#!/usr/bin/env bash
# runners/weekly_creative_firehose.sh
#
# Flow C — Generate 3-5 new creative variants per active campaign.
# Scheduled: Mon 10:00 Asia/Jerusalem.
#
# Proposes `task_type=new_creative` rows into `approvals`. Does not upload to
# Meta directly — human approval + Flow B handle the upload.

set -euo pipefail

FLOW="weekly_creative_firehose"
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
  "BUSINESS_ID=$BUSINESS_ID. Run the weekly creative firehose per campaigner/CAMPAIGNER.md."

DURATION=$(($(date +%s%3N) - START_TS))
python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase end \
  --duration-ms "$DURATION" \
  --exit-code 0 >/dev/null

echo "✓ $FLOW completed in ${DURATION}ms"
