"""
Authentication.

Refresh tokens are opaque, stored only as a hash, rotated on every use, and a
replayed one kills the whole session family. The login throttle moved to Redis
in this rewrite: as a process-local dict it reset on every restart, which made
restarting the API a way to clear your own lockout.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from .. import db
from ..access import db_role, invalidate_access, load_access
from ..audit import AuditEntry, Who, audit
from ..config import settings
from ..core import redis_client
from ..core.passwords import hash_password, sha256, verify_password
from ..core.tokens import AccessClaims, new_refresh_token, sign_access_token
from ..deps import Actor, client_ip, public_route, requires
from ..errors import bad_request, conflict, locked, too_many, unauthorized

router = APIRouter()

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

#: A hash of nothing in particular. Verifying against it costs the same work as
#: verifying a real one, so an unknown account and a wrong password are
#: indistinguishable from the outside.
DUMMY_HASH = (
    "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
)

THROTTLE_PREFIX = "login:fail:"


class LoginBody(BaseModel):
    email: str = ""
    password: str = ""


class RegisterBody(BaseModel):
    fullName: str = ""
    email: str = ""
    password: str = ""
    phone: str = ""
    gradeLevel: str = ""
    guardianName: str = ""
    guardianEmail: str = ""
    guardianPhone: str = ""


class ChangePasswordBody(BaseModel):
    currentPassword: str = ""
    newPassword: str = ""


# ---------------------------------------------------------------------------
# Throttling — applied to unknown accounts in exactly the same shape, so the
# endpoint cannot be used to discover which email addresses exist.
# ---------------------------------------------------------------------------

async def _throttle(key: str) -> None:
    try:
        blocked = await redis_client.client().get(THROTTLE_PREFIX + key + ":until")
    except Exception:
        return  # Redis down: fail open on throttling rather than lock everyone out
    if blocked and float(blocked) > datetime.now(timezone.utc).timestamp():
        raise too_many()


async def _record_failure(key: str) -> None:
    try:
        r = redis_client.client()
        n = await r.incr(THROTTLE_PREFIX + key + ":n")
        await r.expire(THROTTLE_PREFIX + key + ":n", 900)
        wait = 900 if n >= 10 else min(30, 2 ** max(0, n - 3))
        until = datetime.now(timezone.utc).timestamp() + wait
        await r.setex(THROTTLE_PREFIX + key + ":until", int(wait) + 1, str(until))
    except Exception:
        pass


async def _clear_failures(key: str) -> None:
    try:
        r = redis_client.client()
        await r.delete(THROTTLE_PREFIX + key + ":n", THROTTLE_PREFIX + key + ":until")
    except Exception:
        pass


async def _find_by_email(email: str) -> dict[str, Any] | None:
    """The one pre-authentication lookup: we must find the user before we know them."""
    async with db.admin() as c:
        return await c.one(
            """SELECT id, email, password_hash, status, perm_version, must_change_pw, full_name
                 FROM app_user WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1""",
            email,
        )


async def _issue_session(
    c: db.Conn, user_id: str, is_staff: bool, ip: str, ua: str, family_id: str | None = None
) -> tuple[str, str]:
    refresh = new_refresh_token()
    ttl = (timedelta(hours=settings.staff_refresh_hours) if is_staff
           else timedelta(days=settings.refresh_token_days))
    session_id = str(uuid.uuid4())
    await c.execute(
        """INSERT INTO session (id, user_id, refresh_token_hash, family_id, user_agent, ip, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)""",
        session_id, user_id, sha256(refresh), family_id or str(uuid.uuid4()),
        ua[:250], ip, datetime.now(timezone.utc) + ttl,
    )
    return session_id, refresh


def _set_cookie(response: Response, refresh: str) -> None:
    response.set_cookie(
        settings.cookie_name, refresh,
        httponly=True, samesite="lax", secure=settings.is_prod,
        path="/api/v1/auth", max_age=settings.refresh_token_days * 86400,
    )


async def _start_session(
    response: Response, request: Request, user: dict[str, Any]
) -> dict[str, Any]:
    user_id = str(user["id"])
    access = await load_access(user_id)
    if access is None:
        raise unauthorized()
    is_staff = access.role != "STUDENT"
    ip = client_ip(request)
    ua = request.headers.get("user-agent", "")

    async with db.actor(user_id, db_role(access)) as c:
        session_id, refresh = await _issue_session(c, user_id, is_staff, ip, ua)
        await c.execute("UPDATE app_user SET last_login_at = now() WHERE id = $1", user_id)
        await audit(
            c,
            Who(user_id=user_id, role=access.role, ip=ip,
                request_id=request.state.request_id),
            AuditEntry(action="auth.login.success", entity_type="app_user", entity_id=user_id,
                       summary=f'{user["full_name"]} signed in'),
        )

    token = sign_access_token(AccessClaims(
        sub=user_id, role=access.role, sid=session_id, pv=access.perm_version))
    _set_cookie(response, refresh)
    return {
        "accessToken": token,
        "role": access.role,
        "mustChangePassword": user.get("must_change_pw", False),
    }


# ---------------------------------------------------------------------------
# Students register themselves. Teachers are created by Brolly Admin, which is
# why there is no role field on this endpoint to tamper with.
# ---------------------------------------------------------------------------

@router.post("/api/v1/auth/register")
async def register(
    body: RegisterBody, request: Request, response: Response, _=Depends(public_route)
):
    email = body.email.strip().lower()
    full_name = body.fullName.strip()

    if not full_name:
        raise bad_request("Tell us your name.")
    if not EMAIL_RE.match(email):
        raise bad_request("That does not look like an email address.")
    if len(body.password) < 8:
        # Length, not symbols. Composition rules make teenagers reuse passwords.
        raise bad_request("Use at least 8 characters. A short phrase you will remember is fine.")

    if await _find_by_email(email):
        raise conflict("There is already an account with that email. Try signing in.", "email_taken")

    new_id = str(uuid.uuid4())
    async with db.admin() as c:
        await c.execute(
            """INSERT INTO app_user (id, email, password_hash, full_name, phone, status)
               VALUES ($1,$2,$3,$4,$5,'active')""",
            new_id, email, hash_password(body.password), full_name, body.phone,
        )
        role_id = await c.value("SELECT id FROM role WHERE key = 'STUDENT'")
        await c.execute("INSERT INTO user_role (user_id, role_id) VALUES ($1,$2)", new_id, role_id)
        await c.execute(
            """INSERT INTO student_profile (user_id, grade_level, guardian_name, guardian_email,
                                            guardian_phone, consent_status)
               VALUES ($1,$2,$3,$4,$5,$6)""",
            new_id, body.gradeLevel, body.guardianName, body.guardianEmail, body.guardianPhone,
            "guardian_given" if body.guardianEmail else "pending",
        )

    return await _start_session(
        response, request,
        {"id": new_id, "full_name": full_name, "must_change_pw": False},
    )


@router.post("/api/v1/auth/login")
async def login(
    body: LoginBody, request: Request, response: Response, _=Depends(public_route)
):
    email = body.email.strip()
    if not email or not body.password:
        raise bad_request("Enter your email and password.")

    key = f"{client_ip(request)}|{email.lower()}"
    await _throttle(key)

    user = await _find_by_email(email)
    # Constant-shape failure: an unknown account costs the same work and gives
    # the same message as a wrong password.
    ok = verify_password(body.password, user["password_hash"] if user else DUMMY_HASH)

    if not user or not ok:
        await _record_failure(key)
        raise unauthorized("That email or password is not right.")
    if user["status"] != "active":
        raise locked("This account has been deactivated. Contact support.", "user_disabled")

    await _clear_failures(key)
    return await _start_session(response, request, user)


@router.post("/api/v1/auth/refresh")
async def refresh(request: Request, response: Response, _=Depends(public_route)):
    presented = request.cookies.get(settings.cookie_name)
    if not presented:
        raise unauthorized("No session.")

    async with db.admin() as c:
        row = await c.one(
            """SELECT id, user_id, family_id, used_at, revoked_at, expires_at
                 FROM session WHERE refresh_token_hash = $1 LIMIT 1""",
            sha256(presented),
        )
    if row is None:
        raise unauthorized("Session not recognised.")

    user_id = str(row["user_id"])
    access = await load_access(user_id)
    if access is None or access.status != "active":
        raise unauthorized()

    if row["used_at"] or row["revoked_at"]:
        # Already rotated, so this is a replay: assume theft and kill the whole
        # family rather than just this token.
        async with db.actor(user_id, db_role(access)) as c:
            await c.execute(
                "UPDATE session SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL",
                row["family_id"],
            )
            await audit(
                c,
                Who(user_id=user_id, role=access.role, ip=client_ip(request),
                    request_id=request.state.request_id),
                AuditEntry(
                    action="auth.refresh.reuse_detected", entity_type="session",
                    entity_id=str(row["id"]),
                    summary="Refresh token replayed — every session in the family was revoked",
                ),
            )
        response.delete_cookie(settings.cookie_name, path="/api/v1/auth")
        raise unauthorized("That session was already used. Sign in again.")

    if row["expires_at"] < datetime.now(timezone.utc):
        raise unauthorized("Your session expired. Sign in again.")

    async with db.actor(user_id, db_role(access)) as c:
        await c.execute(
            "UPDATE session SET used_at = now(), revoked_at = now() WHERE id = $1", row["id"]
        )
        session_id, new_refresh = await _issue_session(
            c, user_id, access.role != "STUDENT", client_ip(request),
            request.headers.get("user-agent", ""), str(row["family_id"]),
        )

    token = sign_access_token(AccessClaims(
        sub=user_id, role=access.role, sid=session_id, pv=access.perm_version))
    _set_cookie(response, new_refresh)
    return {"accessToken": token, "role": access.role}


@router.post("/api/v1/auth/logout")
async def logout(request: Request, response: Response, _=Depends(public_route)):
    presented = request.cookies.get(settings.cookie_name)
    if presented:
        async with db.admin() as c:
            await c.execute(
                "UPDATE session SET revoked_at = now() WHERE refresh_token_hash = $1",
                sha256(presented),
            )
    response.delete_cookie(settings.cookie_name, path="/api/v1/auth")
    return {"ok": True}


@router.post("/api/v1/auth/change-password")
async def change_password(
    body: ChangePasswordBody, actor: Actor = Depends(requires("me:read"))
):
    if not body.newPassword or len(body.newPassword) < 8:
        raise bad_request("Use at least 8 characters. A short phrase you will remember is fine.")

    async with actor.db() as c:
        row = await c.one(
            "SELECT password_hash, full_name FROM app_user WHERE id = $1", actor.user_id
        )
        if row is None:
            raise unauthorized()
        if not verify_password(body.currentPassword, row["password_hash"]):
            raise bad_request("Your current password is not right.")

        await c.execute(
            """UPDATE app_user
                  SET password_hash = $1, must_change_pw = false, perm_version = perm_version + 1
                WHERE id = $2""",
            hash_password(body.newPassword), actor.user_id,
        )
        await c.execute(
            "UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
            actor.user_id,
        )
        await actor.log_audit(c, AuditEntry(
            action="auth.password.changed", entity_type="app_user", entity_id=actor.user_id,
            summary=f'{row["full_name"]} changed their password',
        ))

    await invalidate_access(actor.user_id)
    return {"ok": True, "reauth": True}


@router.get("/api/v1/auth/sessions")
async def sessions(actor: Actor = Depends(requires("me:read"))):
    async with actor.db() as c:
        return {"sessions": await c.query(
            """SELECT id, user_agent, ip, created_at, expires_at FROM session
                WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC""",
            actor.user_id,
        )}
