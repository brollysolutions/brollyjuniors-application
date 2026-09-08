"""
Row-level security, tested with no application code in the way.

These queries run straight against Postgres as `brolly_app` with the same two
settings the API pins per request. Nothing here calls a handler, so what passes
is the database's own guarantee — the layer that survives a carelessly written
endpoint added next year.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncpg  # noqa: E402

from app.config import settings  # noqa: E402

ok = 0
fail = 0


def check(label: str, cond: bool, extra: object = "") -> None:
    global ok, fail
    if cond:
        ok += 1
        print(f"  PASS  {label}")
    else:
        fail += 1
        print(f"  FAIL  {label}  {extra}")


async def as_actor(conn, user_id, role, fn):
    tx = conn.transaction()
    await tx.start()
    try:
        await conn.execute("SET LOCAL ROLE brolly_app")
        await conn.execute("SELECT set_config('app.user_id', $1, true)", user_id or "")
        await conn.execute("SELECT set_config('app.role', $1, true)", role)
        return await fn(conn)
    finally:
        await tx.rollback()


async def main() -> None:
    conn = await asyncpg.connect(settings.database_url)
    try:
        aarav = await conn.fetchval("SELECT id FROM app_user WHERE email='aarav@example.com'")
        sana = await conn.fetchval("SELECT id FROM app_user WHERE email='sana@example.com'")
        sneha = await conn.fetchval(
            "SELECT id FROM app_user WHERE email='sneha.reddy@brollyjuniors.com'")
        py_id = await conn.fetchval("SELECT id FROM course WHERE slug='python-foundations'")
        ai_id = await conn.fetchval("SELECT id FROM course WHERE slug='ai-for-beginners'")

        print("\n--- structure is public, substance is not ---")

        async def anon_reads_courses(c):
            return await c.fetchval("SELECT count(*) FROM course WHERE status='published'")
        check("anonymous sees published courses",
              await as_actor(conn, None, "ANON", anon_reads_courses) == 2)

        async def anon_reads_lessons(c):
            return await c.fetchval("SELECT count(*) FROM lesson")
        check("anonymous sees lesson titles (curriculum outline)",
              await as_actor(conn, None, "ANON", anon_reads_lessons) == 14)

        async def anon_reads_bodies(c):
            return await c.fetchval("SELECT count(*) FROM content_version")
        n = await as_actor(conn, None, "ANON", anon_reads_bodies)
        check("anonymous sees NO lesson bodies", n == 0, f"got {n}")

        async def anon_reads_recordings(c):
            return await c.fetchval("SELECT count(*) FROM recording")
        n = await as_actor(conn, None, "ANON", anon_reads_recordings)
        check("anonymous sees NO recordings", n == 0, f"got {n}")

        async def anon_reads_enrolments(c):
            return await c.fetchval("SELECT count(*) FROM enrollment")
        n = await as_actor(conn, None, "ANON", anon_reads_enrolments)
        check("anonymous sees NO enrolment rows", n == 0, f"got {n}")

        print("\n--- but the public aggregate still works (SECURITY DEFINER) ---")

        async def anon_learner_count(c):
            return await c.fetchval("SELECT public_learner_count($1)", py_id)
        n = await as_actor(conn, None, "ANON", anon_learner_count)
        check("public_learner_count returns a real number to a stranger", n > 0, n)

        print("\n--- entitlement: a student reaches only what they bought ---")

        async def sana_reads_python_bodies(c):
            return await c.fetchval(
                """SELECT count(*) FROM content_version cv
                     JOIN content_item ci ON ci.id = cv.content_item_id
                    WHERE ci.course_id = $1""", py_id)
        n = await as_actor(conn, str(sana), "STUDENT", sana_reads_python_bodies)
        check("sana (AI only) reads NO Python lesson bodies", n == 0, f"got {n}")

        async def sana_reads_ai_bodies(c):
            return await c.fetchval(
                """SELECT count(*) FROM content_version cv
                     JOIN content_item ci ON ci.id = cv.content_item_id
                    WHERE ci.course_id = $1""", ai_id)
        n = await as_actor(conn, str(sana), "STUDENT", sana_reads_ai_bodies)
        check("sana reads the AI bodies she paid for", n > 0, f"got {n}")

        async def aarav_reads_both(c):
            return await c.fetchval("SELECT count(*) FROM content_version")
        n = await as_actor(conn, str(aarav), "STUDENT", aarav_reads_both)
        check("aarav (both courses) reads both sets", n > 0, f"got {n}")

        print("\n--- a student cannot read another student's work ---")

        async def sana_reads_others_progress(c):
            return await c.fetchval("SELECT count(*) FROM progress WHERE user_id <> $1", sana)
        n = await as_actor(conn, str(sana), "STUDENT", sana_reads_others_progress)
        check("no other student's progress rows", n == 0, f"got {n}")

        async def sana_reads_others_orders(c):
            return await c.fetchval("SELECT count(*) FROM course_order WHERE user_id <> $1", sana)
        n = await as_actor(conn, str(sana), "STUDENT", sana_reads_others_orders)
        check("no other student's orders", n == 0, f"got {n}")

        async def sana_reads_others_profiles(c):
            return await c.fetchval("SELECT count(*) FROM student_profile WHERE user_id <> $1", sana)
        n = await as_actor(conn, str(sana), "STUDENT", sana_reads_others_profiles)
        check("no other student's guardian details", n == 0, f"got {n}")

        print("\n--- a teacher reaches students only through a course they teach ---")

        async def sneha_sees_students(c):
            return await c.fetchval(
                """SELECT count(*) FROM app_user u
                    WHERE EXISTS (SELECT 1 FROM enrollment e WHERE e.user_id = u.id)""")
        taught = await as_actor(conn, str(sneha), "TEACHER", sneha_sees_students)
        total = await conn.fetchval(
            "SELECT count(DISTINCT user_id) FROM enrollment")
        check("teacher sees some but not all enrolled students",
              0 < taught < total, f"{taught} of {total}")

        async def sneha_reads_student_profiles(c):
            return await c.fetchval("SELECT count(*) FROM student_profile")
        n = await as_actor(conn, str(sneha), "TEACHER", sneha_reads_student_profiles)
        check("teacher reads NO student guardian details", n == 0, f"got {n}")

        print("\n--- notifications cannot be planted in someone else's feed ---")

        async def sana_inserts_notification(c):
            try:
                await c.execute(
                    """INSERT INTO notification (user_id, kind, title, body)
                       VALUES ($1,'spoof','Planted','x')""", aarav)
                return "inserted"
            except Exception as e:
                return type(e).__name__
        r = await as_actor(conn, str(sana), "STUDENT", sana_inserts_notification)
        check("direct INSERT into another user's notifications is refused",
              r != "inserted", r)

        print("\n--- the admin sees the platform ---")

        async def admin_reads_all(c):
            return await c.fetchval("SELECT count(*) FROM enrollment")
        n = await as_actor(conn, str(aarav), "BROLLY_ADMIN", admin_reads_all)
        check("admin role sees every enrolment", n > 200, n)

        print(f"\n{'=' * 52}\n  {ok} passed, {fail} failed\n{'=' * 52}")
    finally:
        await conn.close()

    raise SystemExit(1 if fail else 0)


if __name__ == "__main__":
    asyncio.run(main())
