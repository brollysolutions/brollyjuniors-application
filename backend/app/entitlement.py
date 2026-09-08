"""
Entitlement — requirement 24, in code.

    "A student should not be able to access a course merely because they know
     the course ID or URL."

These functions are the application's half of that. The database enforces the
same rule underneath (sql/003_rls.sql), so the two are belt and braces: an
endpoint that forgets to call assert_can_reach() still returns nothing useful,
and a policy that is somehow relaxed still meets an explicit check here.
"""
from __future__ import annotations

from .access import Access
from .db import Conn
from .errors import forbidden, not_found


async def is_enrolled(c: Conn, user_id: str, course_id: str) -> bool:
    rows = await c.query(
        """SELECT 1 FROM enrollment
            WHERE user_id = $1 AND course_id = $2 AND status IN ('active','completed')
              AND (expires_on IS NULL OR expires_on >= current_date)""",
        user_id, course_id,
    )
    return len(rows) > 0


async def teaches_course(c: Conn, user_id: str, course_id: str) -> bool:
    rows = await c.query(
        "SELECT 1 FROM course_teacher WHERE user_id = $1 AND course_id = $2",
        user_id, course_id,
    )
    return len(rows) > 0


async def assert_can_reach(c: Conn, access: Access, course_id: str) -> None:
    """
    The one question every protected read asks.

    Answers 404 rather than 403 on purpose: a student who has not bought the
    course should not learn that the id they guessed is a real one.
    """
    if access.role == "BROLLY_ADMIN":
        return
    if access.role == "TEACHER":
        if await teaches_course(c, access.user_id, course_id):
            return
        raise not_found("That course is not one of yours.")
    if await is_enrolled(c, access.user_id, course_id):
        return
    raise not_found("You are not enrolled in that course.")


async def assert_teaches(c: Conn, access: Access, course_id: str) -> None:
    """Teaching, specifically — for grading, scheduling and marking attendance."""
    if access.role == "BROLLY_ADMIN":
        return
    if await teaches_course(c, access.user_id, course_id):
        return
    raise forbidden("You do not teach that course.")


def assert_own(access: Access, owner_id: str) -> None:
    """A student's own row, and nobody else's."""
    if access.role == "BROLLY_ADMIN":
        return
    if access.user_id != str(owner_id):
        raise forbidden("That belongs to someone else.")


async def assert_can_see_student(c: Conn, access: Access, student_id: str) -> None:
    """
    A teacher reaches a student only through a course they teach — there is no
    stored student/teacher relationship to shortcut this.
    """
    if access.role == "BROLLY_ADMIN":
        return
    if access.user_id == str(student_id):
        return
    rows = await c.query(
        """SELECT 1 FROM enrollment e
             JOIN course_teacher ct ON ct.course_id = e.course_id
            WHERE e.user_id = $1 AND ct.user_id = $2 AND e.status IN ('active','completed')
            LIMIT 1""",
        student_id, access.user_id,
    )
    if not rows:
        raise forbidden("That student is not enrolled in any course you teach.")


async def course_of_lesson(c: Conn, lesson_id: str) -> str:
    """Resolve the course a lesson belongs to, for entitlement on nested content."""
    row = await c.one(
        "SELECT m.course_id FROM lesson l JOIN module m ON m.id = l.module_id WHERE l.id = $1",
        lesson_id,
    )
    if row is None:
        raise not_found("Unknown lesson.")
    return str(row["course_id"])


async def course_of_quiz(c: Conn, quiz_id: str) -> str:
    row = await c.one("SELECT course_id FROM quiz WHERE id = $1", quiz_id)
    if row is None:
        raise not_found("Unknown quiz.")
    return str(row["course_id"])


async def course_of_assignment(c: Conn, assignment_id: str) -> str:
    row = await c.one("SELECT course_id FROM assignment WHERE id = $1", assignment_id)
    if row is None:
        raise not_found("Unknown assignment.")
    return str(row["course_id"])
