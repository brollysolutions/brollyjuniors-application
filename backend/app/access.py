"""
Effective authority.

    can(actor, permission) = the role grants it
                         AND the governing feature is switched on

Resource scope — "may this teacher see THIS student" — is deliberately not
here. It needs the loaded row, so it lives in entitlement.py and is called by
the handler right after the fetch. And below that again, the database refuses
on its own (sql/003_rls.sql), which is the layer that survives a coding
mistake.

The cache moved to Redis in this rewrite. As a process-local dict it was
already wrong the moment a second uvicorn worker existed: an admin revoking a
role invalidated one worker's copy and left the others serving stale authority
for the rest of the TTL.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from . import db
from .core import redis_client
from .shared.access import FEATURES, PERMISSION_FEATURE

CACHE_PREFIX = "access:"
TTL_SECONDS = 15

#: Which of a user's roles decides their portal. In B2C a person has exactly
#: one, but the model allows more, so the highest level wins rather than "the
#: first row we happened to read".
RANK: dict[str, int] = {"BROLLY_ADMIN": 3, "TEACHER": 2, "STUDENT": 1}


@dataclass(slots=True)
class Access:
    user_id: str
    role: str
    roles: list[str]
    perm_version: int
    status: str
    full_name: str
    email: str
    must_change_password: bool
    permissions: set[str] = field(default_factory=set)
    features: set[str] = field(default_factory=set)

    def to_cache(self) -> str:
        return json.dumps({
            "user_id": self.user_id,
            "role": self.role,
            "roles": self.roles,
            "perm_version": self.perm_version,
            "status": self.status,
            "full_name": self.full_name,
            "email": self.email,
            "must_change_password": self.must_change_password,
            "permissions": sorted(self.permissions),
            "features": sorted(self.features),
        })

    @staticmethod
    def from_cache(raw: str) -> "Access":
        d = json.loads(raw)
        return Access(
            user_id=d["user_id"],
            role=d["role"],
            roles=d["roles"],
            perm_version=d["perm_version"],
            status=d["status"],
            full_name=d["full_name"],
            email=d["email"],
            must_change_password=d["must_change_password"],
            permissions=set(d["permissions"]),
            features=set(d["features"]),
        )


async def invalidate_access(user_id: str) -> None:
    try:
        await redis_client.client().delete(CACHE_PREFIX + user_id)
    except Exception:
        # A cache that cannot be cleared must not break the request that
        # cleared it; the entry expires on its own in TTL_SECONDS anyway.
        pass


async def load_access(user_id: str) -> Access | None:
    r = redis_client.client()
    try:
        hit = await r.get(CACHE_PREFIX + user_id)
        if hit:
            return Access.from_cache(hit)
    except Exception:
        pass  # Redis down: fall through and read Postgres

    # Read the account as itself: the app_user policy always lets you see you.
    async with db.actor(user_id, "STUDENT") as c:
        value = await _read(c, user_id)

    if value is not None:
        try:
            await r.setex(CACHE_PREFIX + user_id, TTL_SECONDS, value.to_cache())
        except Exception:
            pass
    return value


async def _read(c: db.Conn, user_id: str) -> Access | None:
    u = await c.one(
        """SELECT id, full_name, email, status, perm_version, must_change_pw
             FROM app_user WHERE id = $1 AND deleted_at IS NULL""",
        user_id,
    )
    if u is None:
        return None

    role_rows = await c.query(
        "SELECT r.key FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_id = $1",
        user_id,
    )
    roles = [r["key"] for r in role_rows]
    if not roles:
        return None
    role = sorted(roles, key=lambda k: RANK.get(k, 0), reverse=True)[0]

    perm_rows = await c.query(
        """SELECT DISTINCT rp.permission_key
             FROM user_role ur JOIN role_permission rp ON rp.role_id = ur.role_id
            WHERE ur.user_id = $1""",
        user_id,
    )

    return Access(
        user_id=str(u["id"]),
        role=role,
        roles=roles,
        perm_version=u["perm_version"],
        status=u["status"],
        full_name=u["full_name"],
        email=u["email"],
        must_change_password=u["must_change_pw"],
        permissions={r["permission_key"] for r in perm_rows},
        # Every feature is on for Brolly Juniors today. The indirection exists
        # so a future organisation can have some of them off without a code
        # change.
        features=set(FEATURES.keys()),
    )


def can(access: Access, permission: str) -> bool:
    if permission not in access.permissions:
        return False
    feature = PERMISSION_FEATURE.get(permission)
    if feature and feature not in access.features:
        return False
    return True


def db_role(access: Access) -> str:
    return access.role


def boundary_line(access: Access) -> str:
    """What this login can reach, in one line. Shown on every screen."""
    if access.role == "BROLLY_ADMIN":
        return "The whole platform — every course, teacher and student"
    if access.role == "TEACHER":
        return "Your courses, and the students enrolled in them"
    return "Your own courses and your own work"
