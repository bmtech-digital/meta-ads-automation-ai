#!/usr/bin/env bash
# runners/daily_observe_propose.sh
#
# Flow A — Observe-Propose. Scheduled: 09:00 Asia/Jerusalem via cron.
#
# Pulls Meta insights, diagnoses per CAMPAIGNER.md, writes proposals into
# `approvals` and decisions into `agent_decisions`. Never touches Meta.
#
# Heartbeat contract: writes phase=start on entry, phase=end on success,
# phase=error on any failure. The frontend uses this to detect "3 consecutive
# failures" (spec §10.8).
#
# Prereqs: BUSINESS_ID, ANTHROPIC_API_KEY, META_* env vars set. When running
# on Cloud Run Jobs, these are fetched from Secret Manager by the job entrypoint
# before this script is invoked.
#
# Exit codes:
#   0 — success (observe-propose completed, heartbeat end written)
#   1 — failure (claude returned non-zero, DB unreachable, etc. — heartbeat error written)
#   2 — validation (env misconfig, blocks before any tool call)

set -euo pipefail

FLOW="daily_observe_propose"
START_TS=$(date +%s%3N)

# ----- env validation (pre-heartbeat so we don't pollute the table) -----
: "${BUSINESS_ID:?BUSINESS_ID must be set}"
: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY must be set}"

cd "$(dirname "$0")/.."

# ----- heartbeat start -----
python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase start >/dev/null

# ----- trap: on any unexpected exit, write heartbeat error -----
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

# ----- invoke Claude Code headless -----
# The prompt tells Claude which flow to execute; it reads CAMPAIGNER.md + prompts/*.md
# from cwd (which is /app for this runner).
claude -p \
  --output-format json \
  "BUSINESS_ID=$BUSINESS_ID. Run the daily observe-propose flow per campaigner/CAMPAIGNER.md."

# ----- heartbeat end (only reached on success) -----
DURATION=$(($(date +%s%3N) - START_TS))
python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase end \
  --duration-ms "$DURATION" \
  --exit-code 0 >/dev/null

echo "✓ $FLOW completed in ${DURATION}ms"
