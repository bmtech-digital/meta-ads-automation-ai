# Campaigner Audit — Volume 2: Input Context

> **What this file is:** a continuation of [`AUDIT_AND_MIGRATION.md`](AUDIT_AND_MIGRATION.md), opened along a different vertical. Volume 1 asked *where does logic live*. This volume asks **what does the Claude Code session actually know at the moment it starts thinking** — and what is it flying blind on. The aim is to make the input surface to a single headless `claude -p` invocation legible end-to-end, so future edits can be made with a clear picture of which context is reachable vs missing.

> **When:** drafted 2026-05-18 against the codebase at commit `c6ea3c8`, in parallel with Volume 1.

> **Audience:** anyone touching prompts, runners, tool catalogs, or DB schema — including future Claude sessions evaluating whether to add a new data source vs reorganize an existing one.

---

## TL;DR

Each Campaigner run is a fresh, stateless `claude -p` invocation with no conversational memory of any prior run. What enters the session is exactly four things: (1) the CLAUDE.md hierarchy auto-loaded by Claude Code from cwd, (2) a one-sentence trigger prompt from the bash runner naming the flow, (3) protocol files (`CAMPAIGNER.md` plus a flow-conditional subset of `prompts/*.md`) that the agent reads as its first action, and (4) tool-fetched runtime data from Postgres and Meta. Anything outside those four is invisible.

The system-side loop is closed — `load_recent_actions_outcomes` reads what the agent previously executed and joins to Meta deltas, so the agent does see whether its past proposals improved CPL. The human-side loop is open — the agent never re-reads its own past Hebrew rationale, never sees operator notes outside `rejection_reason`, never sees yesterday's heartbeat failures, and never sees what a parallel flow proposed thirty minutes earlier. Cross-flow coordination does not exist; the daily, weekly, A/B, and creative flows each run as isolated context islands.

Plans (forward-looking commitments) are the most fragile slice of memory. Volume 1 already flagged that they are parsed from Hebrew prose via regex; this volume confirms the structured `plans_carryover` table from migration 023 exists but does not yet carry outcome data — the agent can tell that a commitment was made but not whether it fired and worked. Multi-month and seasonal context is also absent: baselines are rolling 30–90 day medians, and the only year-over-year signal is whatever an operator typed into `business_knowledge.seasonal_multiplier`.

The recommendation surface is mostly about *closing the operator-side loop* and *making cross-flow context reachable* — the structural-debt fixes in Volume 1 are independent of these gaps.

---

## How we looked

We started from the runner scripts (`runners/*.sh`), traced the trigger prompt each one passes to `claude -p`, and read `campaigner/CAMPAIGNER.md` end-to-end to enumerate what the protocol tells Claude to load and in what order. We then walked every tool under `campaigner/tools/` to classify it as past-state, current-state, or write-only, and read the relevant migrations (`004_approvals.sql`, `005_agent_decisions.sql`, `007_heartbeats.sql`, `023_plans_carryover.sql`) to confirm what is actually persisted on disk. Per-folder `CLAUDE.md` files were read to enumerate auto-loaded markdown. The walk was scoped to Flow A (daily observe-propose) as the reference case, with deltas noted for Flows B, C, D, F, G, H where they diverge.

---

## What the session enters with

A fresh Flow A session at 09:00 Asia/Jerusalem has the following in its head before its first tool call beyond the auto-loaded markdown.

**Cold-start prompt.** Exactly one sentence: `"BUSINESS_ID=$BUSINESS_ID. Run the daily observe-propose flow per campaigner/CAMPAIGNER.md."` (See [`runners/daily_observe_propose.sh:59`](../runners/daily_observe_propose.sh).) No approval IDs, no past metrics, no operator notes — just the business identifier and the flow signal. Every other flow follows the same minimal pattern, with the exception of `propose_audiences_for_service.sh` which additionally injects `SERVICE_NAME` because the operator triggers it from the CLI.

**Auto-loaded CLAUDE.md hierarchy.** Five files load automatically by virtue of Claude Code's default behavior when cwd is the repo root (`/app` in production): root `CLAUDE.md` (binding personality, architecture map, env vars, navigation), `campaigner/CLAUDE.md` (headless invocation contract, Hebrew rules), `campaigner/prompts/CLAUDE.md` (the per-flow prompt-load matrix), `campaigner/tools/CLAUDE.md` (tool I/O contract), and `runners/CLAUDE.md` (heartbeat contract). Combined these set the agent's posture but contain no business data.

**Protocol-directed prompt loads.** `campaigner/CAMPAIGNER.md` instructs Claude at session start to read a flow-conditional subset of `prompts/*.md`. For Flow A: `guardrails.md` (universal), `performance-brain.md`, `decision-tree.md`, `hebrew-copy-style.md`. Flow C additionally reads `creative-guide.md`. Flow D reads `competitive-research.md`. Other prompts (`cpl-infrastructure.md`, `kpi-benchmarks.md`) load on-demand inside the diagnostic loop. This selective loading is marked "binding to save tokens" in the protocol (lines 31–49).

**Pre-flight skip gate (Flow A only).** Before any business data loads, Step −1 calls `compute_state_hash` (hashing active-campaign count, latest edit time, spend bucket at ₪50 granularity, pending-approvals state, tracking and health bands) and compares against the previous run's hash read from `agent_decisions` where `node_name='state_hash'`. If unchanged and the prior run is under 36 hours old, the run logs a skip and exits before loading any business data. This is the only point at which the agent reads its own prior-run record before deciding to proceed.

**Business knowledge (loaded once per run).** `load_business_knowledge` returns the `businesses` row (timezone, ad account, page, monthly budget, primary KPI, monthly brief) joined to `business_knowledge` (vertical, products, brand voice, customer demographics, service regions, tracking verification flags, hands-off campaign IDs, seasonal multiplier, KPI target). This is the agent's only persistent picture of *who the client is*.

**Outcomes of past executed actions (30 days).** `load_recent_actions_outcomes` reads `approvals` where `status='executed'`, joins to `agent_decisions` by `run_id` to recover the campaign_id, and pulls Meta insights for the seven days before and seven days after `executed_at` to classify each action as improved / flat / regressed / insufficient_data. The task-type-specific metric is picked sensibly (CPL for scale and budget changes, CTR for creative actions, CPM for audience expansion). **This is the closed loop on the system side.**

**Operator pushback (90 days).** `load_feedback_history` reads `approvals` where `status='rejected'`, filters out bulk-reset and system reasons (`reset_per_operator_request*`, `anti_flood*`, `tracking_unhealthy*`, `expired_no_action`, `superseded_by_run*`), and groups what remains by `(task_type, target_kind, target_id)`. The agent sees the operator's free-text rejection reasons but only for rejections, and only as text fields.

**Forward-looking commitments (21 days).** `load_active_plans` runs in two modes. Soft mode (current default for un-migrated rows): regex-extracts lines beginning `תוכנית:` from the Hebrew `rationale` text of recent approved or executed approvals. Hard mode (migration 023, present on disk but not yet primary): queries the `plans_carryover` table for rows with `status='pending'` and unexpired `expires_at`, including a `trigger_condition` text field best-effort-parsed from the original "if …" clause. The agent merges both.

**Current Meta state (per-call snapshots).** `fetch_insights` (campaign and ad level, 7-day window with optional prior 7-day window for delta percentages), `fetch_meta_state` (status, last edit time, daily budget cents, objective, post-edit cooldown flag), `check_creative_fatigue` (CPR ≥ 2× prior-window CPR per creative), `check_marginal_return` (did the last scale event move conversions ≥ 10%?), `compute_monthly_pace` (month-to-date spend vs `businesses.monthly_budget_ils` with `seasonal_multiplier` adjustment), `check_account_health` (spend-cap exhaustion, rejected-ads-30d count, funding source, disable_reason → healthy / watch / critical band), `check_tracking_health` (Pixel/CAPI/AEM/domain verification → blocks_proposals list of disallowed task types), `list_active_creatives --with-performance` (per-creative hook rate, CTR, spend, channel; aggregate `viable_unused_count` per channel), `list_audiences` (custom/saved/lookalike from local `meta_audiences` mirror), `fetch_lead_quality_summary` (per-campaign operator-attested quality grades joined to leads from Meta Lead Forms → quality-adjusted CPL).

**Baselines.** `load_baselines` returns rolling medians (typically 30–90 day windows) for CPL, CPA, ROAS, CPM, utilization rate from the `baselines` table. This is what "performance ±15% of baseline" comparisons evaluate against.

**Tool-call discipline.** The protocol explicitly forbids re-calling the same tool with the same arguments within a single run (CAMPAIGNER.md lines 57–68): `load_business_knowledge`, `fetch_meta_state`, `fetch_insights` per `(level, window)`, `load_baselines`, `load_audiences`, `load_feedback_history`, `load_recent_actions_outcomes`, `load_active_plans` are each called once and re-referenced from cache. This is a token-cost lever, not a correctness lever, but it shapes the input surface in practice — the agent does not have on-demand access to "fresh" versions of these mid-run.

---

## Findings

**Finding 10 — The operator-side loop is open.** The agent reads what it *executed* and how Meta responded (`load_recent_actions_outcomes`), and it reads what the operator *rejected* and why (`load_feedback_history`). It does not read the Hebrew rationale it itself wrote on prior runs, nor any operator follow-up beyond rejection_reason. If an operator approved a scale-up last Tuesday and wrote a Slack note saying "this worked because we ran a coupon — don't credit the audience widening," that signal is unreachable. The agent will re-derive its own reasoning every run from numbers alone, then re-write similar rationale in Hebrew, with no awareness of which prior arguments landed and which did not. This is the most consequential gap in the input surface, because it is the one most likely to make the agent feel "repetitive" or "tone-deaf" to operators.

**Finding 11 — Cross-flow context does not exist.** Flow A (09:00), Flow G (09:30 A/B decisions), Flow C (Mon 10:00 creatives), Flow D (Mon 11:00 competitive), Flow F (Sun 08:00 self-audit), and Flow H (13:00 midday check) each run as isolated `claude -p` invocations. There is no shared session, no shared scratchpad, no inter-flow signal beyond what each happens to write into `approvals` and `agent_decisions`. Flow C does not know what Flow A proposed thirty minutes earlier on the same morning. Flow H does not know what Flow A diagnosed at 09:00 — it re-fetches state from scratch at 13:00 and may emit overlapping alerts. Anti-flood caps run per-flow, not per-day, so on a Monday morning the operator can receive proposals from up to four flows back-to-back with no deduplication.

**Finding 12 — Heartbeat history is write-only.** The `heartbeats` table records phase, exit code, duration, and error message for every runner invocation. The frontend reads this to surface "3 consecutive failures." The agent itself never reads it. If Flow A errored at Step 2 yesterday and the day before, the agent today has no awareness that it is about to re-enter a known-failing path. The same is true for `agent_decisions` outside the narrow `state_hash` lookup — the agent does not consult its own historical decisions table during a run, despite that table being where everything is logged.

**Finding 13 — Multi-month and seasonal context is thin.** `load_baselines` returns rolling 30–90 day medians. The only forward-looking seasonal signal is `business_knowledge.seasonal_multiplier`, which is operator-set, scalar, and not date-shaped. There is no year-over-year comparison, no quarterly trend, no calendar of past campaign windows. For a vertical with strong seasonality (a tax-time service, a Black-Friday-driven product), the agent's window is too short to detect the pattern. The Israeli holiday calendar tool (`apply_israeli_calendar.py`) gives day-shape adjustments but not multi-week trend context.

**Finding 14 — Plan outcomes are not recorded.** Migration 023's `plans_carryover` table carries status values `pending / triggered / superseded / expired`. The "triggered" transition records that a forward-looking commitment fired, but no field carries whether the resulting action worked. The agent reads active plans (what was committed to) and recent action outcomes (what executed actions did), but cannot join them — the plan and the action it produced are not linked by ID in the schema as audited. So the agent cannot answer "the last three times I committed to redeploying a creative on this campaign, did the redeploys lift CTR?" — a question whose answer would refine its own commitment-making.

**Finding 15 — Past Hebrew rationale is reachable in the DB but never loaded.** Every `approvals` row stores the agent's rationale text. The `load_active_plans` tool reads this text but only to regex-extract `תוכנית:` lines. No tool returns the full prior rationales for re-reading. The agent has, in effect, written a journal it never re-opens. Whether that journal should be re-opened is a question with cost trade-offs — full rationales are token-expensive at scale — but the current answer is "no" by silence rather than by design.

**Finding 16 — The trigger prompt carries no situational hint.** Every runner passes the same template: `"BUSINESS_ID=X. Run the <flow> per campaigner/CAMPAIGNER.md."` There is no field for "operator manually re-triggered this after a failure," "this is the second run today because the first errored," "this run was triggered post-incident," or "an operator flagged campaign 7.5 as urgent yesterday." All such signals would have to be persisted to DB and discovered by the agent on its own, which today means they are not discovered at all.

**Finding 17 — Skip-on-no-change is the only run-history lookup.** Step −1 (Flow A) is the only point in the protocol where the current run reads a record of the prior run, and the only field it reads is the state hash. This is correct for its narrow purpose (cost gating) but reveals that the broader pattern "before running, check what already happened" is absent everywhere else. Flow C does not check whether Flow A from 30 minutes ago already exhausted the anti-flood budget. Flow F does not check whether yesterday's audit already reported the same trend.

---

## The target

What we would move toward if these gaps were addressed. Not yet adopted; proposed.

**A run-context preamble injected by the runner.** Each runner queries a small "run-context" view in Postgres and passes the result as a JSON blob in the trigger prompt or as a file the agent reads first. Contents: prior-run heartbeat status, count of pending approvals from the last 24 hours, whether another flow ran in the last 60 minutes, whether the operator left any structured note in the last 24 hours. This shifts cross-flow coordination from "impossible" to "addressable in markdown" without changing the agent paradigm.

**Operator notes as first-class rows.** A `operator_notes` table keyed by `(business_id, target_kind, target_id, created_at)` with free-text content and an optional `tag` (e.g. `external_factor`, `kpi_correction`, `pause_request`). A small `load_operator_notes` tool returns the last 14 days. Operators write to this from the web UI alongside approve/reject; the agent reads it in Step 1.6.

**Plan-to-action linkage.** Migration 023+1 adds `plans_carryover.triggered_approval_id` (FK to `approvals`). When a pending plan's trigger condition fires and the agent proposes the resulting action, it sets this FK on the plan row. `load_recent_actions_outcomes` reads the FK back so the outcome is joinable to the original commitment. The agent learns "my commitments fire and work" vs "my commitments fire and miss."

**Heartbeat awareness in the agent.** Add `load_recent_run_history` returning the last 7 days of heartbeat rows for this business+flow. Surfaced in Step 1.6 alongside feedback and outcomes. The agent can say "Flow A errored at Step 2 yesterday — checking that path first" or skip a section it knows is broken.

**A flow-coordination ledger.** A small `flow_runs` view returning all runs from the last 24 hours across all flows for this business — what each proposed, what was rejected, what is still pending. The daily anti-flood cap moves from per-flow to per-business-day, computed against this view.

**Year-over-year baselines (deferred).** Lower-priority. Once baselines have a year of history, `load_baselines` gains a YoY mode. Until then, operator-set `seasonal_multiplier` is the placeholder.

---

## Migration steps

Each step is independently shippable. None depend on Volume 1's structural migration, though Step 1 below dovetails with Volume 1's flow registry.

**Step 8 — Run-context preamble.** Add a thin `compose_run_context.py` tool. Each runner calls it before `claude -p` and either pipes the JSON into the prompt or writes to a known path the agent reads first. Effort: small. Risk: low. Unlocks: cross-flow awareness, post-incident continuity.

**Step 9 — Operator notes table.** Migration `031_operator_notes.sql`. Web UI field on the approval detail page and a free "leave a note" surface on the campaign view. Tool `load_operator_notes.py`. Wire into Flow A Step 1.6 and Flow F. Effort: medium. Risk: low. Unlocks: closing the operator-side loop.

**Step 10 — Plan-to-action linkage.** Migration `032_plans_carryover_triggered_approval_id.sql`. Update `propose_task.py` to accept `--triggered-by-plan <plan_id>` and set the FK. Update `load_recent_actions_outcomes` to surface "this action originated from plan X." Effort: small. Risk: low. Unlocks: closed loop on forward commitments.

**Step 11 — Run-history awareness.** Tool `load_recent_run_history.py` reading `heartbeats` for the last 7 days for this business. Surface in Step 1.6. Effort: small. Risk: low. Unlocks: incident-aware reasoning.

**Step 12 — Flow-coordination ledger.** Postgres view `vw_flow_runs_24h`. Tool `load_today_proposals.py`. Move anti-flood caps from per-flow to per-business-day computed against the view. Effort: medium. Risk: medium (changes anti-flood semantics — needs golden-test coverage). Unlocks: same-day flow coordination, true per-operator-per-day cap.

The five steps together can be staged behind feature flags in `business_knowledge` so they roll out per-business, not globally.

---

## What we are explicitly NOT changing

To protect the cost profile and the agent paradigm:

- Stateless per-invocation execution. No long-running agent process between cron firings.
- Flow-conditional prompt loading (the token-saving lever from CAMPAIGNER.md lines 31–49).
- The skip-on-no-change gate (Step −1). It stays the cheapest path through Flow A on quiet days.
- Tool-call deduplication discipline within a run.
- The protocol's "agent reads markdown, calls tools, writes output" shape.
- The HITL queue. Every new context source surfaces to the agent for reasoning; it does not change who approves.

---

## Open questions

Two things are not yet decided and should be settled before Step 8.

**Where does the run-context preamble live?** Two options: (a) injected into the `claude -p` prompt as a JSON blob, or (b) written to `/tmp/run_context.json` and the agent reads it as its first action. Option (a) makes it part of the visible invocation; (b) makes it grep-able after the fact. The cost difference is negligible; the choice is about debuggability.

**Are full prior rationales worth loading?** Loading the last 7 days of approved-or-executed rationales adds material tokens to every run. The cheaper alternative is a Hebrew summarizer (a small offline pass that condenses prior rationales into a 5–10 line digest per campaign) which the agent reads instead. Until we have a concrete failure mode where re-reading rationales would have changed an answer, the digest path is preferred.

---

## Updating this file

Same discipline as Volume 1 (Rule 7 — rewrite in place, do not append amendments). Where this volume's findings conflict with Volume 1, this volume reflects the runtime view and Volume 1 reflects the structural view; both can be correct simultaneously. The status line at top is updated whenever findings or the migration step list change materially.
