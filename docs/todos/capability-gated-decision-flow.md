# TODO — Convert Category B gates from "silent skip" to "annotated finding"

**Status:** open · **Owner:** _unassigned_ · **Filed:** 2026-05-25 by Roi · **Severity:** high (agent is silencing real findings)
**Pairs with:** [`surface-runs-detail.md`](./surface-runs-detail.md) — that TODO surfaces what the agent already says; this one fixes what it *fails* to say.

---

## The framing (read this first)

The agent has **45 gates** across `campaigner/prompts/guardrails.md`, `campaigner/tools/check_*.py`, `campaigner/CAMPAIGNER.md`, and `campaigner/prompts/decision-tree.md`. They split cleanly into two categories that look the same from the outside but do different work:

**Category A — Safety gates** (~30 of the 45). Prevent the agent from doing a *specific bad action*.
Examples: `budget_jump_max_30pct` · `no_pause_on_recent_conversion_24h` · `no_low_res_creative` · `no_delete_campaigns` · `scale_down_max_15pct_per_step` · `no_horizontal_scaling_by_duplication`.
These are **working correctly**. They're enforced in `check_guardrails.py`, return `rejection`, and prevent real harm. **Don't touch them.**

**Category B — Premise gates** (~15 of the 45). Block the agent from *speaking* because some input is missing or some prior state exists.
Examples: `verify_tracking_infrastructure` (§17) · `set_kpi_target_requires_research` (§26) · `state_hash unchanged → skip` (Step -1) · `pending approval exists → skip everything` (Step 0.7) · `§T-2 generic-name gate` · `§37 rejection-cooldown` · approval dedup.
These don't prevent harm — they prevent expression. When they fire, the agent has a thought and swallows it.

**The bug pattern:** Category B gates currently treat "I can't take this action" and "I can't share this observation" as the same event. They emit a `decision_type='skip'` (or no row at all) and the operator sees nothing — even though the agent did real diagnostic work.

This was concretely observed on 2026-05-25, business `9f8f42d9-3f6c-4e2e-bc1a-b60f9ff551f3`, runs `b2e70a34-…` / `c2455f95-…` / `54d09e9b-…`:

- Run 2 identified `objective_mismatch` on `23.4 סוכן AI` (engagement campaign for a lead-gen service, 7d CPL $192). The finding was correct. It was silenced because §17 (`verify_tracking_infrastructure`) blocked all structural lanes — but **changing an objective is not a scale-spend decision** and doesn't need verified tracking.
- Run 2 identified `הראל לידים` as `scale_up_candidate` (+822% w/w spend ramp, ₪14 CPL, CTR +53%). The finding was correct and the gate was *right* to block the action — but the operator never sees the staged-ready signal.
- Run 3 produced 0 proposals (skipped=2) because the existing onboarding alert from Run 1 deduped *everything*, including findings unrelated to onboarding (`objective_mismatch`, `budget_projection_high`, `staged_scale_up_candidate`). Dedup matched on coarse vibe ("there's a pending alert about onboarding") instead of per-finding identity.

---

## What this TODO is about

Three coupled changes that together fix the Category B pattern:

1. **Move premise-checking out of the LLM.** Build a `capabilities.py` that, given current business state, returns the list of capabilities exercisable this run. Pass that list into the prompt as a fact ("you can do A, B, C; D requires verified tracking, blocked this run"), not as a thing the LLM figures out.
2. **Convert Category B gates from `skip` to `annotate`.** When a capability is blocked, the agent still emits the diagnosis. The runtime stamps `blocked_by: ['tracking_verified']` (or similar) and the UI surfaces it as "ready when you unblock me."
3. **Fix the dedup primitive.** Dedup on `(finding_type, target_id)` — not on "any pending alert exists for this business." Three different findings should not collide just because they share a business and a day.

---

## What to build

### 1. `campaigner/lib/capabilities.py` — new file

A pure function: `compute_capabilities(business_state) → CapabilityReport`.

`business_state` is the output of the existing `load_business_state` / `check_tracking_health` / `check_account_health` / etc. calls — already gathered at the start of every run.

`CapabilityReport` shape:

```python
@dataclass
class Capability:
    name: str                    # e.g. "scale_up", "new_creative", "objective_mismatch_alert"
    available: bool
    blocked_by: list[str]        # e.g. ["tracking_verified", "primary_kpi_set"]
    reason_he: str               # short Hebrew, for UI

@dataclass
class CapabilityReport:
    capabilities: list[Capability]
    blocked_count: int
    available_count: int
```

Capability definitions (start with these — extend as needed):

| capability | requires |
|---|---|
| `emergency_pause` | (none — safety overrides) |
| `objective_mismatch_alert` | (none — structural read) |
| `creative_fatigue_alert` | (none — structural read) |
| `pool_misalignment_alert` | (none — structural read) |
| `set_monthly_budget_alert` | (none — operator action) |
| `set_kpi_target` | `research_sources >= 2`, `matched_terms_present` |
| `scale_up` | `tracking_verified`, `primary_kpi_set`, `target_value_set`, `not_in_learning` |
| `scale_down` | `tracking_verified`, `primary_kpi_set` |
| `new_creative` | `tracking_verified`, `utilization_7d >= 50%` |
| `new_campaign` | `tracking_verified`, `primary_kpi_set`, `target_value_set` |
| `expand_audience` | `tracking_verified`, `cpa_above_target` |
| `redeploy_creative` | `tracking_verified` (looser than `new_creative`) |
| `ab_test_decide` | `test_age_days >= 7` |

This list mirrors the gates currently scattered in `guardrails.md` §17, §24, §26, §28, §30 + CAMPAIGNER.md Step 0.5 + Step 0.7. **Don't invent new requirements** — port the existing ones.

### 2. Inject capabilities into the prompt

At the top of `daily_observe_propose.sh` (and other runners), after gathering state, run:

```bash
CAPABILITIES_JSON=$(python -m campaigner.tools.compute_capabilities --business-id "$BUSINESS_ID")
```

Pass that JSON into the `claude -p` invocation as part of the protocol input — e.g., a new section in `CAMPAIGNER.md` Step 0 telling the LLM: "your runnable capabilities this run are listed in CAPABILITIES_JSON. Do not propose tasks outside that list. For each diagnosis where the relevant capability is blocked, emit the diagnosis as an `observation` with `outputs.blocked_by` set."

The LLM is told what it can do. It doesn't decide.

### 3. New `decision_type` value: `observation_blocked`

Add to `agent_decisions.decision_type` enum (migration). Semantics: "I found something. I can't act on it because capability X is blocked. Here's the finding anyway."

When `decision_type='observation_blocked'`, `outputs` MUST include:
```json
{
  "finding_type": "objective_mismatch" | "staged_scale_up" | "creative_fatigue" | ...,
  "blocked_by": ["tracking_verified"],
  "would_propose": { "task_type": "...", "payload": "..." },
  "summary_he": "..."
}
```

These rows surface in `/runs/[run_id]` (existing page handles them via the `decision_type` distribution bar) and in the new home-card from [`surface-runs-detail.md`](./surface-runs-detail.md). They are **not** written to the `approvals` table — they're observations, not action proposals.

### 4. Rewrite Category B gates to emit `observation_blocked` instead of `skip`

Files to touch:

- `campaigner/CAMPAIGNER.md` Step 0.7 (diagnostic-skip) — replace "skip Steps 1–6" with "run Steps 1–6, but for each capability-blocked finding emit `observation_blocked`."
- `campaigner/prompts/decision-tree.md` §T-1 (utilization gate), §T-2 (generic-name gate), §T0r routing — when routing to a blocked lane, emit `observation_blocked` not `skip`.
- `campaigner/prompts/guardrails.md` §17 (verify_tracking_infrastructure) — currently rejects proposals; should let the LLM emit `observation_blocked` upstream of the proposal call, *or* convert the guardrail's `rejection` into an `observation_blocked` row on the related diagnosis.
- `campaigner/tools/check_guardrails.py` — when a Category B rule fires, write an `observation_blocked` decision in addition to the rejection.

Category A guardrails (§1, §2, §4, §7, §8, §9, §18, §19, §20, §22, etc.) continue to reject. **Do not convert them.** Rejecting `budget_jump_max_30pct` is correct — the agent shouldn't be allowed to propose a 50% scale jump regardless.

### 5. Fix approval dedup

Currently the agent self-dedups in prompt logic ("don't propose if there's a pending alert that covers this"). The matching is by vibe.

Replace with structured dedup at the `propose_task` tool level:

- Every proposal carries `finding_key = sha256(finding_type + target_id_or_'business')`.
- Before insert, `propose_task.py` queries: "is there a pending approval with this `finding_key`?" If yes → skip with `decision_type='skip'`, `outputs.dedup_reason='existing_finding_key'`, `outputs.existing_approval_id=<id>`.
- If no → insert.

Add `finding_key` column to `approvals` table (migration). Backfill nullable for existing rows.

This means `onboarding_incomplete`, `objective_mismatch`, `set_monthly_budget`, and `staged_scale_up_candidate` are four distinct `finding_key`s and can coexist in the queue.

### 6. UI surface for `observation_blocked` (cross-references runs TODO)

Once the data is being written, the runs detail page already renders it (via the `DecisionRow` component). What's needed in addition:

- On the home-card (per [`surface-runs-detail.md`](./surface-runs-detail.md)), surface `observation_blocked` rows prominently — these are the "ready when you unblock me" insights.
- On `/approvals`, add a "blocked findings" section that lists `observation_blocked` rows from the latest run. Clicking through shows what the agent *would* propose and what to unblock.

---

## What NOT to do

- **Do not weaken any Category A guardrail.** The 30+ safety rules in `guardrails.md` exist because of past incidents. Listed in this TODO under "Category A" and explicitly out of scope.
- **Do not remove HITL.** All proposals still require operator approval. We're widening the *input* surface of HITL (more visible findings), not removing the *output* gate.
- **Do not let the LLM compute capabilities.** The whole point is `capabilities.py` is deterministic. The LLM reads the list as a fact.
- **Do not add Pixel/CAPI bypass for `scale_up`.** Scaling spend on unverified tracking is the failure mode the gate prevents. We're not removing the gate — we're making sure the *finding* survives even when the *action* is blocked.
- **Do not skip the migration step for `decision_type` enum.** Postgres enum changes need a migration; don't shortcut by sticking values in a `text` column.

---

## Acceptance criteria

1. `campaigner/lib/capabilities.py` exists. `compute_capabilities(state)` returns the same blocked/available list whether called twice in a row — pure function, no LLM, no I/O beyond reading the passed state.
2. New `observation_blocked` decision_type exists in DB and migration applied.
3. Re-running the same three scans from 2026-05-25 on business `9f8f42d9-…` (or equivalent reproduction) produces:
   - 1 alert: `onboarding_incomplete` (Run 1, same as before)
   - 1 alert: `objective_mismatch` on `23.4 סוכן AI` (new — was silenced)
   - 1 alert: `set_monthly_budget` (new — was silenced)
   - N `observation_blocked` rows for `staged_scale_up_candidate` on `הראל לידים` and similar
   - 0 duplicate alerts across the three runs (dedup works per finding_key)
4. Category A guardrails (`budget_jump_max_30pct`, `no_low_res_creative`, etc.) continue to reject proposals that violate them — no regression. Verify via `tests/guardrails/` if those tests exist; otherwise add fixture-based tests.
5. `/runs/[run_id]` shows `observation_blocked` rows distinguishable from `skip` rows (different label/color via `DecisionRow`).
6. The agent's prompt no longer contains conditional skip logic for tracking / KPI / research-sufficiency — those checks moved to `capabilities.py` and are passed in as facts.

---

## Reference: the 15 Category B gates to migrate

(Sourced from a full-codebase scan on 2026-05-25.)

| Gate | File | Current behavior | After migration |
|---|---|---|---|
| §17 `verify_tracking_infrastructure` | `guardrails.md` + `check_guardrails.py` | rejects scale/new on unverified tracking | capability blocks action; diagnosis still emitted as `observation_blocked` |
| §26 `set_kpi_target_requires_research` | `guardrails.md` | rejects target proposal if research weak | capability requires `research_sources>=2`; if missing, emit `observation_blocked` with "needs more research" reason |
| §28 `prefer_redeploy_creative` | `guardrails.md` | rejects `new_creative` if redeploy candidates exist | capability `new_creative` requires `viable_unused_count < 3`; otherwise route to `redeploy_creative` |
| §37 rejection-cooldown | `guardrails.md` | skips if operator rejected something similar | capability blocks specific `(task_type, target_id)`; finding still emitted |
| §T-1 utilization gate | `decision-tree.md` | blocks `new_creative` if util < floor | capability requires `utilization_7d >= 50%`; otherwise `observation_blocked` with "delivery bottleneck — fix audience/budget first" |
| §T-2 generic-name gate | `decision-tree.md` | blocks action, forces rename alert | capability requires `name_is_descriptive`; emit rename alert AND original diagnosis as `observation_blocked` |
| §T_HO hands-off | `decision-tree.md` | skips entirely | capability `act_on_campaign` blocked; per-campaign observation still emitted |
| Step -1 `state_hash` skip | `CAMPAIGNER.md` | skips entire run | run continues but most diagnoses short-circuit; emit one `observation` row stating "no state delta — same as last run at $TIMESTAMP" |
| Step 0.7 diagnostic-skip | `CAMPAIGNER.md` | skips Steps 1–6 if pending unblock | run Steps 1–6 anyway; emit `observation_blocked` for findings that need unblocking |
| Approval dedup (current vibe-based) | LLM prompt | skips proposal if "similar pending" | dedup by `finding_key` at `propose_task.py` level |
| Flow C portfolio diversity | `creative_generator.py` | skips generation | capability `generate_creative` requires non-exhausted diversity; if blocked, emit `observation_blocked` |
| Flow D research cache | `CAMPAIGNER.md` Step 2 | skips re-search within 7d | OK as-is (legitimate cache, not silencing) |
| Flow E audience gate | `CAMPAIGNER.md` Step 4.2 | skips on unhealthy tracking | capability `build_audience` blocked; per-campaign audience observation still emitted |
| Flow H ready-count gate | `CAMPAIGNER.md` Step 2 | skips if 0 tests ready | OK as-is (legitimate no-op) |
| Insufficient-data gate (§6.4) | `check_data_sufficiency.py` | skips winner classification | capability `classify_winner` blocked; emit `observation_blocked` with current signals at low confidence |

---

## Open questions for the operator (Roi)

1. **Should `observation_blocked` rows show in `/approvals`** (as a separate section) or only in `/runs/[run_id]`? Per the previous debate, my lean is: latest-run blocked findings on `/approvals` (so they're seen), full history on `/runs/[run_id]`.
2. **`state_hash` skip** — should it become "always run but short-circuit fast" or stay as-is? Argument for keeping: cost (each run is ~$2.50). Argument for changing: drift inside an unchanging hash.
3. **Capability list** in §1 above — does it match your mental model? Any capability missing?
