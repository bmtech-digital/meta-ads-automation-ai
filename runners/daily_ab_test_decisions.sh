#!/usr/bin/env bash
# runners/daily_ab_test_decisions.sh
#
# Flow G — Daily A/B Test Decisions. Scheduled: 09:30 Asia/Jerusalem
# (30 min after Flow A so the daily insights are fresh).
#
# For every ab_test in `running` status whose `planned_end_at` has passed,
# emit an `ab_test_decide` proposal with the evaluated winner. Closes the
# Block 11 loop — until now setup happened (ab_test_setup), but no flow
# automatically announced "your test ended, here's the winner."
#
# Heartbeat contract: writes phase=start on entry, phase=end on success,
# phase=error on any failure.
#
# Prereqs: BUSINESS_ID, ANTHROPIC_API_KEY, META_* env vars set.
#
# Exit codes:
#   0 — success
#   1 — failure (claude returned non-zero, DB unreachable, etc.)
#   2 — validation (env misconfig)

set -euo pipefail

FLOW="daily_ab_test_decisions"
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
  "BUSINESS_ID=$BUSINESS_ID. Run the daily A/B test decisions flow per campaigner/CAMPAIGNER.md Flow G."

DURATION=$(($(date +%s%3N) - START_TS))
python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase end \
  --duration-ms "$DURATION" \
  --exit-code 0 >/dev/null

echo "✓ $FLOW completed in ${DURATION}ms"
