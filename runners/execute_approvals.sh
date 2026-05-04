#!/usr/bin/env bash
# runners/execute_approvals.sh
#
# Flow B — Execute approved actions. Scheduled: every 15 minutes.
#
# Reads `approvals WHERE status='approved'`, re-checks guardrails against live
# state, calls Meta via execute_task.py, logs each outcome. Advisory lock in
# Postgres prevents two concurrent executors from touching the same business.

set -euo pipefail

FLOW="execute_approvals"
START_TS=$(date +%s%3N)

: "${BUSINESS_ID:?BUSINESS_ID must be set}"
: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY must be set}"

cd "$(dirname "$0")/.."

python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase start >/dev/null

on_error() {
  local exit_code=$?
  local duration=$(($(date +%s%3N) - START_TS))
  python -m campaigner.tools.heartbeat \
    --business-id "$BUSINESS_ID" \
    --flow "$FLOW" \
    --phase error \
    --exit-code "$exit_code" \
    --duration-ms "$duration" \
    --error-message "runner exited non-zero" || true
  exit "$exit_code"
}
trap on_error ERR

claude -p \
  --output-format json \
  "BUSINESS_ID=$BUSINESS_ID. Run the execute-approvals flow per campaigner/CAMPAIGNER.md."

DURATION=$(($(date +%s%3N) - START_TS))
python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase end \
  --duration-ms "$DURATION" \
  --exit-code 0 >/dev/null

echo "✓ $FLOW completed in ${DURATION}ms"
