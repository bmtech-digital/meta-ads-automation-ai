#!/usr/bin/env bash
# runners/midday_health_check.sh
#
# Flow H — Midday Health Check. Scheduled: 13:00 Asia/Jerusalem.
#
# A short check that runs 4 hours after Flow A's morning sweep. It does NOT
# redo full diagnosis — instead it watches for things that ONLY matter if
# they emerge during the workday:
#
#   (a) Emergency-pause candidates — a campaign whose CPL has spiked > 3×
#       target since this morning (rare but catastrophic if it sits 18 hours).
#   (b) Tracking-health drift — pixel went from `healthy` to `partial` since
#       morning (operator changed something, or domain verification dropped).
#
# Neither emits proposals casually. (a) emits an `alert` (`acknowledgment_only`)
# with the spike numbers and the next-step ("approve here to also send an
# emergency `pause_campaign`?"). (b) emits an `alert` describing what broke
# in the measurement infrastructure.
#
# Heartbeat contract: writes phase=start on entry, phase=end on success,
# phase=error on any failure.
#
# Exit codes:
#   0 — success
#   1 — failure
#   2 — validation

set -euo pipefail

FLOW="midday_health_check"
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
  "BUSINESS_ID=$BUSINESS_ID. Run the midday health check flow per campaigner/CAMPAIGNER.md Flow H. Watch ONLY for emergency-pause candidates (CPL > 3× target intra-day) and tracking-health drift since morning. Do NOT redo Flow A diagnosis."

DURATION=$(($(date +%s%3N) - START_TS))
python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase end \
  --duration-ms "$DURATION" \
  --exit-code 0 >/dev/null

echo "✓ $FLOW completed in ${DURATION}ms"
