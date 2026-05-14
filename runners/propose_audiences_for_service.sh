#!/usr/bin/env bash
# runners/propose_audiences_for_service.sh
#
# Flow E — Per-Service Audience Proposals. Operator-initiated, NOT cron.
# Triggered from /business-knowledge → service card → "הצע קהל מבוסס מחקר".
# The web API exec's into the running `campaigner` container with
# BUSINESS_ID + SERVICE_NAME set, and the agent reads §T_AUD in decision-tree.md.
#
# Heartbeat contract: writes phase=start on entry, phase=end on success,
# phase=error on any failure — same convention as the cron runners so the
# failure-detector (spec §10.8) sees this flow too.
#
# Prereqs: BUSINESS_ID, SERVICE_NAME, ANTHROPIC_API_KEY, META_* env vars set.
#
# Exit codes:
#   0 — success
#   1 — runtime failure
#   2 — validation failure (env missing — no heartbeat written)

set -euo pipefail

FLOW="propose_audiences_for_service"
START_TS=$(date +%s%3N)

# ----- env validation (pre-heartbeat) -----
: "${BUSINESS_ID:?BUSINESS_ID must be set}"
: "${SERVICE_NAME:?SERVICE_NAME must be set (operator-initiated; pass the product name)}"
: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY must be set}"

cd "$(dirname "$0")/.."

# Details JSON stamped on every heartbeat — lets the web UI poll status per
# (business, service) instead of just per business+flow. We construct it with
# python's json to avoid quoting headaches if SERVICE_NAME has spaces or
# punctuation.
DETAILS_JSON=$(python -c 'import json,os;print(json.dumps({"service_name":os.environ["SERVICE_NAME"]}))')

# ----- heartbeat start -----
python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase start \
  --details "$DETAILS_JSON" >/dev/null

on_error() {
  local exit_code=$?
  local duration=$(($(date +%s%3N) - START_TS))
  python -m campaigner.tools.heartbeat \
    --business-id "$BUSINESS_ID" \
    --flow "$FLOW" \
    --phase error \
    --exit-code "$exit_code" \
    --duration-ms "$duration" \
    --details "$DETAILS_JSON" \
    --error-message "runner exited non-zero" || true
  exit "$exit_code"
}
trap on_error ERR

# ----- invoke Claude Code headless -----
# The prompt carries the flow name + SERVICE_NAME so the agent routes to
# Flow E in CAMPAIGNER.md and §T_AUD in decision-tree.md.
claude -p \
  --output-format json \
  "BUSINESS_ID=$BUSINESS_ID. SERVICE_NAME=$SERVICE_NAME. Run propose audiences for service per campaigner/CAMPAIGNER.md Flow E."

# ----- heartbeat end -----
DURATION=$(($(date +%s%3N) - START_TS))
python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase end \
  --duration-ms "$DURATION" \
  --exit-code 0 >/dev/null

echo "✓ $FLOW service=\"$SERVICE_NAME\" completed in ${DURATION}ms"
