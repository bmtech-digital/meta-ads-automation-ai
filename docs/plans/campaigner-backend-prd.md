# PRD: Campaigner Backend (MVP)

> **Status:** Draft v1 (2026-04-16)
> **Scope:** Backend — Claude Code Native agent, Python tools, Supabase schema, cron runners, operator CLI.
> **Audience:** The developer picking this up as a handoff. Implement against this PRD; reference the spec for depth.
> **Companion:** [`campaigner-frontend-prd.md`](./campaigner-frontend-prd.md) — web UI over the same Supabase, built **after** backend Phase 5.
> **Ground truth (read before starting):**
> 1. [`docs/plans/campaigner-spec.md`](./campaigner-spec.md) — full technical spec (this PRD pulls up to the "what ships" level; the spec is the "how").
> 2. [`docs/CAMPAIGN_EVALUATION.md`](../CAMPAIGN_EVALUATION.md) — the evaluation philosophy the agent must encode.
> 3. [`docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md`](../CAMPAIGN_BUILDING_RECOMMENDATIONS.md) — 2026 practices; anything you build must not regress these.
>
> **Roles:**
> - **Operator** = Roi (product owner, daily approver, prompt author alongside the developer, stakeholder interface).
> - **Developer** = you (reader of this doc, implementer).

---

## 1. Executive Summary

### Problem Statement

Aiweon runs paid Meta Ads campaigns in Hebrew for the Israeli market. A strong campaigner costs ~₪15K/month, works office hours, and can't keep up with what Meta's 2024-2025 Andromeda engine now rewards: 10-50+ diverse creatives per ad set, continuous evaluation through two distinct signal gates (leading creative signals at 48h-7d; lagging campaign signals post-learning — see [`CAMPAIGN_EVALUATION.md`](../CAMPAIGN_EVALUATION.md) §2), and baseline-first judgment (Israel CPL runs ~2.5× global median; global benchmarks mislead). Manual operation leaves money on the table (missed scale windows, late Gate-1 kills, stale creative) and ignores pre-Andromeda rules that are now actively harmful — listed in EVALUATION §8 + [`CAMPAIGN_BUILDING_RECOMMENDATIONS.md`](../CAMPAIGN_BUILDING_RECOMMENDATIONS.md) §10.

### Proposed Solution

A stateless agent that runs on `cron` → `claude -p "..."` (Claude Code headless). Claude reads `.md` knowledge files, calls Python tools via the Bash tool, and writes proposals to a Supabase `approvals` queue. A human approves via CLI or web; a separate cron tick executes approved actions against the Meta Marketing API. Every decision is logged to `agent_decisions` for audit and observability — replacing LangSmith for the MVP. LangGraph orchestration is explicitly deferred to v2 (triggered by adding a second ad account).

### Success Criteria

Three tiers. Must hit all to declare MVP done.

**Tier 1 — Pipeline complete (engineering gate):**
- Daily `observe-propose` cron runs for 14 consecutive days without manual intervention.
- Every approved action that passes guardrail recheck executes against Meta API successfully (≥95% execution success rate).
- Every run produces ≥1 `agent_decisions` row per logical phase (observe / diagnose / propose / apply_guardrails / execute).
- **Every diagnosis row tags its gate** — `outputs.gate ∈ {'gate_1_creative', 'gate_2_campaign', 'skip_insufficient_data'}` — reflecting the Two-Gates model from CAMPAIGN_EVALUATION §2. No diagnosis lands in `agent_decisions` without a gate tag.
- **Every proposal rationale references ≥1 baseline number** (account-scoped, 7/14/30-day rolling window per EVALUATION §3). A rationale that compares only to global benchmarks fails acceptance.
- CLI commands `list`, `approve`, `reject`, `inspect`, `run --dry-run`, `onboard` all functional and documented via `--help`.

**Tier 2 — Signal quality (operational gate):**
- 30 consecutive days of autonomous operation after go-live (cron + HITL, no code changes).
- Operator approval rate ≥ **50%** on surfaced proposals. Below **40% for 2 consecutive weeks** → investigate (prompt drift, guardrail miscalibration, or noise in diagnoses).
- p95 time-to-approval-visible (cron run start → approval row readable) ≤ 5 minutes.
- **No proposal volume floor.** Proposals are surfaced when the agent has something real to say. The agent is *not* judged on how busy it is — a quiet day means no action was warranted. Volume is tracked for visibility, not as a gate.

**Tier 3 — Quality (regression gate):**
- Zero `decision_type='error'` rows from guardrail or execution tools for 7 consecutive days (pipeline hygiene).
- **No regression to any pre-Andromeda rule** across prompts, guardrails, or decision tree. Three canonical lists must all be clean — audited pre-release and before every prompt edit:
  - spec §6.7
  - [`CAMPAIGN_EVALUATION.md`](../CAMPAIGN_EVALUATION.md) §8
  - [`CAMPAIGN_BUILDING_RECOMMENDATIONS.md`](../CAMPAIGN_BUILDING_RECOMMENDATIONS.md) §10
- Golden-set E1 passes 100% (all 13 snapshots, including the deprecated-rule canary #13).
- **Cost is not a gate.** Spec §21 projects ~$25/mo; actual spend tracked but no alert threshold. If cost balloons, the cause is a reasoning bug, not a limit violation — fix the bug.

---

## 2. User Experience & Functionality

### Personas

| Persona | Role | How they touch the backend |
|---|---|---|
| **Operator (Roi)** | Owner, daily approver. **Prompt author starting Phase 5+** (not before). | Terminal-first: approves/rejects via `campaigner` CLI from any shell (local, VPS, phone SSH). |
| **Developer (you, the reader)** | Builder + maintainer. **Sole prompt author through Phase 4.** | Implements the backend per this PRD. Authors `CAMPAIGNER.md` + `prompts/*.md` (Hebrew, grounded in CAMPAIGN_EVALUATION + CAMPAIGN_BUILDING) in Phase 2-3; continues to own prompt iteration until operator is comfortable with the format (Phase 5 handoff). Runs Python tools standalone for debugging; reads `agent_decisions` to diagnose agent behavior. |
| **Aiweon marketing stakeholder** | Read-only, via frontend | Not a direct backend user — reads approvals and rationales through the web UI (Phase 6+). |

### User Stories (backend surface = CLI + the agent itself)

**US-B1 — List pending approvals**
*As operator, I want `campaigner list --pending` to see today's proposals with urgency, rationale, and expected impact, so I can triage from terminal without a browser.*

**US-B2 — Approve / reject from terminal**
*As operator, I want `campaigner approve <id>` and `campaigner reject <id> --reason "..."` to move a queue item without context-switching, so I can clear the queue in batches.*

**US-B3 — Inspect agent reasoning**
*As operator, I want `campaigner inspect <run-id|approval-id>` to print the full `agent_decisions` chain (observation → diagnosis → proposal → guardrails), so I can audit "why did it propose this?"*

**US-B4 — Manual trigger with dry-run**
*As operator, I want `campaigner run daily --dry-run` to simulate a cron flow end-to-end with **reads + `agent_decisions` writes + simulated `approvals` (inserted with `status='dry_run'`)** but **zero Meta writes and zero real `status='pending'` rows**, so I can inspect the full proposed queue via CLI or web UI (filtered to `dry_run`) without the operator ever being able to approve them into production. Tests prompt changes safely while still producing the exact same `agent_decisions` audit trail a real run would.*

**US-B5 — Onboard a business**
*As operator, I want `campaigner onboard --config onboarding/aiweon.yaml` to seed `businesses`, `business_knowledge`, and `baselines` in one command, so I don't hand-write SQL.*

**US-B6 — Headless agent runs unattended**
*As operator, I want cron to invoke `claude -p` with the right env vars and capture structured logs per run, so I can grep historical behavior by date without reading DB directly.*

**US-B7 — Tools are standalone**
*As engineer, I want every file under `campaigner/tools/*.py` to expose `--help`, take only CLI args, emit JSON on stdout, and return clean exit codes, so I can debug each tool in isolation.*

**US-B8 — Weekly creative firehose**
*As operator, I want a `weekly-creative-firehose` cron slot that generates 3-5 new creatives per active campaign (continuous additions, not replacement), so the ad account stays in Andromeda's 10-50+ diversity sweet spot (CAMPAIGN_BUILDING §5) without me thinking about it.*

**US-B9 — Two-gate reasoning is visible**
*As operator, I want the agent to separate Gate 1 (creative-level, leading signals at 48h-7d) from Gate 2 (campaign-level, lagging signals post-learning) in its reasoning, and to write them as distinct phases in `agent_decisions`, so when I inspect a proposal I can see which gate drove it — and I can audit whether the agent is honoring CAMPAIGN_EVALUATION §2 without reading every rationale.*

**US-B10 — Ask a human when confidence is low**
*As operator, I want the agent to flag a proposal for explicit human review (urgency='high', `requires_human_review=true` in payload, rationale names the trigger) when any of the six scenarios in CAMPAIGN_EVALUATION §9 fires:*
1. *Account age < 30 days (no reliable baseline yet)*
2. *No primary benchmark data available for the vertical*
3. *Leading signals (Gate 1) and lagging signals (Gate 2) conflict — e.g. hook 45% but CPA × 2*
4. *Multiple winners in the same ad set (no consensus playbook)*
5. *Proposed budget jump > 30%*
6. *Sudden CPL spike ≥ 2× baseline with no obvious cause (potential Israel wartime context — Operation Modes deferred to v2)*

*In these cases the agent does not suppress the proposal and does not auto-approve it; it escalates to the operator with the reason named.*

**US-B11 — Day Zero pre-flight for new-campaign proposals**
*As operator, I want the agent to run a pre-flight check (CAMPAIGN_BUILDING Day-Zero Launch Checklist) before proposing any `task_type='new_campaign'`, and to refuse to propose if any of these fail:*
- *Tracking infrastructure verified (Pixel + CAPI deduplicated, AEM priority events configured, domain verified) — pulled from `business_knowledge` or tool call*
- *Proposed daily budget ≥ `(target_cpa × 50) / 7` (learning-phase viability)*
- *Naming follows `[Funnel]_[Objective]_[Audience]_[Creative]_[Date]`*
- *≥3 diverse creatives queued (CAMPAIGN_BUILDING §5 launch minimum)*
- *Advantage+ Placements on; broad audience + Advantage+ Audience on*

*Each failure surfaces as a rejection row in `agent_decisions` with the specific guardrail name, so I can fix the gap (usually a business-knowledge field) before re-running.*

### Acceptance Criteria (rolled up)

- [ ] **CLI binary `campaigner`** installable via `pip install -e .`, discoverable in `$PATH` after install.
- [ ] **Subcommands:** `list`, `approve`, `reject`, `inspect`, `run`, `onboard`, **`rotate-token`**. Each has `--help`. Each writes an `agent_decisions` row where relevant (e.g. approve → `decision_type='execution'` will follow later in Flow 2).

  **Output locale:** CLI labels, errors, and prompts are **English**. Content pulled from the DB (rationales, campaign names, questionnaire answers) stays in its native Hebrew. Rationale: RTL in terminals is inconsistent across emulators; English labels are grep-friendly and copy-paste-friendly when asking for support.

  **Behavior per subcommand:**

  | Subcommand | Behavior |
  |---|---|
  | `list` | Defaults to `--pending`. Flags narrow: `--approved`, `--rejected`, `--executed`, `--failed`, `--dry-run`, `--all`. `--campaign <name>` filters. Output: compact table (id, urgency, task_type, target, age). |
  | `approve <id> [<id>...]` | Accepts one or more explicit IDs. **No glob, no `--all-pending`** — the friction of typing IDs is the safety mechanism. No confirmation prompt; if you typed it, you meant it. |
  | `reject <id> [<id>...] --reason "<text>"` | Reason required (≥10 chars). Same multi-ID semantics as approve. |
  | `approve <id> --override-guardrail <rule> --reason "<text>"` | Soft-guardrail override path (see §2 AC). Reason ≥10 chars. The long `--reason` string is the friction; no additional confirmation prompt. Hard guardrails error out. |
  | `inspect <id>` | Pretty-printed `agent_decisions` chain by default (human-readable, grouped by gate per CAMPAIGN_EVALUATION §2). `--json` for machine consumption / piping. No built-in pager — pipe to `less` manually when needed. |
  | `run <flow>` | Flows: `daily`, `execute`, `creative-firehose` (maps to the three cron slots). `--dry-run` on any flow activates the dry-run mode from Group 3.4. |
  | `run <tool-name>` | Also dispatches to any `tools/*.py` by filename (minus extension), e.g. `campaigner run fetch-insights --days 7`. Same args + JSON output as the tool itself. Invaluable for debugging + prompt iteration; zero extra code (it's `exec`-style dispatch). |
  | `onboard --config <yaml>` | One-shot business onboarding per spec §11.5. |
  | `rotate-token` | Interactive: takes a fresh Meta long-lived user token (pasted in), validates it via Meta's `debug_token` + one read call against the ad account, and updates `.env.production` on the Cloud Run instance via `gcloud run jobs update`. Writes an `agent_decisions` row (`decision_type='observation'`, summary "token rotated; new expiry 2026-MM-DD"). Operator runs it manually on the 50-day reminder. |

  **Explicit non-goals for MVP CLI:** shell completion scripts (bash/zsh), interactive TUI, glob/filter-based approve, batch confirmation prompts, multi-business selector. Each of these is a legitimate v2 addition; none blocks MVP.
- [ ] **Agent invocation** uses `claude -p --output-format json --max-turns 30` with env-injected secrets. Logs stream to stdout → **Google Cloud Logging** (Cloud Run Jobs' native path). Filter by `resource.labels.job_name` and `labels.flow` to slice by cron slot. No separate `/var/log/campaigner/` on disk — Cloud Run containers are ephemeral.

- [ ] **Cron liveness — `heartbeats` table.** Each `runners/*.sh` writes a row at start and at end (or on error). Schema:
  ```sql
  create table heartbeats (
    id uuid primary key default gen_random_uuid(),
    business_id uuid references businesses(id) on delete cascade,
    flow text not null,                    -- 'daily_observe_propose' | 'execute_approvals' | 'weekly_creative_firehose'
    phase text not null check (phase in ('start','end','error')),
    ran_at timestamptz not null default now(),
    duration_ms int,                       -- filled on 'end' / 'error' rows
    exit_code int,
    error_message text,
    details jsonb,
    created_at timestamptz not null default now()
  );
  create index on heartbeats (business_id, flow, ran_at desc);
  ```
  Add as `migrations/007_heartbeats.sql`. Frontend reads this to display last-seen age per flow and to compute the "3 consecutive failures" alert.

- [ ] **3-consecutive-failures alert.** No separate alerts table — computed from `heartbeats` by a frontend query: if the last 3 rows for a given `(business_id, flow)` all have `phase='error'` (or missing `phase='end'` after `ran_at + expected_duration × 2`), surface an alert banner on the web dashboard. Backend does not push notifications; alerting is visibility-based, not interruptive.
- [ ] **Tool contract (spec §11.6) enforced:** one integration test per tool asserts: (a) emits JSON on stdout, (b) logs to stderr, (c) exit code 0 on success / 1 on error / 2 on validation.
- [ ] **Dry-run mode:** `campaigner run <flow> --dry-run` sets `CAMPAIGNER_DRY_RUN=1`. Behavior:
  - `agent_decisions` writes happen normally (full audit trail preserved).
  - `propose_task` inserts approvals with `status='dry_run'` instead of `'pending'`. These rows are invisible to normal `list --pending` / frontend queue and cannot be approved into execution (guardrail: approve-action on `status='dry_run'` rejects with a clear error).
  - `execute_task` + all Meta write calls no-op and return a simulated response shape that downstream logging can consume without special-casing.
  - **Schema change required:** `approvals.status` enum gains `'dry_run'`. Add to migration `004_approvals.sql` (spec §10.4 amendment). `expires_at` for dry-run rows is short (24h) — they clean themselves up.
- [ ] **Concurrency guard:** `execute_approvals.sh` acquires a Postgres advisory lock scoped to `business_id`; on lock-miss, exits cleanly with code 0.
- [ ] **Guardrail suite** implements all 20 rules in spec §14.1 plus 3 new ones derived from CAMPAIGN_BUILDING:
  - `enforce_budget_formula` — proposed daily budget must clear `(target_cpa × 50) / 7` for the optimization event; below it → reject with explanation to optimize for a higher-funnel event instead.
  - `enforce_naming_convention` — new-campaign proposals match `[Funnel]_[Objective]_[Audience]_[Creative]_[Date]` (CAMPAIGN_BUILDING §9).
  - `verify_tracking_infrastructure` — new-campaign proposals are blocked if `business_knowledge.tracking_verified ≠ true` (Pixel + CAPI + AEM + domain verification all green per CAMPAIGN_BUILDING §7).

  Plus the 5 new 2026 rules from spec §14.1: `no_horizontal_scaling_by_duplication`, `require_95pct_significance_for_ab`, `prefer_add_creative_over_pause`, `no_manual_creative_pruning_before_48h`, `no_frequency_only_kill`.

  Each guardrail has a unit test asserting pass/fail for at least one positive and one negative case.

- [ ] **Two-pass guardrail evaluation.** Every proposal is validated twice, per spec §14:
  1. **Propose-time** (Flow 1) — `check_guardrails.py` runs after the agent drafts a proposal. Failures log `decision_type='rejection'` to `agent_decisions` and either surface the block (soft guardrail) or silently drop (hard guardrail) — see below.
  2. **Execute-time recheck** (Flow 2) — `recheck_guardrails.py` runs immediately before the Meta API call. Rationale: state can change between propose and execute (campaign exits learning, conversion lands in the last 24h, budget depleted). A guardrail that passed at propose-time can fail at execute-time; when it does, the approval transitions to `status='failed'` with the violated rule in `execution_result`.

  Approve-time recheck (in the CLI/UI path) is deliberately *not* added — it's redundant with execute-time recheck and couples the frontend to guardrails Python.

- [ ] **Guardrails split: hard (non-overridable) vs soft (overridable with operator reason).** A silent drop on every guardrail hides operator-correctable situations (e.g. "I know this campaign *looks* like it's in learning, but we just pushed a tracking fix — override and scale"). Policy:

  **Hard guardrails — silent drop; no override path. Violating these is never correct.**
  - `no_delete_campaigns` (system safety — deletion is irreversible)
  - `meta_api_rate_limit` (infrastructure)
  - `document_every_decision` (audit integrity)
  - `no_low_res_creative` (Meta will reject regardless)
  - `external_source_allowlist` (v2)
  - `no_competitor_hallucinations` (v2)

  **Soft guardrails — surface to operator as a pending approval with `payload.guardrail_override_required=true` and the violated rule named in `rationale`. Operator can reject, or approve-with-override (see below).** All others, including:
  - `no_learning_phase_touch`, `budget_jump_max_30pct`, `no_audience_change_on_active`, `no_horizontal_scaling_by_duplication`, `no_pause_on_recent_conversion_24h`, `require_95pct_significance_for_ab`, `prefer_add_creative_over_pause`, `no_manual_creative_pruning_before_48h`, `no_frequency_only_kill`, `max_tasks_per_day`, `video_preferred_on_equal_cpa`, `enforce_budget_formula`, `enforce_naming_convention`, `verify_tracking_infrastructure`, `explicit_approval_over_threshold_ils`

  **Override mechanism:**
  - CLI: `campaigner approve <id> --override-guardrail <rule> --reason "<text>"`. Reason required (≥10 chars).
  - Web UI: "Approve with override" button behind a confirmation modal that displays the violated rule + knowledge-doc link, requires the reason field, and sets `approvals.approved_by_override={rule, reason, overridden_by}`.
  - Logged as `agent_decisions` row with `decision_type='override'`, containing the rule + reason + operator identity.
  - Each soft guardrail declares in its Python source whether overridable by the current operator role — hard/soft is a property of the rule, not a config flag, to prevent accidental promotion.
  - Hard guardrails reject `--override-guardrail` attempts with an error naming the rule and pointing at this section.
- [ ] **Data sufficiency gate (§6.4) enforced before any Gate 2 decision:** `check_data_sufficiency.py` returns `{sufficient: bool, reason: str}`; agent is instructed to log `decision_type='skip'` and move on when insufficient.
- [ ] **Business knowledge loader** loads the entire `business_knowledge` row into Claude's context in a single tool call (no RAG, no chunking) and caches it across turns.

- [ ] **README runbook section.** A `## Runbook` section at the end of the repo README covers the minimum to diagnose a dead system: where to look in Cloud Logging, how to read `heartbeats`, how to re-run a flow manually (`campaigner run daily`), how to rotate the Meta token, and when to contact Anthropic / Supabase support. Intentionally brief — not a `RUNBOOK.md`; failure-mode encyclopedias get out of date before they're useful. Grow only as real incidents accumulate.

### Non-Goals (explicitly NOT in backend MVP)

- LangGraph orchestration or any non-Claude-Code agent runtime.
- Vector DB, embeddings, RAG, Qdrant, pgvector — business knowledge is structured JSONB + markdown.
- Real-time alerts or Meta webhooks.
- Auto-approval execution (config placeholder exists in schema per §16; execution path not wired).
- Multi-tenant: single `business_id` in cron env; RLS policies exist but auth layer not built.
- Operation Modes (Storm/Off-Season/Peak/Normal) — MVP is always Normal.
- Annual War Chest budgeting, RLHF, Master View, Cross-business intelligence.
- Creative regeneration loop on rejection — reject is terminal.
- Video generation, voice-over, image expansion, background swap — out of scope for creative firehose MVP.
- LangSmith / Langfuse — `agent_decisions` table is the observability substrate.

---

## 3. AI System Requirements

### Tools Required

**Knowledge surface (read by Claude each run):** each prompt file is a translation of a specific section of the two authoritative knowledge docs. The prompt is the *operational* version; the knowledge docs are the *reference*. When they diverge, the knowledge docs win — update prompts to match.

| File | Purpose | Authored from |
|---|---|---|
| `CAMPAIGNER.md` | Agent protocol — Flow 1/2/3 steps | spec §11.3-§11.5 |
| `prompts/performance-brain.md` | Two-Gates evaluation logic + baseline-first rule + Israel warning | EVALUATION §2, §3, §4; spec §6 |
| `prompts/decision-tree.md` | Scenario branches — Gate 1 creative, Gate 2 campaign, account-wide | EVALUATION §7 (scenarios A-D); spec §17 |
| `prompts/guardrails.md` | Human-readable catalog of enforced rules + deprecated-rules audit | spec §14.1 + EVALUATION §8 + CAMPAIGN_BUILDING §10 (deprecated-rule lists must be cited verbatim, not paraphrased — prevents drift) |
| `prompts/creative-guide.md` | Firehose model, hook-rate bands, angles, placement adaptation, aspect ratios | CAMPAIGN_BUILDING §5, §7; EVALUATION §4 |
| `prompts/day-zero-checklist.md` | Pre-flight for new-campaign proposals (US-B11 rules) | CAMPAIGN_BUILDING Day-Zero Launch Checklist |
| `prompts/ask-a-human.md` | The 6 scenarios where the agent escalates rather than decides | EVALUATION §9 |
| `prompts/hebrew-copy-style.md` | Brand voice, forbidden words, register | Business knowledge (per-business) |

**Python tools (invoked by Claude via Bash):**
15 scripts under `campaigner/tools/` per spec §19. Organized by flow:

- Read-side: `fetch_insights`, `load_baselines`, `load_business_knowledge`, `check_data_sufficiency`, `list_approved`, `list_active_creatives`.
- Write-side: `propose_task`, `log_decision`, `execute_task`, `mark_failed`.
- Validation: `check_guardrails`, `recheck_guardrails`.
- Creative: `generate_creative` (wraps existing `image_generator.py` + Claude copy gen).

**External APIs:**
- **Anthropic API** via `@anthropic-ai/claude-code` CLI (Node 20+). **Model: Claude Sonnet 4.6 across all flows** — the default `claude -p` model; no per-flow override. Opus 4.6 stays available for ad-hoc operator debugging but is not wired into any cron path. Rationale: Sonnet 4.6 plus prompt caching (spec §21) produces the right reasoning/cost balance; upgrading to Opus without evidence of Sonnet insufficiency is premature.
- **Meta Marketing API** via existing `facebook-business` SDK (wrapped in `campaigner/lib/meta_client.py`).
- **Supabase REST** via `supabase-py` (service_role key only, backend context).
- **Vertex AI Imagen** via existing `google-genai` SDK (wrapped in `campaigner/lib/creative.py`).

### Evaluation Strategy

**How we measure output quality and accuracy:**

**E1 — Golden-set replay (pre-go-live and before every prompt change)**
A fixed set of campaign snapshots (JSON) + expected decision class + expected gate. After any change to `CAMPAIGNER.md`, `prompts/*.md`, or guardrails, run the agent against all snapshots in `--dry-run` and assert both the decision class and the tagged gate match. Regression → block merge.

**Sourcing — two phases:**

- **Phases 0-3 (pre-dry-run): synthetic starter set.** Developer authors the 13 snapshots below, grounded in CAMPAIGN_EVALUATION §7 + §9 and CAMPAIGN_BUILDING Day-Zero. Operator reviews and signs off before Phase 4 begins. Serves as scaffolding while no real data exists yet.
- **Phase 4 onward: curated real captures.** The 7-day dry-run produces real `agent_decisions` records against Aiweon's actual account. The operator picks representative cases (kills, scales, escalations, skips, edge cases) and promotes them to `tests/golden/*.json`. The synthetic starter set is retired as real captures cover each scenario — real data is always preferred over hypothesized data.

After Phase 4, E1 regression tests run against the real-captured set; the developer does not keep inventing scenarios.

Required coverage:

| # | Scenario | Source | Expected outcome |
|---|---|---|---|
| 1 | Creative fails Gate 1 (hook < 25%, CTR < 1%) at 48h+1000 impr | EVALUATION §7 scenario A | `gate_1_creative` → `kill` proposal |
| 2 | Winner campaign post-learning, CPA ≤ target, hook > 35% | EVALUATION §7 scenario B | `gate_2_campaign` → `scale_up` proposal |
| 3 | Creative Fatigue flag triggered (CPR ≥ 2× historical) | EVALUATION §7 scenario C | `gate_2_campaign` → `add_creatives` proposal (never pause) |
| 4 | Insufficient time (< 48h since edit) or insufficient volume | EVALUATION §7 scenario D | `skip_insufficient_data` decision, no proposal |
| 5 | Account age < 30d, low-baseline low-confidence | EVALUATION §9 #1 | Proposal with `requires_human_review=true` |
| 6 | No primary benchmark for the vertical | EVALUATION §9 #2 | Same as above |
| 7 | Leading + lagging signals conflict (hook 45%, CPA × 2) | EVALUATION §9 #3 | Same as above |
| 8 | Multiple winners in same ad set | EVALUATION §9 #4 | Proposal with 2-3 options presented to operator |
| 9 | Proposed budget jump > 30% | EVALUATION §9 #5 | Same as #5 |
| 10 | CPL spike ≥ 2× baseline, no obvious cause | EVALUATION §9 #6 | Escalation + pause-confirmation request |
| 11 | New-campaign proposal with tracking unverified | CAMPAIGN_BUILDING Day-Zero + US-B11 | Blocked by `verify_tracking_infrastructure` guardrail |
| 12 | New-campaign proposal with budget under `(CPA × 50) / 7` | CAMPAIGN_BUILDING §4 | Blocked by `enforce_budget_formula` guardrail |
| 13 | Proposal matching any deprecated rule (e.g. "Frequency > 3 → pause") | EVALUATION §8 / CAMPAIGN_BUILDING §10 | Reasoning path produces this → test fails; prompt has regressed |

The #13 row is a regression canary — it should never produce the old behavior; if it does, a deprecated rule has leaked back into a prompt.

**E2 — Guardrail unit tests (CI gate)**
Every rule in §14.1 has at least one passing and one failing fixture. CI fails if any guardrail is bypassed.

**E3 — Ad-hoc prompt iteration (no scheduled sampling)**
Operator reviews proposals in the course of normal approval work. When a rationale reads wrong, a guardrail fires incorrectly, or a diagnosis feels off, the operator opens a PR against `prompts/*.md` (or `guardrails.py`) and adds a golden-set snapshot covering the case. No weekly scoring ritual — the signal comes from daily use, the response is code.

**E4 — Approval-rate trend (operational signal)**
Weekly approval rate tracked in a dashboard query. If approval rate drops below 40% for 2 consecutive weeks → investigate (likely prompt drift or guardrail misconfiguration).

**E5 — Meta outcome tracking (correlative, not causal)**
30-day rolling comparison of campaigns under agent management vs. baseline (pre-agent 30d). Metric: CPA delta. Not a pass/fail gate for MVP, but logged for Aiweon stakeholder reporting.

**E6 — Cost tracking (visibility only, no gate)**
Daily cron tool writes Anthropic + Imagen spend to `agent_decisions.outputs` for historical visibility. No alert threshold — if spend grows, it reflects reasoning behavior (more turns, bigger prompts); fix the cause, not the limit.

---

## 4. Technical Specifications

### Architecture Overview

See spec §9 for the full diagram. Condensed flow:

```
Cloud Scheduler (cron)
  → Cloud Run Job (Docker: Claude CLI + Python 3.11 + campaigner/)
  → runners/<flow>.sh
  → claude -p "..."
  → Claude reads prompts/*.md + invokes tools/*.py via Bash
  → tools talk to Meta (facebook-business) + Supabase (supabase-py) + Imagen
  → every phase writes agent_decisions; proposals write approvals
  → Claude exits; cron completes
```

**3 cron slots (spec §18.1):**
- `0 9 * * *` Asia/Jerusalem → `daily_observe_propose.sh` (~2-5 min)
- `*/15 * * * *` → `execute_approvals.sh` (~10-60 sec, mostly no-op)
- `0 10 * * 1` → `weekly_creative_firehose.sh` (~3-8 min)
- `0 3 1 * *` → `refresh_baselines.py` (pure Python, no Claude)

### Integration Points

| System | Auth | Access pattern | Failure mode |
|---|---|---|---|
| Anthropic API | `ANTHROPIC_API_KEY` from `.env` mounted on Cloud Run instance | Synchronous CLI invocation per cron tick | Exit code 1 → `heartbeats` row with `phase='error'`; 3 consecutive failures → frontend alert banner |
| Meta Marketing API | `META_ACCESS_TOKEN` (~60-day expiry) from `.env` | facebook-business SDK, read + write | Manual rotation via `campaigner rotate-token` CLI; operator calendar reminder at 50d. **Future plan:** migrate to System User Token once Business Verification completes — eliminates expiry (see §5 risks + Phase 6 notes) |
| Supabase Postgres | `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) from `.env` | supabase-py client | Connection error → `heartbeats` row with `phase='error'`; agent aborts run |
| Vertex AI Imagen | GCP ADC (Workload Identity on Cloud Run) | google-genai SDK | Quota exceeded → tool exits 1; firehose skips that creative, continues |

**Advisory locking:** `pg_try_advisory_lock(hashtext('execute_' || business_id))` at start of `execute_approvals.sh`. Prevents overlapping executions.

### Data Model

See spec §10 for full DDL. Six tables:
- `businesses` (1 row for MVP: Aiweon)
- `business_knowledge` (1-to-1 with business; JSONB for flexibility)
- `baselines` (metrics per scope × window: 7/14/30-day rolling per spec §6.2)
- **`approvals`** — HITL queue. Status state machine: `pending → approved → executed` or `pending → rejected` or `pending → expired` (48h default TTL).
- **`agent_decisions`** — observability substrate. Every phase writes ≥1 row. Retention: 90 days.
- `creative_gallery` — generated assets + Meta creative IDs after upload.

All tables have RLS enabled (for v2 multi-tenant readiness); MVP backend uses service_role which bypasses policies.

### Security & Privacy

- **Secrets:** All three tokens (`ANTHROPIC_API_KEY`, `META_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`) live in a `.env` file mounted on the Cloud Run Job instance. `.env` is **not in Git** — provisioned at deploy time via `gcloud run jobs update --env-vars-file=.env.production` or an equivalent Terraform module. Never in code, never in stdout (Cloud Logging ingests stdout), never in `agent_decisions`.
- **Log redaction:** Python tools and `runners/*.sh` route through a redactor that masks anything matching the three token patterns before stdout. Cloud Logging retains whatever reaches stdout, so the redactor is the only safety net.
- **Blast-radius note:** `.env` on-instance is simpler than Secret Manager but means a compromised Cloud Run service exposes all three tokens. Mitigation: Cloud Run service account has minimum-necessary IAM (Artifact Registry read, Supabase project access via the key, no GCP-level admin). If a compromise is suspected, rotate all three tokens.
- **Supabase service_role key** exists only in the backend Cloud Run environment. Frontend uses anon + RLS.
- **No PII in prompts:** Business knowledge + campaign data flow through Claude, but no end-user PII (email lists, phone numbers) are in scope for MVP. If a future creative targets a custom audience upload, the upload file is a direct Meta-side action — never read into Claude context.
- **Operator authentication for CLI:** MVP uses environment-based trust (operator has shell access to the VPS or local env with secrets). Multi-user auth for CLI deferred to v2.

---

## 5. Risks & Roadmap

### Phased Rollout

Phases are ordered, not date-bound. Advance a phase only when its exit criteria hold.

**Phase 0 — Pre-dev (blockers; must clear before Phase 1)**
- [ ] **Supabase project** created (EU-West or EU-Central, low-latency to Israel). *Currently the known blocker — not done yet.*
- [ ] **Meta app access verified.** Local `.env` credentials already allow read + edit of campaigns on dev/test account. Audit whether the app has **Advanced Access** for `ads_management` (required for production spend). If not, submit Meta App Review — **2-4 week bottleneck.** Use personal token + test account `act_202495959` for dev until Advanced Access lands. Business Verification is a separate track (v2/Phase 6) and not required to start.
- [ ] **Anthropic API key** provisioned and added to `.env.production` (mounted on Cloud Run; not in Git).
- [ ] **Business Verification (Meta)** — not started as of 2026-04-16. Acknowledge as a **Phase 6 lever, not a Phase 0 blocker**: the system operates with a manually-rotated user token through Phase 6; Business Verification + System User Token is the rotation-free endgame (see §5 risks).
- [ ] **GCP Imagen quotas** verified in `bemtech-478413`.
- [ ] **Claude CLI** pinned version confirmed installable in Cloud Run Docker image.

**Phase 1 — Foundation**
Supabase migrations (001-007) applied to both `public` (prod) and `staging` schemas, `campaigner/lib/` wrappers around existing `meta_ads_manager.py` + `image_generator.py`, `campaigner/tools/` core tools (`fetch_insights`, `load_baselines`, `log_decision`, `propose_task`).

**Aiweon seeding during this phase:**
- Operator fills the **structured** portion of `business_knowledge` via `campaigner onboard --config onboarding/aiweon.yaml` (factual fields: vertical, website, regions, products, budgets, delivery time, seasons, primary KPI, tracking-verification checkboxes). The questionnaire/judgmental portion (brand voice, ideal customer, past wins/fails) is deliberately deferred to Phase 4 — operator refines it after seeing what the dry-run agent writes.
- `scripts/refresh_baselines.py` pulls **30 days** of Meta history (matches EVALUATION §3 rolling windows) and seeds `baselines`. If <30 days available, each baseline row gets `low_confidence=true` and the agent enters EVALUATION §9 #1 mode (low-baseline escalation) until the window fills.

**Exit criterion:** every core tool returns valid JSON for Aiweon's real ad account in a one-off invocation; `baselines` populated; structured `business_knowledge` seeded.

**Phase 2 — Agent**
`CAMPAIGNER.md` + `prompts/*.md` in Hebrew (co-authored with operator). First `claude -p` smoke test against Aiweon read-only data. Golden-set replay harness with 10 snapshots. **Exit criterion:** golden-set passes; Claude produces coherent Hebrew diagnoses and plausible proposals.

**Phase 3 — Control plane**
`campaigner/cli/` (`approve`, `reject`, `list`, `inspect`, `run`, `onboard`), `runners/*.sh`, Dockerfile, Cloud Run Job, Cloud Scheduler setup. **Exit criterion:** manual cron trigger end-to-end works; operator can approve a proposal via CLI and see `status='executed'` on next tick.

**Phase 4 — Dry-run live**
7 consecutive days of `observe-propose` in `--dry-run`: agent reasons and logs `agent_decisions`, writes `status='dry_run'` approvals for inspection, no Meta writes. **Operator completes the `business_knowledge` questionnaire during this phase** — the dry-run rationales reveal which judgmental answers (brand voice, ideal customer, past wins/fails, forbidden words) most affect output quality, so the questionnaire is filled against real examples rather than in the abstract. **Exit criterion:** operator audits reasoning; ≥90% of dry-run diagnoses judged sound; questionnaire complete.

**Phase 5 — Observe-only live**
Full `observe-propose` writes real `approvals`; `execute_approvals` flow *disabled*. Operator reviews proposals via CLI; no auto-execution. Proves decision quality without risking spend. **Frontend work unblocks after this phase starts** — a read-only UI over real data accelerates operator auditing. **Prompt-iteration ownership hands off from developer to operator** during this phase: operator submits PRs against `prompts/*.md` with the deprecated-rules checklist; developer reviews for technical correctness. **Exit criterion:** 7 consecutive days + Tier 2 approval-rate target met; operator has shipped ≥1 prompt iteration on their own.

**Phase 6 — Full HITL**
`execute_approvals` enabled. Operator approves via CLI or web. Monitor Tier 2 metrics for 30 days. **Exit criterion:** 30 consecutive days clean; Tier 2 and Tier 3 gates satisfied.

**Phase 7 — v2 triggers**
When a **second ad account** joins the system, trigger `docs/plans/langgraph-v2-migration.md`. Backend `tools/` + `lib/` + Supabase schema are reused; only the orchestration layer changes.

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Meta `ads_management` App Review rejection or delay | Medium | Blocks go-live | Submit Phase 0; have manual-use fallback (personal token + test account `act_202495959`) for dev |
| `META_ACCESS_TOKEN` expires mid-operation (~60d cycle) | High | Full agent outage until refresh | Operator calendar reminder at 50d; rotate via `campaigner rotate-token` CLI. **Future plan:** Business Verification → System User Token eliminates expiry entirely. Business Verification not started as of 2026-04-16; treat as Phase 6+ work, not a Phase 0 blocker. |
| Claude CLI breaking changes (npm package updates) | Medium | Agent invocation fails | Pin `@anthropic-ai/claude-code` version in Dockerfile; rebuild image on intentional upgrade only |
| Hebrew prompt quality drift | Medium | Bad proposals, low approval rate | E1 golden-set replay before every prompt merge; E3 weekly sampling |
| Andromeda threshold miscalibration (hook-rate <25%, CPA×1.3) | Medium | Kills good creatives or keeps bad ones | Tier 2 approval-rate signal; spec §23.4 notes vertical-specific thresholds are open — plan 30-day calibration window before relying on Gate 1 auto-proposals |
| Pre-Andromeda rule regresses into prompts | Medium | Silently bad decisions | Spec §6.7 + §14.1 guardrails; prompt PR template includes explicit §6.7 checklist |
| Supabase region latency (EU-West to IL operator) | Low | Slow CLI | Acceptable at p95 < 1s; alternative eu-central if needed |
| Claude reasoning exceeds `--max-turns 30` | Low | Partial work loss | Log and retry next cron tick; decisions from prior partial run remain in `agent_decisions` for audit |

### Open Questions (require operator input or A/B testing)

See spec §23.4 — six open items from Deep Research that Claude cannot auto-resolve (vertical thresholds, CI math for CPA, multiple-winners handling, >20% budget jump tolerance, GenAI creative fatigue curve, awareness vs. direct for Israeli service niches). Each becomes a Business Knowledge input or a deliberate A/B test during Phase 6.

### Flagged before Phase 0 kickoff

These were not resolved in PRD drafting and should surface early so they don't block later phases:

1. **Hebrew copy QA loop.** Who reviews agent-generated Hebrew copy during Phase 4 dry-run, and at what point does trust transfer to auto-publication? MVP assumption: operator reviews every new creative proposal during Phase 4-6; no auto-approval. Revisit for v2.
2. **`prompts/hebrew-copy-style.md` authorship.** Source of the brand-voice content for Aiweon: operator-authored, Aiweon team-authored, or extracted from existing Aiweon marketing assets? Needs an owner before Phase 2.
3. **Staging/prod schema sync (8.3 consequence).** One Supabase project with `public` + `staging` schemas means every migration must apply to both; the `migrations/*.sql` files need a convention (e.g. `SET search_path TO public, staging` or duplicated apply). Confirm mechanism during Phase 1.
4. **Meta App Review scope.** Which permissions submit together — `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `instagram_basic`? Iterative submissions mean serial 2-4w waits. Bundle all at once unless there's a specific reason not to.

### Documentation deliverables

Ships alongside code at MVP:
- `README.md` with the Runbook section (Group 4.6)
- `campaigner/CAMPAIGNER.md` — the agent protocol Claude loads at every invocation (spec §19)
- `docs/onboarding-new-business.md` — short checklist for when v2 adds the second ad account; maps the Aiweon onboarding flow to generic steps so future businesses don't require rediscovery
- This PRD + [`campaigner-frontend-prd.md`](./campaigner-frontend-prd.md) stay canonical through Phase 6

---

## Sources

- Spec: [`docs/plans/campaigner-spec.md`](./campaigner-spec.md)
- Evaluation philosophy: [`docs/CAMPAIGN_EVALUATION.md`](../CAMPAIGN_EVALUATION.md)
- 2026 practices: [`docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md`](../CAMPAIGN_BUILDING_RECOMMENDATIONS.md)
- Research diff: [`docs/deep_research/findings-diff.md`](../deep_research/findings-diff.md)
