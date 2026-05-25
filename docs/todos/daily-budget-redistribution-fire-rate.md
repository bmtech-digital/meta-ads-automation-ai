# TODO — Make the daily flow actually propose budget redistribution across campaigns

**Status:** open · **Owner:** _unassigned_ · **Filed:** 2026-05-25 by Roi · **Severity:** high (the lanes exist on paper but rarely propose anything; the agent should be actively reallocating budget across the connected ad account's campaigns every day)

---

## The framing (read this first)

Part of what the agent does — "run the agency" — is **portfolio capital allocation**: given the campaigns currently running in the connected Meta ad account, are we spending each ILS where it produces the most marginal conversions? Today three lanes in the daily flow are supposed to answer this:

- **§T2+ `scale_up_candidate` lane** (per-campaign) → `scale_up` ([`prompts/decision-tree.md` §T2+](../../campaigner/prompts/decision-tree.md))
- **§T_SD `scale_down_candidate` lane** (per-campaign) → `scale_down -15%` ([`prompts/decision-tree.md` §T_SD](../../campaigner/prompts/decision-tree.md))
- **§T11 Portfolio Rebalancing** (once per run) → linked `scale_up` + `scale_down` pair that moves budget from an expensive_stable to a hungry_winner ([`prompts/performance-brain.md` §8](../../campaigner/prompts/performance-brain.md), [`CAMPAIGNER.md` Flow A Step 6](../../campaigner/CAMPAIGNER.md))

**Observed problem (operator, 2026-05-25):** in practice these lanes propose **rarely**. A daily run on a multi-campaign business should be producing `scale_up` / `scale_down` / linked-pair proposals on a steady cadence (subject to the per-week / 14-day cadence guards, of course), but the queue and the runs detail pages don't show that volume. The agent diagnoses, observes, alerts — but mostly *doesn't* redistribute. That's a regression against the design intent.

**Cadence decision (locked):** the daily flow keeps this responsibility. We will NOT carve it out into a weekly job. Per-campaign cadence guards (§20 `scale_up_cadence_max_1_per_week`, §23 `no_consecutive_scale_down_14d`) already prevent the daily cadence from spamming the same campaign — those guards are the right throttle. The daily *opportunity-scan* should fire every day; the *per-campaign action cadence* throttles to weekly naturally.

**What this TODO is about:** diagnose why the budget-redistribution lanes don't fire as often as they should, identify the over-restrictive gate(s) or routing bug(s), and refine the logic so the daily flow actively considers and proposes budget moves across the portfolio.

---

## Step 1 — Measure the actual fire rate (investigation, do this first)

Before refining anything, get a clean baseline. Without this we'll be guessing which gate is over-restrictive.

For the last 30 days of `agent_decisions` (across all businesses with `active_campaign_count >= 2`):

1. **Lane-classification counts.** How many times did the router classify a campaign into each lane? Group by `(business_id, lane)` where lane ∈ {`hands_off`, `scale_up_candidate`, `scale_down_candidate`, `creative_pool_exhausted`, `pool_misalignment`, `routine_observation`}. The `node_name='route'` rows in `agent_decisions` (§T0r emits these — see [`prompts/decision-tree.md`](../../campaigner/prompts/decision-tree.md)) hold the data.
2. **Lane → action conversion rate.** For each `scale_up_candidate` classification, did the run also produce a `propose_task(task_type='scale_up')`? If not, log the SKIP rationale. Same for `scale_down_candidate` → `scale_down`. The expected funnel:
   - `scale_up_candidate` classifications → `scale_up` proposals: target ~50% (other half blocked by cadence/marginal-return — fine)
   - `scale_down_candidate` classifications → `scale_down` proposals: target ~70% (fewer guards)
3. **§T11 fire rate.** How many runs had `active_campaign_count >= 2` AND `tracking_health_status == 'healthy'` AND at least one `hungry_winner` + one `expensive_stable` classification, but produced **no** linked-pair proposal? Each such run is a missed rebalance.
4. **Top SKIP rationales** on `scale_up` / `scale_down` / `budget_change` task_types. Count rationales like `weekly_cadence_cap`, `cpm_inflation_no_lift`, `marginal_return_failed`, `weekly_rebalance_cap`, `consecutive_scale_down_blocked`. This tells us which gate is doing the most blocking.
5. **Capability availability.** From `agent_decisions.outputs` where `node_name='capabilities'` — how often are `scale_up` / `scale_down` `available=false`, and what's in `blocked_by`? If `tracking_verified` is blocking 80% of `scale_up` capabilities, that's the lever.

**Deliverable:** a short report at `docs/research/budget-redistribution-fire-rate-2026-05-25.md` with the five tables above. Write it before touching any prompt or threshold.

---

## Step 2 — Likely hypotheses to test against the data

Don't refine blind. The data from Step 1 will point at one of these (or surface a new one). Listed in rough order of likelihood:

### H1: §T0r router under-classifies into `scale_up_candidate` / `scale_down_candidate`

The router classifies each campaign into ONE lane. If the router prefers `routine_observation` or `creative_refresh_candidate` whenever there's ambiguity, a campaign that *also* qualifies as a scale candidate never gets seen as one. The decision-tree document at §T0r lists six lanes — re-read the routing rules and check whether a campaign with strong CPA and decent utilization can be silently routed to `routine_observation` because nothing pushed it over a threshold.

**If H1:** the router needs a secondary classification — a campaign can be `creative_refresh_candidate` *and* `scale_up_candidate` simultaneously. Adjust §T0r to emit both lanes and run both branches.

### H2: `marginal_return_check` (§21) is over-restrictive

§21 blocks a new `scale_up` if a previous scale_up in the last 14 days didn't produce ≥ `{{scaling.marginal_return_min_lift}}` (= 1.1×) more conversions. If a business had any previous scale_up that was rounded to "didn't lift," the lane is locked out for two weeks.

**If H2:** consider whether the marginal-return test should consider *moving direction* (the trend) rather than absolute lift, or whether the lookback window should be shorter for high-volume campaigns.

### H3: §T11 entry condition is too narrow

§T11 requires `active_campaign_count >= 2 + tracking_health_status == 'healthy'`. If most businesses have `tracking_health_status == 'watch'` (a yellow band — not broken, just not perfectly healthy), §T11 silently never runs.

**If H3:** allow §T11 to run on `health_band == 'watch'` with a more conservative cap on the move size (e.g. halve `{{portfolio.safety_cap_ils}}` from 200 to 100 ILS for watch-band businesses).

### H4: hungry_winner / expensive_stable definitions are too strict

`hungry_winner` requires CPA ≤ target × `winner_ratio` + utilization ≥ `solid_strong.util_floor` + 7+ days ACTIVE + `marginal_return_passed=true` — four conjunctions. `expensive_stable` requires CPA between `expensive_threshold` and `emergency_threshold` × target + 7+ days ACTIVE + not Learning + no creative-fatigue. Each conjunct cuts the population; together they may eliminate every realistic campaign.

**If H4:** consider softening one conjunct (e.g. allow `marginal_return_unknown` as a degraded-pass for hungry_winner, with a lower scale_up step), or introducing a "weak winner" / "stable" tier that gets a smaller move.

### H5: Capability gating eats spend-touching proposals

Per [`docs/todos/capability-gated-decision-flow.md`](./capability-gated-decision-flow.md), `scale_up` requires `tracking_verified` + `primary_kpi_set` + `target_value_set` + `not_in_learning`. A business missing any one of these gets zero scale_up proposals ever. If most active businesses are missing `target_value_set` (the operator never set a target CPA), the whole lane is dead in the water — and we'd see it as `observation_blocked` rows, not as `scale_up` proposals.

**If H5:** the fix isn't in the budget logic — it's in the onboarding flow (push harder to get `target_value_set` filled), or the `observation_blocked` rows need to surface so prominently that the operator fills the field. Per the capability TODO, the `observation_blocked` plumbing is partly built; this becomes a UI/onboarding push, not a budget-lane change.

### H6: Anti-flood cap (§2) is consuming the per-day proposal budget

§2 caps proposals/day by business budget tier (2/5/10). If Flow A emits a creative-fatigue alert, an objective_mismatch alert, an onboarding_incomplete alert, and an audience proposal — that's 4 proposals on a small-tier business with a cap of 2. The scale_up/scale_down at the end of the run never get queued.

**If H6:** carve out budget-redistribution proposals as a *separate* counter (e.g. `max_proposals_budget_moves` defaulting to 2/day, additive on top of the alert cap). Budget redistribution is the highest-leverage thing the agent does — it shouldn't lose a fairness fight against an alert.

---

## Step 3 — Refinement, after Step 1 + 2 identify the lever

**Don't refine more than one thing per change.** Land the diagnostic report, pick the one hypothesis the data implicates, change the minimum needed, re-measure for 7 days, then decide whether to iterate. Random simultaneous changes to four gates will make us unable to attribute the next observation.

Generic refinement principles:

- **Keep all Category A safety guardrails intact.** §4 (`budget_jump_max_30pct`), §18 (`enforce_budget_formula`), §22 (`scale_down_max_15pct_per_step`), §24 (`no_scale_down_in_learning`), §29 (`hands_off`) — these are the rails that keep us from setting client money on fire. None of them should be loosened to "fire more budget proposals." If a safety guardrail is the bottleneck, the diagnosis is *upstream* (don't classify into that lane in that condition), not "loosen the guardrail."
- **Cadence guards (§20 weekly cap, §23 14-day cap) ARE the throttle for the daily cadence.** They are doing the right job. If the data shows §20 is the top SKIP reason, that's *correct behavior on a healthy-firing lane* — it means the daily flow did try to propose every day and the cadence guard correctly held it to once per week per campaign. That's not the bug. The bug is when the lane didn't even try.
- **Prefer raising the classification rate** over loosening the action gates. If we route more campaigns into `scale_up_candidate`, the action gates will correctly decide whether to fire on each one. If we loosen the action gates without fixing classification, we'll fire more aggressively on the same small population — riskier.
- **Symmetry between scale_up and scale_down.** If we touch one, audit the other. The portfolio doesn't redistribute well if we only emit one side of the pair.

---

## What NOT to do

- **Do not move portfolio rebalance to a new weekly flow.** Locked decision — daily is correct, fire-rate is the problem.
- **Do not give the agent auto-execute authority on budget moves.** Proposals-only, HITL stays. Confirmed by the operator earlier in the same exchange.
- **Do not weaken §17 `verify_tracking_infrastructure`.** Scaling spend on unverified tracking is the failure mode that rule exists for. If the data says §17 is blocking everything, the fix is to make `observation_blocked` rows so visible that operators verify tracking — not to bypass the rule. See [`capability-gated-decision-flow.md`](./capability-gated-decision-flow.md) for the plumbing.
- **Do not raise the `scale_up` step size beyond the existing `{{scaling.scale_up_strict_cap_pct}}` (30%) cap.** Andromeda doesn't reward big jumps. Higher fire frequency is the goal, not bigger individual moves.
- **Do not introduce a "Flow I" or any new runner.** The earlier draft of this TODO created one; that draft is superseded. Everything happens in `daily_observe_propose`.
- **Do not refine multiple gates simultaneously.** One lever per change, 7-day observation window between changes, otherwise we can't attribute outcomes.

---

## Acceptance criteria

1. `docs/research/budget-redistribution-fire-rate-2026-05-25.md` exists with the five tables from Step 1, computed on the last 30 days of `agent_decisions`.
2. The report identifies a primary bottleneck and matches it to one of H1–H6 (or surfaces a new hypothesis with the same level of specificity).
3. One change is landed against that bottleneck — confined to either §T0r routing, one capability definition, or one gate definition. Diff scope: small.
4. A follow-up measurement 7 days post-change shows the targeted lane's fire rate increased (target: 2× the baseline rate for that lane, without an increase in operator rejection rate on those proposals).
5. No Category A safety guardrail (§4, §17, §18, §22, §24, §29) is modified.
6. No new runner or kubefile is added; the daily flow continues to own this responsibility.
7. The `runs/[run_id]` detail page on a post-change run shows visible portfolio-redistribution proposals (linked `scale_up`/`scale_down` pair or standalone moves), where on a baseline run it would have shown zero.

---

## Open questions for the operator (Roi)

1. **Confirm the observed-rarity claim.** I'm working from your verbal report ("right now they don't appear as much"). Step 1 will either validate that against the data or show that the lanes fire less than expected but more than zero — which changes the framing. Are you OK with Step 1 being a 1-2 day investigation before any code/prompt changes land?
2. **Operator rejection signal.** Part of "fire rate is too low" might be the agent learning from past rejections — §37 rejection-cooldown silences re-proposals after the operator rejected a similar one. If you've been rejecting scale_up proposals as too aggressive, the cooldown is correctly suppressing the next one. Do you remember rejecting scale_up/scale_down proposals recently? (If yes, H7 = "rejection-cooldown is doing the job; the real fix is calibrating scale_up step size, not firing more often.")
3. **What does "better distribution" look like to you?** The framing above optimizes for marginal conversions (move spend from expensive_stable to hungry_winner). But you might mean something different — e.g. you want broader portfolio coverage (don't let one campaign starve to 5% of total spend), or you want a daily "here's what I'd reallocate" summary even when no single move is large enough to propose. Different goals point at different refinements.
4. **Where should the diagnostic report live?** Default above is `docs/research/`. If you'd rather have it as a stable, regenerable dashboard (page under `/runs` or a new `/portfolio` route) instead of a one-shot markdown, that changes the deliverable from "report" to "view." Flag if you want the latter.
