# Campaign Building Recommendations — Unified

**Last updated:** 2026-04-16
**Sources merged:** Manus (primary, tie-breaker) + Grok
**Raw source docs:**

- `deep_research/manus-campaign-building-recommendations-2026-04-16.md`
- `deep_research/grok-campaign-building-recommendations-2026-04-16.md`

> **Conflict resolution rule:** Where the two sources disagree, this doc follows Manus. Grok's divergent opinion is preserved inline as _Grok differs:_ for traceability.

---

## Executive summary

- **Andromeda (Meta's ML engine, rolled out 2024-2025) is the frame for every decision.** It rewards creative signals, broad audiences, and consolidated data density — and actively punishes pre-Andromeda habits like interest siloing and ad set fragmentation.
- **"Power of One" — evolved.** Consolidate aggressively, but Advantage+ Sales now permits multiple ad sets inside a single campaign for isolated testing or "learning protection." Default to one campaign / one ad set; escalate only for real reasons (see §1).
- **Advantage+ is the default for eCommerce.** ASC / Advantage+ Sales has largely replaced manual campaigns. For non-eCom lead gen, the **Leads** objective is the baseline; **Sales + website lead event** is a variant for accounts with strong pixel/CAPI data.
- **Broad targeting + strong creative.** "Creative is the targeting." Detailed interests/behaviors/LALs are legacy in most cases; use custom audiences as **seed data** for Advantage+ Audience, not as direct targeting.
- **Budget formula, not flat minimum.** `Minimum daily budget per ad set = (Target CPA × 50) / 7` — enough to clear Meta's ~50 events/week learning threshold. Example: $20 target CPA → ~$143/day.
- **CBO (Campaign Budget Optimization) is the default.** ABO only for specific controlled tests.
- **Launch with 3-5 high-quality diverse creatives.** Steady-state target is 10-50+ as you scale. Mix short-form video (Reels 9:16) + static (4:5, 1:1). First-3-seconds hook is scored explicitly by Andromeda.
- **Advantage+ Placements (auto) is the default.** ~11.7% lower CPA vs manual (Meta's own experiment).
- **Pixel + CAPI + AEM + domain verification are non-negotiable pre-launch.** Poor signal quality is the single most common reason ads never exit learning.
- **Landing page speed + mobile + ad-to-page match materially affect delivery cost** in the Andromeda era. Andromeda scores the full journey, not just the ad.
- **Cold start playbook:** broad + Advantage+ Audience + CAPI + diverse creatives + optional higher-funnel event (Landing Page View, View Content) to accumulate data before optimizing for the real conversion.
- **Naming must be parseable:** `[Funnel]_[Objective]_[Audience]_[Creative]_[Date]` → e.g. `TOFU_Sales_Broad_Video_20260416`.

---

## 1. Campaign structure — "Power of One" or not?

**Default:** Consolidated structure — one campaign, one ad set, many creatives.

Advantage+ Sales (which replaced Advantage+ Shopping) allows multiple ad sets inside a single campaign; use that capability sparingly, for:

- **Isolated testing** of a new creative concept or audience you don't want to disrupt scaling ad sets.
- **"Learning protection"** — keeping an experimental setup off the main budget allocator.
- Testing completely different offers / product categories with distinct economics.
- Multi-country accounts with dramatically different purchasing power or currencies.
- High-ticket / long sales-cycle businesses that need strict remarketing isolation (rare).

**For eCommerce:** Advantage+ Sales / ASC has largely replaced manual campaigns. Manual is reserved for specific testing or learning protection.

**For lead gen:** Leads objective is standard; Sales objective + website lead event is a credible alternative for accounts with high-quality pixel/CAPI data who want to optimize further down the funnel.

_Grok differs:_ Grok frames Power of One as "one campaign, one ad set" — stricter than Manus. Manus allows multiple ad sets inside one Advantage+ Sales campaign for flexibility. Following Manus.

---

## 2. Campaign objective selection

Meta's current objective map (2025-2026):

| Objective         | When to use                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| **Awareness**     | Reach & brand recall, TOFU branding                                                                 |
| **Traffic**       | Maximize clicks to site/LP                                                                          |
| **Engagement**    | Post interactions, video views, DMs                                                                 |
| **Leads**         | Instant Forms, Messenger, calls, or website lead conversions — default for most lead-gen businesses |
| **Sales**         | Purchases, catalog sales, high-value website/app conversions — default for eCommerce                |
| **App Promotion** | App installs & in-app events                                                                        |

**For a non-eCom lead-gen business:** Default to **Leads**. Use **Sales + website lead event** only if you have strong pixel/CAPI data and want to optimize for a deeper event (Submit Application, Contact, Complete Registration).

**CAPI** does not change which objective you pick — but it materially improves the signal quality feeding whichever objective you chose. Always use Pixel + CAPI, deduplicated.

---

## 3. Audience / targeting at launch

**Default: broad targeting + Advantage+ Audience ON.**

- "Broad" = country-wide (or multi-country), age 18-65+, minimal/no gender filter.
- **Detailed targeting (interests / behaviors / custom segments) is a suggestion only**, and hurts performance if overused. Justified only for initial creative validation or very niche markets.
- **Lookalikes are largely deprecated** in favor of Advantage+ Audience. Advantage+ Audience dynamically expands targeting using real-time performance signals — what LALs used to do, but better and more flexible.
- **Custom audiences (CRM, site visitors, engagement) remain valuable as SEED DATA** for Advantage+ Audience (not as hard direct targeting). For remarketing they can still be targeted directly.

**Zero-pixel-data cold start:** Broadest possible targeting + Advantage+ Audience + aggressive creative testing. Optimize for a higher-funnel event (View Content, Add to Cart, Landing Page View) to accumulate data fast. Prioritize CAPI from day one. Upload existing CRM as seed if you have anything at all.

_Grok differs:_ Grok is more forgiving of LALs and custom audiences as "suggestions/seeds." Manus is stricter — LALs are pre-Andromeda; custom audiences only as seeds. Following Manus.

---

## 4. Budget — initial allocation

**Use the formula, not a flat dollar minimum:**

```
Minimum daily budget per ad set = (Target CPA × 50) / 7
```

Rationale: Meta needs ~50 optimization events/week per ad set to exit the learning phase reliably.

Worked examples:

| Target CPA | Min daily budget |
| ---------- | ---------------- |
| $10        | ~$72/day         |
| $20        | ~$143/day        |
| $50        | ~$358/day        |
| $100       | ~$715/day        |

If you can't afford the formula-derived number, **optimize for a higher-funnel event with a lower CPA** (Landing Page View, View Content) until you have enough data to shift to the real conversion event.

**CBO (Campaign Budget Optimization) is the 2026 default.** Meta's AI distributes spend across ad sets for best total performance. Use ABO only for specific controlled tests or strict country separation.

Scale: increase budget by ~+20% every 3-4 days maximum to avoid resetting learning.

_Grok differs:_ Grok gives a practitioner rule of thumb ($50-100/day practical minimum). Manus' formula is more precise. Following Manus; keep Grok's floor as a sanity check if Target CPA is unknown.

---

## 5. Creative at launch

**Launch with 3-5 high-quality, diverse creatives.** Ramp to 10-50+ at steady state as you scale.

The priority at launch is **quality and conceptual diversity**, not volume. Andromeda needs enough signal to identify winning angles — more creatives in steady state, fewer but stronger at cold start.

**Non-negotiable formats:**

- **Reels 9:16** — short-form video, high engagement
- **Feed 4:5** — vertical image/video for main feed
- **Feed 1:1** — square, versatile across placements
- **Stories 9:16** — full-screen immersive

Right Column and other minor placements: skip initially; Advantage+ Placements will handle distribution.

**Hook in first 3 seconds: still load-bearing.** Andromeda scores the opening explicitly. Diverse hooks per concept.

**Advantage+ Creative (auto-variations, expansions):** Helps more often than it hurts. Enable unless you have concrete evidence of fatigue or conceptual mismatch between assets.

**Mix video + static.** Video (especially UGC/Reels) dominates, but static/carousel still wins in certain verticals. Launch diverse.

_Grok differs:_ Grok says launch with 10-15+ creatives. Manus says 3-5. Following Manus — the "launch small, scale creative volume" approach is less risky for a new account and lets you identify winning angles faster.

---

## 6. Placements

**Advantage+ Placements (auto) is the default.** Meta's own experiment shows ~11.7% lower CPA vs manual. Let Meta's AI mix Facebook, Instagram, Audience Network, Messenger.

Manual only in very specific verticals with proven poor performance on a given placement (e.g., high-ticket B2B on Audience Network).

**Prepare the four canonical aspect ratios:**

- **1:1** (square — versatile)
- **4:5** (vertical feed)
- **9:16** (Reels / Stories — full-screen vertical)
- **16:9** (horizontal — some video placements)

Providing native assets for these four ensures optimal rendering across all key placements; Advantage+ Creative can adapt at the margins but shouldn't be relied on to fabricate coverage you didn't provide.

---

## 7. Optimization event & Pixel / CAPI setup

**Pre-launch verification checklist:**

- **Pixel events** — all standard + custom events firing correctly on the site/app.
- **Conversions API (CAPI)** — implemented, deduplicated with Pixel, sending rich first-party signals.
- **Aggregated Event Measurement (AEM)** — configured, priority events ordered correctly (critical for iOS 14+ attribution).
- **Domain verification** — verified in Meta Business Manager.

**Optimization event selection:**

- **Lead gen:** Pick the highest-value event that fires frequently enough to hit ~50/week. Order of preference: Submit Application / Contact / Complete Registration → Lead → Landing Page View (fallback for zero-data accounts).
- **eCommerce:** Purchase (default), or Add to Cart / View Content as warm-up events for low-volume accounts.

**Cold-start playbook (new business, no pixel data):**

1. **Broad targeting** — maximize reach and signal collection.
2. **Initial higher-funnel objective** — Engagement / Traffic to populate the pixel, or optimize for Landing Page View / Initiate Checkout directly.
3. **Rapid creative testing** — 3-5 concepts, iterate based on early engagement.
4. **Escalate the optimization event** once you have enough data to switch to the real conversion.
5. **CAPI from day one** — the biggest lever for signal quality.

Do not edit the structure during the 7-14 day learning phase.

_Grok differs:_ Grok's cold-start jumps straight to the real objective with broad + Advantage+ Audience. Manus' staged approach (Traffic/Engagement warm-up → pivot to conversions) is more conservative and better suited to zero-data accounts. Following Manus.

---

## 8. Ad copy & landing page

**Copy:**

- **Primary text:** Hook in the first 1-3 lines (before the "See More" break). Longer storytelling below is fine if the opening earns the click.
- **Headline:** 5-7 words, benefit-driven, concise.
- **CTA:** Match the objective — "Shop Now" (Sales), "Learn More" (Awareness/Traffic), "Sign Up" / "Get Quote" (Leads). Test variants.

**Landing page — non-negotiable in the Andromeda era:**

Andromeda scores the full user journey, not just the ad. A slow or mismatched LP degrades delivery and raises cost.

Top landing-page mistakes that kill great ads:

- Slow load (>2-3 seconds, especially on mobile)
- Poor mobile responsiveness
- Mismatch between ad promise and LP content/offer
- Overly long or complex lead forms
- No clear CTA / next step
- Broken tracking or technical glitches

**Rule:** If the LP isn't mobile-first, fast, and perfectly aligned with the ad's offer, fix it before spending a dollar.

---

## 9. Naming conventions

Use a parseable, consistent naming structure at every level so humans and agents can scan the account:

```
Campaign: [Funnel Stage]_[Objective]_[Audience Type]_[Creative Type]_[Date]
Ad Set:   [Audience Type]_[Country/Region]_[Advantage+ Flag]
Ad:       [Hook/Concept]_[Format]_V[N]
```

**Example:**

- Campaign: `TOFU_Sales_Broad_Video_20260416`
- Ad Set: `Broad_IL_AdvPlus`
- Ad: `AiweonHook1_Reel_V2`

**Field definitions:**

- **Funnel Stage:** TOFU | MOFU | BOFU
- **Objective:** Sales | Leads | Traffic | Engagement | Awareness
- **Audience Type:** Broad | LAL | Custom | Retargeting | Interest
- **Creative Type:** Video | Image | Carousel | Dynamic
- **Date:** YYYYMMDD

**What lives in names vs tags/UTMs:**

- **In names:** high-level parseable identifiers (funnel stage, objective, audience type, creative type, date).
- **In UTMs/tags:** granular tracking parameters, specific audience IDs, creative variation details — anything that would bloat the name.

_Grok differs:_ Grok suggests `[Objective]_[Offer]_[Date]_[Test#]` — flatter, no funnel stage. Manus' funnel-stage-first format is more legible for multi-campaign accounts. Following Manus.

---

## 10. Common launch-phase mistakes

The damaging ones, ranked by how often they kill campaigns before they exit learning:

1. **Over-segmentation** — too many ad sets with small budgets or overlapping audiences. Fragments data, blocks learning.
2. **Insufficient budget** — under the `(Target CPA × 50) / 7` threshold → perpetual learning purgatory.
3. **Poor signal quality** — missing CAPI, unverified AEM, or unverified domain → Andromeda has nothing to optimize with.
4. **Weak or undiversified creative** — one creative, or 3 near-identical ones; no angle testing.
5. **Bad landing page experience** — slow, mismatched, or not mobile-first; Andromeda deprioritizes.
6. **Frequent edits during learning** — budget / targeting / creative changes reset learning.
7. **Vanity metric focus** — optimizing for CTR instead of ROAS / CPA / lead quality.

**Pre-Andromeda rules now actively misleading:**

| Pre-Andromeda rule                      | 2026 replacement                                                           |
| --------------------------------------- | -------------------------------------------------------------------------- |
| Granular interest targeting as default  | Broad + Advantage+ Audience; creative is the targeting                     |
| Excessive ad set duplication to scale   | Consolidated campaign + CBO + Advantage+ Sales                             |
| Manual placement optimization           | Advantage+ Placements (auto)                                               |
| ABO as the default for testing          | CBO as the default                                                         |
| "One creative per ad set" discipline    | 3-5 at launch, 10-50+ at steady state, Advantage+ Creative                 |
| Separate remarketing campaigns          | Auto-prioritization inside Advantage+; use audience segments for reporting |
| Complex TOFU/MOFU/BOFU ad set structure | One consolidated ad set; funnel lives in creative + audience signals       |
| CTR-first optimization                  | ROAS / CPA / lead quality                                                  |

---

## Day Zero Launch Checklist

An agent should run through this in order before clicking "Publish":

1. **Verify tracking infrastructure** — Pixel + CAPI (deduplicated), AEM configured with priority events, domain verified.
2. **Select one campaign objective** — align to business goal (Sales / Leads / etc.).
3. **Set broad audience + Advantage+ Audience ON** — country-wide, age 18-65+. Optional: upload CRM as seed.
4. **Compute daily budget** — `(Target CPA × 50) / 7`. Use CBO.
5. **Prepare 3-5 diverse creatives** — Reels 9:16, Feed 4:5, Feed 1:1, Stories 9:16. Strong 3-second hook on video. Enable Advantage+ Creative.
6. **Advantage+ Placements ON** — let Meta mix.
7. **Write copy + verify LP** — concise primary text, 5-7 word headline, objective-matched CTA. LP fast, mobile-first, matches ad offer.
8. **Name everything parseably** — `[Funnel]_[Objective]_[Audience]_[Creative]_[Date]` pattern.
9. **Review + launch** — then leave it alone for 7 days minimum. No edits during learning.

---

## Open questions

- **Israel/MENA creative nuances** — no 2026 practitioner data on Hebrew/Arabic creative vs. English in broad IL targeting, or on wartime-context sensitivity. Agent should rely on human/A/B input for localization decisions.
- **Optimal creative refresh cadence for niche markets** — 5-10 new creatives/week may be unsustainable for very small TAMs; the right cadence is an open question.
- **Manual placement exceptions by vertical** — limited public 2026 data on when manual still beats Advantage+ Placements in specific IL/MENA verticals.
- **Advanced CAPI event prioritization for multi-step funnels** — how to best order AEM events for complex lead-gen journeys remains an area of live practitioner experimentation.

---

## Sources

**Meta official (2024-2026):** Engineering blog (Andromeda, Dec 2 2024); Business Help Center (Advantage+ Sales, Advantage+ Placements).

**Practitioners:** Jon Loomer (structure, targeting, Advantage+ Sales); Savannah Sanchez (creative volume & hooks); WordStream (objectives map 2026); Optifox (best practices 2026); Silver Spoon Agency; AdNabu; AdStellar AI; Affect Group (Israel 2026 audience breakdown).

**Raw research docs:** `deep_research/manus-campaign-building-recommendations-2026-04-16.md`, `deep_research/grok-campaign-building-recommendations-2026-04-16.md`.
