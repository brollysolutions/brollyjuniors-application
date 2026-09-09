"""
Brolly Admin: the whole platform.

The Content Hub lives here. Its central promise — requirement 15 — is that
publishing a new version of a chapter reaches students with no deploy of any
kind. That is achieved by writing a new immutable content_version, archiving
the previous one and moving a single release pointer, all in one transaction.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..access import invalidate_access
from ..audit import AuditEntry
from ..core.passwords import hash_password, sha256, temp_password
from ..deps import Actor, requires
from ..errors import bad_request, conflict, not_found
from ..media import storage_key_for

router = APIRouter()

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SLUG_RE = re.compile(r"^[a-z0-9-]{3,60}$")


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class CourseBody(BaseModel):
    title: str = ""
    slug: str = ""
    subtitle: str = ""
    description: str = ""
    subjectId: str | None = None
    level: str = "Beginner"
    ageRange: str = "11–16"
    durationHours: int | None = None
    priceMinor: int | None = None


class CoursePatchBody(BaseModel):
    title: str | None = None
    subtitle: str | None = None
    description: str | None = None
    level: str | None = None
    durationHours: int | None = None
    priceMinor: int | None = None


class StatusBody(BaseModel):
    status: str = ""


class CourseTeacherBody(BaseModel):
    teacherId: str | None = None
    role: str = "assistant"
    remove: bool = False


class DraftBody(BaseModel):
    body: Any = None
    changelog: str = ""


class MediaBody(BaseModel):
    fileName: str = ""
    sha256: str = ""
    kind: str = "pdf"
    mimeType: str = "application/pdf"
    bytes: int | None = None
    durationMs: int | None = None
    visibility: str = "protected"


class LiveBody(BaseModel):
    courseId: str | None = None
    teacherId: str | None = None
    moduleId: str | None = None
    title: str = ""
    description: str = ""
    startsAt: str = ""
    durationMinutes: int | None = None
    provider: str = "manual"
    meetingUrl: str = ""
    capacity: int | None = None


class TeacherBody(BaseModel):
    fullName: str = ""
    email: str = ""
    phone: str = ""
    headline: str = ""
    bio: str = ""
    expertise: list[str] = []
    yearsExp: int | None = None
    courseIds: list[str] = []


# ---------------------------------------------------------------------------
# Overview and analytics
# ---------------------------------------------------------------------------

@router.get("/api/v1/admin/overview")
async def overview(actor: Actor = Depends(requires("analytics:read:platform"))):
    async with actor.db() as c:
        return {
            "totals": await c.one("""
                SELECT
                  (SELECT count(*)::int FROM app_user u JOIN user_role ur ON ur.user_id=u.id
                     JOIN role r ON r.id=ur.role_id AND r.key='STUDENT' WHERE u.deleted_at IS NULL) AS students,
                  (SELECT count(DISTINCT p.user_id)::int FROM progress p
                    WHERE p.last_activity_at > now() - interval '7 days') AS active_students,
                  (SELECT count(*)::int FROM app_user u JOIN user_role ur ON ur.user_id=u.id
                     JOIN role r ON r.id=ur.role_id AND r.key='TEACHER' WHERE u.deleted_at IS NULL) AS teachers,
                  (SELECT count(*)::int FROM course WHERE status='published') AS courses,
                  (SELECT count(*)::int FROM enrollment) AS enrolments,
                  (SELECT count(*)::int FROM enrollment WHERE status='completed') AS completions,
                  (SELECT coalesce(sum(amount_minor),0)::bigint FROM course_order WHERE status='paid') AS revenue_minor,
                  (SELECT count(*)::int FROM course_order WHERE status='paid') AS paid_orders,
                  (SELECT count(*)::int FROM live_session WHERE starts_at > now() AND status='scheduled') AS upcoming_live,
                  (SELECT count(*)::int FROM certificate) AS certificates"""),

            "courses": await c.query("""
                WITH nodes AS (
                  SELECT m.course_id, l.id FROM lesson l JOIN module m ON m.id = l.module_id
                  UNION ALL
                  SELECT m.course_id, e.id FROM exercise e JOIN lesson l ON l.id = e.lesson_id
                    JOIN module m ON m.id = l.module_id
                  UNION ALL
                  SELECT r.course_id, r.id FROM recording r WHERE r.status='published')
                SELECT c.id, c.slug, c.title, c.status, c.price_minor, s.name AS subject,
                       (SELECT count(*)::int FROM enrollment e WHERE e.course_id = c.id) AS enrolments,
                       (SELECT count(*)::int FROM enrollment e WHERE e.course_id = c.id AND e.status='completed') AS completed,
                       (SELECT coalesce(sum(o.amount_minor),0)::bigint FROM course_order o
                         WHERE o.course_id = c.id AND o.status='paid') AS revenue_minor,
                       (SELECT count(*)::int FROM nodes n WHERE n.course_id = c.id) AS nodes,
                       (SELECT count(*)::int FROM progress p WHERE p.course_id = c.id AND p.status='completed') AS completed_nodes
                  FROM course c JOIN subject s ON s.id = c.subject_id
                 ORDER BY enrolments DESC"""),

            "recentOrders": await c.query("""
                SELECT o.id, o.amount_minor, o.status, o.created_at, o.paid_at,
                       u.full_name AS student, co.title AS course
                  FROM course_order o JOIN app_user u ON u.id = o.user_id JOIN course co ON co.id = o.course_id
                 ORDER BY o.created_at DESC LIMIT 10"""),

            "signupsByWeek": await c.query("""
                SELECT to_char(date_trunc('week', enrolled_at), 'DD Mon') AS week,
                       count(*)::int AS enrolments
                  FROM enrollment WHERE enrolled_at > now() - interval '12 weeks'
                 GROUP BY date_trunc('week', enrolled_at) ORDER BY date_trunc('week', enrolled_at)"""),
        }


# ---------------------------------------------------------------------------
# Courses
# ---------------------------------------------------------------------------

@router.get("/api/v1/admin/courses")
async def list_courses(actor: Actor = Depends(requires("course:read"))):
    async with actor.db() as c:
        return {
            "courses": await c.query("""
                SELECT c.id, c.slug, c.title, c.subtitle, c.status, c.level, c.price_minor, c.duration_hours,
                       c.published_at, s.name AS subject,
                       (SELECT count(*)::int FROM module m WHERE m.course_id = c.id) AS modules,
                       (SELECT count(*)::int FROM lesson l JOIN module m ON m.id = l.module_id
                         WHERE m.course_id = c.id) AS lessons,
                       (SELECT count(*)::int FROM enrollment e WHERE e.course_id = c.id) AS enrolments,
                       coalesce((SELECT array_agg(u.full_name) FROM course_teacher ct
                                   JOIN app_user u ON u.id = ct.user_id WHERE ct.course_id = c.id), '{}') AS teachers
                  FROM course c JOIN subject s ON s.id = c.subject_id ORDER BY c.title"""),
            "subjects": await c.query("SELECT id, key, name FROM subject ORDER BY name"),
            "teachers": await c.query("""
                SELECT u.id, u.full_name FROM app_user u
                  JOIN user_role ur ON ur.user_id = u.id JOIN role r ON r.id = ur.role_id AND r.key='TEACHER'
                 WHERE u.deleted_at IS NULL ORDER BY u.full_name"""),
        }


@router.post("/api/v1/admin/courses")
async def create_course(body: CourseBody, actor: Actor = Depends(requires("course:create"))):
    title = body.title.strip()
    slug = body.slug.strip().lower()
    if not title or not slug:
        raise bad_request("A course needs a title and a URL slug.")
    if not SLUG_RE.match(slug):
        raise bad_request("The slug should be lowercase letters, digits and hyphens.")
    if not body.subjectId:
        raise bad_request("Choose a subject for the course.")

    async with actor.db() as c:
        if await c.one("SELECT 1 FROM course WHERE slug = $1", slug):
            raise conflict("That slug is already used by another course.", "slug_taken")

        course_id = str(uuid.uuid4())
        await c.execute(
            """INSERT INTO course (id, subject_id, slug, title, subtitle, description, level, age_range,
                                   duration_hours, price_minor, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft')""",
            course_id, body.subjectId, slug, title, body.subtitle, body.description,
            body.level, body.ageRange, body.durationHours or 0, body.priceMinor or 0,
        )
        await actor.log_audit(c, AuditEntry(
            action="course.created", entity_type="course", entity_id=course_id,
            summary=f'Created course "{title}"',
            after={"title": title, "slug": slug, "price_minor": body.priceMinor or 0},
        ))
        return {"id": course_id, "slug": slug}


@router.patch("/api/v1/admin/courses/{course_id}")
async def update_course(
    course_id: str, body: CoursePatchBody, actor: Actor = Depends(requires("course:update"))
):
    async with actor.db() as c:
        before = await c.one(
            "SELECT title, subtitle, price_minor, level, duration_hours, status FROM course WHERE id = $1",
            course_id,
        )
        if before is None:
            raise not_found("No such course.")
        await c.execute("""
            UPDATE course SET title = coalesce($1,title), subtitle = coalesce($2,subtitle),
                   description = coalesce($3,description), level = coalesce($4,level),
                   duration_hours = coalesce($5,duration_hours), price_minor = coalesce($6,price_minor),
                   updated_at = now()
             WHERE id = $7""",
            body.title, body.subtitle, body.description, body.level,
            body.durationHours, body.priceMinor, course_id,
        )
        await actor.log_audit(c, AuditEntry(
            action="course.updated", entity_type="course", entity_id=course_id,
            summary=f'Updated "{before["title"]}"', before=before,
            after=body.model_dump(exclude_none=True),
        ))
        return {"ok": True}


@router.post("/api/v1/admin/courses/{course_id}/status")
async def set_course_status(
    course_id: str, body: StatusBody, actor: Actor = Depends(requires("course:publish"))
):
    if body.status not in ("draft", "published", "retired"):
        raise bad_request("Unknown status.")

    async with actor.db() as c:
        before = await c.one("SELECT title, status FROM course WHERE id = $1", course_id)
        if before is None:
            raise not_found("No such course.")
        await c.execute(
            """UPDATE course SET status = $1, published_at = CASE WHEN $1 = 'published' AND published_at IS NULL
                 THEN now() ELSE published_at END WHERE id = $2""",
            body.status, course_id,
        )
        await actor.log_audit(c, AuditEntry(
            action="course.published" if body.status == "published" else "course.updated",
            entity_type="course", entity_id=course_id,
            summary=f'"{before["title"]}" → {body.status}',
            before=before, after={"status": body.status},
        ))
        return {"ok": True, "status": body.status}


@router.post("/api/v1/admin/courses/{course_id}/teachers")
async def assign_teacher(
    course_id: str, body: CourseTeacherBody,
    actor: Actor = Depends(requires("course:assign_teacher")),
):
    if not body.teacherId:
        raise bad_request("Choose a teacher.")

    async with actor.db() as c:
        course = await c.one("SELECT title FROM course WHERE id = $1", course_id)
        if course is None:
            raise not_found("No such course.")

        if body.remove:
            await c.execute(
                "DELETE FROM course_teacher WHERE course_id = $1 AND user_id = $2",
                course_id, body.teacherId,
            )
            await actor.log_audit(c, AuditEntry(
                action="course.teacher.removed", entity_type="course", entity_id=course_id,
                summary=f'Removed a teacher from "{course["title"]}"',
            ))
            return {"ok": True}

        await c.execute(
            """INSERT INTO course_teacher (course_id, user_id, role) VALUES ($1,$2,$3)
               ON CONFLICT (course_id, user_id) DO UPDATE SET role = excluded.role""",
            course_id, body.teacherId, "lead" if body.role == "lead" else "assistant",
        )
        await actor.log_audit(c, AuditEntry(
            action="course.teacher.assigned", entity_type="course", entity_id=course_id,
            summary=f'Assigned a teacher to "{course["title"]}"',
        ))
        return {"ok": True}


# ---------------------------------------------------------------------------
# Content Hub
# ---------------------------------------------------------------------------

@router.get("/api/v1/admin/content")
async def content_hub(actor: Actor = Depends(requires("content:create"))):
    async with actor.db() as c:
        return {
            "courses": await c.query("""
                SELECT c.id, c.title, c.slug, c.status,
                       (SELECT release_no FROM content_release cr
                         WHERE cr.scope='course' AND cr.scope_id = c.id AND cr.status='published') AS release_no,
                       (SELECT published_at FROM content_release cr
                         WHERE cr.scope='course' AND cr.scope_id = c.id AND cr.status='published') AS released_at
                  FROM course c ORDER BY c.title"""),
            "items": await c.query("""
                SELECT ci.id, ci.key, ci.content_type, ci.title, ci.course_id, co.title AS course,
                       cv.version_no, cv.status AS version_status, cv.published_at, cv.changelog,
                       (SELECT count(*)::int FROM content_version v WHERE v.content_item_id = ci.id) AS versions,
                       (SELECT count(*)::int FROM content_version v
                         WHERE v.content_item_id = ci.id AND v.status IN ('draft','review')) AS pending
                  FROM content_item ci
                  LEFT JOIN course co ON co.id = ci.course_id
                  LEFT JOIN content_version cv ON cv.content_item_id = ci.id AND cv.status = 'published'
                 ORDER BY co.title, ci.content_type, ci.title"""),
            "pendingReview": await c.query("""
                SELECT cv.id, cv.version_no, cv.status, cv.changelog, cv.created_at, ci.title, ci.content_type
                  FROM content_version cv JOIN content_item ci ON ci.id = cv.content_item_id
                 WHERE cv.status IN ('draft','review') ORDER BY cv.created_at DESC"""),
        }


@router.get("/api/v1/admin/content/{item_id}")
async def content_item(item_id: str, actor: Actor = Depends(requires("content:create"))):
    async with actor.db() as c:
        item = await c.one("""
            SELECT ci.id, ci.key, ci.content_type, ci.title, ci.course_id, co.title AS course
              FROM content_item ci LEFT JOIN course co ON co.id = ci.course_id WHERE ci.id = $1""",
            item_id,
        )
        if item is None:
            raise not_found("No such content item.")
        return {
            "item": item,
            "versions": await c.query("""
                SELECT id, version_no, status, changelog, created_at, published_at, body
                  FROM content_version WHERE content_item_id = $1 ORDER BY version_no DESC""",
                item_id,
            ),
        }


@router.post("/api/v1/admin/content/{item_id}/draft")
async def save_draft(
    item_id: str, body: DraftBody, actor: Actor = Depends(requires("content:update"))
):
    """
    Save a draft. A published version is never edited in place — editing always
    produces version n+1 — so a student mid-chapter never sees the text change
    underneath them.
    """
    if not isinstance(body.body, list):
        raise bad_request("Content must be a list of blocks.")

    async with actor.db() as c:
        item = await c.one("SELECT id, title FROM content_item WHERE id = $1", item_id)
        if item is None:
            raise not_found("No such content item.")

        open_version = await c.one("""
            SELECT id, version_no FROM content_version
              WHERE content_item_id = $1 AND status IN ('draft','review')
              ORDER BY version_no DESC LIMIT 1""",
            item_id,
        )
        # The hash is over the canonical serialisation, not the bytes the
        # client happened to send, so whitespace in the editor is not a change.
        body_hash = sha256(json.dumps(body.body, sort_keys=True, separators=(",", ":")))

        if open_version:
            await c.execute(
                """UPDATE content_version SET body = $1, body_hash = $2, changelog = $3,
                          status = 'draft' WHERE id = $4""",
                body.body, body_hash, body.changelog, open_version["id"],
            )
            return {
                "versionId": str(open_version["id"]),
                "versionNo": open_version["version_no"],
                "status": "draft",
            }

        latest = await c.value(
            "SELECT coalesce(max(version_no),0)::int FROM content_version WHERE content_item_id = $1",
            item_id,
        )
        version_id = str(uuid.uuid4())
        await c.execute(
            """INSERT INTO content_version (id, content_item_id, version_no, locale, status, body,
                                            body_hash, changelog, created_by)
               VALUES ($1,$2,$3,'en','draft',$4,$5,$6,$7)""",
            version_id, item_id, latest + 1, body.body, body_hash, body.changelog, actor.user_id,
        )
        await actor.log_audit(c, AuditEntry(
            action="content.draft.saved", entity_type="content_item", entity_id=item_id,
            summary=f'Saved draft v{latest + 1} of "{item["title"]}"',
            after={"version_no": latest + 1},
        ))
        return {"versionId": version_id, "versionNo": latest + 1, "status": "draft"}


@router.post("/api/v1/admin/content/versions/{version_id}/review")
async def request_review(version_id: str, actor: Actor = Depends(requires("content:review"))):
    async with actor.db() as c:
        v = await c.one("""
            SELECT cv.id, cv.status, cv.version_no, ci.title
              FROM content_version cv JOIN content_item ci ON ci.id = cv.content_item_id
             WHERE cv.id = $1""",
            version_id,
        )
        if v is None:
            raise not_found("No such version.")
        if v["status"] != "draft":
            raise conflict("Only a draft can be sent for review.", "not_draft")

        await c.execute("UPDATE content_version SET status = 'review' WHERE id = $1", version_id)
        await actor.log_audit(c, AuditEntry(
            action="content.review.requested", entity_type="content_version", entity_id=version_id,
            summary=f'Sent v{v["version_no"]} of "{v["title"]}" for review',
        ))
        return {"ok": True, "status": "review"}


@router.post("/api/v1/admin/content/versions/{version_id}/publish")
async def publish_version(version_id: str, actor: Actor = Depends(requires("content:publish"))):
    """
    Publish.

    One transaction: archive the current version, publish the new one, supersede
    the old release and write a new one. The partial unique index on
    content_version guarantees exactly one published version, so this is atomic
    by construction rather than by convention. Students read the new text on
    their next request. No deploy, and rollback is the same move in reverse.
    """
    async with actor.db() as c:
        v = await c.one("""
            SELECT cv.id, cv.status, cv.version_no, cv.content_item_id, cv.body, ci.title, ci.course_id
              FROM content_version cv JOIN content_item ci ON ci.id = cv.content_item_id
             WHERE cv.id = $1""",
            version_id,
        )
        if v is None:
            raise not_found("No such version.")
        if v["status"] == "published":
            return {"ok": True, "alreadyPublished": True}
        if not isinstance(v["body"], list) or not v["body"]:
            raise bad_request("A version needs at least one block before it can be published.")

        current = await c.one(
            """SELECT id, version_no FROM content_version
                WHERE content_item_id = $1 AND status = 'published' AND locale = 'en'""",
            v["content_item_id"],
        )
        if current:
            await c.execute(
                "UPDATE content_version SET status='archived' WHERE id = $1", current["id"]
            )
        await c.execute(
            "UPDATE content_version SET status='published', published_at = now() WHERE id = $1",
            version_id,
        )

        release_no: int | None = None
        if v["course_id"]:
            prev = await c.one(
                """SELECT id, release_no FROM content_release
                    WHERE scope='course' AND scope_id=$1 AND status='published'""",
                v["course_id"],
            )
            if prev:
                await c.execute(
                    "UPDATE content_release SET status='superseded' WHERE id=$1", prev["id"]
                )
            release_no = (prev["release_no"] if prev else 0) + 1
            await c.execute(
                """INSERT INTO content_release (id, scope, scope_id, release_no, status, manifest, published_by)
                   VALUES ($1,'course',$2,$3,'published',$4,$5)""",
                str(uuid.uuid4()), v["course_id"], release_no,
                {"changed": v["title"], "versionNo": v["version_no"]}, actor.user_id,
            )

        await actor.log_audit(c, AuditEntry(
            action="content.published", entity_type="content_version", entity_id=version_id,
            summary=(f'Published v{v["version_no"]} of "{v["title"]}"'
                     + (f" as release {release_no}" if release_no else "")),
            after={"version_no": v["version_no"], "release_no": release_no},
        ))
        return {"ok": True, "versionNo": v["version_no"], "releaseNo": release_no}


@router.post("/api/v1/admin/content/{item_id}/rollback")
async def rollback(item_id: str, actor: Actor = Depends(requires("content:publish"))):
    """Rollback is the same operation with the numbers swapped."""
    async with actor.db() as c:
        item = await c.one("SELECT title, course_id FROM content_item WHERE id = $1", item_id)
        if item is None:
            raise not_found("No such content item.")

        current = await c.one(
            """SELECT id, version_no FROM content_version
                WHERE content_item_id = $1 AND status = 'published'""",
            item_id,
        )
        previous = await c.one(
            """SELECT id, version_no FROM content_version
                WHERE content_item_id = $1 AND status = 'archived'
                ORDER BY version_no DESC LIMIT 1""",
            item_id,
        )
        if previous is None:
            raise conflict("There is no earlier version to roll back to.", "no_previous_version")

        if current:
            await c.execute(
                "UPDATE content_version SET status='archived' WHERE id=$1", current["id"]
            )
        await c.execute(
            "UPDATE content_version SET status='published' WHERE id=$1", previous["id"]
        )

        await actor.log_audit(c, AuditEntry(
            action="content.rolled_back", entity_type="content_item", entity_id=item_id,
            summary=f'Rolled "{item["title"]}" back to v{previous["version_no"]}',
            before={"version_no": current["version_no"]} if current else None,
            after={"version_no": previous["version_no"]},
        ))
        return {"ok": True, "versionNo": previous["version_no"]}


# ---------------------------------------------------------------------------
# Media
# ---------------------------------------------------------------------------

@router.post("/api/v1/admin/media")
async def upload_media(body: MediaBody, actor: Actor = Depends(requires("media:upload"))):
    file_name = body.fileName.strip()
    if not file_name:
        raise bad_request("A file needs a name.")
    # In production the bytes go straight to object storage with a pre-signed
    # PUT, and this call only records the metadata afterwards. The hash is what
    # makes the key content-addressed, so the same file is never stored twice.
    digest = body.sha256 or sha256(f"{file_name}:{datetime.now(timezone.utc).timestamp()}")

    async with actor.db() as c:
        existing = await c.one("SELECT id FROM media_asset WHERE sha256 = $1", digest)
        if existing:
            return {"id": str(existing["id"]), "deduplicated": True}

        asset_id = str(uuid.uuid4())
        key = storage_key_for(digest, file_name)
        await c.execute(
            """INSERT INTO media_asset (id, sha256, storage_key, file_name, kind, mime_type, bytes,
                                        duration_ms, visibility, uploaded_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
            asset_id, digest, key, file_name, body.kind, body.mimeType, body.bytes or 0,
            body.durationMs, "public" if body.visibility == "public" else "protected",
            actor.user_id,
        )
        await actor.log_audit(c, AuditEntry(
            action="media.uploaded", entity_type="media_asset", entity_id=asset_id,
            summary=f"Uploaded {file_name}",
        ))
        return {"id": asset_id, "storageKey": key}


@router.get("/api/v1/admin/media")
async def list_media(actor: Actor = Depends(requires("media:upload"))):
    async with actor.db() as c:
        return {"media": await c.query("""
            SELECT id, sha256, file_name, kind, mime_type, bytes, duration_ms, visibility, created_at
              FROM media_asset ORDER BY created_at DESC LIMIT 200""")}


# ---------------------------------------------------------------------------
# Live sessions
# ---------------------------------------------------------------------------

@router.get("/api/v1/admin/live")
async def list_live(actor: Actor = Depends(requires("live:manage"))):
    async with actor.db() as c:
        return {
            "sessions": await c.query("""
                SELECT ls.id, ls.title, ls.starts_at, ls.ends_at, ls.status, ls.meeting_url,
                       c.title AS course, c.id AS course_id, u.full_name AS teacher, u.id AS teacher_id,
                       (SELECT count(*)::int FROM session_attendance sa WHERE sa.live_session_id = ls.id) AS registered,
                       (SELECT count(*)::int FROM session_attendance sa
                         WHERE sa.live_session_id = ls.id AND sa.status='attended') AS attended
                  FROM live_session ls JOIN course c ON c.id = ls.course_id JOIN app_user u ON u.id = ls.teacher_id
                 ORDER BY ls.starts_at DESC LIMIT 100"""),
            "courses": await c.query(
                "SELECT id, title FROM course WHERE status='published' ORDER BY title"),
            "teachers": await c.query("""
                SELECT u.id, u.full_name FROM app_user u
                  JOIN user_role ur ON ur.user_id = u.id JOIN role r ON r.id = ur.role_id AND r.key='TEACHER'
                 WHERE u.deleted_at IS NULL ORDER BY u.full_name"""),
        }


@router.post("/api/v1/admin/live")
async def schedule_live(body: LiveBody, actor: Actor = Depends(requires("live:manage"))):
    if not (body.courseId and body.teacherId and body.title and body.startsAt):
        raise bad_request("A session needs a course, a teacher, a title and a start time.")

    try:
        # The browser sends UTC with a trailing Z; a naive value is read as UTC
        # rather than as this container's clock, which is never the user's.
        starts = datetime.fromisoformat(body.startsAt.replace("Z", "+00:00"))
    except ValueError:
        raise bad_request("That start time could not be read.")
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=timezone.utc)
    if starts < datetime.now(timezone.utc) - timedelta(minutes=1):
        raise bad_request("Choose a start time in the future.")

    minutes = body.durationMinutes or 60
    session_id = str(uuid.uuid4())
    ends = starts + timedelta(minutes=minutes)

    async with actor.db() as c:
        teaches = await c.one(
            "SELECT 1 FROM course_teacher WHERE course_id = $1 AND user_id = $2",
            body.courseId, body.teacherId,
        )
        if teaches is None:
            raise conflict(
                "That teacher is not assigned to this course. Assign them first.", "not_assigned"
            )

        await c.execute(
            """INSERT INTO live_session (id, course_id, module_id, teacher_id, title, description,
                                         starts_at, ends_at, provider, meeting_url, capacity, status, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'scheduled',$12)""",
            session_id, body.courseId, body.moduleId, body.teacherId, body.title, body.description,
            starts, ends, body.provider,
            body.meetingUrl or f"https://meet.brollyjuniors.com/{session_id[:8]}",
            body.capacity, actor.user_id,
        )

        enrolled = await c.value(
            "SELECT count(*)::int FROM enrollment WHERE course_id = $1 AND status='active'",
            body.courseId,
        )
        await actor.log_audit(c, AuditEntry(
            action="live.scheduled", entity_type="live_session", entity_id=session_id,
            summary=f'Scheduled "{body.title}" for {enrolled} students',
            after={"title": body.title, "starts_at": starts.isoformat()},
        ))
        return {"id": session_id, "enrolled": enrolled}


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------

@router.get("/api/v1/admin/teachers")
async def list_teachers(actor: Actor = Depends(requires("user:read"))):
    async with actor.db() as c:
        return {"teachers": await c.query("""
            SELECT u.id, u.full_name, u.email, u.status, u.last_login_at, u.created_at,
                   tp.headline, tp.expertise, tp.years_exp,
                   coalesce((SELECT array_agg(c.title) FROM course_teacher ct JOIN course c ON c.id = ct.course_id
                              WHERE ct.user_id = u.id), '{}') AS courses,
                   (SELECT count(DISTINCT e.user_id)::int FROM course_teacher ct
                      JOIN enrollment e ON e.course_id = ct.course_id AND e.status='active'
                     WHERE ct.user_id = u.id) AS students,
                   (SELECT count(*)::int FROM live_session ls WHERE ls.teacher_id = u.id) AS sessions
              FROM app_user u
              JOIN user_role ur ON ur.user_id = u.id JOIN role r ON r.id = ur.role_id AND r.key='TEACHER'
              LEFT JOIN teacher_profile tp ON tp.user_id = u.id
             WHERE u.deleted_at IS NULL ORDER BY u.full_name""")}


@router.post("/api/v1/admin/teachers")
async def create_teacher(body: TeacherBody, actor: Actor = Depends(requires("user:create"))):
    email = body.email.strip().lower()
    full_name = body.fullName.strip()
    if not full_name or not email:
        raise bad_request("A teacher needs a name and an email address.")
    if not EMAIL_RE.match(email):
        raise bad_request("That does not look like an email address.")

    async with actor.db() as c:
        taken = await c.one(
            "SELECT 1 FROM app_user WHERE lower(email)=lower($1) AND deleted_at IS NULL", email
        )
        if taken:
            raise conflict("That email already has an account.", "email_taken")

        user_id = str(uuid.uuid4())
        temp = temp_password(10)
        await c.execute(
            """INSERT INTO app_user (id, email, password_hash, full_name, phone, status, must_change_pw)
               VALUES ($1,$2,$3,$4,$5,'active',true)""",
            user_id, email, hash_password(temp), full_name, body.phone,
        )
        role_id = await c.value("SELECT id FROM role WHERE key='TEACHER'")
        await c.execute(
            "INSERT INTO user_role (user_id, role_id, granted_by) VALUES ($1,$2,$3)",
            user_id, role_id, actor.user_id,
        )
        await c.execute(
            """INSERT INTO teacher_profile (user_id, headline, bio, expertise, years_exp)
               VALUES ($1,$2,$3,$4,$5)""",
            user_id, body.headline, body.bio, body.expertise, body.yearsExp or 0,
        )

        for course_id in body.courseIds:
            await c.execute(
                """INSERT INTO course_teacher (course_id, user_id, role) VALUES ($1,$2,'assistant')
                   ON CONFLICT DO NOTHING""",
                course_id, user_id,
            )

        await actor.log_audit(c, AuditEntry(
            action="user.created", entity_type="app_user", entity_id=user_id,
            summary=f"Created teacher account for {full_name}",
            after={"full_name": full_name, "email": email},
        ))
        return {"id": user_id, "email": email, "temporaryPassword": temp}


@router.post("/api/v1/admin/users/{user_id}/status")
async def set_user_status(
    user_id: str, body: StatusBody, actor: Actor = Depends(requires("user:deactivate"))
):
    if body.status not in ("active", "disabled"):
        raise bad_request("Unknown status.")
    if user_id == actor.user_id:
        raise conflict("You cannot deactivate your own account.", "self_deactivate")

    async with actor.db() as c:
        u = await c.one("SELECT full_name, status FROM app_user WHERE id = $1", user_id)
        if u is None:
            raise not_found("No such account.")

        await c.execute(
            "UPDATE app_user SET status = $1, perm_version = perm_version + 1 WHERE id = $2",
            body.status, user_id,
        )
        if body.status == "disabled":
            await c.execute(
                "UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
                user_id,
            )
        await actor.log_audit(c, AuditEntry(
            action="user.deactivated" if body.status == "disabled" else "user.reactivated",
            entity_type="app_user", entity_id=user_id,
            summary=f'{u["full_name"]} → {body.status}', before=u, after={"status": body.status},
        ))

    await invalidate_access(user_id)
    return {"ok": True, "status": body.status}


@router.get("/api/v1/admin/students")
async def list_students(q: str = "", actor: Actor = Depends(requires("user:read"))):
    async with actor.db() as c:
        return {"students": await c.query("""
            SELECT u.id, u.full_name, u.email, u.status, u.last_login_at, u.created_at,
                   (SELECT count(*)::int FROM enrollment e WHERE e.user_id = u.id) AS courses,
                   (SELECT count(*)::int FROM enrollment e WHERE e.user_id = u.id AND e.status='completed') AS completed,
                   (SELECT coalesce(sum(o.amount_minor),0)::bigint FROM course_order o
                     WHERE o.user_id = u.id AND o.status='paid') AS spent_minor,
                   (SELECT max(p.last_activity_at) FROM progress p WHERE p.user_id = u.id) AS last_seen
              FROM app_user u
              JOIN user_role ur ON ur.user_id = u.id JOIN role r ON r.id = ur.role_id AND r.key='STUDENT'
             WHERE u.deleted_at IS NULL
               AND ($1 = '' OR u.full_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
             ORDER BY u.created_at DESC LIMIT 200""", q.strip())}


@router.get("/api/v1/admin/orders")
async def list_orders(actor: Actor = Depends(requires("order:read:platform"))):
    async with actor.db() as c:
        return {
            "orders": await c.query("""
                SELECT o.id, o.amount_minor, o.currency, o.status, o.provider, o.provider_ref,
                       o.created_at, o.paid_at, u.full_name AS student, u.email, c.title AS course
                  FROM course_order o JOIN app_user u ON u.id = o.user_id JOIN course c ON c.id = o.course_id
                 ORDER BY o.created_at DESC LIMIT 200"""),
            "summary": await c.one("""
                SELECT count(*) FILTER (WHERE status='paid')::int AS paid,
                       count(*) FILTER (WHERE status='pending')::int AS pending,
                       count(*) FILTER (WHERE status='failed')::int AS failed,
                       coalesce(sum(amount_minor) FILTER (WHERE status='paid'),0)::bigint AS revenue_minor
                  FROM course_order"""),
        }


@router.get("/api/v1/admin/audit")
async def list_audit(actor: Actor = Depends(requires("audit:read"))):
    async with actor.db() as c:
        return {"entries": await c.query("""
            SELECT a.id, a.action, a.entity_type, a.summary, a.occurred_at, a.actor_role,
                   u.full_name AS actor
              FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_user_id
             ORDER BY a.occurred_at DESC LIMIT 150""")}
