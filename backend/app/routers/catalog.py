"""
The public catalogue and the bootstrap.

A shopper must be able to read the curriculum before paying for it, so module
and lesson TITLES are public. Lesson bodies, textbook sections, recordings and
materials are not — that line is drawn in the RLS policies, so these handlers
do not have to remember it.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import db
from ..access import boundary_line, can
from ..audit import AuditEntry
from ..deps import Actor, public_route, requires
from ..errors import not_found
from ..shared.brand import BROLLY_JUNIORS

router = APIRouter()


class MeBody(BaseModel):
    fullName: str | None = None
    phone: str | None = None


def build_nav(access, badges: dict[str, int]) -> list[dict[str, Any]]:
    nav: list[dict[str, Any]] = []

    def add(key: str, label: str, icon: str, permission: str | None = None,
            badge: int | None = None) -> None:
        if permission and not can(access, permission):
            return
        item: dict[str, Any] = {"key": key, "label": label, "icon": icon}
        if badge:
            item["badge"] = badge
        nav.append(item)

    if access.role == "BROLLY_ADMIN":
        add("overview", "Overview", "▤")
        add("courses", "Courses", "▦", "course:read")
        add("content", "Content Hub", "✎", "content:create")
        add("resources", "Shared library", "▩", "resource:manage")
        add("teachers", "Teachers", "◈", "user:read")
        add("students", "Students", "▧", "user:read")
        add("live", "Live classes", "◉", "live:manage")
        add("orders", "Orders", "₹", "order:read:platform")
        add("audit", "Activity log", "◧", "audit:read")
        add("profile", "My profile", "◔")
        return nav

    if access.role == "TEACHER":
        add("overview", "Dashboard", "▤")
        add("courses", "My courses", "▦", "course:read")
        add("students", "My students", "▧", "progress:read:course")
        add("resources", "Library", "▩", "resource:read")
        add("live", "Live classes", "◉", "live:read")
        add("grading", "Grading", "✓", "assignment:grade", badges.get("pendingGrading"))
        add("recordings", "Recordings", "▶", "recording:read")
        add("profile", "My profile", "◔")
        return nav

    add("home", "Home", "▤")
    add("mycourses", "My courses", "▦", "enrollment:read")
    add("browse", "Browse courses", "◎")
    add("live", "Live classes", "◉", "live:attend")
    add("recordings", "Recordings", "▶", "recording:read")
    add("resources", "Library", "▩", "resource:read")
    add("assignments", "Assignments", "✎", "assignment:submit", badges.get("dueAssignments"))
    add("progress", "My progress", "◫", "progress:read:self")
    add("certificates", "Certificates", "★", "certificate:read")
    add("profile", "My profile", "◔")
    return nav


@router.get("/api/v1/public/brand")
async def public_brand(_=Depends(public_route)):
    return {"brand": BROLLY_JUNIORS}


@router.get("/api/v1/public/courses")
async def public_courses(_=Depends(public_route)):
    """The shop window. Published courses only, no protected content."""
    async with db.anon() as c:
        return {
            "brand": BROLLY_JUNIORS,
            "subjects": await c.query("SELECT id, key, name, blurb FROM subject ORDER BY name"),
            "courses": await c.query("""
                SELECT c.id, c.slug, c.title, c.subtitle, c.level, c.age_range, c.duration_hours,
                       c.price_minor, c.currency, s.name AS subject, s.key AS subject_key,
                       (SELECT count(*)::int FROM module m WHERE m.course_id = c.id) AS modules,
                       (SELECT count(*)::int FROM lesson l JOIN module m ON m.id = l.module_id
                         WHERE m.course_id = c.id) AS lessons,
                       public_learner_count(c.id) AS learners,
                       coalesce((SELECT array_agg(u.full_name ORDER BY ct.role, u.full_name)
                                   FROM course_teacher ct JOIN app_user u ON u.id = ct.user_id
                                  WHERE ct.course_id = c.id), '{}') AS teachers
                  FROM course c JOIN subject s ON s.id = c.subject_id
                 WHERE c.status = 'published'
                 ORDER BY c.price_minor"""),
        }


@router.get("/api/v1/public/courses/{slug}")
async def public_course(slug: str, _=Depends(public_route)):
    """A course page a stranger can read: outline yes, contents no."""
    async with db.anon() as c:
        course = await c.one("""
            SELECT c.id, c.slug, c.title, c.subtitle, c.description, c.outcomes, c.requirements,
                   c.level, c.age_range, c.duration_hours, c.price_minor, c.currency,
                   s.name AS subject, s.key AS subject_key
              FROM course c JOIN subject s ON s.id = c.subject_id
             WHERE c.slug = $1 AND c.status = 'published'""", slug)
        if course is None:
            raise not_found("No such course.")

        return {
            "brand": BROLLY_JUNIORS,
            "course": course,
            # Structure only. Every one of these lessons is a title with no body
            # until somebody buys the course.
            "modules": await c.query("""
                SELECT m.id, m.position, m.title, m.summary,
                       coalesce((SELECT json_agg(json_build_object(
                           'id', l.id, 'title', l.title, 'position', l.position,
                           'minutes', l.est_minutes)
                         ORDER BY l.position) FROM lesson l WHERE l.module_id = m.id),
                         '[]'::json) AS lessons
                  FROM module m WHERE m.course_id = $1 ORDER BY m.position""", course["id"]),
            "teachers": await c.query("""
                SELECT u.full_name, tp.headline, tp.bio, tp.expertise, tp.years_exp, ct.role
                  FROM course_teacher ct
                  JOIN app_user u ON u.id = ct.user_id
                  LEFT JOIN teacher_profile tp ON tp.user_id = u.id
                 WHERE ct.course_id = $1 ORDER BY ct.role, u.full_name""", course["id"]),
            # Every one of these is an aggregate over rows a shopper cannot read,
            # so all five come from the SECURITY DEFINER counters in 004 and 006.
            # Counted directly here they would all be zero for a stranger.
            "stats": await c.one("""
                SELECT public_learner_count($1) AS learners,
                       public_completion_count($1) AS completed,
                       cc.recordings, cc.quizzes, cc.materials
                  FROM public_course_contents($1) cc""", course["id"]),
        }


@router.get("/api/v1/public/certificates/{code}")
async def verify_certificate(code: str, _=Depends(public_route)):
    """Anyone can check a certificate is real, without signing in."""
    async with db.anon() as c:
        # Deliberately read through the admin-free path: certificates are
        # private, so verification returns a confirmation, never the row.
        row = await c.one("SELECT * FROM public_verify_certificate($1)", code.upper())
        if row is None:
            return {"valid": False}
        return {
            "valid": True,
            "holder": row["holder"],
            "course": row["course"],
            "serial": row["serial"],
            "issuedAt": row["issued_at"],
        }


@router.get("/api/v1/me/bootstrap")
async def bootstrap(actor: Actor = Depends(requires("me:read"))):
    a = actor.access
    async with actor.db() as c:
        badges: dict[str, int] = {}

        if a.role == "TEACHER":
            badges["pendingGrading"] = await c.value("""
                SELECT count(*)::int FROM submission s
                  JOIN assignment asg ON asg.id = s.assignment_id
                  JOIN course_teacher ct ON ct.course_id = asg.course_id AND ct.user_id = $1
                 WHERE s.status = 'submitted'""", a.user_id)
        if a.role == "STUDENT":
            badges["dueAssignments"] = await c.value("""
                SELECT count(*)::int FROM assignment asg
                  JOIN enrollment e ON e.course_id = asg.course_id
                       AND e.user_id = $1 AND e.status = 'active'
                 WHERE asg.status = 'published'
                   AND NOT EXISTS (SELECT 1 FROM submission s
                                    WHERE s.assignment_id = asg.id AND s.user_id = $1)""", a.user_id)

        initials = "".join(w[0] for w in a.full_name.split() if w)[:2].upper()
        return {
            "user": {
                "id": a.user_id,
                "fullName": a.full_name,
                "email": a.email,
                "avatarInitials": initials,
                "mustChangePassword": a.must_change_password,
            },
            "role": a.role,
            "roles": a.roles,
            "permissions": sorted(a.permissions),
            "features": sorted(a.features),
            "brand": BROLLY_JUNIORS,
            "boundary": boundary_line(a),
            "nav": build_nav(a, badges),
        }


@router.patch("/api/v1/me")
async def patch_me(body: MeBody, actor: Actor = Depends(requires("me:read"))):
    async with actor.db() as c:
        await c.execute(
            """UPDATE app_user
                  SET full_name = coalesce($1, full_name), phone = coalesce($2, phone)
                WHERE id = $3""",
            body.fullName, body.phone, actor.user_id,
        )
        await actor.log_audit(c, AuditEntry(
            action="user.updated", entity_type="app_user", entity_id=actor.user_id,
            summary="Updated own profile", after={"full_name": body.fullName},
        ))
        return {"ok": True}


@router.get("/api/v1/me/notifications")
async def notifications(actor: Actor = Depends(requires("me:read"))):
    async with actor.db() as c:
        return {"notifications": await c.query(
            """SELECT id, kind, title, body, link_screen, link_param, read_at, created_at
                 FROM notification WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30""",
            actor.user_id,
        )}


@router.post("/api/v1/me/notifications/read")
async def mark_notifications_read(actor: Actor = Depends(requires("me:read"))):
    async with actor.db() as c:
        await c.execute(
            "UPDATE notification SET read_at = now() WHERE user_id = $1 AND read_at IS NULL",
            actor.user_id,
        )
        return {"ok": True}
