#!/usr/bin/env bash
# Apply SQL migrations to the Postgres target pointed at by DATABASE_URL.
#
# Local dev: ensures postgres service is up, then runs migrate.py inside the
# campaigner container (so psycopg + project code are available).
#
# Supabase: same script — set DATABASE_URL in .env to Supabase URI, run this.
#
# Usage:
#   bash scripts/migrate.sh              # apply pending
#   bash scripts/migrate.sh --status     # list applied vs pending
#   bash scripts/migrate.sh --dry-run    # plan only

set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Ensuring postgres service is up..."
docker compose up -d postgres >/dev/null

echo "→ Waiting for postgres health..."
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U campaigner -d campaigner_dev >/dev/null 2>&1; then
    echo "  ✓ postgres healthy"
    break
  fi
  sleep 1
  if [[ $i -eq 30 ]]; then
    echo "  ✗ postgres did not become healthy in 30s"
    docker compose logs postgres | tail -20
    exit 1
  fi
done

echo "→ Running migrate.py..."
docker compose run --rm campaigner python scripts/migrate.py "$@"
