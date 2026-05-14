# Campaigner Decision Map — What a Senior Meta Performance Brain Decides

> **Purpose.** This document is the single source of truth for the full decision space of the Campaigner agent brain. It maps every category of decision a senior Meta performance marketer makes, the mechanisms that implement each decision, which mechanisms are already built, which are shipping in the current plan ([cheeky-seeking-blossom.md](cheeky-seeking-blossom.md)), and which are deferred to backlog tiers 2 and 3.
>
> **Maintenance rule.** When a new mechanism is proposed, add it here FIRST with a tier. Never let a mechanism live only in a plan file — plans get archived, this map persists.

---

## 1. The 10-layer decision space of a senior Meta campaigner

| Layer                              | Decisions the brain must be able to make                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1 — Strategy / intent**         | What business objective am I serving this month? What offer is active? What's the funnel stage? What's the seasonal context? What's the budget envelope? |
| **L2 — Account architecture**      | How many campaigns? CBO vs ABO? Which optimization event? Which bid strategy? Manual vs Advantage+ placements? Attribution window?                       |
| **L3 — Audience**                  | Broad vs narrow in cold start? Advantage+ Audience vs saved/lookalike? Exclusions? Cannibalization between ad sets?                                      |
| **L4 — Creative**                  | Hook/angle, format (image/video/mix), ratios, variation count, material diversity, copy voice, CTA, landing destination                                  |
| **L5 — Budget & pacing**           | Scale up/down timing & magnitude, emergency pause vs cooldown, inter-campaign reallocation, monthly burn, creative-refresh reserve                       |
| **L6 — Measurement & attribution** | Is the Pixel/CAPI healthy? Right optimization event given volume? Attribution window coherent with sales cycle? MER/Entity-ID testing?                   |
| **L7 — Account health**            | Policy violations, review warnings, token expiry, billing, business-verification status, auction cannibalization against self                            |
| **L8 — Off-platform**              | Landing page speed, form completion rate, message-match, mobile responsiveness, tracking-event firing                                                    |
| **L9 — Ops workflow**              | When to involve the operator, alert severity, reconciling contradictory proposals within a single run, hands-off campaigns                               |
| **L10 — Institutional learning**   | Pattern extraction from winners/losers, baseline drift, hypothesis/experiment tracking, revisiting stale assumptions                                     |

---

## 2. Mechanism catalog — 12 mechanisms, with tier & status

Legend:

- **in_plan** — shipping in [cheeky-seeking-blossom.md](cheeky-seeking-blossom.md)
- **backlog_tier_2** — high-value, defer until tier 1 is stable and Aiweon is out of cold-start
- **backlog_tier_3** — defer to v2 (second ad account onboarding trigger)
- **done_already** — already in codebase pre-plan (reference only)

### Tier 1 — shipping now

| ID  | Mechanism                  | Layer(s) | Status  | Why it's urgent                                                                                                                                                               | Target file(s)                                                                           |
| --- | -------------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| M1  | Tracking Health Gate       | L6       | **done** (2026-05-12) | If Pixel/CAPI is broken, every downstream metric lies. Brain will otherwise recommend action on untrusted data. First link in the causal chain of diagnosis.                  | `campaigner/tools/check_tracking_health.py` (built); `CAMPAIGNER.md` Flow A Step 0.5 (added); §17 guardrail extended to block scale_up / new_creative / expand_audience |
| M2  | Monthly Brief layer        | L1       | in_plan | PERSONALITY.md mandates "ask intent before recommending." No structured place today for active offer, deadline, hands-off flags. Brain optimizes toward wrong KPI without it. | `businesses.monthly_brief jsonb`, `load_business_knowledge.py`, `/business-knowledge` UI |
| M3  | Budget Utilization Receipt | L5       | in_plan | PERSONALITY.md mandates "check utilization before touching budget." ₪30/d that spent ₪19 in 4d ≠ ₪30/d that spent ₪120 — totally different problems.                          | `campaigner/tools/check_utilization.py`, rule in `guardrails.md`                         |

### Tier 2 — backlog (post-tier-1 stability)

| ID  | Mechanism                                      | Layer(s) | Status         | Why deferred                                                                                                                                                                        | Rough design                                                                                                                            |
| --- | ---------------------------------------------- | -------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| M4  | Landing Page / Funnel Health signal            | L8       | backlog_tier_2 | Needs external probe or GA/hotjar integration. High value for B2B lead forms but out of MVP scope.                                                                                  | Lightweight tool fetching click-to-lead ratio from Meta; if below threshold, block `new_creative` proposals and raise `alert` instead   |
| M5  | Attribution Event Policy (low-volume fallback) | L6       | backlog_tier_2 | Cold-start accounts have <5 purchases/mo; optimizing for purchase is wrong choice. Need a policy that steps up the funnel (AddToCart → ViewContent → Leads) based on weekly volume. | Rule in `performance-brain.md`: if `conversions_7d < 20` → recommend event-swap proposal to lower-funnel event                          |
| M6  | Portfolio / Cannibalization Detection          | L2, L3   | backlog_tier_2 | Less relevant for Aiweon's single-campaign cold start. Becomes critical at 3+ active ad sets with overlapping audiences.                                                            | `tools/detect_audience_overlap.py` — compute audience overlap % between active ad sets; warn if >30%                                    |
| M7  | Proposal Bundle Reconciliation                 | L9       | backlog_tier_2 | Currently each proposal is standalone; a single run might produce "add creative" + "pause ad set" + "scale budget" for the same ad set. Needs a reconciliation step in Flow A.      | New step: after propose_task round, scan same run_id proposals for same target_id; apply precedence rules before writing to `approvals` |

### Tier 3 — backlog (v2 / multi-account)

| ID  | Mechanism                             | Layer(s) | Status         | Why deferred                                                                                                            |
| --- | ------------------------------------- | -------- | -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| M8  | Policy Violation Risk Pre-check       | L7       | backlog_tier_3 | Only relevant when brain generates creative automatically at volume. Manual-upload dominant workflow today.             |
| M9  | Do-nothing / Counterfactual Reasoning | L9, L10  | backlog_tier_3 | "Would Andromeda self-correct if we do nothing?" — hard to implement without historical A/B baseline per campaign.      |
| M10 | Hypothesis / Experiment Tracker       | L10      | backlog_tier_3 | Each 3-5 variant batch is a hypothesis. Full experiment tracking is a separate product surface.                         |
| M11 | Benchmark Drift Detection             | L10      | backlog_tier_3 | `target_cpa` set 6 months ago may no longer fit the market. Requires time-series baselines and periodic review cadence. |
| M12 | Hands-off Protected Campaign Flag     | L9       | backlog_tier_3 | Partially covered by M2 `monthly_brief.hands_off_campaign_ids`. Full "protected" semantics (no observe, no log) is v2.  |

### Already in codebase (reference only)

| Mechanism                                                               | Layer(s)   | Location                                                               |
| ----------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| Two-gate evaluation (Gate 1 leading 48h-7d, Gate 2 lagging post-50conv) | L4, L10    | `campaigner/prompts/performance-brain.md`, `check_data_sufficiency.py` |
| 13 hard guardrails (deterministic)                                      | L2–L9      | `campaigner/prompts/guardrails.md`, `check_guardrails.py`              |
| Decision-tree T0–T6 (per-campaign diagnosis)                            | L2, L4, L5 | `campaigner/prompts/decision-tree.md`                                  |
| Learning-phase caution (`no_learning_phase_touch`)                      | L2, L4     | `guardrails.md §3`, `check_guardrails.py:78-85`                        |
| HITL approval queue (pending → approved → executed)                     | L9         | `approvals` table, `propose_task.py`, `execute_task.py`                |
| Anti-flood cap (5 proposals/day for ₪50-500 budget)                     | L9         | `CAMPAIGNER.md §5`                                                     |
| `agent_decisions` audit trail                                           | L10        | `agent_decisions` table, `log_decision.py`                             |
| Monthly pacing                                                          | L5         | `compute_monthly_pace.py`, `seasonal.py`                               |
| Creative firehose model (10-50+ diverse, 3-5/wk adds)                   | L4         | `creative-guide.md §1-3`                                               |
| Meta Creative Fatigue flag (CPR ≥ 2× baseline)                          | L4         | `performance-brain.md §5`, `decision-tree.md §T1`                      |
| Heartbeat liveness (3-failure alert)                                    | L9         | `heartbeats` table, `heartbeat.py`                                     |

---

## 3. How top practitioners think — synthesis

Based on research into senior Meta performance marketers (Charley Tichenor, Depesh Mandalia, Pilothouse Digital, Dara Denney, Barry Hott). Principles below inform both the plan and the backlog prioritization.

### P1 — "Creative is the new targeting" (Tichenor)

Under Andromeda, creative signals drive which auctions you enter and which users you reach. **Diagnose creative first**, audience/budget second. A weak hook will not be fixed by "widen the audience."
→ Implemented in CDP §2, §4 (diversity on 2 of 4 axes).

### P2 — Liquidity & Natural CAC (Tichenor)

Every market has a natural CAC floor. If your budget × available audience doesn't support that floor, no optimization will win. **Check liquidity before recommending scale.**
→ Informs M3 (utilization) and will inform M6 (cannibalization) in tier 2.

### P3 — Range × Diversity beats Volume (Pilothouse 3-3-3)

10-25 creatives that vary on 3 real dimensions × 3 options = 27 combinations beat 50 near-duplicates. Diversity is _material_ (hook, subject, format, offer), not _cosmetic_ (color, font).
→ Directly implemented in CDP §4.

### P4 — Brief-first, metric-second (Mandalia)

Start from the monthly business objective and work backwards to creative and structure. Metric targets without an intent are optimization theatre.
→ Implemented in M2.

### P5 — Symptom-vs-Cause layering (Hott/Denney)

CTR drop is a symptom. The cause is one of: creative fatigue, audience saturation, Pixel/tracking issue, offer mismatch, LP breakage, seasonal shift, competitor surge. Walk the chain before prescribing.
→ First link in chain is M1 (tracking health). Second link will be M4 (LP health) in tier 2.

### P6 — Do-nothing-first

Andromeda often self-corrects within 48-72h. Many "urgent" alerts resolve themselves. The question "would it recover if we did nothing?" is a legitimate first answer.
→ Deferred as M9 tier 3 because it requires historical baseline per campaign.

### P7 — One change at a time

Changing budget + audience + creative in the same edit destroys attribution of which change caused the outcome. Andromeda's learning phase penalty compounds.
→ Partially enforced by guardrails today; fully by M7 (reconciliation) in tier 2.

### P8 — Receipts not opinions

"CTR is bad" → needs the number, the baseline, the delta. PERSONALITY.md binds this as voice; M3 binds it as mechanism for budget claims.
→ M3 (utilization receipt) is the first formal receipt-enforcement mechanism.

---

## 4. Promotion rules (when to move an item from backlog to a plan)

- **Tier 2 → active plan** when at least two of:
  - Aiweon is out of cold-start (conversions_30d ≥ 50)
  - A specific incident has been attributed to the missing mechanism
  - The operator has requested it explicitly
  - A second ad account has been onboarded
- **Tier 3 → active plan** when a second ad account is onboarded (v2 migration trigger per CLAUDE.md).

Every promotion must update this doc first, then the new plan file.

---

## 5. Revision log

| Date       | Author           | Change                                                                               |
| ---------- | ---------------- | ------------------------------------------------------------------------------------ |
| 2026-04-23 | Campaigner + Roi | Initial map. 12 mechanisms catalogued; M1-M3 in tier 1; M4-M7 tier 2; M8-M12 tier 3. |
| 2026-05-12 | Campaigner + Roi | M3 (Budget Utilization Receipt) shipped — §T-1 gate in decision-tree.md. Added §T0r top-level router + new lanes §T2+ (scale-up with marginal-return guard + cadence cap), §T_SD (scale-down -15%/step), §T_PE (creative pool exhausted), §T_HO (hands-off with explicit sub-branches). 6 new guardrails (rules 19-24). Promoted P2 (Liquidity / marginal return) from deferred research-only to enforced via `marginal_return_check_before_scale_up` guardrail. P6 (Do-nothing-first) elevated from M9 tier-3 to operational via §T_HO post_edit_cooldown 72h. Implementation is prompt-level; deterministic Python checks deferred (still in_plan). |
| 2026-05-12 | Campaigner + Roi | **Block 1 (data inputs):** migration 019 added `target_cpa_ils` / `target_cpl_ils` / `target_roas` on `businesses`. `load_business_knowledge.py` now returns `kpi_target` convenience block (which target matches the active KPI). New tool `fetch_meta_state.py` exposes object-level `status` / `updated_time` / `daily_budget` (insights doesn't). New tool `check_marginal_return.py` implements §T2+ Pre-check 1 by hitting `approvals` + two Meta windows. `fetch_insights --with-prior-window` returns delta_*_pct for CPM-trend / marginal-CPM guard. UI `/business-knowledge` gained "יעדי ביצוע" card with 3 inputs. |
| 2026-05-12 | Campaigner + Roi | **Block 2 (execution):** Removed `new_creative` and `expand_audience` from UNSUPPORTED_MVP. `execute_task.py` now dispatches both via `MetaClient.upload_image + create_image_creative + create_ad` and the new `MetaClient.update_targeting`. Added `alert` to `propose_task.VALID_TASK_TYPES` (informational, no Meta call — acknowledgement-only). `set_kpi_target` web-side handler + DB method `setKpiTarget` were wired in parallel; execute_task dispatches a defensive no-op for completeness. CAMPAIGNER.md task-type list and Known MVP Limitations both updated. §T_PE in decision-tree no longer carries the "use new_campaign instead" stale workaround. |
| 2026-05-12 | Campaigner + Roi | **Block 3 (UI surfaces):** approvals/[id] rationale now parses `**תוכנית:**` heading per hebrew-copy-style §11.6 and renders the work plan as a numbered callout (brand-color box, circle-numbered steps) — separate visual treatment from the rest of the "why?" prose. New `parsePlanSection` + `parsePlanSteps` helpers in `approvals-fmt.ts` with 11 vitest cases. `/history` page split into two tabs: "אישורים" (existing approvals table) and "פעילות שקופה של הסוכן" — feed of skip/rejection/route-diagnosis decisions from `agent_decisions`. New DB method `listAgentActivity(businessId, days)` filters to the operator-relevant decision types. DecisionRow component reused (already shows guardrail_violations as chips and rationale text). |
| 2026-05-12 | Campaigner + Roi | **KPI editor live verdict:** the /business-knowledge "יעדי ביצוע" inputs were 3 plain numbers with static band text. Replaced with `KpiTargetEditor` client component — live verdict badge ("מעל הממוצע" / "בטווח" / "מתחת לממוצע" / "לא ריאלי") that updates per keystroke via `classifyAgainstBenchmark(value, kpi, getBenchmark(vertical, kpi))`. Operator sees "this number is sane / not sane for my vertical" before saving instead of after. |
| 2026-05-12 | Campaigner + Roi | **Block 4 (M2 Monthly Brief shipped):** migration 020 adds `businesses.monthly_brief jsonb` with shape `{month, active_offer, deadline_date, hands_off_campaign_ids, notes}`. `load_business_knowledge.py` now returns the brief + `monthly_brief_summary` convenience block with `is_current_month` staleness flag (computed in Asia/Jerusalem). New `setMonthlyBrief()` on DataClient + local-postgres + supabase stub. /business-knowledge gained a "תכנון חודשי" card with 4 inputs (active offer, deadline date, hands-off campaign IDs CSV, free notes). Server-stamps `month` to current Asia/Jerusalem YYYY-MM. CAMPAIGNER.md Flow A Step 1 updated to read the brief and either quote it back, flag stale, or note missing in rationale. New guardrail §25 `respect_hands_off` blocks structural proposals on campaigns the operator explicitly fenced off. PERSONALITY non-negotiable #4 ("ask intent before recommending") now has its structural mechanism. |
| 2026-05-12 | Campaigner + Roi | **Block 5 (fatigue + pool count + guardrail enforcement):** Two new tools — `check_creative_fatigue.py` (per-ad CPR current vs prior 7d ≥ 2× → flag; surfaces aggregate `any_fatigue` + `active_with_impressions_count` for §T0r R4 / §T_PE) and `list_active_creatives.py --with-performance` (joins gallery rows with ad-level insights via meta_creative_id; impressions ≥ 100 = active). `check_guardrails.py` extended from 13 to 20 deterministic checks — 7 new functions for guardrails 19-25. New context fetchers `scale_ups_last_7d_on_target` and `scale_downs_last_14d_on_target` query `approvals` for cadence enforcement. Decision-tree §T0r inputs table updated to point at the now-real tool names; CAMPAIGNER.md tool readiness reflects new state. Block 5 close-out (same date): `tests/tools/test_guardrails_block5.py` with 31 unit cases covering rules 19-25; CAMPAIGNER.md Step 1 documents the per-task state-key assembly for `check_guardrails`. |
| 2026-05-12 | Campaigner + Roi | **Block 6 (M1 Tracking Health Gate):** New tool `check_tracking_health.py` reads operator-attested `business_knowledge.tracking_*` fields and emits `status: healthy \| partial \| unverified \| unknown` + `blocks_proposals` list. CAMPAIGNER.md Flow A gets a new **Step 0.5** that runs the check before signal-pulling — when status≠healthy the agent emits a `verify_pixel_capi` proposal and adds `tracking_status` to every diagnose decision's `inputs` so downstream consumers see the data is unverified. Guardrail §17 `verify_tracking_infrastructure` extended to block `scale_up`, `new_creative`, and `expand_audience` (was: `new_campaign` only) — burning budget on untracked campaigns is the same waste regardless of whether it's new or scaled. Guardrail now prefers `state.tracking_health_status` over raw `state.tracking_verified` flag. `tests/tools/test_guardrails_block6.py` with 12 unit cases covering the expanded blocked-task list + status preference. Promoted M1 from `in_plan` to `done`. v2: live Meta Pixel event-rate + match-quality + last-seen check (deferred). |
| 2026-05-13 | Campaigner + Roi | **Block 7 (gallery→campaign loop, partial):** Closes the largest brain gap per the 2026-05-12 audit (memory: `project_gap_gallery_to_campaign_loop`). Three deliverables: (1) new task_type `boost_post` in propose_task + execute_task (wraps Meta's `object_story_id` pattern via new `MetaClient.create_creative_from_post` — promotes an existing organic post as an ad, inherits its reactions/comments/shares as social proof, cheaper than `new_creative` from scratch). (2) new tool `check_organic_performance.py` reads `approvals.external_post_id` posts in last 14d, classifies viral / solid / underperformer / insufficient_data against engagement-rate baseline (default 2.5% for IL 2026), returns `boost_candidates` list. (3) new decision-tree lane **§T9.1 Post-Promote** runs after §T9 organic cadence — emits `boost_post` (high urgency) on viral posts, `alert` (medium urgency) when 3+ underperformers share a marketing_angle. CAMPAIGNER.md Flow A Step 1 + task-type list updated; tools/CLAUDE.md catalog updated. **MVP scope:** live Meta organic-post insights (page-token Graph calls) deferred to v2 — `check_organic_performance` returns the right shape with zero-filled metrics + a `meta_error` note. The classification logic, §T9.1 lane, `boost_post` execute path, and downstream guardrail interactions (§17 tracking, §25 hands-off) are all wired so v2 just plugs in the live read. |
| 2026-05-13 | Campaigner + Roi | **Block 8 (live organic post insights):** Closes the v2 gap from Block 7. New `fetch_post_insights(network, post_id, page_access_token, is_reel)` in `page_publishing.py` makes raw Graph calls per network: FB uses `/{post_id}/insights` (post_impressions, post_impressions_unique) + base post fields for reactions/comments/shares totals via summary edges; IG image/carousel uses `/insights?metric=impressions,reach,engagement` + base fields for like_count/comments_count; IG reels swap the metric set to `plays,reach,total_interactions,comments,shares,saved`. Output normalized to `{impressions, reach, reactions, comments, shares, saves, video_views, meta_error}` regardless of network. `check_organic_performance.py` resolves the right Page Access Token via `page_tokens.get_publishing_target` (FB direct, IG falls back through linked Page) and calls the new helper per post; token cache keyed per (business, network) so one DB hit per network per run. The §T9.1 lane now sees real engagement numbers and fires `boost_post` proposals on actually-viral posts. |
