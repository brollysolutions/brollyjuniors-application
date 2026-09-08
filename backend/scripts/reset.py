"""
Drop everything and start again.

Drops the public schema rather than the database, so the connection string,
the role and the container all stay put. `brolly_app` is a cluster-level role,
so it is dropped too — 003_rls.sql recreates it.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncpg  # noqa: E402

from app.config import settings  # noqa: E402


async def main() -> None:
    conn = await asyncpg.connect(settings.database_url)
    try:
        # Ownership of the schema objects has to come back to us before the
        # role can be dropped.
        await conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
        await conn.execute("CREATE SCHEMA public")
        await conn.execute("GRANT ALL ON SCHEMA public TO CURRENT_USER")
        await conn.execute("GRANT ALL ON SCHEMA public TO public")
        await conn.execute("""
            DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brolly_app') THEN
                DROP OWNED BY brolly_app;
                DROP ROLE brolly_app;
              END IF;
            END $$;
        """)
        print(f"Dropped and recreated schema public on {settings.database_url}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
