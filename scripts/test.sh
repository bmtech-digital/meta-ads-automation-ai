#!/usr/bin/env bash
# Run pytest inside the campaigner container against local Postgres.
#
# On first run, installs pytest (per requirements-dev.txt) into the container.
# Subsequent runs re-use the install (pip is fast when nothing has changed).
#
# Prereqs:
#   - postgres service is up (docker compose up -d postgres)
#   - migrations applied (bash scripts/migrate.sh)
#   - seed loaded (bash scripts/seed_local.sh)
#
# Usage:
#   bash scripts/test.sh                      # full suite
#   bash scripts/test.sh tests/tools/         # specific path
#   bash scripts/test.sh -k contract          # pytest -k filter
#   bash scripts/test.sh -x -v                # stop on first failure, verbose

set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Ensuring postgres is up..."
docker compose up -d postgres >/dev/null

docker compose run --rm campaigner bash -c "
  pip install -q -r requirements-dev.txt &&
  python -m pytest ${*:-tests/}
"
