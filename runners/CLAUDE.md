# Claude-at-`runners/` — cron entrypoints

> Loaded automatically when cwd is here. Active alongside [root CLAUDE.md](../CLAUDE.md).

## What this folder is

Five Bash scripts. Each wraps a single `claude -p` headless invocation with environment validation, heartbeats, and exit-code discipline. Four are cron entrypoints (the seam between Cloud Scheduler / cron and the agent); one is operator-initiated.

| Script | Flow | Schedule (Asia/Jerusalem) |
|---|---|---|
| [`daily_observe_propose.sh`](daily_observe_propose.sh) | A — observe & queue proposals to `approvals` | 09:00 daily |
| [`execute_approvals.sh`](execute_approvals.sh) | B — execute approved rows against Meta | every 15 min |
| [`weekly_creative_firehose.sh`](weekly_creative_firehose.sh) | C — generate 3-5 new creatives per active campaign | Mon 10:00 |
| [`weekly_competitive_research.sh`](weekly_competitive_research.sh) | D — weekly WebSearch on market prices, trending angles, new formats — emits `alert` proposals with sources | Mon 11:00 |
| [`weekly_audience_refresh.sh`](weekly_audience_refresh.sh) | Page audience-signals refresh — UPSERTs hour-of-week into `page_audience_signals` for §T9 organic cadence | Sun 04:00 |
| [`propose_audiences_for_service.sh`](propose_audiences_for_service.sh) | E — per-service audience proposals (§T_AUD); requires `SERVICE_NAME` env var | operator-initiated (not cron) |
| [`weekly_self_audit.sh`](weekly_self_audit.sh) | F — weekly self-audit; agent writes a Hebrew ~200-word digest summarising what was proposed/approved/rejected/outcomes (the "agency replacement" weekly status report) | Sun 08:00 |
| [`daily_ab_test_decisions.sh`](daily_ab_test_decisions.sh) | G — for every A/B test past its `planned_end_at`, propose `ab_test_decide` with the evaluated winner | 09:30 daily |
| [`midday_health_check.sh`](midday_health_check.sh) | H — short midday check; emergency-pause candidates + tracking-health drift only (does NOT redo full Flow A) | 13:00 daily |

The matching k8s `CronJob` manifests live in [`../kubefiles/`](../kubefiles/) (`agent_cronjob_*.yaml`).

## The runner contract

Every runner does these five things, in this order. If you write a new runner, copy the structure exactly.

1. **Validate env** (`set -euo pipefail`, `: "${BUSINESS_ID:?...}"`). Fail with exit 2 **before** writing any heartbeat — a misconfigured run shouldn't pollute the heartbeat table.
2. **Heartbeat `phase=start`** via `python -m campaigner.tools.heartbeat`. This makes the run visible to the failure-detector.
3. **`trap` to write `phase=error` on any non-zero exit**, including duration and exit code. Suppress trap errors with `|| true` so the trap itself never crashes.
4. **`claude -p --output-format json "..."`** with a prompt that names the flow. Claude reads [`../campaigner/CAMPAIGNER.md`](../campaigner/CAMPAIGNER.md) from cwd and routes to the right flow.
5. **Heartbeat `phase=end`** with duration and exit code 0 — only reached on success.

## Why this structure

- **Heartbeats are observability.** The frontend's "3 consecutive failures → red banner" detector (spec §10.8) reads the `heartbeats` table. A runner that doesn't write heartbeats is invisible.
- **`trap on ERR`** is the only way to guarantee a `phase=error` row even when `claude -p` segfaults or the network drops mid-flow.
- **The prompt is one line.** `claude -p "BUSINESS_ID=$BUSINESS_ID. Run the daily observe-propose flow per campaigner/CAMPAIGNER.md."` Claude reads everything else from CAMPAIGNER.md. Don't inline prompt content here — it's a maintenance trap.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. `phase=end` heartbeat written. |
| 1 | Runtime failure (Claude returned non-zero, DB unreachable, Meta API down). `phase=error` heartbeat written via trap. |
| 2 | Validation failure (env missing). No heartbeat — run never started. |

## Adding a new runner

1. **Don't unilaterally.** Each flow needs spec alignment first (CAMPAIGNER.md flow section + table at top + this folder's catalog + a matching k8s CronJob). The current set is Flow A/B/C/D — A=daily, B=every-15-min, C+D=weekly. Adding a fifth flow needs an operator decision, not an agent decision.
2. If the spec adds one (e.g. monthly review, ad hoc backfill), copy `daily_observe_propose.sh` byte-for-byte and change three things: `FLOW=...`, the `claude -p` prompt, and the runtime expectations comment block at the top.
3. Add a matching `kubefiles/agent_cronjob_<flow>.yaml` and wire it in the [Makefile](../Makefile) `agent_deploy` target.
4. Update [root CLAUDE.md "Architecture"](../CLAUDE.md#architecture-mvp--claude-code-native) and `CAMPAIGNER.md` flow table.

## Triggering manually

```bash
# Local
docker compose run --rm campaigner bash runners/daily_observe_propose.sh

# Production (one-off)
make agent_run_once FLOW=daily-observe       # see Makefile
```

The CLI [`campaigner run <flow>`](../campaigner/cli/__main__.py) shells to these scripts directly.

## Where truth lives

| Question | Read |
|---|---|
| What each flow does | [`../campaigner/CAMPAIGNER.md`](../campaigner/CAMPAIGNER.md) Flow A / B / C |
| Heartbeat schema | [`../migrations/007_heartbeats.sql`](../migrations/007_heartbeats.sql) + spec §10.8 |
| Cron schedule of record | [`../kubefiles/agent_cronjob_*.yaml`](../kubefiles/) |
| Operator manual trigger | [Makefile](../Makefile) `agent_run_once` |
