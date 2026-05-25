#!/usr/bin/env bash
# Bootstrap the local Mongo + Redis dev environment.
#
# Usage:
#   bash scripts/bootstrap_local_db.sh           # idempotent: ensures services up, runs init
#   bash scripts/bootstrap_local_db.sh --reset   # wipes mongo + redis volumes first
#
# Runs end-to-end: start containers, wait for health, create collections + indexes.
# After success: `python scripts/validate_local_env.py` to verify.
#
# Stack: see decisions-log.md §1.4 amendment (local aligned to generic_agent
# pattern — Mongo + Redis). Remote target TBD.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--reset" ]]; then
  echo "→ Wiping mongo + redis volumes..."
  docker compose down -v --remove-orphans 2>/dev/null || true
fi

echo "→ Building campaigner image (picks up requirements.txt changes)..."
docker compose build campaigner

echo "→ Starting mongo + redis (removing any orphan services)..."
docker compose up -d --remove-orphans mongo redis

echo "→ Waiting for mongo to be healthy..."
for i in {1..30}; do
  if docker compose exec -T mongo mongosh --quiet --eval "db.adminCommand('ping').ok" 2>/dev/null | grep -q 1; then
    echo "  ✓ mongo healthy"
    break
  fi
  sleep 1
  if [[ $i -eq 30 ]]; then
    echo "  ✗ mongo did not become healthy in 30s"
    docker compose logs mongo | tail -20
    exit 1
  fi
done

echo "→ Waiting for redis to be healthy..."
for i in {1..15}; do
  if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    echo "  ✓ redis healthy"
    break
  fi
  sleep 1
  if [[ $i -eq 15 ]]; then
    echo "  ✗ redis did not become healthy in 15s"
    docker compose logs redis | tail -20
    exit 1
  fi
done

echo "→ Initializing mongo collections + indexes..."
docker compose run --rm campaigner python migrations/mongo/init_mongo.py

echo ""
echo "✓ Local dev env ready (mongo + redis)."
echo ""
echo "Next: docker compose run --rm campaigner python scripts/validate_local_env.py"
