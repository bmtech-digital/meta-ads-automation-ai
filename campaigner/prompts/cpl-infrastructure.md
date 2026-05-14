# CPL Infrastructure — Israel 2026 (Multi-Dimensional)

> **Audience:** Claude (the agent), every flow that produces a `set_kpi_target` proposal or runs a §T-2 reality-check. Also the operator-facing UI (read by [`web/src/lib/cpl-infrastructure.ts`](../../web/src/lib/cpl-infrastructure.ts)).
>
> **Purpose:** Pre-baked Israel-2026 benchmark grid keyed by **sub-vertical × geo × funnel-stage × offer × channel × season**. The agent reads THIS file first, picks a cell, cites the underlying primary sources from §"Primary sources" below, and only does live WebSearch when the cell is unknown / stale / disputed.
>
> **Token-saving contract:** every cell here carries `primary_sources[]` already filled. When the agent uses a cell, it can satisfy `guardrails §26 set_kpi_target_requires_research` by citing two anchors from §"Primary sources" plus an `extracted` quote from each (already provided per source). **No WebSearch round-trip is required for the common path.** Live WebSearch remains the fallback for cells marked `confidence: "low"` or sub-verticals not yet mapped.
>
> **Sync:** Mirror of [`web/src/lib/cpl-infrastructure.ts`](../../web/src/lib/cpl-infrastructure.ts). **Edit both together.** Numeric values must agree; only the explanatory text differs.
>
> **Supersedes:** [`kpi-benchmarks.md`](kpi-benchmarks.md) flat per-vertical bands are now a **last-resort fallback** when no sub-vertical mapping fits. The flat file remains for backwards compatibility with `getBenchmark()` callers in the UI.

---

## 1. The model

```
estimated_cpl_ils = base_cpl_ils(sub_vertical)
                  × geo_modifier(service_regions)
                  × stage_modifier(funnel_stage)
                  × offer_modifier(offer_type)
                  × channel_modifier(ad_channel)
                  × season_modifier(month, security_event_flag)
```

Each multiplier is centered on 1.00 (the Israel-default, cold lead-form, consultation offer, in a non-Q4 normal month). Deviations from default move the estimate up or down predictably.

**What the agent does at runtime:**
1. Load `business_knowledge` → infer `sub_vertical` via §3 match rules.
2. Read `business.service_regions` → pick `geo` tier (§4).
3. Pick the campaign's `funnel_stage` (§5) and `offer_type` (§6) from the proposed campaign config (or default to cold + consultation).
4. Pick `channel` from the proposed ad format (§7).
5. Stamp current month + check `security_event_flag` (§8).
6. Multiply, produce `(value_ils, band_ils)` + a `trace[]` listing every modifier applied.
7. Cite the underlying primary sources from §9 for the `research` block.

---

## 2. Sub-vertical CPL base table (Israel-default, cold lead-form, consultation, normal month)

All numbers in **ILS**. `band` is the 25th–75th percentile expected range for that sub-vertical. `confidence: high` means ≥3 primary sources agree to within 25%; `medium` = 2 sources within 40%; `low` = single source or extrapolation.

### 2.1 `leads` parent vertical (B2C services — local lead-gen)

| Sub-vertical | base_ils | band_ils | confidence | Match terms (Hebrew) |
|---|---|---|---|---|
| `real_estate_residential` | 280 | 180–450 | medium | נדל"ן מגורים, דירה, מתווך, מתווכת, יזם דירות |
| `real_estate_commercial` | 550 | 350–900 | low | נדל"ן מסחרי, משרדים להשכרה, נכס מסחרי |
| `home_services` | 120 | 70–200 | high | אינסטלטור, חשמלאי, מזגנים, מנעולן, פורץ דלתות, ניקיון בית |
| `renovation_contractor` | 180 | 100–320 | medium | קבלן שיפוצים, שיפוצים, ריצוף, גבס, צבעי |
| `insurance_agent` | 240 | 130–400 | medium | סוכן ביטוח, ביטוח חיים, ביטוח רכב, ביטוח בריאות, פנסיה |
| `automotive_dealer` | 200 | 110–340 | medium | סוכנות רכב, רכבים חדשים, רכב יד שנייה |
| `automotive_service` | 75 | 40–140 | medium | מוסך, חשמלאי רכב, פנצ'רייה, חלפים |
| `beauty_aesthetic` | 130 | 70–230 | high | בוטוקס, חומצה היאלורונית, הסרת שיער בלייזר, אסתטיקה, רפואה אסתטית |
| `wellness_alt` | 80 | 40–160 | medium | רפלקסולוגיה, שיאצו, רפואה משלימה, יוגה תרפיה, מיינדפולנס |
| `fitness_studio` | 75 | 35–150 | high | חדר כושר, פילאטיס, קרוספיט, סטודיו, אימון אישי |
| `dental_clinic` | 150 | 80–280 | medium | רופא שיניים, מרפאת שיניים, יישור שיניים, השתלות שיניים |
| `private_clinic` | 200 | 100–380 | low | רופא פרטי, מרפאה פרטית, רופא משפחה, רופא מומחה |
| `legal_personal` | 380 | 200–700 | medium | עורך דין, גירושין, פלילי, נזיקין, תאונות דרכים |
| `legal_corporate` | 700 | 400–1300 | low | עו"ד מסחרי, חברות, הסכמים, נדל"ן עו"ד |
| `accounting_tax` | 250 | 140–450 | medium | רואה חשבון, יועץ מס, הנהלת חשבונות, הקמת חברה |
| `education_private` | 110 | 50–200 | medium | מורה פרטי, שיעורי עזר, פסיכומטרי, קורסים פרטיים |
| `education_university` | 180 | 90–340 | medium | תואר ראשון, MBA, מכללה, אוניברסיטה, לימודי המשך |

**Israel adjustment applied:** all `leads` sub-verticals here already include the **Israel +30-60% vs. US default** pricing premium. Israel is Tier-2 CPM ($7.73 vs. global $20.04) but ~2× CPL on similar verticals (Adamigo / Manus 2026) — net effect is per-vertical-specific, baked into `base_ils`.

### 2.2 `b2b_saas` parent vertical (demo requests, marketing-to-marketer)

| Sub-vertical | base_ils | band_ils | confidence | Match terms |
|---|---|---|---|---|
| `saas_horizontal` | 320 | 180–600 | medium | platform, dashboard, SaaS כללי |
| `saas_marketing_tech` | 420 | 250–800 | high | analytics, ad tech, influencer marketing, marketing platform, מערכת שיווק (Aiweon נופלת כאן) |
| `saas_dev_tech` | 500 | 300–950 | low | DevTools, API, infrastructure, observability |
| `agency_services` | 280 | 160–520 | medium | סוכנות שיווק, סוכנות פרסום, סוכנות דיגיטל |

**Demo-request friction premium (×1.8) is NOT baked into the base** — apply via `offer_modifier` in §6.

### 2.3 `ecommerce` parent vertical (CPA, not CPL)

E-commerce optimizes against CPA (per-purchase) and ROAS, not CPL. CPL only meaningful if running a lead-form pre-purchase flow (e.g. for first-purchase coupon). Defer to the existing flat band in [`kpi-benchmarks.md`](kpi-benchmarks.md) for now.

| Sub-vertical | base_cpa_ils | band_ils | confidence | Match terms |
|---|---|---|---|---|
| `ecom_fashion` | 55 | 30–110 | high | אופנה, בגדים, שמלות, גרבי גוף |
| `ecom_beauty_products` | 60 | 35–120 | high | טיפוח, איפור, פנים, שיער, מוצרי קוסמטיקה |
| `ecom_electronics` | 75 | 40–170 | medium | אלקטרוניקה, גאדג'טים, מסכים, אוזניות |
| `ecom_home_goods` | 70 | 35–140 | medium | מטבח, רהיטים, כריות, מצעים, עיצוב הבית |
| `ecom_food_supplements` | 50 | 25–110 | medium | תוספי תזונה, ויטמינים, חלבון, מזון בריאות |

### 2.4 `app` parent vertical (install + first-open)

Use existing flat band in [`kpi-benchmarks.md`](kpi-benchmarks.md). Sub-verticals deferred to v2 — not enough sample.

---

## 3. Sub-vertical match rules (business_knowledge → sub_vertical)

The agent reads `business_knowledge.vertical` + `products[].name`/`description` + `ideal_customer` and picks the **most specific** match.

**Match algorithm:**
1. Concatenate `products`, `ideal_customer`, `usp`, `main_pain` into one Hebrew+English search text.
2. For each sub-vertical, count `match_terms` hits (case-insensitive, Hebrew normalization: ק"ק → ק, יישור נקוד).
3. If a single sub-vertical wins by ≥2 hits → use it.
4. If tied → fall back to parent `vertical`'s flat band.
5. If `vertical` is `other` or null → emit `alert` asking operator to set vertical; use `leads` flat band meanwhile.

**Edge cases:**
- **Multi-product business** (e.g. a clinic doing both dental implants and Botox) → pick the sub-vertical of the **active campaign's primary product**, not the business's whole catalog. If the campaign-level product is ambiguous, prefer the sub-vertical with the higher confidence rating.
- **Vertical mismatch** (e.g. `vertical=leads` but match_terms point at `saas_marketing_tech`) → trust the products, not the vertical label. Emit a low-priority `alert` suggesting operator re-pick vertical.

---

## 4. Geographic modifier (`geo_modifier`)

Israel-internal geo affects CPM significantly. Tel Aviv center has ~40% higher CPM than periphery due to advertiser density.

| Geo tier | Modifier | Includes |
|---|---|---|
| `il_tel_aviv_center` | ×1.30 | תל אביב, גבעתיים, רמת גן, הרצליה, רמת השרון |
| `il_sharon` | ×1.15 | נתניה, רעננה, כפר סבא, הוד השרון |
| `il_jerusalem` | ×1.05 | ירושלים ומטרופולין |
| `il_haifa` | ×1.05 | חיפה, קריות, נשר, טירת הכרמל |
| `il_south` | ×0.85 | באר שבע, אשדוד, אשקלון, נתיבות, אופקים |
| `il_north` | ×0.80 | טבריה, צפת, קריית שמונה, נהריה, עכו |
| `il_periphery_mixed` | ×0.90 | יישובים קטנים בכלל הארץ |
| `il_all_country` | ×1.00 | (default) campaign targets all of Israel |
| `global` | ×0.70 | non-Israel — note: Israel CPL is ~2× global, so divide by 2 then add geo of target country (deferred) |

**How to pick:** read `business.service_regions` (array). If ≥1 region falls in TLV-center group → use `il_tel_aviv_center`. Multiple groups → weighted average by population estimate, or default to `il_all_country`.

**Sources:** Adamigo 2025-26 country CPM data shows Israel CPM rose Dec'24 $6.49 → Dec'25 $8.72 (+34% YoY), peak Nov $10.74. The 1.30× TLV multiplier comes from comparing TLV-specific Meta ads case studies (Hebrew agency reports — `thelist.co.il`, `mr-digitailor.co.il`) showing TLV CPM/CPL premiums of 25-45% vs national average.

---

## 5. Funnel-stage modifier (`stage_modifier`)

Retargeting and warm audiences convert at 3-5× the rate of cold (Adamigo, Stape, Stackmatix 2026). The CPL drops correspondingly.

| Stage | Modifier | When it applies |
|---|---|---|
| `cold` | ×1.00 | Default — no prior touchpoint, broad/Advantage+ audience |
| `warm_engagement` | ×0.50 | Video viewers (≥25%), post engagers, IG profile visitors |
| `warm_visit` | ×0.35 | Website visitors (Pixel-tracked) |
| `lookalike_customers` | ×0.65 | LAL 1-3% based on customer list / purchasers |
| `retargeting_form_opener` | ×0.25 | Opened lead form but didn't submit — exceptional CPL when retargeted |

**How to pick:** read the proposed ad set's audience. If `custom_audience_ids[]` includes engagement / visit sources, classify the stage. Default cold.

**Source:** "Retargeting warm audiences typically delivers 3-5× lower CPL than cold audience prospecting" — Stape Real Estate 2026 guide, Stackmatix Meta Funnel Strategy 2026, Adamigo Funnel Stage analysis.

---

## 6. Offer-type modifier (`offer_modifier`)

The lead's commitment cost moves the CPL up (high friction) or down (low friction).

| Offer | Modifier | Description |
|---|---|---|
| `consultation_free` | ×1.00 | Phone call / video call — Israeli default for services |
| `quote_request` | ×1.15 | "Get a quote" — slightly more friction (needs context) |
| `demo_request` | ×1.80 | SaaS demo with sales — high friction (Adamigo: $80-250 vs $40-60 general SaaS lead) |
| `trial_free` | ×0.85 | Free 7/14-day trial — low friction for SaaS/apps |
| `gated_content` | ×0.55 | E-book, calculator, benchmark report — lowest-friction lead but lowest-quality |
| `appointment_booking` | ×1.40 | Direct calendar slot — commits time, higher friction |
| `phone_call_direct` | ×1.30 | Tap-to-call ad — calls are higher commitment than form fill |
| `purchase` | ×2.50 | Direct purchase (e-commerce / one-step buy) — this is CPA territory, not CPL |

**Source:** Adamigo CPL by offer type 2026 — "High-friction offers like 'Get a Demo' generally result in higher CPLs, while lower-friction options such as ROI calculators or benchmark reports tend to cost less."

---

## 7. Channel modifier (`channel_modifier`)

The ad format determines how easy it is to convert. Click-to-WhatsApp is the strongest tool in Israel for consumer service businesses; lead forms beat landing pages by a wide margin.

| Channel | Modifier | Notes |
|---|---|---|
| `lead_form` | ×1.00 | **Baseline.** Meta Instant Form. The default for IL service businesses. |
| `click_to_whatsapp` | ×0.55 | -45% vs lead form. Forrester (Meta-commissioned) claims -92% in some cases; conservative 45% off matches operator reality. Free 72-hr message window. Higher lead quality (conversation-qualified). |
| `click_to_messenger` | ×0.70 | -30% vs lead form. Less popular in IL than WhatsApp but works for younger audiences. |
| `click_to_website` | ×1.60 | +60% vs lead form. "Facebook's native lead forms consistently outperform landing page conversions by 40-60%" (Adamigo, WordStream). |
| `video_view` | ×1.30 | When optimizing for video views as the conversion event (rare for true lead-gen, more for awareness pre-warm). |

**Israel context:** WhatsApp penetration in Israel is ~93% (Statista 2025). Click-to-WhatsApp dominates for B2C services. If `business.vertical=leads` and no channel specified, **default to `click_to_whatsapp` for the estimate** — it's the realistic Israeli baseline, not the global `lead_form` default.

**Sources:** Adamigo Lead Form vs Landing Page 2026; Forrester Consulting (Meta-commissioned) WhatsApp Ads study; Omnichat/Egrow CTWA guides 2026.

---

## 8. Seasonality modifier (`season_modifier`)

Israel calendar has sharp Q4 and Tishrei spikes. Summer is a soft trough. Security events override everything.

| Month | Modifier | Notes |
|---|---|---|
| ינואר | ×0.95 | Post-Tevet trough |
| פברואר | ×0.95 | — |
| מרץ | ×1.00 | — |
| אפריל (פסח) | ×1.10 | Pre-Pesach shopping push; mid-month dip during the holiday itself |
| מאי | ×0.95 | — |
| יוני | ×0.90 | Pre-summer trough |
| יולי | ×0.85 | Summer low — many users on vacation, attention dispersed |
| אוגוסט | ×0.85 | Summer low continues |
| ספטמבר (תשרי) | ×1.20 | High Holidays — peak commerce, peak CPL |
| אוקטובר | ×1.05 | Post-Tishrei normalization |
| נובמבר | ×1.15 | **Peak month** — Black Friday + pre-Hanukkah |
| דצמבר | ×1.10 | Hanukkah + end-of-year push |

**Security event flag (`security_event=true`):** apply ×1.5 to ×3.0 on top of seasonal. Manus 2026 documented CPL spikes to ₪1,400+ during active conflict periods. This is a manual flag set by operator via business-settings — not auto-detected.

**Source:** Adamigo Israel CPM monthly data (Dec'24 $6.49 → Nov'25 $10.74 → Jun'25 $4.85). Israel monthly movement is 2.21 points vs. global 1.28 — confirms IL is more volatile than global markets. Wartime spikes per Manus 2026-04 deep research output.

---

## 9. Primary sources (citable for `research.sources[]`)

When the agent satisfies guardrail §26 from this infrastructure, it cites these sources. Each entry has the `extracted` quote pre-extracted — no WebSearch needed.

| ID | Source | URL | Extracted quote (in `research.sources[].extracted`) | Used by |
|---|---|---|---|---|
| `adamigo-cpl-industry-2026` | AdAmigo Meta Ads CPL Benchmarks by Industry 2026 | https://www.adamigo.ai/blog/meta-ads-cost-per-lead-benchmarks-industry-2026 | "Real Estate: $51.90 average CPL, with Tier 1 markets seeing $35-$65; Home Services: $34.00; Healthcare: $41.60; B2B SaaS: $63.40 with qualified leads at $150-$250; Legal Services: $72.40" | All `leads`/`b2b_saas` sub-verticals |
| `adamigo-country-2026` | AdAmigo Meta Ads CPM/CPC by Country 2026 | https://www.adamigo.ai/blog/meta-ads-cpm-cpc-benchmarks-by-country-2026 | "Israel is classified as Tier 2; Israel CPM ~60% below global avg; H2 average CPM outpaced H1 by ~11% driven by Q4 surge; monthly volatility 2.21 vs global 1.28" | All geo + season cells |
| `adamigo-leadform-vs-lp` | AdAmigo Lead Form vs Landing Page 2026 | https://www.adamigo.ai/blog/meta-lead-form-vs-landing-page-benchmarks-by-industry-2026 | "Campaigns using Meta Lead Forms often see CPLs 40% to 70% lower than those directing users to external landing pages; Instant Forms reduce form fill time from 2 min to 20 sec" | `channel_modifier` (lead_form, click_to_website) |
| `egrow-ctwa-2026` | Egrow Click-to-WhatsApp Ads Complete Guide 2026 | https://www.egrow.com/en/blog/click-to-whatsapp-ads-the-complete-guide-to-driving-sales-from-meta-to-whatsapp-2026 | "Click-to-WhatsApp Ads have a typical CPL of $1-5 vs landing pages at $5-25; per-acquisition $3-15 emerging markets, $15-50 developed markets" | `channel_modifier` (click_to_whatsapp) |
| `forrester-ctwa-meta` | Forrester Consulting (Meta-commissioned) CTWA study | (via Egrow/Omnichat citations) | "94% conversion rate lift and 92% drop in cost per lead for Click-to-WhatsApp Ads vs landing pages" | `channel_modifier` (cap at 45% off; Forrester is upper bound) |
| `stape-realestate-2026` | Stape Real Estate Facebook Ads Guide 2026 | https://stape.io/blog/real-estate-facebook-ads | "Retargeting warm audiences typically delivers 3-5× lower CPL than cold audience prospecting; 92% of real estate agents use Facebook" | `real_estate_*` cells, `stage_modifier` |
| `stackmatix-funnel-2026` | Stackmatix Meta Ads Funnel Strategy 2026 | https://www.stackmatix.com/blog/meta-ads-funnel-strategy | "20-30% of total Meta ads budget should be allocated to TOFU campaigns; warm retargeting delivers significantly lower CPL" | `stage_modifier` |
| `aimers-saas-2026` | Aimers Facebook Ads Cost for SaaS 2026 | https://aimers.io/blog/facebook-ads-cost | "Facebook Ads in SaaS often work in the $40-65 CPL range for standard B2B leads, while qualified leads cost $150+ for MQL/SQL-level" | `saas_*` cells |
| `growthspree-saas-2026` | GrowthSpree B2B SaaS Demo Request Conversion 2026 | https://www.growthspreeofficial.com/blogs/b2b-saas-demo-request-conversion-rate-benchmarks-2026 | "Demo request CPLs $150-400 across paid channels; conversion rates drop from 8.2% to 6.4% with form friction" | `saas_*` + `offer_modifier(demo_request)` |
| `webfx-healthcare-2026` | WebFX Healthcare Marketing Benchmarks 2026 | https://www.webfx.com/blog/healthcare/marketing-benchmarks-for-healthcare/ | "Healthcare leads average $377 for B2B and $367 for B2C; B2C wellness CPLs range from $98 to $661 depending on service" | `dental_clinic`, `private_clinic`, `beauty_aesthetic`, `wellness_alt` |
| `wordstream-fb-2025` | WordStream Facebook Ads Benchmarks 2025 | https://www.wordstream.com/blog/facebook-ads-benchmarks-2025 | "Facebook lead ads CVR 7.72%, CPL $27.66 globally" | Global baseline used to derive Israel premium |
| `manus-il-cpl-2026` | Manus deep research output (internal) | docs/deep_research/manus-meta-evaluation-andromeda-2026-04-16.md | "Israel CPL $104.72 globally per Adamigo 2026 (~2.5× global $41.53); wartime spikes documented up to $385 (~₪1,400)" | Israel +Q4 + `security_event` |
| `grok-il-2026` | Grok deep research output (internal) | docs/deep_research/grok-meta-evaluation-andromeda-2026-04-15.md | "Israel CPM low (Tier 2) but CPL elevated due to small audience density and high advertiser saturation per Hebrew-speaking pool" | Israel premium rationale |

**Citation contract for `research` block:** when the agent uses a cell from §2:
- pick **2-3 source IDs** from §9 whose extracted quote covers the chosen base+modifiers,
- emit each as `{title, url, extracted}` per `propose_task.py` payload contract,
- set `context_used[]` from §3 match rules (e.g. `["vertical", "products", "service_regions"]`),
- set `market_average` = computed `value_ils` from the model,
- the proposal passes guardrail §26 **without a WebSearch round-trip.**

---

## 10. When to live-WebSearch anyway (escape hatch)

The static infrastructure handles the common path. Live WebSearch is still required when:

1. **Cell confidence is `low`** — `legal_corporate`, `real_estate_commercial`, `private_clinic`, `saas_dev_tech`. The static value is a placeholder; verify with 1-2 fresh searches before committing.
2. **Sub-vertical not in §2** — match rules in §3 return no hit. Don't fall back to flat vertical band silently; instead live-research and propose adding the sub-vertical to §2 via `alert`.
3. **Operator's set target is OUTSIDE the §2 band by >2×** — possible the operator has unusual unit economics or knows something the table doesn't. Live-search to verify; if research confirms operator, emit an `alert` proposing band update.
4. **Last-mile validation for high-stakes proposals** — if `propose_task` would set `target_cpl_ils` on a campaign with budget > ₪500/day, do at least one fresh search to confirm the static value isn't 6+ months stale.
5. **Business profile flagged `unusual: true`** in `business_settings` — operator explicitly marked this business as not fitting standard verticals.

Outside these cases, **trust the static cells.** Token budget per scan drops from ~3-5 WebSearch calls to 0.

---

## 11. Update protocol

This file is a snapshot of the 2026 IL market state. It drifts. Update triggers:

- **Quarterly** — agent runs Flow D (competitive research) and proposes `alert` updates if 2+ fresh primary sources disagree with a cell by >30%.
- **After a major security event** — operator flips `security_event=true`; on resolution, the agent re-WebSearches for fresh post-event CPL data and proposes a return to baseline (or adjusted baseline if the spike persists).
- **When a sub-vertical gets ≥3 real-data observations** — the agent's own `agent_decisions` history of actual CPL for a business in that sub-vertical can override the static value. After 3 distinct businesses or 90 days of single-business data, propose `alert` to update §2 with empirical band.
- **When the operator pushes back** — pushback on the band ("the agent says ₪200 but I know it's ₪450 in my market") triggers a single targeted WebSearch + an `alert` to update or branch the cell.

**Editing rule:** if you edit §2, §4, §5, §6, §7, or §8, also edit [`web/src/lib/cpl-infrastructure.ts`](../../web/src/lib/cpl-infrastructure.ts) in the same commit. UI shows the band from the TS file; agent acts on this MD file. They MUST agree.

---

## 12. Quick reference — Aiweon's own profile

Aiweon = `saas_marketing_tech` sub-vertical (per [memory: aiweon-product](../../C:/Users/harel/.claude/projects/d--meta-ads-automation-ai/memory/project_aiweon_product.md) — influencer marketing platform, B2B, marketing-to-marketer).

Default estimate for a cold demo-request lead form campaign, all-IL, non-peak month:

```
base = 420 (saas_marketing_tech)
× geo (il_all_country) = 1.00
× stage (cold) = 1.00
× offer (demo_request) = 1.80
× channel (lead_form) = 1.00
× season (current month) = 1.00 ± 0.20
─────────────────────────────────
estimated_cpl_ils ≈ 756 (band ₪450 – ₪1,440)
```

If switching channel to `click_to_whatsapp` (consultation, not demo): `420 × 1.00 × 1.00 × 1.00 × 0.55 = ₪231`. Massive CPL difference — this is why channel choice dominates the optimization for Aiweon.

**Cold-start caveat:** [memory: aiweon new account](../../C:/Users/harel/.claude/projects/d--meta-ads-automation-ai/memory/project_aiweon_new_account.md) — Aiweon's Meta ad account has zero history. First-campaign CPL will be 30-80% above the band above due to no Pixel data / no signal. Bake an extra ×1.4 first-30-days multiplier into recommendations until 50+ conversions accumulate.
