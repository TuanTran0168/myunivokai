#!/bin/sh
# Render runs one container per service (no compose ordering), so migrations
# run here, before the API starts, when RUN_MIGRATIONS_ON_START=true.
# cmd/migrate prefers DATABASE_DIRECT_URL (Neon direct endpoint) over
# DATABASE_URL, which is correct for DDL through a pooler.
set -e

if [ "$RUN_MIGRATIONS_ON_START" = "true" ]; then
  echo "running database migrations"
  /app/migrate
fi

exec /app/api
