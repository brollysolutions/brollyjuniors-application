"""
Redis.

Two things live here, and both were process-local Maps in the previous build —
which meant they silently stopped working the moment a second worker existed:

  1. The effective-access cache. A 15-second TTL in front of the role and
     permission read, invalidated explicitly when a role changes.
  2. The login throttle. Counters that must survive a restart, or a restart is
     a way to clear your own lockout.

Redis is not a source of truth for anything. Sessions and refresh tokens stay
in Postgres, because losing them would sign the world out.
"""
from __future__ import annotations

import redis.asyncio as aioredis

from ..config import settings

_client: aioredis.Redis | None = None


async def connect() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(
            settings.redis_url, encoding="utf-8", decode_responses=True
        )
        await _client.ping()
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def client() -> aioredis.Redis:
    if _client is None:
        raise RuntimeError("Redis is not connected. Call connect() first.")
    return _client
