#!/usr/bin/env bash
# runners/weekly_self_audit.sh
#
# Flow F — Weekly Self-Audit. Scheduled: Sun 08:00 Asia/Jerusalem.
#
# Loads the 7-day structured audit via `compose_weekly_audit.py`, then asks
# Claude to translate it into a ~200-word Hebrew operator-facing digest that
# logs as an `agent_decisions` row with node_name='weekly_digest'. The UI
# surfaces this on a dedicated weekly-summary card so Roi opens his week with
# "here's what your campaign manager did last week" — the agency-replacement
# experience.
#
# Heartbeat contract: writes phase=start on entry, phase=end on success,
# phase=error on any failure.
#
# Prereqs: BUSINESS_ID, ANTHROPIC_API_KEY, META_* env vars set.
#
# Exit codes:
#   0 — success (digest written, heartbeat end written)
#   1 — failure (claude returned non-zero, DB unreachable, etc.)
#   2 — validation (env misconfig, blocks before any tool call)

set -euo pipefail

FLOW="weekly_self_audit"
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
# The prompt names the flow; Claude reads CAMPAIGNER.md Flow F, calls the
# audit tool, writes the digest, persists via log_decision.
claude -p \
  --output-format json \
  "BUSINESS_ID=$BUSINESS_ID. Run the weekly self-audit flow per campaigner/CAMPAIGNER.md Flow F. Produce the Hebrew weekly digest."

# ----- heartbeat end (only reached on success) -----
DURATION=$(($(date +%s%3N) - START_TS))
python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase end \
  --duration-ms "$DURATION" \
  --exit-code 0 >/dev/null

echo "✓ $FLOW completed in ${DURATION}ms"
