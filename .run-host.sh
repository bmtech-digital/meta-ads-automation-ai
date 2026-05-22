#!/usr/bin/env bash
# Host wrapper for Flow A. Loads .env, activates the host venv, sets PYTHONPATH,
# then exec's whatever was passed as args. Used in lieu of docker compose so the
# host CC session can drive tools directly without the inner-Claude layer.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
export PYTHONPATH="$PWD"
exec .venv-host/bin/python "$@"
