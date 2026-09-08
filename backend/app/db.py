"""
Every query runs as somebody.

Application code never opens a connection. It calls `actor()` or `anon()`,
which wrap the work in a transaction that has already dropped to the
non-superuser `brolly_app` role and pinned who is asking. A handler that
forgets an entitlement check is therefore survivable: the database still
refuses to return a course the student has not bought (sql/003_rls.sql).

asyncpg is used rather than psycopg because it speaks Postgres' native `$1`
placeholders — which is why every SQL statement carried over from the previous
TypeScript build runs here unchanged, character for character.
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Literal

import asyncpg

from .config import settings

ActorRole = Literal["BROLLY_ADMIN", "TEACHER", "STUDENT", "ANON"]

_pool: asyncpg.Pool | None = None


def _dumps(value: Any) -> str:
    # default=str so a datetime or UUID inside an audit payload serialises
    # rather than raising halfway through a write.
    return json.dumps(value, default=str)


async def _init_connection(conn: asyncpg.Connection) -> None:
    """
    Hand jsonb back as parsed Python objects rather than strings, so a handler
    reads `course["outcomes"][0]` exactly as the TypeScript one did. Binding
    works the same way round: pass a dict or list, never a pre-encoded string.
    """
    for name in ("jsonb", "json"):
        await conn.set_type_codec(
            name, encoder=_dumps, decoder=json.loads, schema="pg_catalog"
        )


async def connect() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=settings.db_pool_min,
            max_size=settings.db_pool_max,
            init=_init_connection,
            # Statement caching and RLS session settings coexist badly when a
            # pooled connection is reused under a different actor, so plans are
            # not cached across checkouts.
            statement_cache_size=0,
        )
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool is not open. Call connect() first.")
    return _pool


class Conn:
    """
    A connection already inside a transaction, pinned to one actor.

    The surface is deliberately the same three calls the TypeScript `Conn` had —
    fetch/fetchrow/execute — so ported handlers read the same.
    """

    def __init__(self, raw: asyncpg.Connection) -> None:
        self._raw = raw

    async def query(self, text: str, *args: Any) -> list[dict[str, Any]]:
        rows = await self._raw.fetch(text, *args)
        return [dict(r) for r in rows]

    async def one(self, text: str, *args: Any) -> dict[str, Any] | None:
        row = await self._raw.fetchrow(text, *args)
        return dict(row) if row is not None else None

    async def value(self, text: str, *args: Any) -> Any:
        return await self._raw.fetchval(text, *args)

    async def execute(self, text: str, *args: Any) -> str:
        return await self._raw.execute(text, *args)

    async def exec_script(self, text: str) -> None:
        """Multi-statement DDL. Migration and seed only."""
        await self._raw.execute(text)


@asynccontextmanager
async def _run_as(
    user_id: str | None, role: ActorRole
) -> AsyncIterator[Conn]:
    async with pool().acquire() as raw:
        async with raw.transaction():
            await raw.execute("SET LOCAL ROLE brolly_app")
            await raw.execute(
                "SELECT set_config('app.user_id', $1, true)", user_id or ""
            )
            await raw.execute("SELECT set_config('app.role', $1, true)", role)
            yield Conn(raw)


def actor(user_id: str, role: ActorRole):
    """Every authenticated request."""
    if not user_id:
        raise ValueError("actor() called without a user")
    return _run_as(user_id, role)


def anon():
    """The public catalogue, and nothing else. Sees published structure only."""
    return _run_as(None, "ANON")


@asynccontextmanager
async def admin() -> AsyncIterator[Conn]:
    """
    Migration and seed only. Runs as the owning role, so RLS does not apply.

    Login is the one runtime caller: it must find a user before it knows who
    they are, which is the whole of the chicken-and-egg problem in
    authentication.
    """
    async with pool().acquire() as raw:
        async with raw.transaction():
            yield Conn(raw)
