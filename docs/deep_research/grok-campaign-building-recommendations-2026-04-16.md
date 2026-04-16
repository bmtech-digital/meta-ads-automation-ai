# Grok — Recommendations for Building Campaigns (2026-04-16)

**Source:** Grok deep research
**Prompt:** recommendations for building campaigns

---

## 1. Executive summary

- **Power of One is reality in 2026**: One campaign + one ad set (broad) with 10–50+ diverse creatives is the default structure top operators use; fragmentation is now the exception, not the rule.
- **Advantage+ (ASC / Sales / Leads) + Andromeda ML is the new baseline**: Manual campaigns are legacy for most eCommerce; ASC has largely replaced them. Leads objective or Sales-with-lead-event both work for non-eCom.
- **Broad targeting + strong creative is mandatory**: Detailed interests/behaviors are suggestions only and rarely justified. Advantage+ Audience + minimal controls (country/age) wins.
- **Minimum viable budget**: $50–100/day practical per campaign (not Meta's $1–5 technical minimum) to exit learning reliably (~50 optimization events/week). Use Advantage+ Campaign Budget (CBO).
- **Launch with 10–15+ creatives minimum**: Prioritize Reels (9:16), Feed (4:5 & 1:1), Stories. First 3 seconds hook is load-bearing (Andromeda scores it explicitly). Mix video + static; enable Advantage+ Creative.
- **Advantage+ Placements is the default winner**: 11.7% lower CPA on average vs manual; only override for proven vertical-specific issues.
- **Pixel + CAPI + domain verification is non-negotiable** before launch. For lead-gen, optimize for "Lead" (on-platform) or specific website event (off-platform).
- **Landing page match + speed still matters massively** post-Andromeda; poor experience kills delivery and raises CPA.
- **Cold-start playbook**: Broad + Advantage+ Audience + diverse creatives + strong first-party signals (CAPI). LAL/custom audiences as optional suggestions only.
- **Naming & organization**: Consistent, parseable names (e.g., [Goal]_[Offer]_[Date]_[Test#]) are now table stakes for agent scalability.

## 2. Section-by-section answers

### 1. CAMPAIGN STRUCTURE — "POWER OF ONE" OR NOT?

Current best practice (2026): **Yes — "Power of One" (one campaign, one ad set, many creatives) is the actual operating model for the vast majority of accounts.** Andromeda rewards data density and creative volume over manual segmentation. Top operators (Jon Loomer, agency playbooks) have collapsed from 10+ campaigns / 50+ ad sets to 1–3 total campaigns.

Multiple ad sets/campaigns are still justified only in these specific situations:

- Testing completely different offers / product categories with distinct economics.
- Multi-country accounts where purchasing power or ad account currencies differ dramatically.
- High-ticket or complex sales cycles needing strict remarketing isolation (rare).
- Initial pixel training on a new business (run a small ABO test campaign first).

**ASC / Advantage+ Sales** has **largely replaced manual campaigns for eCommerce** (Meta and operators now treat manual as legacy). Hybrid testing is still common for the first 7–14 days on new stores. For **lead generation**, Advantage+ Leads or Advantage+ Sales (optimizing to a lead event) are both used; no full replacement of manual yet, but trend is toward automation.

### 2. CAMPAIGN OBJECTIVE SELECTION

Meta's current consolidated map (2026): Awareness | Traffic | Engagement | **Leads** | **Sales** | App Promotion.

- **eCommerce / direct revenue**: Sales (or Advantage+ Shopping when catalog is connected).
- **Lead generation (non-eCom)**: **Leads** objective for on-platform Instant Forms; **Sales** objective + website "Lead" / "Submit Application" / "Contact" event when driving to landing pages (top operators increasingly prefer the latter for higher-quality leads and better CAPI signals).
- **CAPI integration**: Does **not** change objective choice but dramatically improves signal quality for whichever objective you pick. Always use Pixel + CAPI (deduplicated).

Sources agree on the map; minor practitioner disagreement on Leads vs Sales for website lead-gen (some still default to Leads for simplicity).

### 3. AUDIENCE / TARGETING AT LAUNCH

**Default**: Advantage+ Audience ON + broad (country-wide or multi-country, age 18–65+, minimal or no gender). Detailed targeting, behaviors, and interests are **suggestions only** and rarely earn their keep (they add complexity with little proven lift).

LALs and custom audiences (CRM / site visitors / engagement) are still valuable **as suggestions/seeds**, especially for cold-start accounts, but **not** as hard restrictions. Meta's algorithm already prioritizes remarketing automatically.

**Zero-pixel-data cold start**: Use broad + Advantage+ Audience. Optional: upload any existing CRM list as custom audience suggestion or 1% LAL if you have even minimal seed data. Focus on creative quality and CAPI events from day one.

### 4. BUDGET — INITIAL ALLOCATION

Practical minimum daily budget (2025-2026 practitioner consensus): **$50–100/day per campaign/ad set** to exit learning reliably. Meta's technical minimum is $1–5 but meaningless. Aim for ~7–10 optimization events/day (50/week) per ad set.

**CBO (Advantage+ Campaign Budget) is the 2026 default** for launch — Meta distributes spend optimally. ABO only for very small tests or strict country separation.

**Compute starting budget**: (Target CPA × 7–10 events/day) or simply $100–300/day for most SMBs, then scale +20% every 3–4 days max. No Israel-specific budget data found.

### 5. CREATIVE AT LAUNCH

**Launch with 10–15+ creatives** (practitioner consensus; steady-state target 15–50+). Meta/Andromeda needs volume to optimize combinations.

Non-negotiable formats: Reels 9:16, Feed 4:5, Feed 1:1, Stories. Right Column and 16:9 can be skipped initially.

**Hook-in-first-3-seconds is still load-bearing** — Andromeda scores the opening separately. Diverse hooks per creative concept.

**Advantage+ Creative**: Helps (auto-variations, expansions) for most accounts; enable unless you have proven creative fatigue issues.

**Video + static mix**: Yes — video (especially UGC/Reels) dominates, but static/carousel still wins in certain verticals. Launch diverse.

### 6. PLACEMENTS

**Advantage+ Placements (auto) is the correct default** — Meta's own experiment showed 11.7% lower CPA. Manual only in rare verticals with proven poor performance on specific placements (e.g., Audience Network for high-ticket B2B). Prepare the four canonical ratios (1:1, 4:5, 9:16, 16:9) and let Meta mix.

### 7. OPTIMIZATION EVENT & PIXEL / CAPI SETUP

**Must verify before launch**: Pixel events firing correctly, CAPI connected & deduplicated, Aggregated Event Measurement (AEM) set, domain verified.

**Lead-gen optimization event**: "Lead" for Instant Forms; "Submit Application" / "Contact" / "Complete Registration" for website (choose the highest-funnel event you can reliably track).

**Cold-start playbook**: Broad targeting + diverse creatives + CAPI sending every possible signal (even micro-events). Expect 7–14 day learning; do not edit structure.

### 8. AD COPY & LANDING PAGE REQUIREMENTS

Primary text: flexible length (longer still works if scroll-stopping). Headline: concise & benefit-driven. CTA: match objective (e.g., "Learn More", "Get Quote", "Shop Now").

**Landing page speed / mobile experience / ad match still materially affect delivery and cost** in 2026 — Andromeda rewards quality signals.

Top mistakes that kill great ads: slow load (>3s), non-mobile-optimized, offer mismatch, no clear next step, poor trust signals, form friction.

### 9. NAMING CONVENTIONS & ACCOUNT ORGANIZATION

Top agencies (Jon Loomer, performance teams) use parseable, consistent naming:

- Campaign: `[OBJECTIVE]_[OFFER/CATEGORY]_[DATE]_[TEST#]`
- Ad Set: `Broad_[CountryGroup]_[Adv+Audience]`
- Ad: `[Hook/Concept]_[Format]_[V#]`

Metadata (test type, budget tier, creative batch) lives in names for agent parsing; use UTMs/tags for deeper analytics. No single universal standard, but consistency is critical for automation.

### 10. COMMON LAUNCH-PHASE MISTAKES

Most damaging (top operators):

- Over-fragmentation / too many campaigns/ad sets (pre-Andromeda habit).
- Budget too low (<$50–100/day) → stuck in learning forever.
- Too few creatives (<10 at launch) → no data density for Andromeda.
- Frequent structural edits → resets learning.
- Poor tracking (no CAPI, unverified domain).
- Ignoring creative refresh from day one.

**Deprecated pre-Andromeda rules now misleading**: "Detailed targeting silos", "many ad sets for LALs", "ABO over CBO", "one creative per ad set", "manual placements always better", "complex funnel campaigns with separate TOFU/MOFU/BOFU ad sets".

## 3. The "Day Zero Launch Checklist"

1. Verify Pixel + CAPI + domain + AEM (Events Manager).
2. Create campaign → Objective (Sales/Leads) + Advantage+ Campaign Budget ON.
3. Ad set → Advantage+ Audience ON, broad location/age, Advantage+ Placements ON.
4. Upload 10–15+ diverse creatives (Reels 9:16 priority, strong 3s hooks, mix formats). Enable Advantage+ Creative.
5. Set daily budget ≥ $50–100 (or enough for 7–10 events/day).
6. Name everything parseably.
7. Launch → monitor for 7 days minimum before any edits.
8. (Optional cold start) Add CRM/LAL as suggestions only.
9. Confirm landing pages are fast, mobile-first, and match ad creative/offer.

## 4. Deprecated launch rules

- Pre-Andromeda "many ad sets = control" → replaced by one ad set + creative volume.
- "Detailed targeting first" → replaced by creative-first + broad.
- "Minimum 3–5 creatives" → replaced by 10–50+.
- "Separate remarketing campaigns" → replaced by automatic Advantage+ prioritization + audience segments for reporting.
- "ABO for testing" → replaced by CBO + Advantage+ in most cases.

## 5. Open questions

- Exact "best" number of launch creatives still varies by vertical/spend level (10 vs 15 vs 20+).
- When (if ever) manual placements or strict detailed targeting still wins in Israel/MENA-specific verticals (no public 2026 data).
- Hybrid ASC + manual testing cadence for brand-new stores (some operators still do 7–14 day manual seed).
- Israel/MENA wartime or Hebrew/Arabic creative nuances — no practitioner sources specifically address this; agent will need human/A/B input.

## 6. Source list

**Meta official (2024–2026)**: Engineering blog (Andromeda, Dec 2 2024), Business Help Center (Advantage+ Sales, Advantage+ Placements).

**Practitioners (2025–2026)**: Jon Loomer (jonloomer.com articles on structure/targeting, 2026), Savannah Sanchez (creative volume & hooks).

**Data/tools & agency playbooks**: Optifox.in 2026 guide, Adbid.me, Sierra Social Marketing, multiple Reddit/LinkedIn operator threads cross-referenced with named experts.

No Israel/MENA-specific public data found beyond general best practices (use local language creatives, WhatsApp-friendly CTAs for leads).
