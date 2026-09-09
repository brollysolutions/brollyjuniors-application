"""
Teacher routes.

A Brolly Juniors teacher, employed by Brolly, not attached to any school and
not owned by any student. Every student they can reach is reached through a
course they teach — there is no stored student/teacher link to shortcut, and
the database enforces that too.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..audit import AuditEntry
from ..deps import Actor, requires
from ..entitlement import assert_can_reach, assert_can_see_student, assert_teaches
from ..errors import bad_request, conflict, not_found
from ..media import sign_asset

router = APIRouter()

#: The default Brolly rubric. Students see it before they start, which is the
#: point — the four things that get marked are never a surprise.
DEFAULT_RUBRIC: list[dict[str, Any]] = [
    {"key": "correct", "label": "Does what was asked", "max": 4},
    {"key": "approach", "label": "Sensible approach", "max": 3},
    {"key": "readable", "label": "Readable and commented", "max": 2},
    {"key": "ontime", "label": "Submitted on time", "max": 1},
]


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class GradeBody(BaseModel):
    action: str = ""
    scores: dict[str, Any] = {}
    feedback: str = ""


class LiveStatusBody(BaseModel):
    status: str = ""


class Mark(BaseModel):
    userId: str | None = None
    status: str = ""


class AttendanceBody(BaseModel):
    marks: list[Mark] = []


class AssignmentBody(BaseModel):
    courseId: str | None = None
    moduleId: str | None = None
    title: str = ""
    brief: str = ""
    instructions: list[Any] | None = None
    rubric: list[Any] | None = None
    maxScore: int | None = None
    dueAt: str | None = None


def _parse_due(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        due = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise bad_request("That due date could not be read.")
    return due if due.tzinfo else due.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

@router.get("/api/v1/teacher/overview")
async def overview(actor: Actor = Depends(requires("progress:read:course"))):
    uid = actor.user_id
    async with actor.db() as c:
        return {
            "courses": await c.query("""
                SELECT c.id, c.title, c.subtitle, s.name AS subject, ct.role,
                       (SELECT count(*)::int FROM enrollment e WHERE e.course_id = c.id AND e.status = 'active') AS students,
                       (SELECT count(*)::int FROM lesson l JOIN module m ON m.id = l.module_id
                         WHERE m.course_id = c.id) AS lessons
                  FROM course_teacher ct
                  JOIN course c ON c.id = ct.course_id
                  JOIN subject s ON s.id = c.subject_id
                 WHERE ct.user_id = $1 ORDER BY c.title""", uid),

            "stats": await c.one("""
                SELECT
                  (SELECT count(DISTINCT e.user_id)::int FROM enrollment e
                     JOIN course_teacher ct ON ct.course_id = e.course_id AND ct.user_id = $1
                    WHERE e.status = 'active') AS students,
                  (SELECT count(*)::int FROM submission s
                     JOIN assignment a ON a.id = s.assignment_id
                     JOIN course_teacher ct ON ct.course_id = a.course_id AND ct.user_id = $1
                    WHERE s.status = 'submitted') AS to_grade,
                  (SELECT count(*)::int FROM live_session ls
                    WHERE ls.teacher_id = $1 AND ls.starts_at > now() AND ls.status = 'scheduled') AS upcoming,
                  (SELECT count(*)::int FROM live_session ls
                    WHERE ls.teacher_id = $1 AND ls.status = 'ended') AS delivered""", uid),

            "upcoming": await c.query("""
                SELECT ls.id, ls.title, ls.starts_at, ls.ends_at, ls.status, c.title AS course,
                       (SELECT count(*)::int FROM session_attendance sa
                         WHERE sa.live_session_id = ls.id AND sa.status = 'registered') AS registered
                  FROM live_session ls JOIN course c ON c.id = ls.course_id
                 WHERE ls.teacher_id = $1 AND ls.starts_at > now() - interval '2 hours'
                 ORDER BY ls.starts_at LIMIT 5""", uid),

            "recentGrading": await c.query("""
                SELECT s.id, s.submitted_at, u.full_name AS student, a.title AS assignment, c.title AS course
                  FROM submission s
                  JOIN assignment a ON a.id = s.assignment_id
                  JOIN course c ON c.id = a.course_id
                  JOIN course_teacher ct ON ct.course_id = a.course_id AND ct.user_id = $1
                  JOIN app_user u ON u.id = s.user_id
                 WHERE s.status = 'submitted' ORDER BY s.submitted_at LIMIT 8""", uid),
        }


@router.get("/api/v1/teacher/courses/{course_id}")
async def teacher_course(course_id: str, actor: Actor = Depends(requires("course:read"))):
    async with actor.db() as c:
        await assert_teaches(c, actor.access, course_id)
        course = await c.one("""
            SELECT c.id, c.title, c.subtitle, c.level, c.duration_hours, s.name AS subject
              FROM course c JOIN subject s ON s.id = c.subject_id WHERE c.id = $1""", course_id)
        if course is None:
            raise not_found("No such course.")

        return {
            "course": course,
            "modules": await c.query("""
                SELECT m.id, m.position, m.title, m.summary,
                       coalesce((SELECT json_agg(json_build_object('id', l.id, 'title', l.title, 'position', l.position)
                         ORDER BY l.position) FROM lesson l WHERE l.module_id = m.id), '[]'::json) AS lessons
                  FROM module m WHERE m.course_id = $1 ORDER BY m.position""", course_id),

            "students": await c.query("""
                WITH nodes AS (
                  SELECT l.id FROM lesson l JOIN module m ON m.id = l.module_id WHERE m.course_id = $1
                  UNION ALL
                  SELECT e.id FROM exercise e JOIN lesson l ON l.id = e.lesson_id
                    JOIN module m ON m.id = l.module_id WHERE m.course_id = $1
                  UNION ALL
                  SELECT r.id FROM recording r WHERE r.course_id = $1 AND r.status = 'published')
                SELECT u.id, u.full_name, u.email, u.last_login_at, e.status, e.enrolled_at,
                       (SELECT count(*)::int FROM nodes) AS total_nodes,
                       (SELECT count(*)::int FROM progress p
                         WHERE p.user_id = u.id AND p.status='completed'
                           AND p.node_id IN (SELECT id FROM nodes)) AS done,
                       (SELECT round(avg(a.score / nullif(a.max_score,0)) * 100)::int
                          FROM quiz_attempt a JOIN quiz q ON q.id = a.quiz_id
                         WHERE q.course_id = $1 AND a.user_id = u.id AND a.status='submitted') AS quiz_pct,
                       (SELECT max(p.last_activity_at) FROM progress p WHERE p.user_id = u.id) AS last_seen
                  FROM enrollment e JOIN app_user u ON u.id = e.user_id
                 WHERE e.course_id = $1 ORDER BY u.full_name LIMIT 300""", course_id),

            "assignments": await c.query("""
                SELECT a.id, a.title, a.due_at, a.max_score, a.status,
                       (SELECT count(*)::int FROM submission s WHERE s.assignment_id = a.id) AS submitted,
                       (SELECT count(*)::int FROM submission s WHERE s.assignment_id = a.id AND s.status='submitted') AS to_grade
                  FROM assignment a WHERE a.course_id = $1 ORDER BY a.due_at DESC""", course_id),

            "quizzes": await c.query("""
                SELECT q.id, q.title, q.pass_mark_pct,
                       (SELECT count(*)::int FROM question WHERE quiz_id = q.id) AS questions,
                       (SELECT count(*)::int FROM quiz_attempt a WHERE a.quiz_id = q.id AND a.status='submitted') AS attempts,
                       (SELECT round(avg(a.score / nullif(a.max_score,0))*100)::int FROM quiz_attempt a
                         WHERE a.quiz_id = q.id AND a.status='submitted') AS avg_pct
                  FROM quiz q WHERE q.course_id = $1 ORDER BY q.title""", course_id),
        }


# ---------------------------------------------------------------------------
# Students — reached only through a course
# ---------------------------------------------------------------------------

@router.get("/api/v1/teacher/students")
async def students(actor: Actor = Depends(requires("progress:read:course"))):
    async with actor.db() as c:
        return {"students": await c.query("""
            SELECT DISTINCT u.id, u.full_name, u.email, u.last_login_at,
                   (SELECT string_agg(DISTINCT c2.title, ', ')
                      FROM enrollment e2 JOIN course c2 ON c2.id = e2.course_id
                      JOIN course_teacher ct2 ON ct2.course_id = c2.id AND ct2.user_id = $1
                     WHERE e2.user_id = u.id) AS courses,
                   (SELECT max(p.last_activity_at) FROM progress p WHERE p.user_id = u.id) AS last_seen,
                   (SELECT count(*)::int FROM submission s
                      JOIN assignment a ON a.id = s.assignment_id
                      JOIN course_teacher ct3 ON ct3.course_id = a.course_id AND ct3.user_id = $1
                     WHERE s.user_id = u.id AND s.status = 'submitted') AS awaiting_grade
              FROM enrollment e
              JOIN course_teacher ct ON ct.course_id = e.course_id AND ct.user_id = $1
              JOIN app_user u ON u.id = e.user_id
             WHERE e.status IN ('active','completed')
             ORDER BY u.full_name LIMIT 400""", actor.user_id)}


@router.get("/api/v1/teacher/students/{student_id}")
async def student_detail(
    student_id: str, actor: Actor = Depends(requires("progress:read:course"))
):
    uid = actor.user_id
    async with actor.db() as c:
        await assert_can_see_student(c, actor.access, student_id)
        student = await c.one(
            "SELECT id, full_name, email, last_login_at, created_at FROM app_user WHERE id = $1",
            student_id,
        )
        if student is None:
            raise not_found("No such student.")

        return {
            # Note what is absent: date of birth, guardian contact. The RLS
            # policy on student_profile does not admit a teacher, so a query
            # for it here would simply return nothing.
            "student": student,
            "courses": await c.query("""
                SELECT c.id, c.title, e.status, e.enrolled_at,
                       (SELECT count(*)::int FROM progress p WHERE p.user_id = $1 AND p.course_id = c.id
                          AND p.status = 'completed') AS done
                  FROM enrollment e
                  JOIN course c ON c.id = e.course_id
                  JOIN course_teacher ct ON ct.course_id = c.id AND ct.user_id = $2
                 WHERE e.user_id = $1""", student_id, uid),

            "quizzes": await c.query("""
                SELECT q.title, a.score, a.max_score, a.passed, a.submitted_at, c.title AS course
                  FROM quiz_attempt a
                  JOIN quiz q ON q.id = a.quiz_id
                  JOIN course c ON c.id = q.course_id
                  JOIN course_teacher ct ON ct.course_id = q.course_id AND ct.user_id = $2
                 WHERE a.user_id = $1 AND a.status = 'submitted'
                 ORDER BY a.submitted_at DESC""", student_id, uid),

            "submissions": await c.query("""
                SELECT s.id, s.status, s.score, s.submitted_at, s.graded_at, a.title, a.max_score
                  FROM submission s
                  JOIN assignment a ON a.id = s.assignment_id
                  JOIN course_teacher ct ON ct.course_id = a.course_id AND ct.user_id = $2
                 WHERE s.user_id = $1 ORDER BY s.submitted_at DESC""", student_id, uid),

            "recent": await c.query("""
                SELECT p.node_type, p.status, p.last_activity_at, c.title AS course
                  FROM progress p
                  JOIN course c ON c.id = p.course_id
                  JOIN course_teacher ct ON ct.course_id = p.course_id AND ct.user_id = $2
                 WHERE p.user_id = $1 ORDER BY p.last_activity_at DESC LIMIT 12""", student_id, uid),
        }


# ===========================================================================
# Grading
# ===========================================================================

@router.get("/api/v1/teacher/grading")
async def grading(actor: Actor = Depends(requires("assignment:grade"))):
    async with actor.db() as c:
        return {"submissions": await c.query("""
            SELECT s.id, s.status, s.score, s.submitted_at, s.graded_at, s.attempt_no,
                   a.title AS assignment, a.max_score, c.title AS course, u.full_name AS student
              FROM submission s
              JOIN assignment a ON a.id = s.assignment_id
              JOIN course c ON c.id = a.course_id
              JOIN course_teacher ct ON ct.course_id = a.course_id AND ct.user_id = $1
              JOIN app_user u ON u.id = s.user_id
             ORDER BY (s.status = 'submitted') DESC, s.submitted_at LIMIT 100""", actor.user_id)}


@router.get("/api/v1/teacher/submissions/{submission_id}")
async def submission(submission_id: str, actor: Actor = Depends(requires("assignment:grade"))):
    async with actor.db() as c:
        s = await c.one("""
            SELECT s.*, a.title AS assignment, a.instructions, a.rubric, a.max_score, a.course_id,
                   u.full_name AS student, u.email
              FROM submission s
              JOIN assignment a ON a.id = s.assignment_id
              JOIN app_user u ON u.id = s.user_id
             WHERE s.id = $1""", submission_id)
        if s is None:
            raise not_found("No such submission.")
        await assert_teaches(c, actor.access, str(s["course_id"]))
        return {"submission": s}


@router.post("/api/v1/teacher/submissions/{submission_id}/grade")
async def grade_submission(
    submission_id: str, body: GradeBody, actor: Actor = Depends(requires("assignment:grade"))
):
    async with actor.db() as c:
        s = await c.one("""
            SELECT s.id, s.user_id, s.score, a.rubric, a.max_score, a.title, a.course_id
              FROM submission s JOIN assignment a ON a.id = s.assignment_id
             WHERE s.id = $1""", submission_id)
        if s is None:
            raise not_found("No such submission.")
        await assert_teaches(c, actor.access, str(s["course_id"]))

        if body.action == "return":
            await c.execute(
                "UPDATE submission SET status='returned', feedback=$1, graded_by=$2 WHERE id=$3",
                body.feedback, actor.user_id, submission_id,
            )
            await c.execute(
                "SELECT notify($1,'grade',$2,$3,'assignments')",
                s["user_id"], "An assignment came back",
                f'Your teacher asked for another go at "{s["title"]}".',
            )
            await actor.log_audit(c, AuditEntry(
                action="submission.returned", entity_type="submission", entity_id=submission_id,
                summary=f'Returned "{s["title"]}" for another attempt',
            ))
            return {"ok": True, "status": "returned"}

        rubric = s["rubric"] or []
        scores: dict[str, int] = {}
        total = 0
        for r in rubric:
            try:
                raw = int(body.scores.get(r["key"], 0) or 0)
            except (TypeError, ValueError):
                raise bad_request(f'"{r["label"]}" must be between 0 and {r["max"]}.')
            if raw < 0 or raw > r["max"]:
                raise bad_request(f'"{r["label"]}" must be between 0 and {r["max"]}.')
            scores[r["key"]] = raw
            total += raw

        await c.execute(
            """UPDATE submission SET status='graded', rubric_scores=$1, score=$2, feedback=$3,
                      graded_by=$4, graded_at=now() WHERE id=$5""",
            scores, Decimal(str(total)), body.feedback, actor.user_id, submission_id,
        )
        # notify() is the only way a notification is created — see 005_notify.sql.
        await c.execute(
            "SELECT notify($1,'grade',$2,$3,'assignments')",
            s["user_id"], "An assignment was graded",
            f'"{s["title"]}" scored {total} out of {s["max_score"]}.',
        )
        await actor.log_audit(c, AuditEntry(
            action="submission.graded", entity_type="submission", entity_id=submission_id,
            summary=f'Graded "{s["title"]}": {total}/{s["max_score"]}',
            before={"score": s["score"]}, after={"score": total, "feedback": body.feedback},
        ))
        return {"ok": True, "score": total}


# ===========================================================================
# Live classes
# ===========================================================================

@router.get("/api/v1/teacher/live")
async def live(actor: Actor = Depends(requires("live:read"))):
    async with actor.db() as c:
        return {"sessions": await c.query("""
            SELECT ls.id, ls.title, ls.description, ls.starts_at, ls.ends_at, ls.status, ls.meeting_url,
                   c.title AS course, c.id AS course_id,
                   (SELECT count(*)::int FROM session_attendance sa WHERE sa.live_session_id = ls.id) AS registered,
                   (SELECT count(*)::int FROM session_attendance sa
                     WHERE sa.live_session_id = ls.id AND sa.status = 'attended') AS attended,
                   (SELECT count(*)::int FROM enrollment e
                     WHERE e.course_id = ls.course_id AND e.status = 'active') AS enrolled
              FROM live_session ls JOIN course c ON c.id = ls.course_id
             WHERE ls.teacher_id = $1 ORDER BY ls.starts_at DESC""", actor.user_id)}


@router.get("/api/v1/teacher/live/{session_id}")
async def live_session(session_id: str, actor: Actor = Depends(requires("live:read"))):
    async with actor.db() as c:
        s = await c.one("""
            SELECT ls.*, c.title AS course FROM live_session ls JOIN course c ON c.id = ls.course_id
             WHERE ls.id = $1""", session_id)
        if s is None:
            raise not_found("No such session.")
        await assert_can_reach(c, actor.access, str(s["course_id"]))
        return {
            "session": s,
            "attendance": await c.query("""
                SELECT sa.status, sa.joined_at, u.id AS user_id, u.full_name
                  FROM enrollment e
                  JOIN app_user u ON u.id = e.user_id
                  LEFT JOIN session_attendance sa ON sa.live_session_id = $1 AND sa.user_id = u.id
                 WHERE e.course_id = $2 AND e.status = 'active'
                 ORDER BY u.full_name""", session_id, s["course_id"]),
        }


@router.post("/api/v1/teacher/live/{session_id}/status")
async def set_live_status(
    session_id: str, body: LiveStatusBody, actor: Actor = Depends(requires("live:host"))
):
    if body.status not in ("live", "ended"):
        raise bad_request("A session can be started or ended.")

    async with actor.db() as c:
        s = await c.one("SELECT id, teacher_id, title FROM live_session WHERE id = $1", session_id)
        if s is None:
            raise not_found("No such session.")
        if str(s["teacher_id"]) != actor.user_id and actor.role != "BROLLY_ADMIN":
            raise conflict("Only the assigned teacher can start or end this session.", "not_host")

        await c.execute("UPDATE live_session SET status = $1 WHERE id = $2", body.status, session_id)
        await actor.log_audit(c, AuditEntry(
            action=f"live.{body.status}", entity_type="live_session", entity_id=session_id,
            summary=f'{"Started" if body.status == "live" else "Ended"} "{s["title"]}"',
        ))
        return {"ok": True, "status": body.status}


@router.post("/api/v1/teacher/live/{session_id}/attendance")
async def mark_attendance(
    session_id: str, body: AttendanceBody, actor: Actor = Depends(requires("live:attendance"))
):
    async with actor.db() as c:
        s = await c.one("SELECT id, course_id FROM live_session WHERE id = $1", session_id)
        if s is None:
            raise not_found("No such session.")
        await assert_teaches(c, actor.access, str(s["course_id"]))

        for m in body.marks:
            if m.status not in ("attended", "absent", "registered") or not m.userId:
                continue
            await c.execute("""
                INSERT INTO session_attendance (live_session_id, user_id, status) VALUES ($1,$2,$3)
                ON CONFLICT (live_session_id, user_id) DO UPDATE SET status = excluded.status""",
                session_id, m.userId, m.status)

        await actor.log_audit(c, AuditEntry(
            action="live.attendance", entity_type="live_session", entity_id=session_id,
            summary=f"Marked attendance for {len(body.marks)} students",
        ))
        return {"ok": True, "marked": len(body.marks)}


# ===========================================================================
# Assignments a teacher owns
# ===========================================================================

@router.post("/api/v1/teacher/assignments")
async def create_assignment(
    body: AssignmentBody, actor: Actor = Depends(requires("assignment:manage"))
):
    title = body.title.strip()
    if not body.courseId or not title:
        raise bad_request("Choose a course and give it a title.")
    due_at = _parse_due(body.dueAt)

    async with actor.db() as c:
        await assert_teaches(c, actor.access, body.courseId)
        assignment_id = str(uuid.uuid4())
        await c.execute(
            """INSERT INTO assignment (id, course_id, module_id, created_by, title, instructions, rubric,
                                       max_score, due_at, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'published')""",
            assignment_id, body.courseId, body.moduleId, actor.user_id, title,
            body.instructions if body.instructions is not None
            else [{"type": "paragraph", "text": body.brief}],
            body.rubric if body.rubric is not None else DEFAULT_RUBRIC,
            body.maxScore or 10, due_at,
        )

        n = await c.value(
            "SELECT count(*)::int FROM enrollment WHERE course_id = $1 AND status = 'active'",
            body.courseId,
        )
        await actor.log_audit(c, AuditEntry(
            action="assignment.created", entity_type="assignment", entity_id=assignment_id,
            summary=f'Created "{title}" for {n} students',
            after={"title": title, "due_at": due_at.isoformat() if due_at else None},
        ))
        return {"id": assignment_id, "students": n}


# ===========================================================================
# Recordings
# ===========================================================================

@router.get("/api/v1/teacher/recordings")
async def recordings(actor: Actor = Depends(requires("recording:read"))):
    async with actor.db() as c:
        return {"recordings": await c.query("""
            SELECT r.id, r.title, r.description, r.duration_seconds, r.recorded_on, r.status,
                   c.title AS course, c.id AS course_id
              FROM recording r
              JOIN course c ON c.id = r.course_id
              JOIN course_teacher ct ON ct.course_id = r.course_id AND ct.user_id = $1
             ORDER BY r.recorded_on DESC NULLS LAST""", actor.user_id)}


@router.get("/api/v1/teacher/recordings/{recording_id}")
async def recording(recording_id: str, actor: Actor = Depends(requires("recording:read"))):
    async with actor.db() as c:
        row = await c.one("""
            SELECT r.*, c.title AS course, ma.storage_key, ma.kind, ma.mime_type, ma.bytes,
                   ma.duration_ms, ma.file_name, ma.visibility
              FROM recording r JOIN course c ON c.id = r.course_id
              LEFT JOIN media_asset ma ON ma.id = r.media_asset_id
             WHERE r.id = $1""", recording_id)
        if row is None:
            raise not_found("No such recording.")
        await assert_can_reach(c, actor.access, str(row["course_id"]))
        return {
            "recording": row,
            "media": sign_asset(row, actor.user_id) if row["storage_key"] else None,
        }
