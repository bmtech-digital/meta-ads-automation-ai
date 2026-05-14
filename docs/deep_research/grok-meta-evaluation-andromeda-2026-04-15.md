# Grok Deep Research — Meta Ads Entity Evaluation (Post-Andromeda)

> **Source:** Grok (xAI)
> **Date:** 2026-04-15
> **Prompt reference:** Agent-agnostic research prompt for "how to evaluate if an entity (ad/adset/campaign) is good enough" in the post-Andromeda era.
> **Use:** Inputs for §6 Performance Brain of the Campaigner spec. Cross-reference with Perplexity / Gemini DR / ChatGPT DR responses when added.

---

## 1. Executive Summary

- **Evaluation now lives primarily at the campaign and creative/ad level**: Andromeda + Advantage+ (ASC/Advantage+ Sales) auto-distributes budget unevenly across creatives within a campaign; ad sets still matter for learning but simple structures (fewer campaigns) win.
- **Hook rate (3s video views / impressions) remains a critical leading indicator**; top operators kill creatives below ~25% early (48h–few days) and scale those >35–40%; the old 30% folklore is directionally still useful but now tied to Andromeda's retrieval prioritization.
- **Learning phase is unchanged at ~50 results (conversions) per week per ad set** after the last significant edit (Meta official guidance, still current in 2026); major edits (budget, creative, targeting) still reset it; stabilization = exit "Learning" status + stable CPR/ROAS over 5–7 days.
- **Act on data only after meaningful volume**: 500–1,000 impressions/ad for CTR/CPC signals; 50–100 clicks; ~50 conversions/week minimum before scaling or killing; CPA movement before then is mostly noise.
- **Kill criteria (post-stabilization)**: Hook <25%, no conversion after ~daily budget spend or 3–7 days, CPR ≥2× historical (Meta's "Creative Fatigue" flag), or CPA >1.3× target for 5+ days.
- **Scaling winners**: Stable CPA/ROAS below target after learning → increase budget 20–30% every 2–3 days (vertical scaling in same campaign preferred; duplication often resets learning). Andromeda makes larger jumps safer than pre-2024 but gradual still dominates practitioner practice.
- **Frequency >3 is still monitored but secondary**; true fatigue signal is Meta's Creative Fatigue/Limited flag (CPR rising) + diversification prevents it. Andromeda can accelerate fatigue via aggressive high-intent delivery.
- **Creative evaluation**: Focus on aggregate campaign performance + breakdowns (hook rate, CTR, spend allocation); uneven spend is normal — Meta is optimizing; winning creative = strong early signals even if initially low spend.
- **Benchmarks (2025 Triple Whale ecommerce medians, updated 2026)**: CTR ~2.19%, CPA ~$38, ROAS ~1.86, CPM ~$14; vary sharply by vertical/objective (see Section 8); no public Israel/MENA-specific data located.
- **Biggest outdated mistake**: Micromanaging early data, over-editing during learning, single-ad reliance, or judging by frequency/CPA alone instead of leading signals + rolling account baselines.

---

## 2. Section-by-Section Answers

### 1. Entity Evaluation Framework

Current best practice: Evaluation has shifted toward **campaign-level aggregate performance and individual creative/ad signals**, not rigid ad-set silos. Andromeda (Meta's 2024 retrieval engine, fully rolled out 2025) + Advantage+ automation prioritize creative signal quality and mathematical matching over manual structure. Meta now handles audience/placement/creative mix dynamically; simple campaign structures (1–few campaigns) with 10–50+ diverse creatives per ad set are recommended. Ad sets still track learning phase, but micromanaging placements or individual ads is discouraged.

Leading indicators: Hook rate (3s views/impressions), early CTR. Lagging: CPA/ROAS after learning.

Hook/Thumb-Stop Rate importance has **increased** as an early retrieval signal; Andromeda uses it to decide testing/prioritization. Thresholds used today (practitioners 2025–2026): >30–40% strong; 25–35% solid; <20–25% = immediate kill/replace. Old 30% folklore is still a practical baseline but now explicitly tied to "does this earn the right to be evaluated?"

**Sources:** Meta Engineering (Dec 2, 2024); Jon Loomer (Jan 2, 2026 & Sep 15, 2025 posts); Motion & AdManage.ai practitioner analyses (2025–Feb 2026). No major source disagreement on shift to creative/campaign focus.

### 2. Learning Phase — Current Truth

"50 conversions in ~7 days" (or per week) rule is **still accurate** per Meta's current help center and 2025–2026 practitioner consensus; it is a guideline for stable delivery, not a hard guarantee. ASC/Advantage+ campaigns benefit from pooled data but follow the same per-ad-set threshold.

Significant edits (budget >20%, creative additions/pauses, targeting changes) **still reset** learning; Meta has not relaxed this.

Stabilization signal: Exit "Learning"/"Learning limited" status + stable cost-per-result over 5–7 days with no major volatility.

**Sources:** Meta Business Help Center (current as of 2026 copyright); multiple 2026 guides (AdStellar, Optifox, Modern Marketing Institute). All sources align; the 50-event rule is Meta-official, not folklore.

### 3. Statistical Significance & Data Sufficiency

Practitioners act only after: 500–1,000 impressions per ad (CTR/CPC reliable); 50–100 clicks; ~50 conversions/week (algorithm optimization). CPA/ROAS decisions require 5–7 days or 50+ conversions post-learning; earlier movement is noise. Top operators apply informal confidence via volume thresholds rather than formal CIs; some use "2–3× target CPA" as kill rule after sufficient sample.

**Sources:** Best Practice Media (2025); Modern Marketing Institute (2026); LinkedIn practitioner posts (2026). Sources agree on volume thresholds; no precise CI numbers published.

### 4. Kill Criteria

Concrete practitioner thresholds (2025–2026):

- **Creative/ad:** Hook rate <25% after 48h → pause; no conversion after spending full daily budget or 3–7 days → kill.
- **Ad set/campaign:** CPA >1.3× target for 5+ days or CPR ≥2× historical (Meta "Creative Fatigue" flag) → pause/refresh.
- **"Days without a conversion" rule:** 3–7 days (budget-dependent); shorter for high-volume accounts.

Post-Andromeda: More patience during initial learning (7–10 day no-touch), but faster creative kills on leading signals (hook/CTR).

**Sources:** Jon Loomer (2025–2026); GrowthMarketer (2026); AdMove.ai & practitioner consensus. Minor variance on exact "days without conv" (3 vs 7) by vertical/budget.

### 5. Scaling Criteria

Winners = stable CPA/ROAS meeting or beating target after learning phase + positive leading signals.

"20% every 2–3 days" rule **still widely used**; some test 20–30% increases. Andromeda allows somewhat larger jumps but practitioners still prefer gradual vertical scaling (budget increase in existing campaign) over horizontal duplication (resets learning).

**Sources:** Reddit practitioner threads & GrowthMarketer (2026); Jon Loomer-aligned advice. Consensus on gradual vertical preference post-Andromeda.

### 6. Frequency & Audience Fatigue

Frequency >3 remains a useful monitoring signal (CPA often climbs 10–25%), but **not the primary one**. Meta now surfaces "Creative Fatigue" (CPR ≥2× historical) or "Creative Limited" flags; Andromeda's better matching can accelerate fatigue (aggressive delivery to high-intent users). Diversification (10–50+ distinct creatives) is the main mitigation; frequency alone does not trigger automatic action if CPR is stable.

**Sources:** Jon Loomer (Sep 15, 2025); AdMove.ai & Sentrum (2026). Sources agree frequency is secondary to CPR flag.

### 7. Creative Evaluation in the Andromeda Era

Evaluate creatives via **aggregate campaign performance + breakdowns** (hook rate, CTR, spend allocation, AI-generated variants). Meta auto-distributes spend unevenly — normal and desired. A creative with high CTR/hook but low spend is usually being tested or starved correctly; give it more variations rather than forcing spend. Compare across placements via Ads Manager breakdowns (even with Advantage+ mix). "Winning creative" = strong early signals + sustained contribution to campaign ROAS without fatigue.

**Sources:** Jon Loomer (Oct 20, 2025 & 2026 posts); Meta Engineering (Dec 2024). No disagreement.

### 8. Benchmarks

**2025 Triple Whale ecommerce medians** (updated Apr 2026, ~35k brands): CTR 2.19%, CPA $38.19, ROAS 1.86, CPM $14.19, CVR 1.6%.

**Adamigo 2026 by objective** (cross-industry):

- Sales: CTR 1.38%, CPM $20–30, CPA ~$30, ROAS ~2.79
- Leads: CTR 2.59%, CPL ~$27.66
- Traffic: CTR 1.71%, CPC $0.70

WordStream 2025 industry data shows wide variance (e.g., higher CPA in finance/healthcare).

**No public Israel/MENA-specific benchmarks located** in primary sources (WordStream, Triple Whale, Adamigo, Meta); general global/ecommerce data applies but local competition/seasonality may differ — flag for account-specific baselines.

**Sources:** Triple Whale (Apr 7, 2026); Adamigo (Jan 29, 2026); WordStream (Sep 8, 2025). Sources align on medians but note vertical/region variance.

### 9. Account-Level vs Campaign-Level Evaluation

Compare underperforming campaign to **rolling account baseline** (7/30-day historical CPA/ROAS) and similar periods (seasonality, competition). If account overall is stable but one campaign lags, it's likely campaign-specific (creative/offer). SaaS tools recommend rolling baselines + incrementality checks to separate "bad campaign" from "bad week."

**Sources:** Practitioner consensus in 2026 guides (e.g., Modern Marketing Institute, Jon Loomer audits). No major disagreement.

### 10. What Most People Get Wrong

Common outdated mistakes (explicitly called out 2025–2026):

- Micromanaging/placing ads or pausing during learning (interrupts Andromeda optimization).
- Relying on single "winning" creative instead of diversification (10–50+ distinct assets).
- Judging solely by lagging CPA/ROAS or frequency without leading signals (hook rate).
- Complex multi-ad-set structures (Andromeda favors simple + creative options).
- Premature scaling via duplication (resets learning).

Pre-2024 rules now misleading: rigid ad-set testing silos, frequency >3 as auto-kill, daily tweaks, assuming manual targeting beats broad + creative signals.

**Sources:** Jon Loomer (multiple 2025–2026); DojoAI, GrowthMarketer (2026).

---

## 3. Deprecated Rules

- "One winning ad + duplicate to scale" → replaced by creative diversification (10–50+ distinct assets per ad set).
- Frequency >3 = automatic fatigue/pause → replaced by Meta's CPR-based Creative Fatigue flag + diversification.
- Daily/early pausing or editing based on 1–3 days data → replaced by 7-day/50-conversion no-touch windows.
- Complex hierarchical ad-set structures for testing → replaced by simple campaigns + creative options.
- Strict 50-conversion hard rule without profitability context → guideline only; prioritize stable profitable delivery.

---

## 4. Open Questions

- Exact statistical confidence intervals or CI thresholds top operators apply (volume rules dominate over formal stats).
- Precise vertical-specific kill/scaling numbers (e.g., ecom vs lead-gen) and Israel/MENA adjustments (no public primary data).
- How much larger budget jumps Andromeda truly tolerates vs. continued 20% practitioner caution.
- Long-term creative fatigue patterns with heavy GenAI/Advantage+ creative use.

Agent will need human override or ongoing A/B testing here.

---

## 5. Source List

### Meta Official

- Engineering at Meta: "Meta Andromeda" (Dec 2, 2024) — https://engineering.fb.com/2024/12/02/...
- Meta Business Help Center: Learning Phase (current 2026) — https://www.facebook.com/business/help/112167992830700

### Practitioners

- Jon Loomer Digital: "19 Rules…" (Jan 2, 2026), Creative Fatigue (Sep 15, 2025), Andromeda Creative Diversification (Oct 20, 2025) — jonloomer.com posts.

### Data Tools

- Triple Whale: Facebook Ads Benchmarks (Apr 7, 2026 update) — triplewhale.com/blog
- Adamigo: Meta Ads Benchmarks 2026 (Jan 29, 2026) — adamigo.ai/blog

### Other

- WordStream (Sep 8, 2025 benchmarks); practitioner guides (Motion, AdManage.ai, GrowthMarketer 2025–2026). No pre-2024 data used without explicit 2025–2026 confirmation.
