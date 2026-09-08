"""
The request pipeline:

  authenticate   valid token? session live? perm_version current?
  permission     the Requires(...) declared on the route
  handler        loads the row, then calls an entitlement check
  database       refuses anyway if the check was forgotten (sql/003_rls.sql)

Deny by default: a route that declares neither `public_route` nor
`requires(...)` fails `assert_every_route_guarded()` at startup. A forgotten
guard is a boot failure, not a hole somebody finds in production.
"""
from __future__ import annotations

from typing import Any, Callable

from fastapi import Depends, FastAPI, Request
from fastapi.routing import APIRoute

from . import db
from .access import Access, can, load_access
from .audit import AuditEntry, Who, audit
from .core.tokens import verify_access_token
from .errors import forbidden, unauthorized

#: Marks a dependency as satisfying the deny-by-default rule. The value is the
#: permission required, or None for a deliberately public route.
GUARD_ATTR = "__brolly_guard__"


class Actor:
    """
    An authenticated caller, plus the two things every handler needs: a
    connection pinned to them, and a way to write an audit row as them.
    """

    __slots__ = ("access", "request")

    def __init__(self, access: Access, request: Request) -> None:
        self.access = access
        self.request = request

    def db(self):
        """Run as this user. RLS is pinned to them for the whole transaction."""
        return db.actor(self.access.user_id, self.access.role)

    @property
    def user_id(self) -> str:
        return self.access.user_id

    @property
    def role(self) -> str:
        return self.access.role

    def _who(self) -> Who:
        return Who(
            user_id=self.access.user_id,
            role=self.access.role,
            ip=client_ip(self.request),
            ua=self.request.headers.get("user-agent", ""),
            request_id=getattr(self.request.state, "request_id", ""),
        )

    async def log_audit(self, c: db.Conn, entry: AuditEntry) -> None:
        await audit(c, self._who(), entry)


def client_ip(request: Request) -> str:
    # trustProxy equivalent: honour the first hop of X-Forwarded-For when a
    # proxy set one, else the socket address.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


async def _authenticate(request: Request) -> Access:
    header = request.headers.get("authorization")
    if not header or not header.startswith("Bearer "):
        raise unauthorized()

    try:
        claims = verify_access_token(header[7:])
    except Exception:
        raise unauthorized("Your session has expired. Sign in again.")

    access = await load_access(claims.sub)
    if access is None:
        raise unauthorized()

    # A role change or deactivation bumps perm_version, so a token minted
    # before that is refused immediately rather than at expiry.
    if access.perm_version != claims.pv:
        raise unauthorized("Your access changed. Sign in again.")
    if access.status != "active":
        raise forbidden("This account has been deactivated.")

    return access


def requires(permission: str) -> Callable[..., Any]:
    """Declare the permission a route needs. Returns an Actor."""

    async def dependency(request: Request) -> Actor:
        access = await _authenticate(request)
        actor = Actor(access, request)

        if not can(access, permission):
            # A spike of these for one account is the signal that somebody is
            # probing. The audit write must never fail the request itself.
            try:
                async with actor.db() as c:
                    await actor.log_audit(c, AuditEntry(
                        action="authz.denied",
                        summary=f"{permission} on {request.method} {request.url.path}",
                    ))
            except Exception:
                pass
            raise forbidden(f"You do not have permission to do that ({permission}).")

        return actor

    setattr(dependency, GUARD_ATTR, permission)
    return dependency


async def public_route() -> None:
    """
    The catalogue is browsable by strangers. Handlers using this open their own
    `db.anon()` scope, which sees published structure and nothing else.
    """
    return None


setattr(public_route, GUARD_ATTR, None)


async def optional_actor(request: Request) -> Actor | None:
    """For a public route that behaves slightly differently when signed in."""
    if not request.headers.get("authorization"):
        return None
    try:
        return Actor(await _authenticate(request), request)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Deny by default
# ---------------------------------------------------------------------------

def _has_guard(dependant: Any) -> bool:
    if dependant.call is not None and hasattr(dependant.call, GUARD_ATTR):
        return True
    return any(_has_guard(sub) for sub in dependant.dependencies)


def assert_every_route_guarded(app: FastAPI, exempt: set[str] | None = None) -> None:
    exempt = exempt or set()
    unguarded: list[str] = []

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if route.path in exempt:
            continue
        methods = set(route.methods or ()) - {"HEAD", "OPTIONS"}
        if not methods:
            continue
        if not _has_guard(route.dependant):
            unguarded.append(f"{'/'.join(sorted(methods))} {route.path}")

    if unguarded:
        listing = "\n  ".join(unguarded)
        raise RuntimeError(
            "These routes declare no permission:\n  "
            f"{listing}\n"
            "Add Depends(requires('some:permission')) or Depends(public_route)."
        )


__all__ = [
    "Actor", "requires", "public_route", "optional_actor", "client_ip",
    "assert_every_route_guarded", "Depends",
]
