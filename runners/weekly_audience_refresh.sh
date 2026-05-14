#!/usr/bin/env bash
# runners/weekly_audience_refresh.sh
#
# Flow D — Page audience refresh. Scheduled: Sunday 04:00 Asia/Jerusalem.
#
# Calls /{page_id}/insights/page_fans_online_per_day for every active business
# with a selected Page, projects onto hour-of-week, UPSERTs into
# `page_audience_signals`. The agent reads this table in §T9 (Organic
# Cadence) to pick `scheduled_for` at peak-online hours.
#
# Heartbeat contract: writes phase=start on entry, phase=end on success,
# phase=error on any failure. Same convention as the other three runners.
#
# Exit codes:
#   0 — success
#   1 — runtime failure
#   2 — env validation

set -euo pipefail

FLOW="weekly_audience_refresh"
START_TS=$(date +%s%3N)

# ----- env validation -----
: "${BUSINESS_ID:?BUSINESS_ID must be set}"
# This runner does not need ANTHROPIC_API_KEY — pure Python tool, no claude -p.

cd "$(dirname "$0")/.."

# ----- heartbeat start -----
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

# ----- run the refresh tool -----
# `--business-id` constrains to this business in single-business deploys.
# Multi-business: omit and the tool iterates active businesses with a Page.
python -m campaigner.tools.refresh_page_audience \
  --business-id "$BUSINESS_ID"

# ----- heartbeat end -----
DURATION=$(($(date +%s%3N) - START_TS))
python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase end \
  --duration-ms "$DURATION" \
  --exit-code 0 >/dev/null

echo "✓ $FLOW completed in ${DURATION}ms"
