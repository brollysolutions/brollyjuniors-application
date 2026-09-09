#!/bin/sh
# Apply any unapplied migrations, then hand off to the real command.
#
# migrate.py keeps a schema_migration ledger and skips files already in it, so
# running this on every boot is a no-op once the schema is current. Seeding is
# deliberately NOT here: seed.py is destructive, and a container restart must
# never be a way to wipe the data.
set -e

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "entrypoint: applying migrations"
  python scripts/migrate.py
else
  echo "entrypoint: RUN_MIGRATIONS=0, skipping migrations"
fi

exec "$@"
