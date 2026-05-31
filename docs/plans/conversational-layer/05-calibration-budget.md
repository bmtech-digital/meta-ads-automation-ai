# 05 · Calibration & Budget Reality

> **Conversational Layer PRD** · split 31.5.2026 · [↩ index](README.md) · source §§8.0.2–8.0.5, 17.4, 17.10 · **Phase 1–3**
> The single most differentiating capability: domain wisdom most tools lack + radical honesty about reality-vs-aspiration + reasoning in **outcomes**, not leads.

---

## A. Calibration methodology (§8.0.2) — "is this budget enough?"
The existing brain has a static CPL grid (`estimate_cpl.py`) but **no calibration to the account's reality**. Operator's real cases show actual CPL ~70% below the grid's "market average." The grid is a *prior*, not the truth.

**Core formula (Bayesian shrinkage):**
```
CPL_predicted = Prior × (1 − confidence) + Actual × confidence
```
- **Prior** = `estimate_cpl` grid (deliberately pessimistic — typical operator, not best-in-class).
- **Actual** = account's observed CPL over available window (Meta history, from [03](03-onboarding-scan.md) step 1).
- **Confidence is multi-dimensional** (not just sample size):
```
confidence = f(N_conversions + temporal_stability + tenure_days
              + investment_consistency + cross_business_signal)
```
A 30-day campaign with 60 stable conversions earns higher confidence than a 3-day one with 100 unstable conversions. **Stability + tenure matter as much as raw N.**

**Volatility gates (operator-calibrated):**
| Weekly CoV of CPL | Meaning | Brain action |
|---|---|---|
| ≤ 20% | Stable | trust observed CPL fully |
| 20–40% | Monitoring | use blend; surface variance in rationale |
| ≥ 40% | **Weakness flag** | give 7+ more days, then act if no recovery |

**Cross-business prior:** when the same operator (Phase A) — or same vertical+geo+budget-tier cohort (Phase B, [10 §17.3](10-elevators-postmvp.md)) — has other established accounts, blend that into the prior for a *new* account. A skilled operator's track record transfers.

**Four modes:**
| History | Mode | Output |
|---|---|---|
| 0 days | No-history | grid prior + explicit confidence band; no single number |
| 1–30 days | Early-data | Bayesian blend, low-medium confidence, flagged preliminary |
| 30–90+ days | Calibrated | trust observed, monitor drift, contribute to cross-business pool |
| 90+ continuous, stable | **"זמן תודעה" — trusted** | confidence ceiling; campaign earns *protection*; feeds cross-business benchmarks |

**Grid recalibration (plan now, harvest later):** keep grid as pessimistic fallback *and* collect Aiweon-pooled actuals from day one. Phase A: grid stays, cross-business prior fills gaps. Phase B: pooled actuals replace the grid for any sub-vertical with ≥5 calibrated accounts.

**Honesty contract:** every CPL carries a **band + confidence label** — never a bare number. e.g. *"Based on 47 conversions over 30 days, CPL ₪22 ± ₪4 (stable). High confidence."*

---

## B. Campaign-age-aware monitoring (§8.0.3)
Today the brain reads Gate 1/Gate 2 the same every day, with no notion of campaign age. Encode the operator's playbook:

| Age | Evaluates | Does |
|---|---|---|
| **T+0** | — | record launch, prior CPL, expected leads/week, target need |
| **T+1–3d** | first lead arrived? | if no by T+3d → diagnose delivery (utilization, audience, creative load) **before touching budget**. New metric `time_to_first_lead` |
| **T+7d** | first CPL read | if ≥30% divergence → **update the prior** in `strategic_memory`, surface to operator. Don't override guardrails — adjust the model |
| **T+30d** | stability vs investment | compute CoV. Stable → confidence ↑, trust observed CPL. Shaky → keep diagnosing, don't scale yet |
| **T+90d** continuous | "זמן תודעה" — trusted | campaign *protected* (no pause without `quality_band='low'` or explicit operator request); feeds cross-business benchmarks |

**Reuse:** `fetch_insights` + `baselines`. New: `campaign_age_state` (column or compute-on-demand) + stage-conditional rules in orchestrator reasoning.

---

## C. Pattern recognition (§8.0.5) — dry periods, streaks, seasonal pulses
Beyond age, campaigns go through patches. The brain must classify *which* before reacting.

| Pattern | Detection | Action |
|---|---|---|
| **Dry period** | drop after stable phase; ≥3d no leads or CPL spike; not matching `seasonal_hints` | **First move: add-creative to existing campaign** (§D #6). Then diagnose saturation (freq ≥ ceiling). **Don't pause yet** |
| **Winning streak** | ≥30% better than baseline, sustained 5+ days, low CoV | **Protect.** Mark `streak_active`; guardrails block destructive proposals. Optional modest scale_up (15%, not 30%) only after R0 cooldown |
| **Seasonal pulse** | matches `seasonal_hints` calendar | pre-adjust budget per calendar; expect lift/drop; don't confuse with fatigue/saturation |
| **Algorithm fluctuation** | volatility within normal CoV (≤20%) | patience, no action |
| **Broken signal** | hard zero (0 impr/0 leads) no cause; or tracking degraded | **Diagnose first** — tracking, Meta health, account issue — before touching campaign |

**The crucial distinction:** dry period (metrics still moving, lower) → patience + creative refresh · broken signal (flat-zero, tracking suspect) → escalate immediately.

**Cross-account dry-period learning** ([10 §17.3](10-elevators-postmvp.md)): if 5+ similar businesses hit a dry period the same week → likely market-wide; report as context, hold steady.

**Streak protection:** during an active streak guardrails raise the bar for pause/scale_down/new_audience. Brain says *"6-day streak — I won't propose changes; if you want to scale, 15% only — bigger jumps risk resetting Learning."*

**Reuse:** `seasonal_hints` (migration 010) · `fetch_insights` time-series · `check_creative_fatigue.py` · `check_tracking_health.py`. **New:** `classify_campaign_pattern.py` → pattern + suggested response lane.

---

## D. Audience-Fit Pre-Check (§8.0.4) — validate targeting BEFORE evaluating leads
> Operator's hard rule: *every other signal lies when targeting is wrong.* Cheap leads that don't close look like a "creative problem" but are a "who-are-we-talking-to" problem. Rule out audience-fit before recommending creative refresh, budget changes, or pivots.

**Runs at four moments:**
| When | Checks | If fail |
|---|---|---|
| **Onboarding (T-1)** | proposed audience matches `service_regions` + ICP + vertical + capacity | block launch; propose corrected audience |
| **T+0 (launch)** | exclusions in place for nearby-but-irrelevant cohorts | warn; offer exclusion proposal |
| **T+3d (first leads)** | do lead attributes look like ICP? | flag audience-fit problem; **don't blame creative** |
| **Always** | "too good to be true": CPL much better than expected AND close_rate unexpectedly low → mis-targeting | flag before scaling |

**Exclusion intelligence:** geo-overlap with irrelevant cohorts (tourists, foreign students, outside radius) · existing customers · job-seekers · industry peers/competitors/press · past low-quality lead clusters (auto-suggest once `lead_outcomes` shows segments that never close).

**Geo radius sanity** (from operational capacity): 1-person carpenter ≠ 100km radius; national e-comm = all-IL. `business_profile_classifier` (§F) suggests a radius band; operator confirms/expands with explicit reasoning.

**Lead-shape validation (T+3d+):** compare incoming lead attributes (age/location/intent when Lead Form fields exist) to onboarding ICP. If ≥60% don't match → audience-fit fail. Output: *"6 of 8 leads are outside your area / wrong age / wrong intent — this is targeting, not creative. Tighten before we touch anything else?"*

**Cross-check with Calibrator:** `actual_CPL << prior` AND `close_rate << prior` → wrong people (surface as audience-fit suspect before budget changes). `actual_CPL << prior` AND `close_rate ≈ prior` → genuinely good, proceed.

**New tools:** `check_audience_fit.py` · `propose_exclusions.py` · `validate_geo_radius.py` · `analyze_lead_shape.py`.

---

## E. Budget-Reality Calibrator (§17.4) — what the operator sees
> Meta's "50 conversions/7d to exit Learning" is a fixed constant that biases small businesses to overspend. Most tools parrot Meta's defaults; Campaigner differentiates through honest budget-reality conversation.

### Core output: always **2 options, never one** (operator-mandated)
| | Option A — Market-recommended for your goal | Option B — What your stated budget delivers |
|---|---|---|
| Basis | live market research: CPL bands + close rates + cross-business actuals + competitive research | Bayesian-calibrated forecast + confidence band (§A); uses account's own history when available |
| Framing | *"To hit X purchases/events/month, market suggests ~₪Y/day."* | *"At ₪40/day, expect ~2 leads/day ≈ N customers/month at close rate Z%."* |

Then state **the gap** explicitly + offer three honest paths: **(a)** increase budget toward A · **(b)** accept reality at B · **(c)** shift the goal.

### Reverse-from-outcome reasoning (end-state, not leads)
```
Option A:  target_purchases/mo ÷ close_rate = leads_needed × CPL_predicted
           = required_monthly_budget ÷ 30 = required_daily_budget
Option B:  stated_daily_budget × 30 ÷ CPL_predicted = expected_leads/mo
           × close_rate = expected_customers/mo
```

### Close-rate is a first-class variable (today the brain ignores it)
- **Prior:** per-vertical bands from live research (carpentry quote 10–25%; bridal consult 30–45%; karaoke booking 5–15%). Researched once at onboarding, refreshed by Flow D.
- **Actual:** when CRM wired ([08](08-leads-crm-whatsapp.md)), real close rates override the prior — same Bayesian shrinkage as CPL.
- Without close_rate the budget conversation is incomplete.

### Always relative to market + business size
Never quote absolutes. *"₪40/day is small for marketing-tech but normal for a side-business attractions account."* Size derived from revenue tier · employee count · operational capacity (`business_profile_classifier`).

### Onboarding sequence (budget-first)
1. **"What budget can you invest as a start?"** (hard limit) → 2. live market research (CPL + close-rate) → 3. **"How many purchases/events/customers per month?"** (soft target) → 4. present 2-options + gap + 3 paths → 5. capability check if stretch. Lead-need is *derived*, not asked.

### Worked example (§17.4.1) — carpentry, ₪40/day, 3 leads/day desired
Reframe to outcomes: *"3 leads/day × ~20% close ≈ 18 customers/month. Here are 2 options:"*

| | Option A — 18 customers/mo | Option B — ₪40/day |
|---|---|---|
| Budget | ₪180/day (~₪5,400/mo) | ₪40/day (₪1,200/mo) |
| Leads | ~3/day (90/mo) | ~0.5–1/day (15–30/mo) |
| Customers @20% | ~18/mo ✓ | ~3–6/mo |
| Gap | met | 12–15 short |

**Strategy at ₪40/day (if B):** consolidated single ad set · optimize for Lead-form-open (upper-funnel, passes Learning faster) · Advantage+ broad · heavy `boost_post` of best organic · 7-day click attribution · 3–5 focused creatives (not 10+).
**MUST NOT propose at this tier:** percent-based `scale_up` (20% = ₪8, meaningless) · `new_creative` when util < 0.5 · A/B test (sample too thin) · "chase 50/7d" advice.
**After 30 days:** Bayesian recalibration; if operator hits ₪20 CPL, forecast jumps and the conversation repeats with updated numbers.

### Calibrator tools (§17.4.2)
`forecast_realistic_volume(budget, vertical, geo)` · `is_50_per_7d_achievable(...)` · `compute_required_budget(target_outcomes, close_rate, vertical, geo)` · `score_meta_fit(profile)` (0–100) · `recommend_optimization_objective(...)` · `lead_economics(business)` (cost-per-closed, rev-per-lead, true ROAS) · `compute_min_meaningful_budget_step(daily_budget)` = `max(₪25, 20%×budget)` · ⭐ `research_market_close_rate(vertical, geo)` · ⭐ `compute_outcomes_from_leads(leads, close_rate)` · ⭐ `present_two_options(...)` · ⭐ `business_profile_classifier(business)` (size tier).

> **Data access note (§17.4.3):** the calibrator is designed to ingest historical data from `agent_decisions` / `baselines` / Meta insights once wired per business. Operator anecdotes qualitatively validate the model; quantitative calibration requires running against real accounts.

---

## F. Brain rigidity audit & micro-tier (§17.10)
Audit of `config/thresholds.yaml` — places the brain is rigid in ways that penalize small businesses:

| Today (rigid) | Why it hurts micro | Fix |
|---|---|---|
| `learning.min_conversions_for_exit: 50` | treats ₪40/day = ₪40k/day | `business_aware_min_conversions = min(50, need_per_week × 1.5)`; accept satisfied-in-Learning as valid steady state |
| `learning.budget_daily_min_ils = CPA×50/7` | orders overspend | conditional: 50/7d only if business *wants* high volume; else `CPA × need_per_week / 7` |
| `scaling.scale_up_*_pct` (20/30%) | ₪40/day × 20% = ₪8 | add `scaling.min_absolute_step_ils: 25`; step = `max(pct×budget, min_step)` |
| no tier below `small` (₪50) | no micro mode | add `budget_tier_micro_ils: 80` + `max_proposals_micro: 1` |
| `gate_1.impressions_floor: 1000` | never fires at ₪20/day | add `impressions_floor_micro: 300`; extend `evaluation_window_hours` |
| `gate_1.clicks_floor: 50` | same | add `clicks_floor_micro: 15` |
| "if Learning, no scale" | micro always in Learning | "if Learning AND profile expects to exit"; micro accepts steady in-Learning |
| "1 ad set + 10+ creatives" | gen cost > value at micro | micro: 1 ad set + **3–5 focused** |
| no volatility gate | one stable week = one chaotic week | add `cpl_volatility.cov_weekly` (§A gates) |
| no close_rate anywhere | optimizes leads, not customers | add close_rate first-class (§E) |
| no business-size context | ₪40/day = "small" or "normal" depending | `business_profile_classifier` stamps tier; recommendations always relative |

**New/extended tools:** `calibrate_budget_reality.py` (engine) · `forecast_realistic_volume.py` · `business_profile_classifier.py` (stamps `business_knowledge.profile_tier`) · `research_market_close_rate.py` · `compute_outcomes_from_leads.py` · `present_two_options.py` · **`check_guardrails.py` becomes tier-aware** (reads `profile_tier`, most guardrails gain a `_micro` variant).

**Honesty principle (codified in [§14 persona](04-conversation-engine.md)):** *"Don't sell illusions."* When the stated goal can't be met at the stated budget, say so directly with the three paths. Never quietly recommend an unattainable strategy; never quote a CPL without a confidence band.
