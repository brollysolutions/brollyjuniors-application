"""
The student portal: checkout, courses, lessons, textbook, exercises, quizzes,
assignments, live classes, progress and certificates.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..audit import AuditEntry
from ..db import Conn
from ..deps import Actor, requires
from ..entitlement import (
    assert_can_reach, assert_own, course_of_assignment, course_of_lesson, course_of_quiz,
    is_enrolled,
)
from ..errors import bad_request, conflict, forbidden, not_found
from ..media import sign_asset
from ..payments import payments

router = APIRouter()


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class OrderBody(BaseModel):
    courseId: str | None = None
    idempotencyKey: str | None = None


class ConfirmBody(BaseModel):
    token: str | None = None


class EnrollFreeBody(BaseModel):
    courseId: str | None = None


class ProgressBody(BaseModel):
    percent: float = 100
    seconds: float = 60


class RunBody(BaseModel):
    code: str = ""
    stdout: str = ""
    outputs: dict[str, str] = {}


class AnswerBody(BaseModel):
    questionId: str | None = None
    choiceIndex: int | None = None


class SubmitBody(BaseModel):
    body: str = ""
    code: str = ""
    fileName: str = ""


class StudentProfileBody(BaseModel):
    gradeLevel: str | None = None
    guardianName: str | None = None
    guardianEmail: str | None = None
    guardianPhone: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def grade_run(
    tests: list[dict[str, Any]], source: str, outputs: dict[str, str]
) -> dict[str, Any]:
    """
    Grade a run.

    Source rules — "use a loop", "do not use max()" — are checked HERE, on the
    server, against the submitted source, so they cannot be faked from the
    browser. Output matching is trusted from Pyodide in the student's tab, which
    a determined student could forge. That is the standing limitation, and it is
    why exercises are practice rather than assessment.
    """
    results: list[dict[str, Any]] = []
    for t in tests:
        name = t.get("name", "")
        if t.get("requireSource"):
            ok = re.search(t["requireSource"], source, re.M) is not None
            results.append({"name": name, "passed": ok,
                            "detail": "Found in your code" if ok
                                      else t.get("hint", "Not found in your code")})
            continue
        if t.get("forbidSource"):
            bad = re.search(t["forbidSource"], source, re.M) is not None
            results.append({"name": name, "passed": not bad,
                            "detail": t.get("hint", "That is not allowed for this task") if bad
                                      else "Good"})
            continue
        out = outputs.get(name, "")
        expect = t.get("expect")
        ok = (expect in out) if expect else bool(out.strip())
        results.append({"name": name, "passed": ok,
                        "detail": "Output matched" if ok
                                  else t.get("hint", f"Expected to see {expect}")})

    passed = sum(1 for r in results if r["passed"])
    return {"results": results, "passed": passed, "total": len(results)}


async def upsert_progress(
    c: Conn, user_id: str, course_id: str, node_type: str, node_id: str,
    percent: float, seconds: int,
) -> None:
    await c.execute("""
        INSERT INTO progress (id, user_id, course_id, node_type, node_id, status, percent,
                              seconds_spent, attempts, last_activity_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1, now())
        ON CONFLICT (user_id, node_type, node_id) DO UPDATE
          SET status = CASE WHEN excluded.percent >= 100 THEN 'completed' ELSE progress.status END,
              percent = greatest(progress.percent, excluded.percent),
              seconds_spent = progress.seconds_spent + excluded.seconds_spent,
              attempts = progress.attempts + 1,
              last_activity_at = now()""",
        str(uuid.uuid4()), user_id, course_id, node_type, node_id,
        "completed" if percent >= 100 else "in_progress", Decimal(str(percent)), int(seconds),
    )


#: Course completion, computed the same way everywhere.
COMPLETION_SQL = """
  WITH nodes AS (
    SELECT l.id, 'lesson' AS t FROM lesson l JOIN module m ON m.id = l.module_id
      WHERE m.course_id = $2
    UNION ALL
    SELECT e.id, 'exercise' FROM exercise e JOIN lesson l ON l.id = e.lesson_id
      JOIN module m ON m.id = l.module_id WHERE m.course_id = $2
    UNION ALL
    SELECT r.id, 'recording' FROM recording r WHERE r.course_id = $2 AND r.status = 'published'
  )
  SELECT count(*)::int AS total,
         count(p.id) FILTER (WHERE p.status = 'completed')::int AS done
    FROM nodes n
    LEFT JOIN progress p ON p.node_id = n.id AND p.user_id = $1"""


def pct(done: int, total: int) -> int:
    return round(done / total * 100) if total else 0


# ===========================================================================
# Checkout — purchase, then enrolment. Never the other way round.
# ===========================================================================

@router.post("/api/v1/checkout/orders")
async def create_order(body: OrderBody, actor: Actor = Depends(requires("order:create"))):
    if not body.courseId:
        raise bad_request("Choose a course.")

    async with actor.db() as c:
        course = await c.one(
            "SELECT id, title, price_minor, currency FROM course WHERE id = $1 AND status = 'published'",
            body.courseId,
        )
        if course is None:
            raise not_found("No such course.")

        if await is_enrolled(c, actor.user_id, str(course["id"])):
            raise conflict("You are already enrolled in this course.", "already_enrolled")

        # An idempotency key means a double-tapped Pay button cannot create two
        # orders, which is the commonest way a checkout charges twice.
        idem = body.idempotencyKey or f'{actor.user_id}:{course["id"]}'
        existing = await c.one(
            "SELECT id, status, amount_minor, provider_ref FROM course_order WHERE idempotency_key = $1",
            idem,
        )
        if existing and existing["status"] == "pending":
            return {"orderId": str(existing["id"]), "amountMinor": existing["amount_minor"],
                    "providerRef": existing["provider_ref"], "reused": True}

        order_id = str(uuid.uuid4())
        intent = await payments.create_intent(
            order_id=order_id, amount_minor=course["price_minor"],
            currency=course["currency"], email=actor.access.email,
        )
        await c.execute(
            """INSERT INTO course_order (id, user_id, course_id, amount_minor, currency, status,
                                         provider, provider_ref, idempotency_key)
               VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8)""",
            order_id, actor.user_id, course["id"], course["price_minor"], course["currency"],
            payments.name, intent.provider_ref, idem,
        )
        await actor.log_audit(c, AuditEntry(
            action="order.created", entity_type="course_order", entity_id=order_id,
            summary=f'Started checkout for {course["title"]}',
            after={"amount_minor": course["price_minor"], "provider": payments.name},
        ))
        return {
            "orderId": order_id, "amountMinor": course["price_minor"],
            "currency": course["currency"], "providerRef": intent.provider_ref,
            "clientPayload": intent.client_payload,
        }


@router.post("/api/v1/checkout/orders/{order_id}/confirm")
async def confirm_order(
    order_id: str, body: ConfirmBody, actor: Actor = Depends(requires("order:create"))
):
    """
    Confirmation is what grants access — and it is a server-side verification
    with the provider, never the browser reporting that payment went well.
    """
    async with actor.db() as c:
        order = await c.one(
            """SELECT o.id, o.user_id, o.course_id, o.status, o.provider_ref, o.amount_minor,
                      co.title
                 FROM course_order o JOIN course co ON co.id = o.course_id
                WHERE o.id = $1""", order_id)
        if order is None:
            raise not_found("No such order.")
        assert_own(actor.access, order["user_id"])
        if order["status"] == "paid":
            return {"ok": True, "alreadyPaid": True}

        result = await payments.confirm(
            order_id=order_id, provider_ref=order["provider_ref"], token=body.token
        )
        if not result.paid:
            await c.execute("UPDATE course_order SET status = 'failed' WHERE id = $1", order_id)
            await actor.log_audit(c, AuditEntry(
                action="order.failed", entity_type="course_order", entity_id=order_id,
                summary=f'Payment failed for {order["title"]}',
            ))
            raise conflict(result.failure_reason or "That payment did not go through.",
                           "payment_failed")

        await c.execute(
            "UPDATE course_order SET status = 'paid', paid_at = now() WHERE id = $1", order_id
        )
        await c.execute(
            """INSERT INTO enrollment (id, user_id, course_id, status, source, order_id)
               VALUES ($1,$2,$3,'active','purchase',$4)
               ON CONFLICT (user_id, course_id) DO UPDATE SET status = 'active'""",
            str(uuid.uuid4()), order["user_id"], order["course_id"], order_id,
        )
        await c.execute(
            "SELECT notify($1,'enrolment',$2,$3,'mycourses')",
            order["user_id"], f'You are enrolled in {order["title"]}',
            "Everything is unlocked — lessons, the textbook, recordings and live classes.",
        )
        await actor.log_audit(c, AuditEntry(
            action="order.paid", entity_type="course_order", entity_id=order_id,
            summary=f'Paid for {order["title"]} and enrolled',
            after={"amount_minor": order["amount_minor"], "provider_ref": order["provider_ref"]},
        ))
        return {"ok": True, "enrolled": True, "courseId": str(order["course_id"])}


@router.post("/api/v1/checkout/enroll-free")
async def enroll_free(body: EnrollFreeBody, actor: Actor = Depends(requires("order:create"))):
    """Free enrolment, for a course priced at zero. Same path, no payment."""
    async with actor.db() as c:
        course = await c.one(
            "SELECT id, title, price_minor FROM course WHERE id = $1 AND status = 'published'",
            body.courseId,
        )
        if course is None:
            raise not_found("No such course.")
        if course["price_minor"] > 0:
            raise forbidden("That course is not free.")
        await c.execute(
            """INSERT INTO enrollment (id, user_id, course_id, status, source)
               VALUES ($1,$2,$3,'active','free') ON CONFLICT (user_id, course_id) DO NOTHING""",
            str(uuid.uuid4()), actor.user_id, course["id"],
        )
        await actor.log_audit(c, AuditEntry(
            action="enrollment.created", entity_type="course", entity_id=str(course["id"]),
            summary=f'Enrolled in {course["title"]} (free)',
        ))
        return {"ok": True, "courseId": str(course["id"])}


@router.get("/api/v1/student/orders")
async def my_orders(actor: Actor = Depends(requires("order:read:self"))):
    async with actor.db() as c:
        return {"orders": await c.query("""
            SELECT o.id, o.amount_minor, o.currency, o.status, o.created_at, o.paid_at,
                   o.provider, o.provider_ref, co.title AS course
              FROM course_order o JOIN course co ON co.id = o.course_id
             WHERE o.user_id = $1 ORDER BY o.created_at DESC""", actor.user_id)}


# ===========================================================================
# Home and courses
# ===========================================================================

@router.get("/api/v1/student/home")
async def home(actor: Actor = Depends(requires("progress:read:self"))):
    uid = actor.user_id
    async with actor.db() as c:
        courses = await c.query("""
            SELECT c.id, c.slug, c.title, c.subtitle, s.name AS subject,
                   e.status AS enrollment_status, e.enrolled_at, e.completed_at
              FROM enrollment e JOIN course c ON c.id = e.course_id
              JOIN subject s ON s.id = c.subject_id
             WHERE e.user_id = $1 ORDER BY e.enrolled_at DESC""", uid)

        for course in courses:
            r = await c.one(COMPLETION_SQL, uid, course["id"])
            course["total"] = r["total"]
            course["done"] = r["done"]
            course["completion"] = pct(r["done"], r["total"])

        # The genuinely next unfinished thing, not a guess.
        nxt = await c.query("""
            SELECT l.id, l.title, l.est_minutes, m.course_id, c.title AS course,
                   m.title AS module, coalesce(p.percent, 0) AS percent
              FROM lesson l
              JOIN module m ON m.id = l.module_id
              JOIN course c ON c.id = m.course_id
              JOIN enrollment e ON e.course_id = m.course_id AND e.user_id = $1
                   AND e.status = 'active'
              LEFT JOIN progress p ON p.node_id = l.id AND p.user_id = $1
             WHERE coalesce(p.status, 'not_started') <> 'completed'
             ORDER BY (p.percent IS NULL), m.position, l.position LIMIT 3""", uid)

        upcoming = await c.query("""
            SELECT ls.id, ls.title, ls.starts_at, ls.ends_at, ls.status, c.title AS course,
                   u.full_name AS teacher, sa.status AS my_status
              FROM live_session ls
              JOIN course c ON c.id = ls.course_id
              JOIN app_user u ON u.id = ls.teacher_id
              JOIN enrollment e ON e.course_id = ls.course_id AND e.user_id = $1
                   AND e.status = 'active'
              LEFT JOIN session_attendance sa ON sa.live_session_id = ls.id AND sa.user_id = $1
             WHERE ls.starts_at > now() - interval '2 hours' AND ls.status <> 'cancelled'
             ORDER BY ls.starts_at LIMIT 4""", uid)

        due = await c.query("""
            SELECT a.id, a.title, a.due_at, c.title AS course, s.status AS submission_status,
                   s.score, a.max_score
              FROM assignment a
              JOIN course c ON c.id = a.course_id
              JOIN enrollment e ON e.course_id = a.course_id AND e.user_id = $1
                   AND e.status = 'active'
              LEFT JOIN submission s ON s.assignment_id = a.id AND s.user_id = $1
             WHERE a.status = 'published'
             ORDER BY (s.id IS NOT NULL), a.due_at LIMIT 5""", uid)

        stats = await c.one("""
            SELECT (SELECT count(*)::int FROM enrollment WHERE user_id = $1) AS courses,
                   (SELECT coalesce(round(sum(seconds_spent)/60.0)::int, 0) FROM progress
                     WHERE user_id = $1) AS minutes,
                   (SELECT count(*)::int FROM certificate WHERE user_id = $1) AS certificates,
                   (SELECT count(*)::int FROM achievement WHERE user_id = $1) AS badges""", uid)

        return {"courses": courses, "next": nxt, "upcoming": upcoming, "due": due, "stats": stats}


@router.get("/api/v1/student/courses/{course_id}")
async def student_course(course_id: str, actor: Actor = Depends(requires("course:read"))):
    async with actor.db() as c:
        await assert_can_reach(c, actor.access, course_id)
        course = await c.one("""
            SELECT c.id, c.slug, c.title, c.subtitle, c.description, c.level, c.duration_hours,
                   s.name AS subject, e.status AS enrollment_status, e.enrolled_at, e.completed_at
              FROM course c JOIN subject s ON s.id = c.subject_id
              LEFT JOIN enrollment e ON e.course_id = c.id AND e.user_id = $2
             WHERE c.id = $1""", course_id, actor.user_id)
        if course is None:
            raise not_found("No such course.")

        completion = await c.one(COMPLETION_SQL, actor.user_id, course_id)

        return {
            "course": course,
            "completion": {**completion, "percent": pct(completion["done"], completion["total"])},
            "modules": await c.query("""
                SELECT m.id, m.position, m.title, m.summary,
                       coalesce((SELECT json_agg(json_build_object(
                           'id', l.id, 'title', l.title, 'position', l.position,
                           'minutes', l.est_minutes,
                           'status', coalesce(p.status, 'not_started'),
                           'percent', coalesce(p.percent, 0),
                           'exercises', (SELECT count(*)::int FROM exercise ex
                                          WHERE ex.lesson_id = l.id))
                         ORDER BY l.position)
                         FROM lesson l
                         LEFT JOIN progress p ON p.node_id = l.id AND p.user_id = $2
                        WHERE l.module_id = m.id), '[]'::json) AS lessons
                  FROM module m WHERE m.course_id = $1 ORDER BY m.position""",
                course_id, actor.user_id),
            "textbook": await c.one("""
                SELECT t.id, t.title, t.edition,
                       (SELECT count(*)::int FROM chapter ch WHERE ch.textbook_id = t.id) AS chapters
                  FROM textbook t WHERE t.course_id = $1""", course_id),
            "quizzes": await c.query("""
                SELECT q.id, q.title, q.description, q.pass_mark_pct, q.max_attempts,
                       (SELECT count(*)::int FROM question WHERE quiz_id = q.id) AS questions,
                       (SELECT max(score) FROM quiz_attempt a
                         WHERE a.quiz_id = q.id AND a.user_id = $2) AS best_score,
                       (SELECT max(max_score) FROM quiz_attempt a
                         WHERE a.quiz_id = q.id AND a.user_id = $2) AS out_of,
                       (SELECT count(*)::int FROM quiz_attempt a
                         WHERE a.quiz_id = q.id AND a.user_id = $2) AS attempts
                  FROM quiz q WHERE q.course_id = $1 ORDER BY q.title""", course_id, actor.user_id),
            "materials": await c.query("""
                SELECT lm.id, lm.title, lm.description, lm.kind, lm.media_asset_id
                  FROM learning_material lm
                 WHERE lm.course_id = $1 AND lm.status = 'published'
                 ORDER BY lm.position""", course_id),
            "recordings": await c.query("""
                SELECT r.id, r.title, r.description, r.duration_seconds, r.recorded_on,
                       coalesce(p.status, 'not_started') AS status
                  FROM recording r
                  LEFT JOIN progress p ON p.node_id = r.id AND p.user_id = $2
                 WHERE r.course_id = $1 AND r.status = 'published'
                 ORDER BY r.position""", course_id, actor.user_id),
            "assignments": await c.query("""
                SELECT a.id, a.title, a.due_at, a.max_score, s.status AS submission_status,
                       s.score, s.feedback
                  FROM assignment a
                  LEFT JOIN submission s ON s.assignment_id = a.id AND s.user_id = $2
                 WHERE a.course_id = $1 AND a.status = 'published'
                 ORDER BY a.due_at""", course_id, actor.user_id),
        }


# ===========================================================================
# Lessons, textbook, materials, recordings
# ===========================================================================

@router.get("/api/v1/student/lessons/{lesson_id}")
async def lesson(lesson_id: str, actor: Actor = Depends(requires("content:read"))):
    async with actor.db() as c:
        course_id = await course_of_lesson(c, lesson_id)
        await assert_can_reach(c, actor.access, course_id)

        row = await c.one("""
            SELECT l.id, l.title, l.est_minutes, l.position, m.title AS module, m.course_id,
                   cv.body, cv.version_no, cv.published_at
              FROM lesson l
              JOIN module m ON m.id = l.module_id
              LEFT JOIN content_version cv
                ON cv.content_item_id = l.content_item_id AND cv.status = 'published'
                   AND cv.locale = 'en'
             WHERE l.id = $1""", lesson_id)
        if row is None:
            raise not_found("No such lesson.")

        return {
            "lesson": row,
            "exercises": await c.query("""
                SELECT e.id, e.title, e.level, e.brief, coalesce(p.status, 'not_started') AS status
                  FROM exercise e
                  LEFT JOIN progress p ON p.node_id = e.id AND p.user_id = $2
                 WHERE e.lesson_id = $1 ORDER BY e.position""", lesson_id, actor.user_id),
            "progress": await c.one(
                "SELECT status, percent FROM progress WHERE user_id = $1 AND node_id = $2",
                actor.user_id, lesson_id),
            "next": await c.one("""
                SELECT l.id, l.title FROM lesson l
                  JOIN module m ON m.id = l.module_id
                 WHERE m.course_id = $1 AND (m.position, l.position) > (
                   SELECT m2.position, l2.position FROM lesson l2
                     JOIN module m2 ON m2.id = l2.module_id WHERE l2.id = $2)
                 ORDER BY m.position, l.position LIMIT 1""", row["course_id"], lesson_id),
        }


@router.post("/api/v1/student/lessons/{lesson_id}/progress")
async def lesson_progress(
    lesson_id: str, body: ProgressBody, actor: Actor = Depends(requires("progress:read:self"))
):
    percent = max(0, min(100, body.percent))
    seconds = max(0, min(7200, body.seconds))
    async with actor.db() as c:
        course_id = await course_of_lesson(c, lesson_id)
        await assert_can_reach(c, actor.access, course_id)
        await upsert_progress(c, actor.user_id, course_id, "lesson", lesson_id, percent, seconds)
        return {"ok": True, "percent": percent}


@router.get("/api/v1/student/textbooks/{textbook_id}")
async def textbook(textbook_id: str, actor: Actor = Depends(requires("content:read"))):
    async with actor.db() as c:
        book = await c.one(
            "SELECT id, course_id, title, edition FROM textbook WHERE id = $1", textbook_id
        )
        if book is None:
            raise not_found("No such textbook.")
        await assert_can_reach(c, actor.access, str(book["course_id"]))
        return {
            "textbook": book,
            "chapters": await c.query("""
                SELECT ch.id, ch.position, ch.title,
                       coalesce((SELECT json_agg(json_build_object(
                           'id', s.id, 'title', s.title, 'position', s.position)
                         ORDER BY s.position) FROM section s WHERE s.chapter_id = ch.id),
                         '[]'::json) AS sections
                  FROM chapter ch WHERE ch.textbook_id = $1 ORDER BY ch.position""", textbook_id),
        }


@router.get("/api/v1/student/sections/{section_id}")
async def section(section_id: str, actor: Actor = Depends(requires("content:read"))):
    async with actor.db() as c:
        # The RLS policy on section already refuses an unentitled reader; this
        # fetch simply comes back empty, and 404 is the honest answer.
        row = await c.one("""
            SELECT s.id, s.title, ch.title AS chapter, t.title AS textbook, t.course_id,
                   cv.body, cv.version_no, cv.published_at
              FROM section s
              JOIN chapter ch ON ch.id = s.chapter_id
              JOIN textbook t ON t.id = ch.textbook_id
              LEFT JOIN content_version cv
                ON cv.content_item_id = s.content_item_id AND cv.status = 'published'
                   AND cv.locale = 'en'
             WHERE s.id = $1""", section_id)
        if row is None:
            raise not_found("No such section.")
        return {"section": row}


@router.get("/api/v1/student/materials/{material_id}/link")
async def material_link(material_id: str, actor: Actor = Depends(requires("content:read"))):
    """Materials and recordings hand back a short-lived signed link, never a path."""
    async with actor.db() as c:
        row = await c.one("""
            SELECT lm.id, lm.title, lm.course_id, lm.external_url,
                   ma.storage_key, ma.kind, ma.mime_type, ma.bytes, ma.duration_ms,
                   ma.file_name, ma.visibility
              FROM learning_material lm
              LEFT JOIN media_asset ma ON ma.id = lm.media_asset_id
             WHERE lm.id = $1 AND lm.status = 'published'""", material_id)
        if row is None:
            raise not_found("No such material.")
        await assert_can_reach(c, actor.access, str(row["course_id"]))
        if not row["storage_key"]:
            return {"title": row["title"], "url": row["external_url"], "external": True}
        return {"title": row["title"], **sign_asset(row, actor.user_id)}


@router.get("/api/v1/student/recordings")
async def recordings(actor: Actor = Depends(requires("recording:read"))):
    async with actor.db() as c:
        return {"recordings": await c.query("""
            SELECT r.id, r.title, r.description, r.duration_seconds, r.recorded_on,
                   c.title AS course, c.id AS course_id, coalesce(p.percent, 0) AS percent
              FROM recording r
              JOIN course c ON c.id = r.course_id
              JOIN enrollment e ON e.course_id = r.course_id AND e.user_id = $1
              LEFT JOIN progress p ON p.node_id = r.id AND p.user_id = $1
             WHERE r.status = 'published' ORDER BY r.recorded_on DESC NULLS LAST""",
            actor.user_id)}


@router.get("/api/v1/student/recordings/{recording_id}")
async def recording(recording_id: str, actor: Actor = Depends(requires("recording:read"))):
    async with actor.db() as c:
        row = await c.one("""
            SELECT r.id, r.title, r.description, r.duration_seconds, r.recorded_on, r.course_id,
                   c.title AS course, ma.storage_key, ma.kind, ma.mime_type, ma.bytes,
                   ma.duration_ms, ma.file_name, ma.visibility, coalesce(p.percent, 0) AS percent
              FROM recording r
              JOIN course c ON c.id = r.course_id
              LEFT JOIN media_asset ma ON ma.id = r.media_asset_id
              LEFT JOIN progress p ON p.node_id = r.id AND p.user_id = $2
             WHERE r.id = $1 AND r.status = 'published'""", recording_id, actor.user_id)
        if row is None:
            raise not_found("No such recording.")
        await assert_can_reach(c, actor.access, str(row["course_id"]))
        return {
            "recording": row,
            "media": sign_asset(row, actor.user_id) if row["storage_key"] else None,
        }


@router.post("/api/v1/student/recordings/{recording_id}/progress")
async def recording_progress(
    recording_id: str, body: ProgressBody, actor: Actor = Depends(requires("recording:read"))
):
    percent = max(0, min(100, body.percent))
    seconds = max(0, min(21600, body.seconds))
    async with actor.db() as c:
        row = await c.one("SELECT course_id FROM recording WHERE id = $1", recording_id)
        if row is None:
            raise not_found("No such recording.")
        course_id = str(row["course_id"])
        await assert_can_reach(c, actor.access, course_id)
        await upsert_progress(c, actor.user_id, course_id, "recording", recording_id,
                              percent, seconds)
        return {"ok": True}


# ===========================================================================
# Exercises — Python in the browser
# ===========================================================================

@router.get("/api/v1/student/exercises/{exercise_id}")
async def exercise(exercise_id: str, actor: Actor = Depends(requires("exercise:attempt"))):
    async with actor.db() as c:
        ex = await c.one("""
            SELECT e.id, e.title, e.level, e.brief, e.starter_code, e.hints, e.solution,
                   e.test_cases, l.id AS lesson_id, l.title AS lesson, m.course_id
              FROM exercise e JOIN lesson l ON l.id = e.lesson_id
              JOIN module m ON m.id = l.module_id
             WHERE e.id = $1""", exercise_id)
        if ex is None:
            raise not_found("No such exercise.")
        await assert_can_reach(c, actor.access, str(ex["course_id"]))
        last = await c.one(
            """SELECT code FROM exercise_attempt WHERE user_id = $1 AND exercise_id = $2
                ORDER BY created_at DESC LIMIT 1""", actor.user_id, exercise_id)
        return {"exercise": {
            "id": str(ex["id"]), "title": ex["title"], "level": ex["level"], "brief": ex["brief"],
            "lesson": ex["lesson"], "lessonId": str(ex["lesson_id"]),
            "courseId": str(ex["course_id"]),
            "starterCode": (last or {}).get("code") or ex["starter_code"],
            "hints": ex["hints"],
            "solution": ex["solution"],   # practice, so the answer is available
            # Expected outputs are never sent: only the name and the stdin.
            "tests": [{"name": t.get("name"), "stdin": t.get("stdin", "")}
                      for t in (ex["test_cases"] or [])],
        }}


@router.post("/api/v1/student/exercises/{exercise_id}/run")
async def run_exercise(
    exercise_id: str, body: RunBody, actor: Actor = Depends(requires("exercise:attempt"))
):
    async with actor.db() as c:
        ex = await c.one("""
            SELECT e.test_cases, m.course_id FROM exercise e
              JOIN lesson l ON l.id = e.lesson_id JOIN module m ON m.id = l.module_id
             WHERE e.id = $1""", exercise_id)
        if ex is None:
            raise not_found("No such exercise.")
        course_id = str(ex["course_id"])
        await assert_can_reach(c, actor.access, course_id)

        graded = grade_run(ex["test_cases"] or [], body.code, body.outputs)
        await c.execute(
            """INSERT INTO exercise_attempt (id, user_id, exercise_id, code, stdout,
                                             passed_count, total_count)
               VALUES ($1,$2,$3,$4,$5,$6,$7)""",
            str(uuid.uuid4()), actor.user_id, exercise_id, body.code, body.stdout[:8000],
            graded["passed"], graded["total"],
        )

        solved = graded["total"] > 0 and graded["passed"] == graded["total"]
        if solved:
            await upsert_progress(c, actor.user_id, course_id, "exercise", exercise_id, 100, 120)
        return {**graded, "solved": solved}


# ===========================================================================
# Quizzes
# ===========================================================================

@router.get("/api/v1/student/quizzes/{quiz_id}")
async def quiz(quiz_id: str, actor: Actor = Depends(requires("quiz:attempt"))):
    async with actor.db() as c:
        course_id = await course_of_quiz(c, quiz_id)
        await assert_can_reach(c, actor.access, course_id)
        q = await c.one(
            """SELECT id, title, description, pass_mark_pct, time_limit_min, max_attempts,
                      course_id FROM quiz WHERE id = $1""", quiz_id)

        attempts = await c.query("""
            SELECT id, attempt_no, status, score, max_score, passed, submitted_at
              FROM quiz_attempt WHERE quiz_id = $1 AND user_id = $2 ORDER BY attempt_no DESC""",
            quiz_id, actor.user_id)
        open_attempt = next((a for a in attempts if a["status"] == "in_progress"), None)

        # The correct index is never sent to the browser. Marking is server-side.
        questions = await c.query(
            """SELECT id, position, kind, text, options, marks FROM question
                WHERE quiz_id = $1 ORDER BY position""", quiz_id)

        submitted = sum(1 for a in attempts if a["status"] == "submitted")
        return {
            "quiz": q,
            "attempts": attempts,
            "questions": questions,
            "openAttemptId": str(open_attempt["id"]) if open_attempt else None,
            "attemptsLeft": max(0, q["max_attempts"] - submitted),
            "savedAnswers": await c.query(
                "SELECT question_id, choice_index FROM quiz_answer WHERE attempt_id = $1",
                open_attempt["id"]) if open_attempt else [],
        }


@router.post("/api/v1/student/quizzes/{quiz_id}/start")
async def start_quiz(quiz_id: str, actor: Actor = Depends(requires("quiz:attempt"))):
    async with actor.db() as c:
        course_id = await course_of_quiz(c, quiz_id)
        await assert_can_reach(c, actor.access, course_id)
        q = await c.one("SELECT max_attempts FROM quiz WHERE id = $1", quiz_id)

        existing = await c.query(
            """SELECT id, attempt_no, status FROM quiz_attempt
                WHERE quiz_id = $1 AND user_id = $2 ORDER BY attempt_no DESC""",
            quiz_id, actor.user_id)
        open_attempt = next((a for a in existing if a["status"] == "in_progress"), None)
        if open_attempt:
            return {"attemptId": str(open_attempt["id"]), "resumed": True}
        if len(existing) >= q["max_attempts"]:
            raise conflict(
                f'You have used all {q["max_attempts"]} attempts on this quiz.',
                "no_attempts_left")

        max_score = await c.value(
            "SELECT coalesce(sum(marks),0)::numeric FROM question WHERE quiz_id = $1", quiz_id)
        attempt_id = str(uuid.uuid4())
        await c.execute(
            """INSERT INTO quiz_attempt (id, quiz_id, user_id, attempt_no, status, max_score)
               VALUES ($1,$2,$3,$4,'in_progress',$5)""",
            attempt_id, quiz_id, actor.user_id, len(existing) + 1, max_score)
        return {"attemptId": attempt_id, "resumed": False}


@router.post("/api/v1/student/quiz-attempts/{attempt_id}/answer")
async def answer_question(
    attempt_id: str, body: AnswerBody, actor: Actor = Depends(requires("quiz:attempt"))
):
    async with actor.db() as c:
        attempt = await c.one(
            "SELECT id, user_id, quiz_id, status FROM quiz_attempt WHERE id = $1", attempt_id)
        if attempt is None:
            raise not_found("No such attempt.")
        assert_own(actor.access, attempt["user_id"])
        if attempt["status"] != "in_progress":
            raise conflict("That attempt is already submitted.", "already_submitted")

        q = await c.one(
            "SELECT id, answer_index, marks FROM question WHERE id = $1 AND quiz_id = $2",
            body.questionId, attempt["quiz_id"])
        if q is None:
            raise not_found("No such question on this quiz.")

        # Marked here, out of the row the browser never sees.
        is_correct = body.choiceIndex == q["answer_index"]
        await c.execute("""
            INSERT INTO quiz_answer (id, attempt_id, question_id, choice_index, is_correct,
                                     marks_awarded)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (attempt_id, question_id) DO UPDATE
              SET choice_index = excluded.choice_index, is_correct = excluded.is_correct,
                  marks_awarded = excluded.marks_awarded, saved_at = now()""",
            str(uuid.uuid4()), attempt_id, q["id"], body.choiceIndex, is_correct,
            Decimal(str(q["marks"] if is_correct else 0)))
        return {"ok": True, "savedAt": datetime.now(timezone.utc).isoformat()}


@router.post("/api/v1/student/quiz-attempts/{attempt_id}/submit")
async def submit_quiz(attempt_id: str, actor: Actor = Depends(requires("quiz:attempt"))):
    async with actor.db() as c:
        attempt = await c.one("""
            SELECT a.id, a.user_id, a.quiz_id, a.status, a.max_score, q.pass_mark_pct,
                   q.course_id, q.title
              FROM quiz_attempt a JOIN quiz q ON q.id = a.quiz_id WHERE a.id = $1""", attempt_id)
        if attempt is None:
            raise not_found("No such attempt.")
        assert_own(actor.access, attempt["user_id"])
        if attempt["status"] != "in_progress":
            return {"ok": True, "alreadySubmitted": True}

        score = await c.value(
            "SELECT coalesce(sum(marks_awarded),0)::numeric FROM quiz_answer WHERE attempt_id = $1",
            attempt_id)
        max_score = attempt["max_score"] or Decimal(0)
        percent = float(score) / float(max_score) * 100 if max_score else 0.0
        passed = percent >= attempt["pass_mark_pct"]

        await c.execute(
            """UPDATE quiz_attempt SET status='submitted', score=$1, passed=$2, submitted_at=now()
                WHERE id=$3""", score, passed, attempt_id)
        await upsert_progress(c, actor.user_id, str(attempt["course_id"]), "quiz",
                              str(attempt["quiz_id"]), 100, 300)

        if passed:
            await c.execute(
                """INSERT INTO achievement (id, user_id, badge_key) VALUES ($1,$2,'quiz_passed')
                   ON CONFLICT (user_id, badge_key, course_id) DO NOTHING""",
                str(uuid.uuid4()), actor.user_id)

        # Results are immediate — a quiz has no written answers waiting on a human.
        return {
            "ok": True, "score": score, "maxScore": max_score, "passed": passed,
            "percent": round(percent),
            "review": await c.query("""
                SELECT q.position, q.text, q.options, q.answer_index, q.explanation,
                       qa.choice_index, qa.is_correct
                  FROM question q
                  LEFT JOIN quiz_answer qa ON qa.question_id = q.id AND qa.attempt_id = $1
                 WHERE q.quiz_id = $2 ORDER BY q.position""", attempt_id, attempt["quiz_id"]),
        }


# ===========================================================================
# Assignments
# ===========================================================================

@router.get("/api/v1/student/assignments")
async def assignments(actor: Actor = Depends(requires("assignment:read"))):
    async with actor.db() as c:
        return {"assignments": await c.query("""
            SELECT a.id, a.title, a.due_at, a.max_score, c.title AS course, c.id AS course_id,
                   s.id AS submission_id, s.status AS submission_status, s.score, s.feedback,
                   s.submitted_at, s.graded_at
              FROM assignment a
              JOIN course c ON c.id = a.course_id
              JOIN enrollment e ON e.course_id = a.course_id AND e.user_id = $1
              LEFT JOIN submission s ON s.assignment_id = a.id AND s.user_id = $1
             WHERE a.status = 'published' ORDER BY a.due_at""", actor.user_id)}


@router.get("/api/v1/student/assignments/{assignment_id}")
async def assignment(assignment_id: str, actor: Actor = Depends(requires("assignment:read"))):
    async with actor.db() as c:
        course_id = await course_of_assignment(c, assignment_id)
        await assert_can_reach(c, actor.access, course_id)
        a = await c.one("""
            SELECT a.id, a.title, a.instructions, a.rubric, a.max_score, a.due_at,
                   a.allow_resubmit, c.title AS course, c.id AS course_id
              FROM assignment a JOIN course c ON c.id = a.course_id WHERE a.id = $1""",
            assignment_id)
        if a is None:
            raise not_found("No such assignment.")
        return {
            "assignment": a,
            "submission": await c.one(
                """SELECT * FROM submission WHERE assignment_id = $1 AND user_id = $2
                    ORDER BY attempt_no DESC LIMIT 1""", assignment_id, actor.user_id),
        }


@router.post("/api/v1/student/assignments/{assignment_id}/submit")
async def submit_assignment(
    assignment_id: str, body: SubmitBody, actor: Actor = Depends(requires("assignment:submit"))
):
    async with actor.db() as c:
        course_id = await course_of_assignment(c, assignment_id)
        await assert_can_reach(c, actor.access, course_id)
        a = await c.one(
            "SELECT id, title, allow_resubmit, status FROM assignment WHERE id = $1", assignment_id)
        if a is None or a["status"] != "published":
            raise not_found("No such assignment.")

        prev = await c.one("""
            SELECT id, attempt_no, status FROM submission
             WHERE assignment_id = $1 AND user_id = $2 ORDER BY attempt_no DESC LIMIT 1""",
            assignment_id, actor.user_id)

        if prev and prev["status"] == "graded" and not a["allow_resubmit"]:
            raise conflict(
                "This has already been graded and does not allow resubmission.", "already_graded")

        text = body.body[:20000]
        code = body.code[:20000]
        if not text.strip() and not code.strip() and not body.fileName:
            raise bad_request("Write something, or attach a file.")

        if prev and prev["status"] != "graded":
            await c.execute(
                """UPDATE submission SET body=$1, code=$2, file_name=$3, status='submitted',
                          submitted_at=now() WHERE id=$4""",
                text, code, body.fileName, prev["id"])
            return {"ok": True, "submissionId": str(prev["id"]), "resubmitted": True}

        sub_id = str(uuid.uuid4())
        await c.execute(
            """INSERT INTO submission (id, assignment_id, user_id, attempt_no, body, code,
                                       file_name, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted')""",
            sub_id, assignment_id, actor.user_id,
            (prev["attempt_no"] if prev else 0) + 1, text, code, body.fileName)
        return {"ok": True, "submissionId": sub_id}


# ===========================================================================
# Live classes
# ===========================================================================

@router.get("/api/v1/student/live")
async def live(actor: Actor = Depends(requires("live:attend"))):
    async with actor.db() as c:
        return {"sessions": await c.query("""
            SELECT ls.id, ls.title, ls.description, ls.starts_at, ls.ends_at, ls.status,
                   c.title AS course, c.id AS course_id, u.full_name AS teacher,
                   sa.status AS my_status
              FROM live_session ls
              JOIN course c ON c.id = ls.course_id
              JOIN app_user u ON u.id = ls.teacher_id
              JOIN enrollment e ON e.course_id = ls.course_id AND e.user_id = $1
              LEFT JOIN session_attendance sa ON sa.live_session_id = ls.id AND sa.user_id = $1
             ORDER BY ls.starts_at DESC""", actor.user_id)}


@router.post("/api/v1/student/live/{session_id}/join")
async def join_live(session_id: str, actor: Actor = Depends(requires("live:attend"))):
    """
    The meeting link is issued at join time, and only inside the window. Putting
    it in the list response would make it shareable days in advance.
    """
    async with actor.db() as c:
        s = await c.one("""
            SELECT ls.id, ls.title, ls.course_id, ls.starts_at, ls.ends_at, ls.meeting_url,
                   ls.status FROM live_session ls WHERE ls.id = $1""", session_id)
        if s is None:
            raise not_found("No such session.")
        await assert_can_reach(c, actor.access, str(s["course_id"]))

        now = datetime.now(timezone.utc)
        if now < s["starts_at"] - timedelta(minutes=15):
            raise conflict("The room opens fifteen minutes before the start time.", "too_early")
        if now > s["ends_at"] + timedelta(minutes=30) or s["status"] == "ended":
            raise conflict(
                "That session has finished. The recording appears here once it is uploaded.",
                "session_ended")

        await c.execute("""
            INSERT INTO session_attendance (live_session_id, user_id, status, joined_at)
            VALUES ($1,$2,'attended', now())
            ON CONFLICT (live_session_id, user_id) DO UPDATE
              SET status = 'attended',
                  joined_at = coalesce(session_attendance.joined_at, now())""",
            session_id, actor.user_id)
        return {"meetingUrl": s["meeting_url"], "title": s["title"]}


@router.post("/api/v1/student/live/{session_id}/register")
async def register_live(session_id: str, actor: Actor = Depends(requires("live:attend"))):
    async with actor.db() as c:
        s = await c.one("SELECT id, course_id FROM live_session WHERE id = $1", session_id)
        if s is None:
            raise not_found("No such session.")
        await assert_can_reach(c, actor.access, str(s["course_id"]))
        await c.execute("""
            INSERT INTO session_attendance (live_session_id, user_id, status)
            VALUES ($1,$2,'registered')
            ON CONFLICT (live_session_id, user_id) DO NOTHING""", session_id, actor.user_id)
        return {"ok": True}


# ===========================================================================
# Progress, certificates, profile
# ===========================================================================

@router.get("/api/v1/student/progress")
async def progress(actor: Actor = Depends(requires("progress:read:self"))):
    uid = actor.user_id
    async with actor.db() as c:
        courses = await c.query("""
            SELECT c.id, c.title, s.name AS subject, e.status, e.enrolled_at, e.completed_at
              FROM enrollment e JOIN course c ON c.id = e.course_id
              JOIN subject s ON s.id = c.subject_id
             WHERE e.user_id = $1 ORDER BY e.enrolled_at""", uid)
        for course in courses:
            r = await c.one(COMPLETION_SQL, uid, course["id"])
            course["total"] = r["total"]
            course["done"] = r["done"]
            course["completion"] = pct(r["done"], r["total"])
            course["quiz"] = await c.one("""
                SELECT count(*)::int AS taken,
                       round(avg(a.score / nullif(a.max_score,0)) * 100)::int AS avg_pct,
                       count(*) FILTER (WHERE a.passed)::int AS passed
                  FROM quiz_attempt a JOIN quiz q ON q.id = a.quiz_id
                 WHERE q.course_id = $1 AND a.user_id = $2 AND a.status = 'submitted'""",
                course["id"], uid)

        return {
            "courses": courses,
            "stats": await c.one("""
                SELECT (SELECT coalesce(round(sum(seconds_spent)/60.0)::int,0) FROM progress
                         WHERE user_id=$1) AS minutes,
                       (SELECT count(*)::int FROM exercise_attempt WHERE user_id=$1)
                         AS exercise_attempts,
                       (SELECT count(*)::int FROM submission WHERE user_id=$1 AND status='graded')
                         AS graded,
                       (SELECT round(avg(score))::int FROM submission
                         WHERE user_id=$1 AND score IS NOT NULL) AS avg_assignment""", uid),
            "badges": await c.query(
                "SELECT badge_key, earned_at FROM achievement WHERE user_id = $1 ORDER BY earned_at DESC",
                uid),
            "recent": await c.query("""
                SELECT p.node_type, p.status, p.last_activity_at, c.title AS course
                  FROM progress p JOIN course c ON c.id = p.course_id
                 WHERE p.user_id = $1 ORDER BY p.last_activity_at DESC LIMIT 12""", uid),
        }


@router.get("/api/v1/student/certificates")
async def certificates(actor: Actor = Depends(requires("certificate:read"))):
    async with actor.db() as c:
        return {"certificates": await c.query("""
            SELECT cert.id, cert.serial, cert.verification_code, cert.final_score, cert.issued_at,
                   c.title AS course, c.level
              FROM certificate cert JOIN course c ON c.id = cert.course_id
             WHERE cert.user_id = $1 ORDER BY cert.issued_at DESC""", actor.user_id)}


@router.get("/api/v1/student/profile")
async def get_profile(actor: Actor = Depends(requires("me:read"))):
    async with actor.db() as c:
        return {"profile": await c.one("""
            SELECT u.id, u.full_name, u.email, u.phone, u.created_at,
                   sp.grade_level, sp.guardian_name, sp.guardian_email, sp.guardian_phone,
                   sp.consent_status
              FROM app_user u LEFT JOIN student_profile sp ON sp.user_id = u.id
             WHERE u.id = $1""", actor.user_id)}


@router.patch("/api/v1/student/profile")
async def patch_profile(
    body: StudentProfileBody, actor: Actor = Depends(requires("me:read"))
):
    async with actor.db() as c:
        await c.execute("""
            UPDATE student_profile
               SET grade_level = coalesce($1, grade_level),
                   guardian_name = coalesce($2, guardian_name),
                   guardian_email = coalesce($3, guardian_email),
                   guardian_phone = coalesce($4, guardian_phone)
             WHERE user_id = $5""",
            body.gradeLevel, body.guardianName, body.guardianEmail, body.guardianPhone,
            actor.user_id)
        return {"ok": True}
