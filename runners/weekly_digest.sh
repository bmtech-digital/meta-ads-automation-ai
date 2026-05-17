#!/usr/bin/env bash
# runners/weekly_digest.sh
#
# Flow — Weekly Hebrew digest (Mastery v2 Phase E, 2026-05-17). Cron: Sunday
# 09:00 Asia/Jerusalem. Composes a structured Hebrew summary of the past 7
# days for each active business + sends it to the operator's email +
# optionally WhatsApp.
#
# Per agency research (memory: project_mastery_plan_v2 §1.8): agencies that
# add a weekly tactical snapshot + monthly narrative retain clients ~34%
# longer than monthly-PDF-only. This is the tactical-snapshot half — the
# monthly-narrative half lives in Phase G.
#
# Content per business (composed by compose_weekly_audit.py which already
# exists from Block 12, then rendered to Hebrew here):
#   - Spend YTD vs target
#   - Top 3 pending approvals (with deep-link)
#   - Top 3 alerts of the week
#   - Top 3 wins (best CPL improvement, viral organic, etc.)
#   - Link to full /reports/<this-week> page
#
# Exit codes:
#   0 — success
#   1 — runtime failure
#   2 — env validation failure

set -euo pipefail

FLOW="weekly_digest"
START_TS=$(date +%s%3N)

: "${BUSINESS_ID:?BUSINESS_ID must be set}"

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
    --error-message "weekly_digest exited non-zero" || true
  exit "$exit_code"
}
trap on_error ERR

# The Claude-headless invocation composes the Hebrew digest text from the
# structured audit (compose_weekly_audit), checks for any boost_post
# candidates clearing §53 thresholds via check_organic_performance, and emits
# an `alert` task with the digest as rationale. The web UI / email job picks
# it up from approvals queue.
claude -p \
  --output-format json \
  "BUSINESS_ID=$BUSINESS_ID. Run the weekly_digest flow per campaigner/CAMPAIGNER.md: \
1) run compute_monthly_pace + compose_weekly_audit + check_organic_performance --boost-candidates \
+ list_active_creatives --with-performance; 2) compose a structured Hebrew digest covering \
spend/pace, top approvals, top alerts, top wins, organic cadence (count of Reels/FB/IG/Stories \
posts past 7d vs floor 3+3+3+5), boost_post candidates per §53; 3) emit one alert task with \
task_type=alert + acknowledgment_only=true + the digest as rationale; 4) link to /reports/[week]."

DURATION=$(($(date +%s%3N) - START_TS))
python -m campaigner.tools.heartbeat \
  --business-id "$BUSINESS_ID" \
  --flow "$FLOW" \
  --phase end \
  --duration-ms "$DURATION" \
  --exit-code 0 >/dev/null

echo "✓ $FLOW completed in ${DURATION}ms"
