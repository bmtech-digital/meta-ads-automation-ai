# PRD: Campaigner Backend (MVP)

> **Status:** Draft v1 (2026-04-16)
> **Scope:** Backend — Claude Code Native agent, Python tools, Supabase schema, cron runners, operator CLI.
> **Audience:** The developer picking this up as a handoff. Implement against this PRD; reference the spec for depth.
> **Companion:** [`campaigner-frontend-prd.md`](./campaigner-frontend-prd.md) — web UI over the same Supabase, built **after** backend Phase 5.
> **Ground truth (read before starting):**
>
> 1. [`docs/plans/campaigner-spec.md`](./campaigner-spec.md) — full technical spec (this PRD pulls up to the "what ships" level; the spec is the "how").
> 2. [`docs/CAMPAIGN_EVALUATION.md`](../CAMPAIGN_EVALUATION.md) — the evaluation philosophy the agent must encode.
> 3. [`docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md`](../CAMPAIGN_BUILDING_RECOMMENDATIONS.md) — 2026 practices; anything you build must not regress these.
>
> **Roles:**
>
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
- **No proposal volume floor.** Proposals are surfaced when the agent has something real to say. The agent is _not_ judged on how busy it is — a quiet day means no action was warranted. Volume is tracked for visibility, not as a gate.

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

| Persona                         | Role                                                                     | How they touch the backend                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Operator (Roi)**              | Owner, daily approver. **Prompt author starting Phase 5+** (not before). | Terminal-first: approves/rejects via `campaigner` CLI from any shell (local, VPS, phone SSH).                                                                                                                                                                                                                                                                |
| **Developer (you, the reader)** | Builder + maintainer. **Sole prompt author through Phase 4.**            | Implements the backend per this PRD. Authors `CAMPAIGNER.md` + `prompts/*.md` (Hebrew, grounded in CAMPAIGN_EVALUATION + CAMPAIGN_BUILDING) in Phase 2-3; continues to own prompt iteration until operator is comfortable with the format (Phase 5 handoff). Runs Python tools standalone for debugging; reads `agent_decisions` to diagnose agent behavior. |

### User Stories (backend surface = CLI + the agent itself)

**US-B1 — List pending approvals**
_As operator, I want `campaigner list --pending` to see today's proposals with urgency, rationale, and expected impact, so I can triage from terminal without a browser._

**US-B2 — Approve / reject from terminal**
_As operator, I want `campaigner approve <id>` and `campaigner reject <id> --reason "..."` to move a queue item without context-switching, so I can clear the queue in batches._

**US-B3 — Inspect agent reasoning**
_As operator, I want `campaigner inspect <run-id|approval-id>` to print the full `agent_decisions` chain (observation → diagnosis → proposal → guardrails), so I can audit "why did it propose this?"_

**US-B4 — Manual trigger with dry-run**
_As operator, I want `campaigner run daily --dry-run` to simulate a cron flow end-to-end with **reads + `agent_decisions` writes + simulated `approvals` (inserted with `status='dry_run'`)** but **zero Meta writes and zero real `status='pending'` rows**, so I can inspect the full proposed queue via CLI or web UI (filtered to `dry_run`) without the operator ever being able to approve them into production. Tests prompt changes safely while still producing the exact same `agent_decisions` audit trail a real run would._

**US-B5 — Onboard a business**
_As operator, I want `campaigner onboard --config onboarding/aiweon.yaml` to seed `businesses`, `business_knowledge`, and `baselines` in one command, so I don't hand-write SQL._

**US-B6 — Headless agent runs unattended**
_As operator, I want cron to invoke `claude -p` with the right env vars and capture structured logs per run, so I can grep historical behavior by date without reading DB directly._

**US-B7 — Tools are standalone**
_As engineer, I want every file under `campaigner/tools/_.py`to expose`--help`, take only CLI args, emit JSON on stdout, and return clean exit codes, so I can debug each tool in isolation.\*

**US-B8 — Weekly creative firehose**
_As operator, I want a `weekly-creative-firehose` cron slot that generates 3-5 new creatives per active campaign (continuous additions, not replacement), so the ad account stays in Andromeda's 10-50+ diversity sweet spot (CAMPAIGN_BUILDING §5) without me thinking about it._

**US-B9 — Two-gate reasoning is visible**
_As operator, I want the agent to separate Gate 1 (creative-level, leading signals at 48h-7d) from Gate 2 (campaign-level, lagging signals post-learning) in its reasoning, and to write them as distinct phases in `agent_decisions`, so when I inspect a proposal I can see which gate drove it — and I can audit whether the agent is honoring CAMPAIGN_EVALUATION §2 without reading every rationale._

**US-B10 — Ask a human when confidence is low**
_As operator, I want the agent to flag a proposal for explicit human review (urgency='high', `requires_human_review=true` in payload, rationale names the trigger) when any of the six scenarios in CAMPAIGN_EVALUATION §9 fires:_

1. _Account age < 30 days (no reliable baseline yet)_
2. _No primary benchmark data available for the vertical_
3. _Leading signals (Gate 1) and lagging signals (Gate 2) conflict — e.g. hook 45% but CPA × 2_
4. _Multiple winners in the same ad set (no consensus playbook)_
5. _Proposed budget jump > 30%_
6. _Sudden CPL spike ≥ 2× baseline with no obvious cause (potential Israel wartime context — Operation Modes deferred to v2)_

_In these cases the agent does not suppress the proposal and does not auto-approve it; it escalates to the operator with the reason named._

**US-B11 — Day Zero pre-flight for new-campaign proposals**
_As operator, I want the agent to run a pre-flight check (CAMPAIGN_BUILDING Day-Zero Launch Checklist) before proposing any `task_type='new_campaign'`, and to refuse to propose if any of these fail:_

- _Tracking infrastructure verified (Pixel + CAPI deduplicated, AEM priority events configured, domain verified) — pulled from `business_knowledge` or tool call_
- _Proposed daily budget ≥ `(target_cpa × 50) / 7` (learning-phase viability)_
- _Naming follows `[Funnel]_[Objective]_[Audience]_[Creative]_[Date]`_
- _≥3 diverse creatives queued (CAMPAIGN_BUILDING §5 launch minimum)_
- _Advantage+ Placements on; broad audience + Advantage+ Audience on_

_Each failure surfaces as a rejection row in `agent_decisions` with the specific guardrail name, so I can fix the gap (usually a business-knowledge field) before re-running._

**US-B12 — Manual asset upload to the creative gallery**
_As operator, I want to upload my own images and videos (client footage, brand assets, product shots) to a gallery that the agent can pull from when proposing creatives or new campaigns — so the agent isn't limited to Imagen-generated output and can use content I've already produced._

_Scope:_

- _Images: PNG/JPG, ≤ 30MB, aspect ratios 1:1 / 4:5 / 9:16 / 16:9._
- _Videos: MP4/MOV, ≤ 4GB, aspect ratios 1:1 / 4:5 / 9:16 / 16:9, duration 1-241 seconds (Meta Feed/Reels/Stories constraints)._
- _Each upload tagged with `service_tag` (which of the business's services it promotes), `marketing_angle` (emotion/urgency/benefit/...), and `aspect_ratio` (auto-detected, editable)._
- _Server-side validation is authoritative; client-side is a UX nicety. A file that fails server validation is rejected with a specific error (e.g. "video duration 312s exceeds Meta max 241s")._
- _`creative_gallery.generated_by='manual_upload'`. `storage_url` points to Supabase Storage bucket `creative-gallery`. No Imagen `generation_prompt` / `seed` — these remain NULL for manual uploads._

_Rationale: see [decisions-log §1.9](./decisions-log.md#19-creative-gallery-manual-video-upload-multi-service-campaign-structure). The existing `creative_gallery.generated_by` field already permits `'manual_upload'`, but no user flow writes that value until this story lands._

**US-B13 — Budget-aware `new_campaign` proposals**
_As operator, I've set `businesses.monthly_budget_ils` and I expect the agent to respect it. Before proposing any `task_type='new_campaign'`, the agent must:_

1. _Compute `current_monthly_spend = sum(active campaigns' daily_budget × 30) + spend_this_month_so_far` (from Meta insights)._
2. _Compute `headroom = monthly_budget_ils - current_monthly_spend`._
3. _Compute `min_campaign_monthly = (target_cpa × 50 / 7) × 30` — the viable-learning floor per [CAMPAIGN_BUILDING §7](../CAMPAIGN_BUILDING_RECOMMENDATIONS.md) Day-Zero checklist._
4. _Branch:_
   - _`headroom >= min_campaign_monthly` → proceed with the `new_campaign` proposal, with the rationale naming the headroom figure._
   - _`headroom < min_campaign_monthly` + an existing campaign meets the winner criterion (CPA < target × 0.8 for ≥ 5 days) → do not propose `new_campaign`; propose `scale_up` on the winner instead._
   - _`headroom < min_campaign_monthly` + no winner + a service without an active campaign exists in `business_knowledge.services` → propose an `alert` (task_type='alert', new — see below) with a budget-increase recommendation: "לפתוח קמפיין ל-<service> בעלות יעד ₪X נדרשים ₪Y לחודש נוספים. צפי לידים נוספים: Z (לפי baseline של <reference campaign>)."_

_New `task_type='alert'`: informational proposal that requires no Meta action. Operator can "acknowledge" (no execution) or "reject" (no-op). Distinct from other task_types because `execute_task.py` is a no-op for it._

**US-B14 — Multi-service business onboarding + portfolio structure caps**
_As operator, when I onboard a business that sells multiple services (e.g. an agency with SEO / PPC / content / web-dev / branding), I want the agent to structure campaigns according to the 2026 Andromeda-era rules in [decisions-log §1.9](./decisions-log.md#19-creative-gallery-manual-video-upload-multi-service-campaign-structure), not to naively run one campaign per service._

_Onboarding questions added to `business_knowledge.questionnaire_answers`:_

1. _`services[]` — list of distinct services, each with `{name, target_cpl_ils, landing_page_url, sales_team_capacity_leads_per_week}`._
2. _`persona_groups[]` — clusters of services that share a buyer persona (e.g. `[["seo", "ppc", "content"], ["branding"], ["web-dev"]]`). For pairs where the operator is unsure, the onboarding form defaults them to the same cluster and surfaces the list for confirmation._
3. _`flagship_service` (optional) — a single service that gets directional priority if CBO redistribution under-spends it._

_Hard caps the agent enforces (guardrails, not soft suggestions):_

- _`max_ad_sets_per_campaign = 3`_ — violation rejects the proposal.
- _`max_parallel_campaigns_per_business = 2`_ — a third `new_campaign` proposal requires a `requires_human_review=true` flag.
- _`cbo_only_across_services = true`_ — ABO across services is rejected with rule `deprecated_abo_service_split`.
- _`cannibalization_flag`_ — when two active campaigns target the same broad audience (same gender/age/region), the next observe-propose run surfaces a `merge_campaigns` proposal (new task_type, v2) or a warning in the affected campaigns' approvals.

_Structure decision at campaign-creation time:_

| Condition                                              | Structure                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `G == 1` + target CPL uniform (±30%) across services   | 1 campaign, 1 ad set, `service_tag` differentiates creatives                          |
| `G == 1` + target CPL differs > 30%                    | 1 campaign, up to `min(services, 3)` ad sets, CBO on                                  |
| `G >= 2` + monthly budget ≥ `G × min_campaign_monthly` | `G` campaigns                                                                         |
| Otherwise                                              | Force `G = 1`; surface a `requires_human_review` note explaining the budget shortfall |

_Creative volume is per ad set, not per service: 10-12 initial, 3-5/week._

### Acceptance Criteria (rolled up)

- [ ] **CLI binary `campaigner`** installable via `pip install -e .`, discoverable in `$PATH` after install.
- [ ] **Subcommands:** `list`, `approve`, `reject`, `inspect`, `run`, `onboard`, **`rotate-token`**. Each has `--help`. Each writes an `agent_decisions` row where relevant (e.g. approve → `decision_type='execution'` will follow later in Flow 2).

  **Output locale:** CLI labels, errors, and prompts are **English**. Content pulled from the DB (rationales, campaign names, questionnaire answers) stays in its native Hebrew. Rationale: RTL in terminals is inconsistent across emulators; English labels are grep-friendly and copy-paste-friendly when asking for support.

  **Behavior per subcommand:**

  | Subcommand                                                   | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
  | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `list`                                                       | Defaults to `--pending`. Flags narrow: `--approved`, `--rejected`, `--executed`, `--failed`, `--dry-run`, `--all`. `--campaign <name>` filters. Output: compact table (id, urgency, task_type, target, age).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | `approve <id> [<id>...]`                                     | Accepts one or more explicit IDs. **No glob, no `--all-pending`** — the friction of typing IDs is the safety mechanism. No confirmation prompt; if you typed it, you meant it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
  | `reject <id> [<id>...] --reason "<text>"`                    | Reason required (≥10 chars). Same multi-ID semantics as approve.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
  | `approve <id> --override-guardrail <rule> --reason "<text>"` | Soft-guardrail override path (see §2 AC). Reason ≥10 chars. The long `--reason` string is the friction; no additional confirmation prompt. Hard guardrails error out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
  | `inspect <id>`                                               | Pretty-printed `agent_decisions` chain by default (human-readable, grouped by gate per CAMPAIGN_EVALUATION §2). `--json` for machine consumption / piping. No built-in pager — pipe to `less` manually when needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
  | `run <flow>`                                                 | Flows: `daily`, `execute`, `creative-firehose` (maps to the three cron slots). `--dry-run` on any flow activates the dry-run mode from Group 3.4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
  | `run <tool-name>`                                            | Also dispatches to any `tools/*.py` by filename (minus extension), e.g. `campaigner run fetch-insights --days 7`. Same args + JSON output as the tool itself. Invaluable for debugging + prompt iteration; zero extra code (it's `exec`-style dispatch).                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
  | `onboard --config <yaml>`                                    | One-shot business onboarding per spec §11.5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | `rotate-token`                                               | Interactive: takes a fresh Meta long-lived user token (pasted in), validates it via Meta's `debug_token` + one read call against the ad account, and publishes it as a new version of the `meta-token-aiweon` secret via `gcloud secrets versions add meta-token-aiweon --data-file=-`. No Cloud Run Job redeploy required — the next cron tick's `gcloud secrets versions access latest` picks up the new version automatically. Writes the new expiry to `businesses.meta_access_token_expires_at` (structured — this is the field the frontend status panel reads) and an `agent_decisions` row (`decision_type='observation'`, summary names old vs new expiry). Operator runs it manually on the 50-day reminder. |

  **Explicit non-goals for MVP CLI:** shell completion scripts (bash/zsh), interactive TUI, glob/filter-based approve, batch confirmation prompts, multi-business selector. Each of these is a legitimate v2 addition; none blocks MVP.

- [ ] **Agent invocation** uses `claude -p --output-format json --max-turns 30` with env-injected secrets. Logs stream to stdout → **Google Cloud Logging** (Cloud Run Jobs' native path). Filter by `resource.labels.job_name` and `labels.flow` to slice by cron slot. No separate `/var/log/campaigner/` on disk — Cloud Run containers are ephemeral.

- [ ] **`expected_duration` per flow — constant, not column.** Defined in `campaigner/lib/flow_config.py` as `FLOW_EXPECTED_DURATION_MS`: `daily_observe_propose=300_000` (5min), `execute_approvals=60_000` (1min), `weekly_creative_firehose=480_000` (8min), `monthly-baseline-refresh=120_000` (2min). Frontend fetches via `/api/flow-config` Route Handler (returns the constant as JSON). Changing a value is a PR to this file — simpler than a new table for four numbers.

- [ ] **`monthly-baseline-refresh` runtime (cron `0 3 1 * *`).** Runs as a **separate Cloud Run Job** (`campaigner-baseline-refresh`) with the same Docker image but a **different entrypoint** (`python -m campaigner.scripts.refresh_baselines`, not `bash runners/*.sh`). Same service account (`campaigner-runner@...`), but only fetches `meta-token-aiweon` + `supabase-sr` from Secret Manager — no `anthropic-api-key` because no Claude. Writes `heartbeats` rows like every other flow. Pure-Python path keeps monthly-baseline cost at ~$0.

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

  Approve-time recheck (in the CLI/UI path) is deliberately _not_ added — it's redundant with execute-time recheck and couples the frontend to guardrails Python.

- [ ] **`approved_by` values (per [`decisions-log §1.7`](./decisions-log.md#17-גישת-משתמשים-שניים--single-user-mvp--c-hook-לעתיד)):** single-operator MVP, so the allowed values are `admin@aiweon.co.il` (web — `auth.jwt() ->> 'email'`) or `terminal` (CLI — hard-coded, no OS-user capture). `auto` reserved for v2 auto-approval. CLI does not read `$USER` or prompt for identity; `terminal` is the audit signal that "a human at a shell did this." Multi-operator attribution is a v2 item tied to the `user_business_access` table deferral in §1.7.

- [ ] **Guardrails split: hard (non-overridable) vs soft (overridable with operator reason).** A silent drop on every guardrail hides operator-correctable situations (e.g. "I know this campaign _looks_ like it's in learning, but we just pushed a tracking fix — override and scale"). Policy:

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

  **Where `payload.guardrail_override_required=true` comes from:** `propose_task.py` is the single writer. When `check_guardrails.py` returns only soft violations (no hard), propose_task sets the flag in `payload`, lists the rules in `payload.violated_rules`, and includes the rule names in `rationale`. The `approvals.guardrail_override_required` generated column (migration 008) mirrors the flag for indexed queries and Supabase Realtime filters — the frontend and `list` CLI do not dig into JSONB. When a hard violation is present, propose_task writes no approval at all (silent drop per the "hard guardrails" block above).

- [ ] **Data sufficiency gate (§6.4) enforced before any Gate 2 decision:** `check_data_sufficiency.py` returns `{sufficient: bool, reason: str}`; agent is instructed to log `decision_type='skip'` and move on when insufficient.
- [ ] **Business knowledge loader** loads the entire `business_knowledge` row into Claude's context in a single tool call (no RAG, no chunking) and caches it across turns.

- [ ] **README runbook section.** A `## Runbook` section at the end of the repo README covers the minimum to diagnose a dead system: where to look in Cloud Logging, how to read `heartbeats`, how to re-run a flow manually (`campaigner run daily`), how to rotate the Meta token, and when to contact Anthropic / Supabase support. Intentionally brief — not a `RUNBOOK.md`; failure-mode encyclopedias get out of date before they're useful. Grow only as real incidents accumulate.

**Gallery + multi-service (US-B12 / B13 / B14 — per [decisions-log §1.9](./decisions-log.md#19-creative-gallery-manual-video-upload-multi-service-campaign-structure)):**

- [ ] **Upload endpoint** — Route Handler `POST /api/gallery/upload` (authenticated, operator-only). Accepts multipart form data; one file per request. Flow: (1) validate MIME + file size (client headers untrusted); (2) for video, probe with `ffprobe` (shell-out via subprocess; codec whitelist `h264`, `hevc`) to extract duration + dimensions; (3) compute aspect ratio, reject if not in `{1:1, 4:5, 9:16, 16:9}`; (4) write to Supabase Storage bucket `creative-gallery` with path `{business_id}/{kind}/{uuid}.{ext}`; (5) insert `creative_gallery` row with `generated_by='manual_upload'`, populated `storage_url` + `aspect_ratio` + `dimensions` + `kind` + `service_tag` + `marketing_angle`; (6) return the new row id + signed preview URL (1h TTL). Errors return Hebrew message + field-level detail.
- [ ] **Schema addition (migration 009):** `creative_gallery.service_tag text` (nullable, indexed); CHECK constraint `generated_by in ('imagen', 'gemini', 'manual_upload')` formalized; Supabase Storage bucket `creative-gallery` created with RLS policy allowing service-role write + authenticated-operator read via signed URLs only.
- [ ] **`task_type='alert'`** — new enum value on `approvals.task_type`. Scope: informational proposals with no Meta side effect. `execute_task.py` is a no-op (logs `decision_type='execution'` with `outputs.noop=true`). UI renders `alert` cards with an "Acknowledge" button instead of "Approve", which transitions `status='acknowledged'` (new enum value on `status`). Enum widenings land in migration 009.
- [ ] **Budget-awareness tool** — new CLI tool `python -m campaigner.tools.compute_budget_headroom --business-id $BUSINESS_ID`. Returns JSON `{monthly_budget_ils, current_monthly_spend, headroom, min_campaign_monthly, can_propose_new_campaign, winners[]}`. Called by the agent before any `new_campaign` draft; refuses the proposal path when `can_propose_new_campaign=false` and routes to `scale_up` or `alert` per US-B13.
- [ ] **Multi-service onboarding YAML schema (spec §11.5 extension):** `knowledge.services[]` and `knowledge.persona_groups[]` and `knowledge.flagship_service` added to the onboarding YAML. Validation: every service in `persona_groups` must exist in `services`; no service may appear in two groups; `flagship_service` (if set) must be in `services`.
- [ ] **Guardrail additions (spec §14):** `max_ad_sets_per_campaign=3`, `max_parallel_campaigns_per_business=2`, `cbo_only_across_services`, `cannibalization_flag_on_broad_audience_overlap`. Each is deterministic and enforced by `check_guardrails.py`. Violations produce a `rejection` decision with the rule name.
- [ ] **Structure decision tool** — new `python -m campaigner.tools.choose_campaign_structure --business-id $BUSINESS_ID --target-service <name>`. Returns the recommended structure (number of campaigns, ad sets, service tagging strategy) per the table in US-B14. Called during `new_campaign` drafting.

### Non-Goals (explicitly NOT in backend MVP)

- LangGraph orchestration or any non-Claude-Code agent runtime.
- Vector DB, embeddings, RAG, Qdrant, pgvector — business knowledge is structured JSONB + markdown.
- Real-time alerts or Meta webhooks.
- Auto-approval execution (config placeholder exists in schema per §16; execution path not wired).
- Multi-tenant: single `business_id` in cron env; RLS policies exist but auth layer not built.
- Operation Modes (Storm/Off-Season/Peak/Normal) — MVP is always Normal.
- Annual War Chest budgeting, RLHF, Master View, Cross-business intelligence.
- Creative regeneration loop on rejection — reject is terminal.
- **AI** video generation, voice-over, image expansion, background swap — out of scope for creative firehose MVP. (Manual video upload **is** in MVP per US-B12.)
- LangSmith / Langfuse — `agent_decisions` table is the observability substrate.

---

## 3. AI System Requirements

### Tools Required

**Knowledge surface (read by Claude each run):** each prompt file is a translation of a specific section of the two authoritative knowledge docs. The prompt is the _operational_ version; the knowledge docs are the _reference_. When they diverge, the knowledge docs win — update prompts to match.

| File                            | Purpose                                                                      | Authored from                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `CAMPAIGNER.md`                 | Agent protocol — Flow 1/2/3 steps                                            | spec §11.3-§11.5                                                                                                                    |
| `prompts/performance-brain.md`  | Two-Gates evaluation logic + baseline-first rule + Israel warning            | EVALUATION §2, §3, §4; spec §6                                                                                                      |
| `prompts/decision-tree.md`      | Scenario branches — Gate 1 creative, Gate 2 campaign, account-wide           | EVALUATION §7 (scenarios A-D); spec §17                                                                                             |
| `prompts/guardrails.md`         | Human-readable catalog of enforced rules + deprecated-rules audit            | spec §14.1 + EVALUATION §8 + CAMPAIGN_BUILDING §10 (deprecated-rule lists must be cited verbatim, not paraphrased — prevents drift) |
| `prompts/creative-guide.md`     | Firehose model, hook-rate bands, angles, placement adaptation, aspect ratios | CAMPAIGN_BUILDING §5, §7; EVALUATION §4                                                                                             |
| `prompts/day-zero-checklist.md` | Pre-flight for new-campaign proposals (US-B11 rules)                         | CAMPAIGN_BUILDING Day-Zero Launch Checklist                                                                                         |
| `prompts/ask-a-human.md`        | The 6 scenarios where the agent escalates rather than decides                | EVALUATION §9                                                                                                                       |
| `prompts/hebrew-copy-style.md`  | Brand voice, forbidden words, register                                       | Business knowledge (per-business)                                                                                                   |

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

| #   | Scenario                                                             | Source                                | Expected outcome                                                |
| --- | -------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| 1   | Creative fails Gate 1 (hook < 25%, CTR < 1%) at 48h+1000 impr        | EVALUATION §7 scenario A              | `gate_1_creative` → `kill` proposal                             |
| 2   | Winner campaign post-learning, CPA ≤ target, hook > 35%              | EVALUATION §7 scenario B              | `gate_2_campaign` → `scale_up` proposal                         |
| 3   | Creative Fatigue flag triggered (CPR ≥ 2× historical)                | EVALUATION §7 scenario C              | `gate_2_campaign` → `add_creatives` proposal (never pause)      |
| 4   | Insufficient time (< 48h since edit) or insufficient volume          | EVALUATION §7 scenario D              | `skip_insufficient_data` decision, no proposal                  |
| 5   | Account age < 30d, low-baseline low-confidence                       | EVALUATION §9 #1                      | Proposal with `requires_human_review=true`                      |
| 6   | No primary benchmark for the vertical                                | EVALUATION §9 #2                      | Same as above                                                   |
| 7   | Leading + lagging signals conflict (hook 45%, CPA × 2)               | EVALUATION §9 #3                      | Same as above                                                   |
| 8   | Multiple winners in same ad set                                      | EVALUATION §9 #4                      | Proposal with 2-3 options presented to operator                 |
| 9   | Proposed budget jump > 30%                                           | EVALUATION §9 #5                      | Same as #5                                                      |
| 10  | CPL spike ≥ 2× baseline, no obvious cause                            | EVALUATION §9 #6                      | Escalation + pause-confirmation request                         |
| 11  | New-campaign proposal with tracking unverified                       | CAMPAIGN_BUILDING Day-Zero + US-B11   | Blocked by `verify_tracking_infrastructure` guardrail           |
| 12  | New-campaign proposal with budget under `(CPA × 50) / 7`             | CAMPAIGN_BUILDING §4                  | Blocked by `enforce_budget_formula` guardrail                   |
| 13  | Proposal matching any deprecated rule (e.g. "Frequency > 3 → pause") | EVALUATION §8 / CAMPAIGN_BUILDING §10 | Reasoning path produces this → test fails; prompt has regressed |

The #13 row is a regression canary — it should never produce the old behavior; if it does, a deprecated rule has leaked back into a prompt.

**E2 — Guardrail unit tests (CI gate)**
Every rule in §14.1 has at least one passing and one failing fixture. CI fails if any guardrail is bypassed.

**E3 — Ad-hoc prompt iteration (no scheduled sampling)**
Operator reviews proposals in the course of normal approval work. When a rationale reads wrong, a guardrail fires incorrectly, or a diagnosis feels off, the operator opens a PR against `prompts/*.md` (or `guardrails.py`) and adds a golden-set snapshot covering the case. No weekly scoring ritual — the signal comes from daily use, the response is code.

**E4 — Approval-rate trend (operational signal)**
Weekly approval rate tracked in a dashboard query. If approval rate drops below 40% for 2 consecutive weeks → investigate (likely prompt drift or guardrail misconfiguration).

**E5 — Meta outcome tracking (correlative, not causal)**
30-day rolling comparison of campaigns under agent management vs. baseline (pre-agent 30d). Metric: CPA delta. Not a pass/fail gate for MVP, but logged for future reporting (single-operator MVP per [`§1.7`](./decisions-log.md#17-גישת-משתמשים-שניים--single-user-mvp--c-hook-לעתיד) means there is no stakeholder reporting surface yet; values accumulate for the v2 C-hook `weekly_digest.py`).

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

| System             | Auth                                                                                                                                                                                                                                                                                                                                                                            | Access pattern                           | Failure mode                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic API      | `ANTHROPIC_API_KEY` from Google Secret Manager (secret `anthropic-api-key`), fetched by `runners/*.sh` at invocation start via `gcloud secrets versions access latest`                                                                                                                                                                                                          | Synchronous CLI invocation per cron tick | Exit code 1 → `heartbeats` row with `phase='error'`; 3 consecutive failures → frontend alert banner                                                                                                                                                                                                                                                                                                                                                                                                           |
| Meta Marketing API | Meta token from Secret Manager (secret `meta-token-aiweon`), fetched at invocation start. **Two auth modes supported** via `businesses.meta_auth_mode`: `user_token` (~60-day expiry; manual rotation) or `system_user_token` (no expiry; requires Business Verification). Both are first-class — dual-mode is required for v2 (clients can choose fast-start vs. stable path). | facebook-business SDK, read + write      | **Rotation path** (User Token): `campaigner rotate-token` CLI; operator calendar reminder at 50d. **Stable path** (System User Token): no rotation needed. Bemtech operates on User Token during MVP; flips `meta_auth_mode` to `system_user_token` once its BV — **in flight from Phase 0** — completes (~5-6 weeks). The rotation mechanism stays load-bearing indefinitely for v2 clients on the fast-start path. See [`decisions-log.md §1.2`](./decisions-log.md#12-meta-business-verification--timing). |
| Supabase Postgres  | `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) from Secret Manager (secret `supabase-sr`), fetched at invocation start                                                                                                                                                                                                                                                              | supabase-py client                       | Connection error → `heartbeats` row with `phase='error'`; agent aborts run                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Vertex AI Imagen   | GCP ADC (Workload Identity on Cloud Run)                                                                                                                                                                                                                                                                                                                                        | google-genai SDK                         | Quota exceeded → tool exits 1; firehose skips that creative, continues                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Advisory locking:** `pg_try_advisory_lock(hashtext('execute_' || business_id))` at start of `execute_approvals.sh`. Prevents overlapping executions.

### Data Model

See spec §10 for full DDL. Six tables:

- `businesses` (1 row for MVP: Aiweon)
- `business_knowledge` (1-to-1 with business; JSONB for flexibility)
- `baselines` (metrics per scope × window: 7/14/30-day rolling per spec §6.2)
- **`approvals`** — HITL queue. Status state machine: `pending → approved → executed` or `pending → rejected` or `pending → expired` (48h default TTL).
- **`agent_decisions`** — observability substrate. Every phase writes ≥1 row. Retention: 90 days (set by the agent_decisions cleanup job). The frontend Decision History surfaces the last **30 days** by default — a UX choice, not a retention gap; a "last 90 days" toggle is a Phase-4 nice-to-have.
- `creative_gallery` — generated assets + Meta creative IDs after upload.

All tables have RLS enabled (for v2 multi-tenant readiness); MVP backend uses service_role which bypasses policies.

### Security & Privacy

- **Secrets (production):** All three tokens (`ANTHROPIC_API_KEY`, `META_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`) live in **Google Secret Manager** in GCP project `bemtech-478413` as three secrets: `anthropic-api-key`, `meta-token-aiweon`, `supabase-sr`. Each new token value is added as a new _version_ (not a replacement); `latest` alias advances automatically. Never in code, never in Git, never in stdout (Cloud Logging ingests stdout), never in `agent_decisions`. `BUSINESS_ID` is non-sensitive and remains a plain environment variable on the Cloud Run Job.
- **Runtime access pattern:** `runners/*.sh` opens each invocation with three `gcloud secrets versions access latest --secret=...` calls that export the values into the process environment. The Python tools read `os.getenv(...)` unchanged — the tool layer is identical in prod and dev. Per-invocation fetch (vs. image-bake) means rotation takes effect on the next cron tick without a redeploy.
- **IAM:** The Cloud Run Job runs under a dedicated service account `campaigner-runner@bemtech-478413.iam.gserviceaccount.com`. That SA is granted `roles/secretmanager.secretAccessor` **on the three specific secrets only**, not project-wide. No `roles/secretmanager.admin`. No default compute SA. Scope creep into other secrets requires an explicit IAM change, logged in Cloud Audit Logs.
- **Audit trail:** Every `gcloud secrets versions access` call writes an entry in Cloud Audit Logs (`data_access` tier enabled for Secret Manager). Baseline pattern: three accesses per cron tick (daily flow = 3, execute flow every 15 min = 3, weekly firehose = 3). Anything outside that pattern — in particular off-hours access or access from a principal other than `campaigner-runner` — is investigable. MVP doesn't build automated alerting on this; the log exists and is queryable if suspicion arises.
- **Log redaction:** Python tools and `runners/*.sh` route through a redactor that masks anything matching the three token patterns before stdout. Cloud Logging retains whatever reaches stdout, so the redactor is the last line of defense regardless of secret source.
- **Blast-radius note:** If the `campaigner-runner` SA key leaks or the Cloud Run container is compromised while a flow is mid-run, the attacker captures the three token values currently resident in the process environment. Mitigation: (a) the SA has no IAM beyond the three secret accessors + Artifact Registry read + Supabase-project-as-external-service — no GCP admin surface; (b) every access is logged, so the compromise window is bounded and visible; (c) rotation via `campaigner rotate-token` (Meta) or manual `gcloud secrets versions add` (Anthropic/Supabase) invalidates the leaked value on the next cron tick without redeploying.
- **Dev-local:** Local development uses a plain `.env` file in the repo root (in `.gitignore`), **not** Secret Manager. Rationale: dev uses different values anyway (test ad account `act_202495959`, a separate Anthropic key or the same one, Supabase staging schema), the 60-day Meta rotation does not apply to the dev token on the same cadence, and a network-hop per tool run during iteration is unnecessary friction. A `.env.example` lists variable names (no values) in Git. Tools use `python-dotenv` when `ENV=local` and `os.getenv` in both environments, so no code branches on environment.
- **Supabase service_role key** exists only in the backend Cloud Run environment (from Secret Manager) and in the dev `.env`. Frontend uses anon + RLS.
- **No PII in prompts:** Business knowledge + campaign data flow through Claude, but no end-user PII (email lists, phone numbers) are in scope for MVP. If a future creative targets a custom audience upload, the upload file is a direct Meta-side action — never read into Claude context.
- **Operator authentication for CLI:** MVP uses environment-based trust (operator has shell access to the VPS or local env with secrets). Multi-user auth for CLI deferred to v2.

---

## 5. Risks & Roadmap

### Phased Rollout

Phases are ordered, not date-bound. Advance a phase only when its exit criteria hold.

**Phase 0 — Pre-dev (blockers; must clear before Phase 1)**

- [ ] **Supabase project** created (EU-West or EU-Central, low-latency to Israel). _Currently the known blocker — not done yet._
- [ ] **Meta app access verified.** Local `.env` credentials already allow read + edit of campaigns on dev/test account. Audit whether the app has **Advanced Access** for `ads_management` (required for production spend). If not, submit Meta App Review — **2-4 week bottleneck.** Use personal token + test account `act_202495959` for dev until Advanced Access lands. Business Verification is a separate track (v2/Phase 6) and not required to start.
- [ ] **Anthropic API key** provisioned (console.anthropic.com) and published as the first version of the `anthropic-api-key` secret in Google Secret Manager.
- [ ] **Secret Manager + service account setup** (one-time, ~30 min):
  - Create three secrets in `bemtech-478413`: `anthropic-api-key`, `meta-token-aiweon`, `supabase-sr`. Each with `--replication-policy=automatic` and an initial version populated from current local `.env` values.
  - Create dedicated service account `campaigner-runner@bemtech-478413.iam.gserviceaccount.com`. No default compute SA.
  - Grant `roles/secretmanager.secretAccessor` to `campaigner-runner` on each of the three secrets individually (`gcloud secrets add-iam-policy-binding <name> --member=serviceAccount:campaigner-runner@... --role=roles/secretmanager.secretAccessor`) — not project-wide.
  - When the Cloud Run Job is created (Phase 3), set `--service-account=campaigner-runner@...`.
  - Enable Secret Manager Data Access audit logs on the project (Cloud Logging → Audit Logs → Secret Manager → ADMIN_READ + DATA_READ).
- [ ] **Business Verification (Meta) — document prep starts Phase 0, runs in parallel with dev.** Timeline: ~1 month to collect Bemtech's documents (ח.פ, company registration, bank confirmation, Business Manager setup if not yet configured) + 1-2 weeks Meta review. Expected to complete during Phase 2-3; **does not block any phase transition**. MVP operates on User Token + 60-day rotation until then; Bemtech flips `businesses.meta_auth_mode` to `system_user_token` once BV approves. The rotation infrastructure stays load-bearing regardless — v2 clients on the fast-start / no-BV path depend on it. Full rationale: [`decisions-log.md §1.2`](./decisions-log.md#12-meta-business-verification--timing).
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
Full `observe-propose` writes real `approvals`; `execute_approvals` flow _disabled_. Operator reviews proposals via CLI; no auto-execution. Proves decision quality without risking spend. **Frontend work unblocks after this phase starts** — a read-only UI over real data accelerates operator auditing. **Prompt-iteration ownership hands off from developer to operator** during this phase: operator submits PRs against `prompts/*.md` with the deprecated-rules checklist; developer reviews for technical correctness. **Exit criterion:** 7 consecutive days + Tier 2 approval-rate target met; operator has shipped ≥1 prompt iteration on their own.

**Phase 6 — Full HITL**
`execute_approvals` enabled. Operator approves via CLI or web. Monitor Tier 2 metrics for 30 days. **Exit criterion:** 30 consecutive days clean; Tier 2 and Tier 3 gates satisfied.

**Phase 7 — v2 triggers**
When a **second ad account** joins the system, trigger `docs/plans/langgraph-v2-migration.md`. Backend `tools/` + `lib/` + Supabase schema are reused; only the orchestration layer changes.

### Technical Risks

| Risk                                                         | Likelihood                                                                | Impact                                 | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta `ads_management` App Review rejection or delay          | Medium                                                                    | Blocks go-live                         | Submit Phase 0; have manual-use fallback (personal token + test account `act_202495959`) for dev                                                                                                                                                                                                                                                                                                                                                                                                  |
| `META_ACCESS_TOKEN` expires mid-operation (~60d cycle)       | High during MVP bridge period; drops to Low for Bemtech after BV approves | Full agent outage until refresh        | Operator calendar reminder at 50d; rotate via `campaigner rotate-token` CLI. **Bemtech BV in flight from Phase 0** (~5-6 weeks end-to-end); post-approval, Bemtech flips `businesses.meta_auth_mode='system_user_token'` and the expiry category disappears for Bemtech. Rotation mechanism remains first-class — v2 clients who choose the fast-start path without their own BV rely on it. Decision trail: [`decisions-log.md §1.2`](./decisions-log.md#12-meta-business-verification--timing). |
| Claude CLI breaking changes (npm package updates)            | Medium                                                                    | Agent invocation fails                 | Pin `@anthropic-ai/claude-code` version in Dockerfile; rebuild image on intentional upgrade only                                                                                                                                                                                                                                                                                                                                                                                                  |
| Hebrew prompt quality drift                                  | Medium                                                                    | Bad proposals, low approval rate       | E1 golden-set replay before every prompt merge; E3 weekly sampling                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Andromeda threshold miscalibration (hook-rate <25%, CPA×1.3) | Medium                                                                    | Kills good creatives or keeps bad ones | Tier 2 approval-rate signal; spec §23.4 notes vertical-specific thresholds are open — plan 30-day calibration window before relying on Gate 1 auto-proposals                                                                                                                                                                                                                                                                                                                                      |
| Pre-Andromeda rule regresses into prompts                    | Medium                                                                    | Silently bad decisions                 | Spec §6.7 + §14.1 guardrails; prompt PR template includes explicit §6.7 checklist                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Supabase region latency (EU-West to IL operator)             | Low                                                                       | Slow CLI                               | Acceptable at p95 < 1s; alternative eu-central if needed                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Claude reasoning exceeds `--max-turns 30`                    | Low                                                                       | Partial work loss                      | Log and retry next cron tick; decisions from prior partial run remain in `agent_decisions` for audit                                                                                                                                                                                                                                                                                                                                                                                              |

### Open Questions (require operator input or A/B testing)

See spec §23.4 — six open items from Deep Research that Claude cannot auto-resolve (vertical thresholds, CI math for CPA, multiple-winners handling, >20% budget jump tolerance, GenAI creative fatigue curve, awareness vs. direct for Israeli service niches). Each becomes a Business Knowledge input or a deliberate A/B test during Phase 6.

### Flagged before Phase 0 kickoff

These were not resolved in PRD drafting and should surface early so they don't block later phases:

1. **Hebrew copy QA loop.** Who reviews agent-generated Hebrew copy during Phase 4 dry-run, and at what point does trust transfer to auto-publication? MVP assumption: operator reviews every new creative proposal during Phase 4-6; no auto-approval. Revisit for v2.
2. **`prompts/hebrew-copy-style.md` authorship.** ✅ Resolved 2026-04-19 — D-lite hybrid: AI-generated skeleton + light extraction from Aiweon's web presence, Roi as sole owner filling `[TBD]` markers. v0 skeleton written; v1 lock target 2026-05-10. See [`decisions-log.md §1.5`](decisions-log.md#15-hebrew-copy-style--authorship) and [`campaigner/prompts/hebrew-copy-style.md`](../../campaigner/prompts/hebrew-copy-style.md).
3. **Staging/prod schema sync.** ✅ Resolved 2026-04-19 — dual-write (`public.` + `staging.` blocks in each migration, fully qualified) with a CI drift check. Local dev uses a Postgres 16 container in `docker-compose.yml`. See [`decisions-log.md §1.4`](decisions-log.md#14-stagingprod-schema-sync--dual-write--ci-diff) and [`migrations/README.md`](../../migrations/README.md).
4. **Meta App Review scope.** ✅ Resolved 2026-04-19 — bundled submission of all 6 permissions in a single App Review package. See [`decisions-log.md §1.3`](decisions-log.md#13-meta-app-review--bundle-vs-serial) and the drafted submission package at [`meta-app-review-submission.md`](meta-app-review-submission.md).

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
