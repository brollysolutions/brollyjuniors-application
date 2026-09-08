"""
Apply the SQL migrations in order, once each.

The SQL itself is carried over from the previous build unchanged — it was
always plain PostgreSQL, and it is now running on the real server rather than
an in-process build of it, which is where the row-level security in 003 was
always meant to run.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncpg  # noqa: E402

from app.config import settings  # noqa: E402

SQL_DIR = Path(__file__).resolve().parent.parent / "sql"


async def main() -> None:
    conn = await asyncpg.connect(settings.database_url)
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_migration (
              file       text PRIMARY KEY,
              applied_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        done = {r["file"] for r in await conn.fetch("SELECT file FROM schema_migration")}

        files = sorted(SQL_DIR.glob("*.sql"))
        if not files:
            raise SystemExit(f"No .sql files found in {SQL_DIR}")

        for path in files:
            if path.name in done:
                print(f"  = {path.name} ... already applied")
                continue
            sql = path.read_text(encoding="utf-8")
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO schema_migration (file) VALUES ($1)", path.name
                )
            print(f"  + {path.name} ... ok")

        print(f"\nSchema up to date  ·  {settings.database_url}\n")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
