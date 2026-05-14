# Findings Diff — Spec §6 vs. Deep Research (Grok + Manus)

> **Purpose:** Map every concrete claim in the current spec against the two 2026 deep research outputs (Grok 2026-04-15, Manus 2026-04-16). Each row gets a status: **CONFIRMED**, **UPDATED**, **DEPRECATED**, or **MISSING**. Recommended new value is given where applicable.
>
> **How to use:** This is the canonical input for rewriting spec §6 (Performance Brain), §7.2 (Creative Testing Matrix), §17 (Decision Tree), and parts of §3 (Meta Ads 2026 research). The rewrite becomes mechanical — apply the "New Value" column, cite the sources already listed here.
>
> **Sources referenced:**
>
> - **Grok** → `docs/deep_research/grok-meta-evaluation-andromeda-2026-04-15.md`
> - **Manus** → `docs/deep_research/manus-meta-evaluation-andromeda-2026-04-16.md`

---

## Legend

| Status        | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| ✅ CONFIRMED  | Spec value aligns with 2026 consensus — keep as is                  |
| 🔄 UPDATED    | Spec value needs a concrete new number / threshold                  |
| ❌ DEPRECATED | Spec value is actively misleading in the Andromeda era — remove     |
| ⚠️ NUANCE     | Principle holds but needs a qualifier                               |
| ➕ NEW        | Research introduces a rule the spec currently lacks — add           |
| ❓ OPEN       | Neither source resolves this — needs Business Knowledge or A/B test |

---

## 1. Spec §6.1 — Goal Hierarchy (KPI per vertical)

| Spec claim                                    | Research finding                                                                      | Status       | Recommended new value                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| eCommerce ROAS > 1.93x (median), target 2.5x+ | 2025 Triple Whale median ROAS = **1.86** (down 4%); 2026 Adamigo Sales ROAS ~**2.79** | ✅ CONFIRMED | Keep principle. Update median ref to **ROAS 1.86-2.79 by source; target 2.5x+**                                  |
| Leads: CPL baseline per account               | Adamigo 2026 median CPL $27.66 globally; **Israel CPL $104.72** (2.5× global)         | 🔄 UPDATED   | Keep "per-account baseline" principle but **add explicit warning that global CPL benchmarks mislead for Israel** |
| Awareness CTR > 1.4%                          | 2025 Triple Whale median CTR **2.19%** (+13.5% YoY); 2026 Adamigo traffic CTR 1.71%   | 🔄 UPDATED   | Raise threshold to **CTR > 1.7% (traffic), > 2.1% (sales)**                                                      |

**Action:** Update §6.1 KPI table to cite 2026 primary-source medians explicitly. Emphasize that these are _reference points_ — the agent acts on per-account rolling baseline, not absolute thresholds.

---

## 2. Spec §6.2 — Relative Comparison / Baselines

| Spec claim                                 | Research finding                                                                                                                     | Status       | Recommended new value                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "'טוב' זה יחסי — not absolute"             | Both sources explicitly confirm rolling account baselines (7/14/30-day) as the right methodology                                     | ✅ CONFIRMED | Keep                                                                                                                                                                                    |
| Israel benchmarks "30-50% cheaper than US" | **PARTIALLY FALSE.** Israel CPM ~$8.38 (low vs global $20.15), but **CPL $104.72 (2.5× global $41.53)**, with wartime spikes to $385 | 🔄 UPDATED   | **Replace §3.4 + §6.2 Israel note:** "Israel CPM runs ~40% below global; Israel CPL runs ~2.5× global with severe security-event volatility. Never extrapolate from global benchmarks." |
| 30/60/90-day windows                       | Both sources recommend **7 / 14 / 30-day** rolling baselines (not 60/90)                                                             | 🔄 UPDATED   | Change to **7 / 14 / 30-day windows** — faster reactivity is the 2026 norm                                                                                                              |

---

## 3. Spec §6.3 — Learning Phase Logic

| Spec claim                                | Research finding                                                                                                | Status       | Recommended new value                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| 50 conversions in 7 days (ad set)         | **Both sources: still accurate** — Meta Business Help Center confirms as of 2026                                | ✅ CONFIRMED | Keep exactly as is                                                                                                 |
| Budget-resetting edit: >20% change        | **Both sources: still accurate** — Meta has not relaxed                                                         | ✅ CONFIRMED | Keep                                                                                                               |
| Audience change resets learning           | **Both sources: confirmed**                                                                                     | ✅ CONFIRMED | Keep                                                                                                               |
| Creative swap resets learning             | **Both sources: confirmed** — but Grok adds: _adding_ a creative to existing ad set does NOT reset if done well | ⚠️ NUANCE    | Add clarifier: "Creative _replacement_ resets; creative _addition_ to an ad set with ≥10 creatives often doesn't." |
| Scaling: 20-30% every 2-3 days max        | Both confirm; Grok notes Andromeda may tolerate larger jumps safely, but practitioners still default to 20%     | ⚠️ NUANCE    | Keep 20% as default; allow guardrail override up to 30% when hook rate > 35% and frequency < 2.0                   |
| Budget formula: `(expected_CPA × 50) / 7` | Both confirm — Manus gives identical formula example                                                            | ✅ CONFIRMED | Keep                                                                                                               |
| Learning Limited triggered after 14 days  | Neither source specifies "14 days" — Meta says "if not projected to exit learning"                              | ⚠️ NUANCE    | Change to **"after 7 days without 50 conversions AND no upward trend in volume"**                                  |

---

## 4. Spec §6.4 — Data Sufficiency Check

| Spec claim                                           | Research finding                                                                               | Status       | Recommended new value                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| Wait 72 hours before decisions                       | Research: **500-1000 impressions + 50-100 clicks** is the volume threshold; days are secondary | 🔄 UPDATED   | Replace time-based with **volume-based**: "≥1000 impressions AND ≥50 clicks before any CPA/CTR judgment" |
| 1,000-2,000 impressions minimum                      | **Both sources: 500-1,000 is the practitioner floor**                                          | 🔄 UPDATED   | Lower to **≥1,000 impressions** (keeps it safer)                                                         |
| Emergency exception: CPA 3× target = "burning money" | Both sources confirm: some operators use "2-3× target CPA" as immediate kill                   | ✅ CONFIRMED | Keep — this is the single justified early-kill trigger                                                   |
| _(missing)_ — statistical significance               | **Research: 95% significance standard among top operators before A/B decisions**               | ➕ NEW       | Add: "For A/B test winner declarations, require 95% confidence (or equivalent sample-size threshold)"    |
| _(missing)_ — days-without-conversion kill           | **Research: 3-7 days (budget-dependent) is common practitioner kill rule**                     | ➕ NEW       | Add: "Kill creative if spent ≥1× daily budget with 0 conversions for 3-7 days"                           |

---

## 5. Spec §6.5 — Metric Hierarchy Table

**THIS IS THE LARGEST SINGLE CHANGE.** The research unanimously says the spec's priority order is post-hoc / lagging-only. For live agent decisions, early-signal metrics must come first.

| Spec priority | Spec metric             | Research position                                                                                                          | Status                                  |
| ------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1 (critical)  | CPA                     | Research: CPA is **lagging only**, reliable after 50 conversions. Not the first thing to check.                            | 🔄 UPDATED (demote from "early signal") |
| 2 (stability) | ROAS                    | Same — lagging only                                                                                                        | 🔄 UPDATED                              |
| 3 (quality)   | CTR > 1.5% / < 0.8%     | Research CTR median **2.19%**; Grok suggests "CTR > 2% strong, < 1% weak"                                                  | 🔄 UPDATED                              |
| 4 (video)     | Hook Rate > 30% / < 15% | Research: **> 35% strong, 25-35% solid, < 25% = immediate kill**                                                           | 🔄 UPDATED + **PROMOTE**                |
| 5 (fatigue)   | Frequency < 2.5 / > 3.0 | Research: **Frequency is monitoring-only, not a trigger.** Meta's Creative Fatigue flag (CPR ≥ 2× historical) replaces it. | ❌ DEPRECATED as trigger                |

### Recommended new hierarchy (rewrite of §6.5)

Split into two tables to reflect the two-gate evaluation model:

**Gate 1 — Leading signals (48h-7d window, creative-level kill decisions):**

| Priority | Metric              | Good  | Kill trigger                |
| -------- | ------------------- | ----- | --------------------------- |
| 1        | **Hook Rate (3s)**  | > 35% | < 25% after 48h             |
| 2        | **CTR** (early)     | > 2%  | < 1% with ≥1000 impressions |
| 3        | **Thumb-stop rate** | > 30% | < 20% after 48h             |

**Gate 2 — Lagging signals (post-learning, campaign-level kill/scale):**

| Priority | Metric                          | Good        | Kill trigger              |
| -------- | ------------------------------- | ----------- | ------------------------- |
| 1        | **CPA**                         | ≤ target    | > 1.3× target for 5+ days |
| 2        | **ROAS**                        | ≥ breakeven | < breakeven profitability |
| 3        | **Meta Creative Fatigue flag**  | Not flagged | CPR ≥ 2× historical       |
| 4        | **Frequency** (monitoring only) | —           | Not a trigger on its own  |

---

## 6. Spec §6.6 — Good/Bad Rules After Learning

| Spec claim                                                    | Research finding                                                    | Status        | Recommended new value                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| Winner: KPI > baseline + 20% for 3+ days → scale 20-30%       | Both confirm — Grok adds: trailing 5-7 days stable preferred over 3 | ⚠️ NUANCE     | Change to **"for 5-7 days" instead of "3+ days"**                                                                 |
| Average: KPI ±15% of baseline → monitor                       | Confirmed — no change                                               | ✅ CONFIRMED  | Keep                                                                                                              |
| Loser: KPI < baseline - 20% for 5+ days → pause/swap creative | Grok: **CPA > 1.3× target for 5+ days** is the specific kill rule   | 🔄 UPDATED    | Make it numeric: "CPA > 1.3× target for 5 days, OR Creative Fatigue flag triggered"                               |
| Audience Fatigue: Frequency > 3 → refresh/expand              | **Both sources: DEPRECATED as auto-trigger**                        | ❌ DEPRECATED | Replace with: "Refresh triggered by CPR ≥ 2× historical baseline (Meta Creative Fatigue flag), NOT raw frequency" |

---

## 7. Spec §7.2 — Creative Testing Matrix

| Spec claim                                | Research finding                                                                                       | Status                  | Recommended new value                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3-5 hooks × 2-3 variants = 9-15 creatives | **Research: 10-50+ distinct creatives per ad set** is the 2026 norm                                    | ❌ DEPRECATED (too few) | Raise to **10-50+ distinct creatives**. Minimum viable: 10. Optimal: 25+.                                                                           |
| "After 5-7 days of testing, keep top 3-5" | Research: Meta auto-distributes spend unevenly; **don't prune manually** — let Andromeda starve losers | ❌ DEPRECATED           | Remove manual pruning. Replace with: "Add new creatives continuously; let Meta allocate spend. Kill only creatives with hook rate < 25% after 48h." |
| Spec §7.1 "5-10 copy variants"            | Same volume principle — 10-50+ total creative assets (copy × image combos)                             | 🔄 UPDATED              | Raise to 10-20 copy variants per campaign                                                                                                           |

---

## 8. Deprecated rules to ADD to spec §22 or new §6.7

Both sources explicitly flag these pre-2024 rules as actively misleading. The spec should call them out so future developers/prompt-writers don't reintroduce them:

| Deprecated rule                                                    | Source agreement                 | What replaces it                                                    |
| ------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------- |
| "1 ad set = 1 ad" structure                                        | Both                             | Fewer ad sets, 10+ ads per ad set                                   |
| Rigid TOFU / MOFU / BOFU funnel separation into distinct campaigns | Both                             | Single Advantage+ campaign; Meta's AI handles funnel stage matching |
| Manual placement optimization (Feed vs Stories vs Reels)           | Both                             | Provide all aspect ratios (1:1, 4:5, 9:16); let Meta decide mix     |
| Horizontal scaling via duplication                                 | Both (explicit: resets learning) | Vertical scaling (budget within existing campaign)                  |
| Narrow interest-based targeting                                    | Both                             | Broad targeting + diverse creatives — Andromeda finds the audience  |
| Frequency > 3 as auto-kill                                         | Both                             | Meta Creative Fatigue flag (CPR ≥ 2× historical)                    |
| Daily pausing/editing based on 1-3 days of data                    | Both                             | 7-day / 50-conversion no-touch windows                              |
| Single "winning creative" reliance                                 | Both                             | 10-50+ creative diversification                                     |
| Pre-2024 Hook Rate folklore "> 30% good" alone                     | Grok primarily                   | Use banded thresholds: >35% strong, 25-35% solid, <25% kill         |

---

## 9. NEW rules the research introduces (not in current spec)

These are rules/signals the spec should _add_:

| New rule                                                                   | Source          | Spec location to add                                                                |
| -------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| Meta Creative Fatigue flag (CPR ≥ 2× historical)                           | Both            | §6.5 (new priority metric); §14 (as guardrail input); §17 (branch in decision tree) |
| 95% statistical significance for A/B winner declarations                   | Both            | §6.4 — data sufficiency                                                             |
| Days-without-conversion kill: 3-7 days × daily budget                      | Both            | §6.5 or §17                                                                         |
| Hook rate banded thresholds (>35% / 25-35% / <25%)                         | Both            | §6.5 leading signals table                                                          |
| Volume-based sufficiency (1000 impr + 50 clicks) replaces time-based (72h) | Both            | §6.4                                                                                |
| "Gate 1 / Gate 2" evaluation split (leading vs lagging)                    | Both (implicit) | §6 overall structure — biggest rewrite                                              |
| Israel CPL ≠ global × 0.5-0.7 (runs 2.5× global with wartime volatility)   | Manus           | §3.4 + §6.2                                                                         |
| Advantage+ / ASC benefit from pooled data but follow same 50-event rule    | Grok            | §6.3                                                                                |

---

## 10. Open questions (neither source resolves)

These remain **❓ OPEN** — the agent cannot auto-resolve. Must be Business Knowledge (§15) inputs from the user, or require A/B testing once production data accumulates:

1. **Vertical-specific kill/scale thresholds for Israeli SaaS/lead-gen niches** — no primary data. Aiweon specifically needs internal baselines from first 30-60 days.
2. **Confidence interval math for CPA movement** — practitioners use volume heuristics, not formal stats. Agent should prompt user if unsure.
3. **How to handle multiple simultaneous winners in a single ad set** — no consensus: move winners? pause losers? raise budget in place?
4. **True tolerance of Andromeda to budget jumps** — practitioners still default to 20% despite anecdotes that 50%+ is now safe.
5. **Long-term creative fatigue under heavy GenAI creative rotation** — no 2026 data yet on whether AI-generated volumes fatigue faster/slower.
6. **Hard-to-sell Israeli service niches: manual warming (awareness + retargeting) vs broad conversion campaigns trust in Meta AI** — open practitioner debate.

---

## 11. Recommended sequence of spec edits

Based on this diff, here's the order I'd apply changes to `docs/plans/campaigner-spec.md`:

1. **§6.5** — rewrite the metric hierarchy table as two tables (Gate 1 / Gate 2). Highest-impact change.
2. **§6.6** — replace Frequency>3 trigger with Meta Creative Fatigue flag.
3. **§6.4** — swap 72h for volume-based thresholds (1000 impr + 50 clicks); add 95% significance and days-without-conversion kill.
4. **§6.2** — add Israel-specific warning; change baseline windows to 7/14/30.
5. **§6.1** — update benchmark numbers to 2026 primary sources.
6. **§7.2** — raise creative count to 10-50+; remove manual pruning.
7. **§3.4** — replace "Israel 30-50% cheaper" with accurate CPM-low-CPL-high profile.
8. **§17** — decision tree gains a "leading-signal" early branch before the current CPA-centric branches.
9. **Add §6.7 "Deprecated Pre-Andromeda Rules"** — explicit call-outs to prevent regression.
10. **Add §20 TODO** — surface the ❓ OPEN items for Business Knowledge onboarding (§15) and Aiweon's first 30-day calibration.

---

**Status:** Ready for spec rewrite. Do not apply changes until a third source (Perplexity / Gemini DR / ChatGPT DR) confirms — two is enough to act, three makes it bulletproof.
