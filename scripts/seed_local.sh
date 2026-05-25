#!/usr/bin/env bash
# Seed minimal fixture data into local Postgres.
#
# Inserts one Aiweon `businesses` row using BUSINESS_ID + Meta fields from .env.
# Idempotent via ON CONFLICT (id) DO NOTHING.
#
# Prereq: migrations applied (bash scripts/migrate.sh).
#
# Usage:
#   bash scripts/seed_local.sh

set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Seeding local fixture data..."
docker compose run --rm campaigner python scripts/seed_local.py
