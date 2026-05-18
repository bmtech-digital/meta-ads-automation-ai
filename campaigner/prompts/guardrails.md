# Guardrails — The Rules That Are Never Broken

> **Source:** [campaigner-spec §14](../../docs/plans/campaigner-spec.md#14-guardrails).
> **Principle:** The most critical rule in the system — the agent never breaks a guardrail, even if it "thinks" it should.
> **Future implementation:** `campaigner/tools/check_guardrails.py` (⏳ pending 4.x). Until then, the agent reads this file before every proposal and verifies manually.
> **Output language (rejections + rationale):** Plain, conversational Hebrew, understandable even to someone outside the field. English acronyms are allowed only from paragraph 2 onward, glossed on first use. See [hebrew-copy-style.md §11](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields).

---

## How to use this file

Before every `propose_task.py`, go through the list below. If one of the rules is triggered → **do not propose**. Instead:

```bash
python -m campaigner.tools.log_decision \
  --business-id "$BUSINESS_ID" --run-id "$RUN_ID" \
  --graph-name observe_propose --node-name apply_guardrails \
  --decision-type rejection \
  --summary "Rejected <task_type> on <target_id>: violates <rule_name>" \
  --rationale "<Hebrew: why the rule applies here>" \
  --guardrail-violations "<rule_name>" \
  --campaign-id "<id>" \
  --outputs "{\"rejected_proposal\":{...}}"
```

**The rule name** (in `--guardrail-violations`) must match the snake_case name from the list below. This is the audit-trail key for §14.

---

## 1. `no_delete_campaigns`

**Rule:** No proposal with `task_type='delete_*'`. Pausing only (`pause_campaign`, `pause_adset`).

**Why:** Deletion is irreversible, loses history, and Meta converts delete to archive automatically anyway. Pausing achieves the same operational result with rollback available.

**How to replace:** `pause_campaign` / `pause_adset`.

---

## 2. `max_tasks_per_day` (§8.3)

**Rule:** Daily proposal cap based on the business's budget:

| `businesses.daily_budget_ils` | Max proposals/day |
| ----------------------------- | ----------------- |
| < 50                          | 2                 |
| 50 – 500                      | 5                 |
| > 500                         | 10                |

**Why:** Applying decisions is cognitive effort. Flooding the user with tasks → decision fatigue → automatic approvals without thinking.

**How to replace:** After step 5 (anti-flood prioritization in CAMPAIGNER.md), skip excess proposals → `log_decision rejection`.

---

## 3. `no_learning_phase_touch`

**Rule:** A campaign in `status=LEARNING` (conversions_7d < 50 AND days_active ≤ 7) → no `pause_campaign` / `pause_adset` / `expand_audience` / `new_campaign`.

**Exception:** `scale_up` to the minimum budget (`budget_daily_min_ils = CPA × 50 / 7`) — otherwise the campaign will never exit Learning.

**Why:** Any change to a campaign in Learning resets Meta's algorithm. Seven days go down the drain.

---

## 4. `budget_jump_max_30pct`

**Rule:** A single daily-budget change ≤ 20% (default). Up to 30% is allowed **only** if:

- `hook_rate > 35%`
- `frequency < 2.0`
- `status=ACTIVE` (exited Learning)

A jump > 30% → rejection.

**Why:** Meta is calibrated for pacing. A jump too large → re-entering Learning, reset of progress.

**How to replace:** Split into 2-3 sequential scale_up proposals across consecutive days.

---

## 5. `no_audience_change_on_active`

**Rule:** No `expand_audience` on an `status=ACTIVE` campaign that's meeting its target (CPA ≤ target). Audience = foundational variable.

**Exception:** A `LEARNING_LIMITED` campaign over 7 days without 50 conversions — audience change is allowed to re-trigger Learning.

**Why:** Changing the audience on a winning campaign = breaking what works. "Don't fix what ain't broken."

---

## 6. `no_horizontal_scaling_by_duplication` (new in 2026)

**Rule:** No proposal with `task_type='new_campaign'` that duplicates a winning campaign.

**Why:** Duplication resets the Learning Phase — 7+ days of optimization down the drain. Vertical scaling (increasing budget on the existing campaign) is the only legitimate path.

**How to replace:** `scale_up` (subject to `budget_jump_max_30pct`).

---

## 7. `meta_api_rate_limit`

**Rule:** Maximum X calls/minute to the Meta Marketing API (X is set by `app_rate_limit` — usually 200/hour user-level).

**Why:** Meta blocks tokens on rate-limit overruns. A block = inability to execute approvals until the block expires.

**How to replace:** If you detect excessive calls, economize — use the cached snapshot from `fetch_insights` instead of re-fetching.

---

## 8. `document_every_decision` (§12.1)

**Rule:** Every action → a row in `agent_decisions` via `log_decision.py`.

**Why:** §12.1 is a real need — without logging there's no audit, no debugging, no UI "why?" trail.

**If log_decision fails:** The tool retries 3 times automatically. If it still fails → exit 1. **Do not** continue in "fail-soft" mode.

---

## 9. `explicit_approval_over_threshold_ils`

**Rule:** A proposal that increases spend by > ₪500/day must have `urgency='high'` or `'urgent'` at minimum. High budget impact = the user sees it at the top of the queue.

**Why:** A high-budget scale_up proposal stuck at "medium" priority for 48 hours = money on fire.

---

## 10. `no_pause_on_recent_conversion_24h`

**Rule:** No `pause_campaign` on a campaign that produced a conversion in the last 24 hours.

**Why:** A live conversion = the ad is still relevant. Pausing makes no sense.

**Exception:** Emergency kill (CPA > 3× target) overrides this rule.

---

## 11. `no_low_res_creative`

**Rule:** Creative under 1080p in resolution → rejection in `new_creative` proposal.

**Why:** Meta auto-downgrades display quality, hurting hook rate.

**Implementation:** When generating an image via `ImageGenerator`, the `aspect_ratio` + dimensions flag returns 1080×*. Validate the output before upload.

---

## 12. `require_95pct_significance_for_ab` (new in 2026)

**Rule:** Declaring a winner in an A/B test requires 95% statistical significance (or volume equivalent). No "hook A scored 2% > hook B 1.8% so A wins" with 100 impressions each.

**Why:** Andromeda allocates budget unevenly on purpose. Performance differences at low volume = noise, not signal.

---

## 13. `prefer_add_creative_over_pause` (new in 2026)

**Rule:** A campaign flagged with Meta Creative Fatigue (CPR ≥ 2× baseline) → proposal `pause_campaign` is forbidden. Allowed proposal: `new_creative` × 3-5.

**Why:** Creative fatigue ≠ campaign problem. Pausing loses Learning. A firehose of creatives refreshes without that loss.

---

## 14. `no_manual_creative_pruning_before_48h` (new in 2026)

**Rule:** No `pause_adset` / `pause_campaign` on a new creative (less than 48h live) **unless** a Gate 1 kill trigger fires (hook < 25% OR CTR < 1% with sufficient volume).

**Why:** Meta allocates budget unevenly on purpose — "winning" creatives get more. The skew looks like uneven proportions on a dashboard. Don't interpret it as "needs to be killed."

---

## 15. `no_frequency_only_kill` (new in 2026)

**Rule:** Frequency > 3 alone → **not** a pause trigger. Requires an additional signal (CPR ≥ 2×, or CPA > 1.3× target).

**Why:** Andromeda targets better. High frequency ≠ fatigue. The real trigger is the Creative Fatigue flag.

**How to catch a rationale that violates the rule:** If `rationale` mentions the word "frequency" without another supporting metric → return to [decision-tree.md §T1](decision-tree.md#t1--cpa-יקר-מדי-gate-2).

---

## 16. `video_preferred_on_equal_cpa`

**Rule:** When proposing `new_creative` and the CPA of video and image variants is similar (±10%), prefer video.

**Why:** Video produces higher hook rate in 2026. Similar CTR + better hook = better scaling potential.

---

## 17. `verify_tracking_infrastructure` (linked to backend PRD E1 #11; expanded 2026-05-12 — M1)

**Rule:** Proposals of type `new_campaign`, `scale_up`, `new_creative`, or `expand_audience` are blocked if the agent knows the tracking infrastructure is unhealthy — meaning:
- `state.tracking_health_status != 'healthy'` (prefer this source — output of `check_tracking_health.py`, M1 2026-05-12), **or**
- `state.tracking_verified=false` (fallback to the legacy flag on `business_knowledge`).

**Why:** Any proposal that **increases spend** in a system that doesn't measure conversions = burning budget on impossible optimization. Until 2026-05-12 the rule only blocked `new_campaign`; since then it also blocks scale-spend on existing campaigns for the same reason — Meta doesn't know what to optimize for, increases just amplify the loss.

**What is still allowed in an unhealthy state:** `pause_campaign` (emergency), `alert`, `set_kpi_target`, `verify_pixel_capi` (the canonical repair path).

**How to replace:** The agent proposes `verify_pixel_capi` with urgency=high to put the task at the top of the user's queue. If a pending `verify_pixel_capi` already exists → `log_decision skip` with rationale `"tracking_unhealthy_proposal_already_pending"`.

**Implementation:** `check_guardrails._verify_tracking_infrastructure`. The agent passes `tracking_health_status` (from `check_tracking_health.py` output, Step 0.5 in Flow A) via `--state`.

---

## 18. `enforce_budget_formula` (linked to backend PRD E1 #12)

**Rule:** Any `new_campaign` / `scale_up` whose resulting daily budget falls below `(expected_cpa × 50) / 7` → rejection.

**Why:** §6.3 — a campaign will not exit Learning if its budget doesn't allow ≥ 50 conversions in 7 days. A proposal that sets it below that = burning money with no exit from Learning.

**Example:** Target CPA ₪100 → `budget_daily_min_ils = (100 × 50) / 7 = 714`. Proposal with daily_budget_ils = 500 → rejection.

**How to replace:** Propose a budget that satisfies the formula, or raise the target CPA if the client insists on a low budget.

---

## 19. `no_new_creative_when_underspending` (new 2026-05-12)

**Rule:** A campaign with `utilization_7d < 0.50` (per §T-1 — Meta spent less than half the budget) → **rejection for `task_type='new_creative'`**.

**Why:** Roi 2026-05-12 — "adding a creative when the problem is that nobody sees the existing one = throwing more buckets at an empty well." The symptom is pool/audience/auction misalignment, not a shortage of angles. Adding a variant won't increase impressions if Meta refuses to spend the budget.

**How to replace:** Propose an alert (`task_type='alert'`) describing the mismatch (pool / audience size / CPM). If the agent identified a specific cause — propose expand_audience, or an alert about the objective. See decision-tree.md §T-1 severely_under branch.

**Exception:** If the operator set an explicit override at `approvals.payload.override_no_new_creative_when_underspending=true` — allowed, but the rationale must say why.

---

## 20. `scale_up_cadence_max_1_per_week` (new 2026-05-12)

**Rule:** Maximum one `task_type='scale_up'` (or `budget_change` with magnitude > 0) proposal per campaign per 7 consecutive days. The count is based on `executed_at` of approvals already executed against Meta.

**Why:** Roi 2026-05-12 — two stacked reasons:
1. Every increase requires Meta to re-balance pacing. Sequential increases before the previous one stabilized = compounding noise.
2. Without a cadence cap, the agent would propose 3 increases on the same campaign in the same week — and the user wouldn't be able to tell which move did what.

**How to replace:** log SKIP with rationale="weekly_cadence_cap" — the agent waits until next week. If the campaign warrants 2× scale_up in a week — that's a signal for the marginal-return guard (§22) or a true winner, in which case Roi will approve manually in a 1:1.

**Implementation:** In decision-tree §T2+ Pre-check 3. Future Python check in `check_guardrails.py`.

---

## 21. `marginal_return_check_before_scale_up` (new 2026-05-12)

**Rule:** A `scale_up` proposal is rejected if:
- A previous scale_up on the same `target_id` happened in the last 14 days, **and**
- `delta_conversions(7d post last_scale) < 1.10 × baseline_conversions(7d pre last_scale)` (less than 10% lift).

**Why:** Roi 2026-05-12 — "only if it's actually effective. If it just doesn't give anything then don't propose." Without this check, the agent would propose +20% even after the previous increase proved no growth — wasting money for no result.

**How to replace:** propose an alert (`task_type='alert'`) instead of scale_up. rationale (plain Hebrew): "ההגדלה הקודמת לא הזיזה המרות. תקציב נוסף לא יעזור — צריך לבחון זווית קופי שונה או לבדוק אם הקהל הגיע לתקרה."

**Edge case:** No previous increase in 14 days → the rule doesn't apply, scale_up is allowed (subject to other pre-checks).

**Implementation:** In decision-tree §T2+ Pre-check 1. The tool `python -m campaigner.tools.check_marginal_return --business-id ... --campaign-id ...` (available since 2026-05-12) performs the full check — including searching `approvals`, pulling both windows from Meta, and computing the delta. The agent reads `passes_guard` and `block_reason` from the output.

---

## 22. `scale_down_max_15pct_per_step` (new 2026-05-12)

**Rule:** A `scale_down` proposal that reduces daily budget by more than 15% in a single step → rejection.

**Why:** Large drops break pacing the same way large increases do. -15% is a noticeable cut from Meta's perspective but small enough not to reset Learning.

**How to replace:** Split into 2 scale_down proposals across 14 days (but also see §23 — `no_consecutive_scale_down_14d` which blocks a sequence that's too tight). If the situation truly demands a large drop — that's a signal for pause + analysis, not scale_down.

---

## 23. `no_consecutive_scale_down_14d` (new 2026-05-12)

**Rule:** Do not propose `scale_down` on a campaign that already had a `scale_down` proposal executed in the last 14 days.

**Why:** Two consecutive cuts = a slow pause. If the first scale_down didn't bring CPA into range — that's a sign the problem is copy, target, or audience, not spend cadence. Another cut just pushes the campaign into a spiral of fewer impressions → fewer conversions → worse-looking CPA in relative terms.

**How to replace:** propose new_creative with a different angle, or propose an alert about pool misalignment. If there's truly nothing to do — pause with urgency='medium' for human review.

---

## 24. `no_scale_down_in_learning` (new 2026-05-12)

**Rule:** A campaign in `status=LEARNING` or `LEARNING_LIMITED` → scale_down is forbidden. Don't propose a "small cut" either.

**Why:** §3 (`no_learning_phase_touch`) already blocks most actions during learning. scale_down specifically: a budget change during learning resets the 7-day counter → another 7+ days of waiting for 50 conversions. In learning, only two legitimate actions exist: scale_up up to `budget_daily_min_ils` (the §3 exception), or pause in an emergency.

**How to replace:** Wait for the campaign to exit Learning. If CPA is very expensive in learning — Emergency check (§T1): CPA > 3× target → pause with urgency='urgent'.

---

## 25. `respect_hands_off` (new 2026-05-12 — M2 Monthly Brief)

**Rule:** A campaign that the user marked under `businesses.monthly_brief.hands_off_campaign_ids` for the current month → no `scale_up` / `scale_down` / `pause_campaign` / `new_creative` / `expand_audience` / `budget_change` proposals. **Allowed:** `alert` (if something needs attention) and `observation` (logged to `agent_decisions` as usual).

**Why:** PERSONALITY non-negotiable #4 — "Ask the business intent before recommending." When the user manually flagged "hands off," the agent should respect that, even when the numbers justify action. The user knows something the agent doesn't (a parallel process, a conservative experiment, business sensitivity).

**How to check:** In Flow A Step 1 the agent loads `load_business_knowledge` and gets `monthly_brief_summary`. If the campaign on deck is in `hands_off_campaign_ids` **and** `is_current_month == true` (brief isn't stale) → log SKIP with rationale="hands_off_per_monthly_brief".

**Sole exception:** Emergency Pause per §T1 (CPA > 3× target OR 3+ days with 0 conversions despite full budget). The user cannot block an emergency, but the rationale must say: "פעלתי בניגוד ל-hands_off כי [תנאי החירום]; אנא עדכן את הבריף בהתאם".

**Implementation:** prompt-level inside the router (§T0r). Future Python check in `check_guardrails.py`.

---

## 26. `set_kpi_target_requires_research` (new 2026-05-12; static path opened 2026-05-13)

**Rule:** A `task_type='set_kpi_target'` proposal is rejected if `payload.research` is missing, or is missing one of these fields:

- `market_average` (number) — the average value the agent found in research.
- `sources[]` — at least 2 entries, each with `title`, `url`, `extracted` (one-line citation).
- `context_used[]` — the list of `business_knowledge` fields that shaped the search queries (`vertical`, `products`, `service_regions`, etc.). Proof that the research was business-specific.

**Why:** The user must be able to verify the value. Without `sources` they can't. Without `context_used` there's no way to tell if the search reflected the business's vertical / product / region or fell back to a generic band. Proposing a generic value for a specific B2B SaaS platform as if it were a contractor lead = wrong advice.

**Two valid paths to populate the research block** (both pass the guardrail the same way):

### Path A — Static (preferred, saves tokens) ⚡

The agent first calls:

```bash
python -m campaigner.tools.estimate_cpl --business-id $BUSINESS_ID \
    [--stage cold|warm_*|...] [--offer consultation_free|demo_request|...] \
    [--channel lead_form|click_to_whatsapp|...] [--month nov] [--security-event]
```

The tool returns a ready `research_block` (fully matches §26): `market_average`, `sources[]` (≥2 citations from [cpl-infrastructure.md §9](cpl-infrastructure.md#9-primary-sources-citable-for-researchsources)), `context_used[]`. **Pass it directly into `propose_task --research <json>`.** Zero WebSearch.

**When this path is valid:**
- `business.vertical` is defined (not null, not `other`).
- `business_knowledge.products` or `questionnaire_answers.ideal_customer/usp/main_pain` exist — enabling sub-vertical match.
- `estimate_cpl` output returns `needs_live_research=false` (meaning `confidence != 'low'` and `confidence_of_match != 'fallback'`).

### Path B — Live (WebSearch) — fallback for edge cases

WebSearch is required when:
- `needs_live_research=true` from `estimate_cpl` output.
- High-stakes proposal needs corroboration (budget > ₪500/day) — [cpl-infrastructure.md §10.4](cpl-infrastructure.md#10-when-to-live-websearch-anyway-escape-hatch).
- The operator-supplied value deviates from the `estimate_cpl` band by >2× — they may have context the static model doesn't know.
- `business_settings.unusual=true` set by the operator.

In WebSearch — queries are shaped from business_knowledge (e.g. `"average cost per lead B2B SaaS Israel 2026"`, `"<vertical-specific term in Hebrew> עלות לליד ממוצעת"`). Synthesize from 2-5 sources. Same 3 required fields (`market_average`, `sources[]`, `context_used[]`).

**If both `estimate_cpl` returned `fallback` AND WebSearch is unavailable:** **do not propose** `set_kpi_target`. Instead, log SKIP with `rationale="static_fallback_and_websearch_unavailable"`. The proposal waits until the next run.

### Required `rationale` content (mandatory — added 2026-05-13 per user feedback)

The guardrail adds **three content checks** on the rationale so the operator sees specificity, not generic text:

1. **Name of the service that was analyzed:** the rationale must explicitly mention at least one of `match.matched_terms[]` returned by `estimate_cpl` (e.g. "ניתחתי את 'סוכן AI'", "ניתחתי את 'מיתוג משפיעות'"). These are the words that fired the match — concrete proof of which service was researched. If `matched_terms` is empty (`confidence_of_match='fallback'`), the rationale must say explicitly "לא זוהה שירות ספציפי, ניתחתי את כלל פעילות העסק". **Generic "a business similar to yours" is blocked.**
2. **Campaign name (when `campaign_name` was passed):** if `estimate_cpl --campaign-name=<X>` was used, the rationale must include `X` (the Meta campaign name) so the operator sees that the research was for the specific campaign, not the business as a whole. Example: "עבור קמפיין 'סוכן AI - שלב 1' (משתייך לשירות 'סוכן AI')". This is the wiring from [decision-tree.md §T-2](decision-tree.md#t-2--per-campaign-service-anchor-must-run-after-t-1-before-t0r).
3. **Anchored competitors:** the rationale must mention ≥1 name from `business_knowledge.competitors`, or — if the list is empty — say explicitly "אין מתחרים מוגדרים, השוואתי מול ממוצע ענפי כללי של [שם תת-ורטיקל]".

**Implementation:** in `_set_kpi_target_requires_research` in [check_guardrails.py](../tools/check_guardrails.py) — simple regex checks:
- At least one of `payload.research.match.matched_terms[]` (or fallback to `business_knowledge.products[].name`) must appear in `rationale`.
- If `payload.research.match.campaign_name` is non-empty → the campaign name must appear in `rationale`.
- At least one entry from `business_knowledge.competitors[]` must appear, or the literal phrase "אין מתחרים מוגדרים" must appear.

See also [kpi-benchmarks.md "How rationale must be written"](kpi-benchmarks.md#how-set_kpi_target-rationale-must-be-written) — the full wording guidance.

---

## 27. `no_competitor_hallucinations` (new 2026-05-13 — Flow D)

**Rule:** A `task_type='alert'` proposal whose `payload.alert_type` is one of (`target_drift`, `trending_angle`, `new_format`) or begins with `competitive_` — must include `payload.research` with:

- `sources[]` of length ≥ 2, each with `title` + `url` + `extracted` (one-line citation)
- `context_used[]` non-empty — the list of `business_knowledge` fields that shaped the search queries (`vertical`, `products`, `service_regions`, `competitors`)

**Why:** Flow D is WebSearch research on the market and competitors. The spec referenced this rule as a v2 placeholder ([campaigner-spec.md §14](../../docs/plans/campaigner-spec.md#14-guardrails)) — promoted to MVP when Flow D was added, because without deterministic enforcement the agent could write "competitors are using angle X" with no source and drag the business into hallucinated decisions. The cost of a hallucination here is large — they'd reject a proposal based on a fantasy, waste a week on a fabricated creative angle, or lower a KPI target based on a non-existent "industry average."

**How to replace:**
- Re-run WebSearch on the topic with more specific queries (including the vertical name in Hebrew + English, product name, region).
- If WebSearch returns only one result — expand the search or skip the finding. A single result isn't research.
- If you can't find ≥ 2 sources within Flow D's 12-query budget — log SKIP with `rationale="insufficient_sources_for_competitive_claim"`. **Do not propose the alert.**

**Exception:** Generic `alert_type` (not in the competitive category — e.g. `alert_type='budget_overrun'`, `alert_type='pool_misalignment'`) **does not apply**. This rule covers competitive claims only, not all alerts.

**Implementation:** in `_no_competitor_hallucinations` in [check_guardrails.py](../tools/check_guardrails.py). Same pattern as §26 set_kpi_target_requires_research, differing only in the trigger (task_type+alert_type) and not requiring `market_average` (doesn't apply here — competitive alerts aren't single-number value proposals).

---

## 28. `prefer_gallery_over_generation` (new 2026-05-13 — Block 8)

**Rule:** A `task_type='new_creative'` proposal is blocked if the gallery has ≥ 3 assets that haven't been used yet (viable, not deleted, not linked to any `executed` ad approval) **on the same channel**. Instead, the agent must propose `redeploy_creative` on the existing assets, or pass `payload.source_preference: 'generate_new'` to consciously override.

**Why:** Imagen costs ~$0.02 per image and Claude a fraction more for copy, but the real cost is opportunity. Every new creative the agent ships is one fewer slot for an asset you already paid for. §T9 (organic) already runs gallery-first; §T6.1 (first campaign) and §T_PE (empty pool) need to follow suit. Andromeda also prefers more active variants — so there's no reason to drop assets that were generated and left behind.

**How the agent complies in practice:**

1. **Pre-step — Gallery census** before proposing `new_creative` or `redeploy_creative`. In [`prompts/decision-tree.md`](decision-tree.md) §T_PE/§T6.1 — required:
   ```bash
   python -m campaigner.tools.list_active_creatives \
     --business-id $BUSINESS_ID \
     --unused-in-campaigns \
     --matches-channel <feed|stories|reels>
   ```
2. **Read** `viable_unused_count` from the output.
3. **Decision by threshold** (as described in §T_PE and §T6.1):
   - `N ≥ 3` (or 10 for first campaign) → propose `redeploy_creative` instead of `new_creative`.
   - `0 < N < 3` (or 1-9 for first campaign) → mixed: redeploy what exists + new for the remainder.
   - `N = 0` → propose `new_creative` normally.
4. The `payload` for `new_creative` must include `channel` (`feed` / `stories` / `reels`) so guardrail §28 can find the count for the right channel. Without `channel` — §28 returns `skipped:true` (doesn't fail, but the missing `channel` alone should signal to the agent that the target wasn't set).

**Explicit override:** Add `source_preference: 'generate_new'` to `payload`. Use only with justification — e.g. all N gallery assets were rejected in learning cycles, or the new campaign's angle is materially different from anything available.

**Implementation:** in `_prefer_gallery_over_generation` in [check_guardrails.py](../tools/check_guardrails.py). The context fetcher (`_fetch_context`) runs the SQL for `viable_unused_gallery_count_for_channel` when the payload contains `channel`. Otherwise — `skip`.

---

## 29. `ab_test_requires_min_creatives` (new 2026-05-13 — Block 11)

**Rule:** A `task_type='ab_test_setup'` proposal must include `payload.creatives` with **between 2 and 4 variants**. Fewer than 2 = nothing to compare; more than 4 = the sample per variant is too small to decide with confidence in a reasonable window.

**Why:** A formal A/B test needs at least two variants to compare. At the upper bound: Andromeda splits budget among variants, and 5+ variants means each gets less than 20% of budget — enough for sampling but not enough for a reliable decision within 7 days. More complex tests are better split into two sequential ones.

**Implementation:** in `_ab_test_requires_min_creatives` in [check_guardrails.py](../tools/check_guardrails.py). Checks `payload.creatives` only — if fewer than 2 or more than 4 → fail.

**How to replace:** Add another variant before proposing (if under 2), or split into two tests (if 5+).

---

## 30. `ab_test_min_window_7d` (new 2026-05-13 — Block 11)

**Rule:** A `task_type='ab_test_setup'` proposal requires `payload.window_days >= 7`. A `task_type='ab_test_decide'` proposal will be blocked if the decision time (`ab_tests.started_at + window_days`) hasn't been reached.

**Why:** Andromeda needs at least 7 days to split budget stably among variants. Deciding at 3-5 days relies on early-campaign fluctuations — not a real signal. This also aligns with §12 `require_95pct_significance_for_ab` (volume for reliability).

**Implementation:** in `_ab_test_min_window_7d` in [check_guardrails.py](../tools/check_guardrails.py). Two paths:
1. `ab_test_setup` — checks `payload.window_days >= 7`. fail otherwise.
2. `ab_test_decide` — checks that `ab_test_id` exists, status='running', and ≥ 7 days have passed since `started_at`. If less → fail with the message "מוקדם מדי, חכה עוד N ימים".

**Exception:** If `cancel_instead=true` is set on `ab_test_decide` — the rule doesn't apply. Cancellation is legitimate at any time.

**How to replace:** Increase `window_days` to 7+, or wait before proposing decide. If variants are *very* strongly differentiated early (margin > 50%, sample ≥ 1,000 per variant) — consider cancel + start_test from copy that already looks like a loser, instead of working around the 7-day window.

---

## 32. `rationale_has_approve_reject_footer` (new 2026-05-13 — response to operator frustration)

**Rule:** Every proposal — any `task_type` — must include in the rationale both strings `אישור` and `דחייה` (with a separator `=`/`—`/`:` within 5 characters after them). Missing one → fail.

**Why:** The UI shows "Approve" / "Reject" buttons with no additional context. Without the fixed lines "אישור = X, דחייה = Y" at the end of the rationale, the operator has to guess what each click does. Logged 2026-05-13: operator reported that an `alert` with rationale missing clear guidance caused them to be uncertain whether "Approve" was supposed to do something or just dismiss the alert.

**Implementation:** in `_rationale_has_approve_reject_footer` in [check_guardrails.py](../tools/check_guardrails.py). Simple regex: `r"אישור\s*[=—:]"` and `r"דחייה\s*[=—:]"`. Both must appear. Order doesn't matter (opening/closing — per the style guide [hebrew-copy-style.md §11 rule 7](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields), the lines go at the end).

**How to replace:** Add the two lines per the template in [hebrew-copy-style.md §11 task_type table](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields). Do not skip this even for `alert` (where it's most critical).

---

## 33. `alert_requires_acknowledgment_only_flag` (new 2026-05-13)

**Rule:** A `task_type='alert'` proposal requires `payload.acknowledgment_only === true`. Missing field, `false`, or wrong type → fail.

**Why:** `alert` is the only task_type with no Meta call or automatic DB update behind it. The UI needs to know that, in order to render a "Dismiss / Got it" button instead of "Approve / Reject" — otherwise the operator thinks they're approving an action when they're really just acknowledging. If there's a real action — use the correct task_type (`set_kpi_target`, `publish_*`, `boost_post`, `redeploy_creative`, `new_creative`, etc.), don't "hide" the action under alert.

**Implementation:** in `_alert_requires_acknowledgment_only_flag` in [check_guardrails.py](../tools/check_guardrails.py). Check: `prop.task_type != 'alert'` → skip; otherwise `payload.acknowledgment_only is True` → pass, otherwise fail.

**How to replace:** Add `"acknowledgment_only": true` to payload. If your reason for writing an alert is that there's an action — switch to a real task_type, don't "hide" the action under alert.

---

## 34. `rationale_paragraph_1_clean` (new 2026-05-13 — response to operator frustration)

**Rule:** The first paragraph of rationale (text until the first blank line, or the first 400 characters if there's no separator) shall contain none of the forbidden tokens listed in [hebrew-copy-style.md §11 forbidden table](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields).

**Code-enforced list** (in `_rationale_paragraph_1_clean`):

- **Metric acronyms:** `CPM`, `CTR`, `CPA`, `CPL`, `CPR`, `ROAS`, `CPC`, `CPI`.
- **Meta engine names:** `Andromeda`, `Advantage\+`, `Advantage Plus`, `Dynamic Creative`.
- **Meta states:** `LEARNING`, `LEARNING_LIMITED`, `LEARNING LIMITED`, `ACTIVE`, `INACTIVE`, `PAUSED`, `LIMITED`, `CAMPAIGN_LIMITED`.
- **English placement names** (Hebrew סטוריז/ריילז/פיד are allowed): `Stories`, `Reels`, `Feed`, `Right Column`, `Audience Network`.
- **CTA tokens:** `MESSAGE_PAGE`, `LEARN_MORE`, `SIGN_UP`, `SHOP_NOW`, `GET_OFFER`, `CONTACT_US`, `SEND_MESSAGE`.
- **Internal agent tokens:** `Flow A/B/C/D`, `dispatcher`, `tracking gate`, `tracking health`, `task_type`, `business_knowledge`, `monthly_brief`, `propose_task`, `execute_task`, `verify_pixel_capi`, `agent_decisions`, `approvals`, `.py`/`.sql`/`.md` suffixes.
- **Meta engineering:** `AEM`, `CAPI`, `Aggregated Event Measurement`, `Conversions API`, `Events Manager`, `Business Manager`, `Graph API`, `Marketing API`, `Pixel ID`.

**Why:** The first paragraph is the operator's first read. An operator without ad-platform background needs to understand what's proposed and decide approve/reject from a single paragraph. An English token = a stop to translate or skip. Logged 2026-05-13: an alert card the operator saw contained `Flow B`, `tracking gate`, `execute_task.py:225`, `verify_pixel_capi`, `AEM`, `Business Manager` in paragraph 1 — unreadable.

**Implementation:** in `_rationale_paragraph_1_clean` in [check_guardrails.py](../tools/check_guardrails.py). Splits the first paragraph by `\n\n` or 400 chars, runs a unified regex against the list above. Any hit → fail with the list of detected tokens. Case-sensitive for most (English words).

**How to replace:** Read your first paragraph and ask "would a business owner who never read marketing-101 understand this?" If not — translate to natural Hebrew. Acronyms are allowed in paragraph 2+ with a parenthetical gloss on first use.

---

## 37. `respect_prior_rejections` (new 2026-05-13 PM — feedback loop)

**Rule:** A new proposal that belongs to `(task_type, target_kind, target_id)` that was previously rejected with a substantive reason (not bulk-reset/anti-flood/system) within the last 60 days must satisfy one of two conditions:

1. **Explicitly cite the prior rejection in the rationale** and describe what changed — example: "ראיתי שדחית הצעה דומה ב-13.5 כי 'אין הסבר איזה שירות אני נותן'. הפעם הקופי ממוקד לשירות `service_tag=influencer_match` שמופיע ב-business_knowledge.products".
2. **If you can't materially differentiate** from the rejected proposal — skip and write `log_decision rejection rationale="respect_prior_rejection_no_meaningful_change"`.

**Why:** Until 2026-05-13 the agent didn't read prior rejections — it would repeat the same proposal every run. Operator Roi complained: "He doesn't learn that I said no." This is the rule that lifts the agent from a junior who repeats himself to a consultant who remembers.

**Implementation:** in `_respect_prior_rejections` in [check_guardrails.py](../tools/check_guardrails.py). The context fetcher (`_fetch_context`) runs SQL per proposal: how many non-bulk rejections exist in the last 60 days for the same `(task_type, target_kind, target_id)`. The rule reads the count + checks that the current rationale contains at least one of these indicators: `"דחית"`, `"דחיתי"`, `"דחיית"`, `"דחיה קודמת"`, `"הפעם שונה"`, `"השתנה"`, or a mention of a date within the last 60 days.

**How to replace:** Add a line to the rationale that cites the rejection and explains what changed. If you can't — skip.

**The tool that feeds the context:** [tools/load_feedback_history.py](../tools/load_feedback_history.py) — must run in Flow A Step 1.6 before proposing. If it didn't run, the guardrail returns `skipped:true`.

---

## 38. `new_campaign_payload_completeness` (new 2026-05-13 PM — response to operator frustration)

**Rule:** A `task_type='new_campaign'` proposal must have a payload containing every field needed to create a complete campaign in Meta (campaign + ad set + ad). Missing any of them → rejection.

**Required fields (by the 3 levels):**

At the campaign level:
- `campaign_name` (str, descriptive Hebrew name)
- `objective` (one of OUTCOME_LEADS / OUTCOME_TRAFFIC / OUTCOME_ENGAGEMENT / OUTCOME_SALES / OUTCOME_AWARENESS / OUTCOME_APP_PROMOTION)
- `special_ad_categories` (list — Meta requires an explicit declaration even if empty. Default for Aiweon: `[]`)
- `daily_budget_ils` OR `lifetime_budget_ils` (one of the two — not both)

At the ad set level:
- `adset_name` (str)
- `optimization_goal` (must match the objective; see decision-tree §T6)
- `billing_event` (almost always IMPRESSIONS)
- `targeting.geo_locations` (required by Meta — at minimum `countries:["IL"]`)
- `targeting.age_min` (required; minimum 18 in 2026)
- For OUTCOME_LEADS: `promoted_object.page_id`
- For OUTCOME_SALES / OFFSITE_CONVERSIONS: `promoted_object.pixel_id` + `promoted_object.custom_event_type`

At the ad level:
- `ad_name` (str)
- `creative_kind` ("image" or "video")
- `creative_source` — one of {`image_path`, `creative_gallery_id`, `video_path`, `existing_post_id`}
- `copy.headline` (≤ 40 chars)
- `copy.primary_text` (80-150 chars)
- `copy.cta` (Meta enum)
- `copy.link_url` (destination URL)
- `identity.page_id`

**Recommended fields (don't fail):**
- `bid_strategy` (default LOWEST_COST_WITHOUT_CAP but prefer to set explicitly)
- `spend_cap_ils` (above-the-baseline — recommended monthly_budget × 0.5)
- `targeting.targeting_automation.advantage_audience` (default 1 in 2026)
- `targeting.publisher_platforms` + positions (otherwise Meta auto-selects)
- `service_tag` (required for businesses with multiple services — Aiweon)
- `marketing_angle` (for internal documentation + tracking §T_PE)
- `hypothesis` (Hebrew sentence describing why the campaign will work)

**Why:** Until 2026-05-13 the new_campaign payload was open — the agent could propose "{campaign_name: 'X', daily_budget_usd: 50, ...}" with empty or missing targeting. The MetaClient would fail at execution time with an unclear API error, and the operator would approve without knowing what was missing. Now, if anything's missing, `check_guardrails` rejects at Flow A Step 4 and the operator sees a precise list of what's missing in the rationale.

**Implementation:** in `_new_campaign_payload_completeness` in [check_guardrails.py](../tools/check_guardrails.py). Checks the presence of every required field above and returns a precise list of what's missing.

**How to replace:** Complete the payload before proposing. If business info is missing (page_id, pixel_id) — call `load_business_knowledge` and pull from there. If copy is missing — generate it per `hebrew-copy-style.md §§2-9` (customer copy, not operator rationale).

---

## 39. `respect_active_plans` (new 2026-05-13 PM — "junior → consultant" #2)

**Rule:** If an active action plan (a forward step from a previous plan) exists on the same `target_id` within the last 21 days, the current proposal must satisfy one of:

1. **Advance the existing plan** — the rationale opens with a sentence that quotes your previous step, states whether its condition was met (or not), and explains how the current proposal is the next step in the plan. Example: _"בריצה מ-7.5 התחייבתי: 'אם הניצול עלה ל-80% — להציע sale_up'. הניצול עלה ל-87%. ההצעה הזאת היא הצעד הבא בתוכנית."_
2. **Explicitly skip** — if the situation has changed enough that the old plan no longer applies, don't propose a new action and write `log_decision skip rationale="active_plan_superseded — תוכנית X מ-7.5 כבר לא רלוונטית כי [הסיבה]"`.

**Not allowed:** Hitting a campaign that has an active plan with a new proposal that has nothing to do with the plan, **without mentioning it at all**. This is the classic junior mistake — forgetting what they said yesterday and proposing something different today without closing the loop.

**Why:** `load_active_plans` was added in Step 1.6, returning all open steps — but without the guardrail the agent could read and ignore. With §39, prompt-only memory becomes binding: operator Roi sees through the rationale that the agent picks up where it left off, not resetting every run.

**Implementation:** in `_respect_active_plans` in [check_guardrails.py](../tools/check_guardrails.py). The context fetcher (`_fetch_context`) runs SQL per proposal: is there an active plan (output of `load_active_plans` stored in `agent_decisions`)? If yes — checks that the current rationale contains at least one of these indicators: `"בריצה הקודמת"`, `"התחייבתי"`, `"תוכנית מ-"`, `"בתוכנית"`, `"הצעד הבא"`, `"כפי שאמרתי"`, `"כפי שתכננתי"`. Case-sensitive Hebrew matching.

**Skip cases:**
- `task_type='alert'` with `acknowledgment_only=true` → exempt (acknowledgment isn't an action).
- No active plan on this `target_id` → pass.
- No `target_id` at all (account-level) → skip with a note.

**How to replace:** Read the output of `load_active_plans` at the start of the run. For every campaign with an active plan — either propose the next step and reference the plan, or skip explicitly with `log_decision skip`. Don't propose anything else on that campaign without mentioning it.

---

## 41. `copy_must_match_brief_voice` (new 2026-05-13 PM — "customer copy" #1)

**Rule:** Customer-facing copy (headline / primary_text / description in the payload of `new_campaign`, `new_creative`, `redeploy_creative`, `boost_post` when the operator overrides copy) shall not contain any token from hebrew-copy-style §3's forbidden list (pan-Israeli + Aiweon-specific). Any occurrence → rejection.

**Distinction from §34:** §34 covers **operator rationale** (Roi reads). §41 covers **customer copy** (Aiweon's audience reads on Facebook/Instagram). Two different audiences, two different forbidden lists with some overlap.

**Lists the rule checks (case-sensitive for most):**

- pan-Israeli spam: `לחץ כאן`, `מוגבל בזמן!`, `הזדמנות של פעם בחיים`, `מהפכה`, `פריצת דרך`, `בלעדי`, `!!!`, `???`, `חינם!!`, `רק היום`.
- Aiweon-specific (§3 hard-ban): superlatives `המוביל`, `מספר 1`, `הטוב ביותר`, `פורץ דרך`, `מהפכני`; specific-ROI claims `X3 לידים`, `חיסכון של %`, `פי N מכירות`; marketing-ese `פתרון 360`, `end-to-end`, `holistic`, `ecosystem`, `synergy`, `workflow`, `funnel`, `engagement` (transliterated).
- **AI overuse:** the word "AI" or "בינה מלאכותית" may appear **once** per copy block. Two occurrences → rejection.

**Why:** Until 2026-05-13 PM the copy the agent proposed was written per the §§2-9 rules, which were prompt-only. `compose_copy_brief` now ships a deterministic list — but without a guardrail to check the output, the agent could "forget" and propose copy the operator would have to reject manually. §41 turns the style guide into binding enforcement.

**Implementation:** in `_copy_must_match_brief_voice` in [check_guardrails.py](../tools/check_guardrails.py). Locates copy fields in each payload by task_type (`payload.copy.headline`, `payload.copy.primary_text`, `payload.copy.description`; for `new_creative`: `payload.headline`, `payload.primary_text`). Runs regex on each.

**Skip cases:**
- `task_type` that doesn't create/modify copy: `alert`, `scale_up`, `scale_down`, `expand_audience`, `set_kpi_target`, `pause_*`, `resume_*`, etc.
- `boost_post` without copy override → skip (inherits copy from the organic post that was already approved earlier).

**How to replace:** If you got a rejection, read which token you failed on — it appears in `forbidden_tokens_in_copy`. Translate per `compose_copy_brief` opening pattern or the §3 substitution table. Do not "solve" it by pushing the token into the rationale instead of the copy — the audience only reads the copy.

---

## 31. Rules deferred to v2

Not implemented in MVP — listed for architectural placement:

- `remarketing_min_budget_ils` — remarketing ≥ ₪50/day even in a weak season
- `external_source_allowlist` — trusted domains only (for tools that consume web research)

---

## Hebrew rejection template

```
סיבה: <rule_name>
הקמפיין/קריאייטיב: <id>
הממצא: <מה נמצא שמפר את הכלל>
למה הכלל חל: <1-2 משפטים>
מה הייתי ממליץ במקום: <חלופה אם קיימת, או "אין פעולה מותרת כרגע">
```
