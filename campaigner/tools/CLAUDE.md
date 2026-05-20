# Claude-at-`campaigner/tools/` — CLI tool conventions

> Loaded automatically when cwd is here. Active **alongside** [`../CLAUDE.md`](../CLAUDE.md) and [root CLAUDE.md](../../CLAUDE.md).

## What this folder is

Every Python file here is a **single-purpose CLI tool** the agent (Claude headless) calls via Bash. They are the only way Claude reaches Postgres, Meta, or Vertex. No tool means no capability — Claude does **not** ad-hoc with `psql`, `curl`, or one-off Python.

## How to invoke (always)

```bash
python -m campaigner.tools.<name> --<arg> <value>
```

Never `python campaigner/tools/<name>.py`. The `-m` form is canonical: it gives consistent `campaigner.*` imports and matches the test harness in [`tests/tools/`](../../tests/tools/).

## The contract every tool obeys

Defined in [`_contract.py`](_contract.py). Read it once before adding or editing a tool.

| Element | Rule |
|---|---|
| Input | CLI args only. No reading from env beyond what `lib/config.py` exposes. No stdin. |
| Output | A **single JSON object** on stdout. Logs go to stderr. |
| Exit codes | `0` success · `1` runtime error (DB down, API error) · `2` validation error (bad args) |
| Side effects | `log_decision`, `propose_task`, `mark_failed`, `heartbeat` write to Postgres. Everything else is read-only or talks to Meta. |
| Retries | DB calls go through `with_db_retry()` — only `psycopg.OperationalError` is retried. Bugs (`IntegrityError`, `ProgrammingError`) bubble. |

Never call `sys.exit()` or `print()` for return data. Always route through `emit_success` / `emit_runtime_error` / `emit_validation_error`.

## Tool catalog (current state)

Status reflects [CAMPAIGNER.md "Current tooling readiness"](../CAMPAIGNER.md#current-tooling-readiness-as-of-2026-04-19) — keep both in sync when you add or remove a tool.

### Observation (read-only)

| Tool | Purpose |
|---|---|
| [`fetch_insights.py`](fetch_insights.py) | Pull Meta insights for a business — campaign or ad level, configurable window. `--with-prior-window` returns delta_*_pct vs the preceding equal window (used by §T2+ marginal-CPM guard, §T_SD trend). |
| [`fetch_meta_state.py`](fetch_meta_state.py) | **(2026-05-12)** Object-level state — `status`, `updated_time`, `daily_budget`, `objective`. Insights doesn't expose these. Used by §T0r R0 cooldown gate + §T-1 utilization. |
| [`load_baselines.py`](load_baselines.py) | Read rolling baselines (`baselines` table) for a business. |
| [`load_business_knowledge.py`](load_business_knowledge.py) | Read the business profile + questionnaire (`business_knowledge` table). **(2026-05-12)** Now also returns `kpi_target` convenience block — target value for the active `primary_kpi` (CPA/CPL/ROAS) per migration 019. |
| [`fetch_paused_campaigns.py`](fetch_paused_campaigns.py) | **(2026-05-13 PM)** Lists PAUSED campaigns + last-30d insights; classifies `revival_candidate` / `narrow_audience_revival` / `archive_candidate`. Used by decision-tree §T_PA. Skips campaigns paused > 90d. |
| [`load_feedback_history.py`](load_feedback_history.py) | **(2026-05-13 PM, feedback loop)** Surfaces meaningful operator rejections from `approvals` (bulk-resets and system reasons filtered out), grouped by `(task_type, target_kind, target_id)`. Feeds guardrail §37 `respect_prior_rejections`. The agent reads this in Flow A Step 1.6 and is bound to cite + differentiate any re-proposal of a previously-rejected combination. |
| [`load_recent_actions_outcomes.py`](load_recent_actions_outcomes.py) | **(2026-05-13 PM, feedback loop)** For each approval executed in the last 30 days, pulls Meta insights for the 7d before + 7d after `executed_at` and computes the delta on the task-relevant metric (CPL for scale_*; CTR for new_creative/redeploy/boost; CPM for expand_audience). Classifies `improved` / `flat` / `regressed` / `insufficient_data`. Closes the loop between "I proposed this" and "what actually happened." |
| [`load_active_plans.py`](load_active_plans.py) | **(PRD step 5, 2026-05-20)** Cross-run plan memory. Reads `plans_carryover` only — the prose-parsing fallback was removed when step 5 landed. Each forward step carries a `structured_trigger` block (metric/operator/threshold_name/sustained_days + proposed_action payload) when the source proposal called `propose_task --plan`; legacy rows from `lib.plans.persist_from_approval` surface as `action_text` + `trigger_condition`. Bound by guardrail §39 `respect_active_plans`. |
| [`draft_new_campaign_payload.py`](draft_new_campaign_payload.py) | **(2026-05-13 PM, "consultant fills the form")** Composes a complete `new_campaign` payload (passes §38 cleanly) from high-level intent (objective + budget + copy + creative source) by reading `businesses` + `business_knowledge` for page_id, pixel_id, service_regions → geo_locations, products → service_tag validation, target_cpl. Returns `validation_notes` for soft coaching (e.g. "daily_budget below formula minimum for exiting Learning"). The agent calls this with intent, gets back a full payload, then `propose_task --payload`. |
| [`compose_copy_brief.py`](compose_copy_brief.py) | **(2026-05-13 PM, "consultant writes the copy")** Builds a structured Hebrew-copy brief that the agent reads before writing customer-facing ad copy: per-service pain/USP from `products[service_tag]`, brand voice from `business_knowledge.brand_voice`, length rules per channel (feed/stories/reels/messaging), CTA enum allowed for the objective, forbidden lexicon (pan-Israeli + Aiweon-specific), and marketing-angle opening pattern. The agent uses the brief; the tool doesn't write Hebrew (per `lib/` boundary). |
| [`compose_weekly_audit.py`](compose_weekly_audit.py) | **(2026-05-13 PM, Flow F)** Aggregates the last 7 days into a structured audit: proposals_summary (by task_type + urgency), approval_funnel (proposed/approved/rejected/pending + rate), rejection_patterns (top operator feedback themes, bulk-resets filtered), outcomes_summary, active_plans_count, budget_snapshot, tracking status, plus English narrative_hints the agent reads to write the Hebrew weekly digest. |
| [`expire_plans.py`](expire_plans.py) | **(2026-05-13 PM, Migration 023)** Flips `plans_carryover` rows past their `expires_at` from `status='pending'` → `'expired'` for audit-trail clarity. Idempotent, global. Hooked into `daily_observe_propose.sh` end so it runs every morning. |
| [`list_active_creatives.py`](list_active_creatives.py) | Active creatives per campaign with angle distribution. **(2026-05-12)** `--with-performance` flag adds impressions/spend/conversions per creative (last 7d) + `active_with_impressions_count` aggregate for §T_PE pool-exhaustion check. **(2026-05-13, Block 8)** `--unused-in-campaigns` + `--matches-channel` (feed/stories/reels) surface `viable_unused_count` — gallery rows that are deployable but not yet used as an ad. §T6.1 / §T_PE / guardrail §28 read this before proposing fresh `new_creative`. |
| [`check_creative_fatigue.py`](check_creative_fatigue.py) | **(2026-05-12)** Computes Meta Creative Fatigue flag locally — per-creative current CPR ≥ 2× prior-window CPR. Used by §T0r R4 (`fatigue_flag`) and §T_PE (`active_with_impressions_count`). Two Meta calls (current + prior window). |
| [`list_approved.py`](list_approved.py) | Pull rows from `approvals` where `status='approved'`, urgency-ordered. |
| [`list_gallery_assets.py`](list_gallery_assets.py) | Pull entries from `creative_gallery`. |
| [`list_audiences.py`](list_audiences.py) | **(2026-05-13, Phase 1)** Read the local `meta_audiences` mirror — Custom / Saved / Lookalike audiences synced from Meta. Filters: `--kind`, `--subtype`, `--include-archived`, `--min-count` (upper-bound size). Read-only — populated by `sync_audiences.py`. The agent reads this in Flow A Step 1 before any `expand_audience` / `new_campaign` / `create_lookalike` proposal. |

### Diagnosis (pure functions)

| Tool | Purpose |
|---|---|
| [`estimate_cpl.py`](estimate_cpl.py) | **(2026-05-13)** Pre-baked Israel-2026 CPL/CPA estimate from `business_knowledge` — sub-vertical × geo × stage × offer × channel × season. Returns `research_block` ready to drop into `propose_task --research` (satisfies guardrail §26 with ZERO WebSearch). Live WebSearch is fallback only when `needs_live_research=true`. Token-saving lever — see [`prompts/cpl-infrastructure.md`](../prompts/cpl-infrastructure.md). |
| [`build_website_audience_rule.py`](build_website_audience_rule.py) | **(2026-05-13 PM, Block 13 follow-up)** Pure-function helper that emits a Meta WEBSITE Custom-Audience rule JSON from `--website-url` + optional `--include-path` / `--exclude-path` / `--days-back`. Called by Flow E (CAMPAIGNER.md §E Step 5) before `propose_audience --task-type create_custom_audience --subtype WEBSITE --rule '<json>'`. Replaces hand-rolled rule construction so every WEBSITE proposal has consistent shape + retention. |
| [`check_data_sufficiency.py`](check_data_sufficiency.py) | Apply [§6.4](../prompts/performance-brain.md#64-data-sufficiency) gates to a metrics blob. |
| [`check_tracking_health.py`](check_tracking_health.py) | **(2026-05-12, M1)** Pre-gate for every scale-spend proposal. Reads `business_knowledge.tracking_*` and returns `status: healthy \| partial \| unverified \| unknown` + `blocks_proposals` list. Caller runs this in Flow A Step 0.5. |
| [`check_organic_performance.py`](check_organic_performance.py) | **(2026-05-12 Block 7 scaffolding; 2026-05-13 Block 8 live)** Reads published organic posts from `approvals.external_post_id`; calls Meta via `page_publishing.fetch_post_insights` (page-token Graph) for real metrics; classifies viral / solid / underperformer; returns `boost_candidates` for §T9.1. Token cache keyed per (business, network). |
| [`check_guardrails.py`](check_guardrails.py) | 36 deterministic guardrail rules (13 baseline + 7 §T0r + §§26-30 + §§32-34 rationale-quality + §§35-36 audience + §37 respect_prior_rejections + §38 new_campaign_payload_completeness + §39 respect_active_plans + §40 winner_requires_quality_grade (Phase 2) + §41 copy_must_match_brief_voice). 5 judgment-only rules enforced via [`prompts/guardrails.md`](../prompts/guardrails.md). |
| [`list_ab_tests.py`](list_ab_tests.py) | **(2026-05-13, Block 11)** List A/B tests for a business — `--status running\|ready_to_decide\|decided\|all`. Returns variants array per test + status counts + `ready_to_decide_count`. §T8 reads `ready_to_decide_count` to know when to emit `ab_test_decide` proposals. |
| [`evaluate_ab_test.py`](evaluate_ab_test.py) | **(2026-05-13, Block 11)** Compute per-variant metrics + winner for a running test. Single Meta insights call covers all variants (joins by ad_id, same pattern as `list_active_creatives.py`). Returns the `decision_snapshot` shape that `ab_test_decide` writes verbatim. Confidence classifier: 95pct / directional / insufficient. |
| [`check_marginal_return.py`](check_marginal_return.py) | **(2026-05-12)** Did the last scale_up/scale_down move conversions ≥ 10%? Implements §T2+ Pre-check 1 + guardrail §21 `marginal_return_check_before_scale_up`. Hits Meta for two equal windows around the last executed event. |
| [`compute_monthly_pace.py`](compute_monthly_pace.py) | Monthly spend pace vs. budget → trigger alert / scale-up reasoning. |

### Mutations (write to Postgres)

| Tool | Purpose | Idempotency |
|---|---|---|
| [`log_decision.py`](log_decision.py) | Append to `agent_decisions`. Built-in retry. | Each row has unique `(run_id, node_name, decision_type, target_id)` — re-run produces a duplicate row by design (each invocation is its own decision). |
| [`propose_task.py`](propose_task.py) | Insert into `approvals` with `status='pending'`. Built-in retry. **(PRD step 5, 2026-05-20)** Accepts `--plan` JSON — when the agent's rationale ends with a Hebrew `תוכנית:` conditional commitment, the structured form (metric / operator / threshold_name / sustained_days + proposed_action payload) is written into `plans_carryover` in the same call. Validation contract in `lib/plans.validate_structured_plan`. | Skips insert if a `pending` row already exists for `(business_id, task_type, target_id)`. |
| [`propose_audience.py`](propose_audience.py) | **(2026-05-13, Phase 1)** Typed wrapper for `create_custom_audience` / `create_saved_audience` / `create_lookalike` proposals. Per-task argparse surface (`--subtype`, `--origin-audience-id`, `--ratio`, etc.) instead of one big `--payload` JSON; pre-validates Phase-1 subtype allowlist + lookalike seed size (≥ 100) using `meta_audiences` mirror, so the operator gets a clear validation error instead of a guardrail rejection at execute time. | Same dedup behavior as `propose_task` (relies on the same `approvals` table). |
| [`sync_audiences.py`](sync_audiences.py) | **(2026-05-13, Phase 1)** Mirror Custom + Lookalike + Saved audiences from Meta into `meta_audiences`. Audiences not seen in the latest response get `archived_at` so historical references in `approvals` still resolve. | Idempotent — re-running with no Meta-side changes produces no diffs. |
| [`heartbeat.py`](heartbeat.py) | Write `phase=start|end|error` to `heartbeats`. Runner contract. | Append-only. |
| [`mark_failed.py`](mark_failed.py) | Move an `approvals` row from `approved` → `failed` with error text. | No-op on rows already `failed`. |
| [`recheck_guardrails.py`](recheck_guardrails.py) | Re-run guardrails against fresh state at execute time. | Read-only; produces a decision row via `log_decision` separately. |

### Execution (talks to Meta — Flow B only)

| Tool | Purpose | Notes |
|---|---|---|
| [`execute_task.py`](execute_task.py) | Dispatch an approved row to the right `MetaClient` method. `--dry-run` available. | Idempotent on rows already `executed`. Errors here trip `mark_failed`. **2026-05-12:** `new_creative`, `expand_audience`, `alert`, `set_kpi_target` newly wired (previously UNSUPPORTED_MVP). **2026-05-13 (Block 7):** `boost_post` wired via `create_creative_from_post` + `create_ad`. **2026-05-13 (Block 8):** `redeploy_creative` wired — short-circuits to `create_ad(existing_creative_id)` when the gallery row has `meta_creative_id` and copy isn't overridden; otherwise upload + create_creative + create_ad, then writes `meta_creative_id` back to `creative_gallery`. |
| [`generate_creative.py`](generate_creative.py) | Vertex Imagen → image asset. Copy is generated by Claude and passed via `--copy`. | Image only. Copy generation lives in the prompt layer. |

### Helpers

| Tool | Purpose |
|---|---|
| [`suggest_where_to_save.py`](suggest_where_to_save.py) | Heuristic for routing a generated asset to the right gallery folder. |

## Adding a new tool

1. **File location:** `campaigner/tools/<name>.py`. Module-style (`-m`) callable.
2. **Boilerplate:** import from `_contract`. Exit only via `emit_*`. Wrap DB calls in `with_db_retry`.
3. **CLI surface:** `argparse`. Use `--business-id`, `--run-id`, etc. consistently with peer tools — read 2-3 existing tools first to match style.
4. **Test:** add a row to [`tests/tools/test_contract.py`](../../tests/tools/test_contract.py) that runs `python -m campaigner.tools.<name> --help` and asserts exit 0 + valid JSON shape on a known input.
5. **Update [`CAMPAIGNER.md`](../CAMPAIGNER.md#current-tooling-readiness-as-of-2026-04-19)** to flip the readiness row to ✅.
6. **Update this catalog** (the table above).

## What NOT to do here

- **No business logic.** Heuristics live in `lib/` or in prompts. A tool is a thin shell around a `lib` call + I/O contract.
- **No Meta calls outside `execute_task.py` and `generate_creative.py`.** Observe-propose tools are strictly Postgres-only.
- **No `requests`/`httpx` imports.** Talk to Meta via `lib/meta_client.py`. Talk to Vertex via `lib/creative.py`.
- **No print debugging in committed code.** Use `print(..., file=sys.stderr)` only for genuine operator-visible warnings.
- **No silent failures.** If `log_decision` fails after retry, exit 1 — don't continue and lose the trail.

## Where truth lives

| Question | Read |
|---|---|
| Tool I/O contract | [`_contract.py`](_contract.py) |
| Which tools exist + status | [`../CAMPAIGNER.md`](../CAMPAIGNER.md) (must match this catalog) |
| Schema a tool reads/writes | [`../../migrations/`](../../migrations/) |
| Spec for new tool's behavior | [`../../docs/plans/campaigner-spec.md`](../../docs/plans/campaigner-spec.md) §11 |
| What Claude expects to call | [`../prompts/`](../prompts/) — search for `python -m campaigner.tools` |
