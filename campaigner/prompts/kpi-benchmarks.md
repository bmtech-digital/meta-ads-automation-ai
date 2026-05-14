# KPI Benchmarks — IL Market 2026

> **Audience:** Claude (the agent), loaded when reasoning about target setting or reality-checking operator-provided targets.
> **Scope:** Median-centered ranges per (vertical, kpi). FALLBACK only — when you can't do live research (no WebSearch tool, no time budget). **Real benchmarks come from your live web research at runtime**, scoped to the business's specific vertical + products + region.
> **Sync:** Mirror of `web/src/lib/kpi-benchmarks.ts`. **Edit both together.** The web file is what the operator sees in the form (also fallback); this is what you read at runtime. If they disagree, the operator sees one thing and you act on another — a credibility breaker.

## ⚡ Primary flow now: read [`cpl-infrastructure.md`](cpl-infrastructure.md) first

**Added 2026-05-13.** The flat per-vertical bands below are now a **second-tier fallback.** For any business with `vertical`, `products`, and `service_regions` populated, the authoritative source is the multi-dimensional grid in [`cpl-infrastructure.md`](cpl-infrastructure.md). The grid:

1. Maps `business_knowledge` to a **sub-vertical** (e.g. `saas_marketing_tech` instead of bare `b2b_saas`).
2. Applies geo / funnel-stage / offer / channel / season modifiers — so two `leads` campaigns in different cities with different offers get **different** benchmarks, not the same ₪90 median.
3. **Ships with primary sources pre-extracted** (§9 of that file) — you can satisfy guardrail §26 `set_kpi_target_requires_research` by citing two source IDs from there, **without spending a WebSearch round-trip.** Token saving is the explicit goal.

**Decision rule for the agent:**

```
if business has vertical + products + service_regions:
    → use cpl-infrastructure.md (cite 2-3 primary_sources from §9, set context_used[])
    → live WebSearch only when cell confidence='low' OR sub-vertical unmapped OR last-mile validation (see §10 of that file)
else:
    → fall back to the flat bands in this file (next section)
    → live WebSearch is still the preferred path for high-stakes proposals
```

The flat bands below are kept for: business-knowledge form rendering (the operator sees `bandMedianHe` on every input), legacy `getBenchmark(vertical, kpi)` callers in the UI, and as the final fallback when `vertical=other` or sub-vertical match returns `fallback` confidence.

## Primary flow: live research (preferred when grid says so)

When you need a benchmark — for a `set_kpi_target` proposal, for a `§T-2` reality-check, for a rationale comparison — **do live web research first.** Use the WebSearch tool with queries shaped from `business_knowledge`:

```
Example queries (lead-gen, IL B2B services):
  "average cost per lead Israel B2B SaaS 2026"
  "Meta lead ads CPL benchmark Israel marketing services 2025"
  "<vertical-specific term in Hebrew> עלות לליד ממוצעת"

Example queries (e-commerce, fashion DTC):
  "average ROAS DTC fashion Israel 2026"
  "Shopify Israel benchmark CPA <product category>"
```

What to extract from each result:
- A typical value or range (in ILS for CPA/CPL, multiplier for ROAS).
- The publication date — if older than 18 months, treat as weak signal; weight recent stronger.
- The methodology — "median across X advertisers" beats "one case study."

Synthesize across 2-5 sources. Output the `research` block (see propose_task.py payload contract). Always include `sources` array with title+url+extracted-quote so the operator can verify.

**Cache:** write the research result into `agent_decisions.outputs.benchmark_research` keyed by `(business_id, kpi)`. Re-use for 30 days unless business_knowledge changes (new vertical, new products) — then re-research.

**Reality-check the research itself:** if the live research returns "₪3 per lead" (implausible) — don't use it. Cross-reference against the static band below, log a low-confidence diagnosis, and either ask the operator OR fall back to band median.

## When to use this file

1. **`set_kpi_target` proposals.** Operator hasn't set a target for their `primary_kpi`. Pick a recommended value from the band below + a "how we get there" plan, and propose for approval.
2. **§T-2 reality-check gate.** Operator already set a target (via /business-knowledge). Compare it to the band. If outside `[implausible_below, unambitious_above]` — emit `alert` proposal explaining the gap.
3. **Performance comparison narratives.** When writing rationale for any approval that references performance ("CPL ₪150 ב-7 ימים אחרונים"), explicitly compare to the band so the operator gets context: "₪150 — בקצה העליון של הטווח התקין (₪60-₪180)".

## Bands

### Leads — B2C services (lead-gen for local services, real-estate, contractors, insurance agents)

- **CPL (target_cpl_ils):**
  - implausible_below: ₪15
  - good_max: ₪60
  - median: ₪90
  - realistic_max: ₪180
  - unambitious_above: ₪400
  - source: Meta IL B2C services 2026 — ליד לקוח-קצה בפלח שירותים מקומיים
- CPA: not applicable (use CPL).
- ROAS: not applicable.

### B2B SaaS / Platforms (demo requests from marketers, agencies, brand managers — long sales cycle, high deal value)

- **CPL (target_cpl_ils):**
  - implausible_below: ₪30
  - good_max: ₪150
  - median: ₪250
  - realistic_max: ₪400
  - unambitious_above: ₪800
  - source: Meta IL B2B SaaS / platforms 2026 — demo request ממנהל שיווק / סוכנות / מותג. ליד גם כן מקצועי, מחזור מכירה ארוך, ערך עסקה גבוה מ-B2C services בכמה סדרי גודל.
- CPA: not applicable in MVP (use CPL — multi-stage funnel MQL→SQL→customer requires v2 instrumentation).
- ROAS: not applicable (subscription LTV, not transactional).

**When to pick this over `leads`:** product is a SaaS / platform / agency offering, **buyers are themselves marketers or brand managers**, sales cycle ≥ 2 weeks. If you're unsure (e.g. a contractor selling to other contractors), default to `leads` and revisit after the first cohort.

### E-commerce (DTC brands, physical goods, AOV ₪150-₪400)

- **CPA (target_cpa_ils):**
  - implausible_below: ₪8
  - good_max: ₪35
  - median: ₪60
  - realistic_max: ₪120
  - unambitious_above: ₪300
- **ROAS (target_roas, higher = better):**
  - implausible_below: 1.2x
  - realistic_max: 2.0x (band lower bound for "ok")
  - median: 2.8x
  - good_max: 4.0x (band upper bound for "good")
  - unambitious_above: 1.5x (anything below = aiming low)
- CPL: not applicable.

### Awareness (reach, brand campaigns, top-of-funnel)

- No CPA/CPL/ROAS targets in MVP. Operator setting one for awareness = mismatch; emit alert "objective mismatch — awareness campaigns optimize against CPM/reach, not CPA/CPL/ROAS."

### App (mobile install)

- **CPA (target_cpa_ils):** install + first-open event.
  - implausible_below: ₪5
  - good_max: ₪20
  - median: ₪35
  - realistic_max: ₪80
  - unambitious_above: ₪200

### Other (no vertical chosen)

- Use the **leads** band as a soft default; in the same approval, emit a side `alert` asking the operator to set a real vertical so benchmarks sharpen.

## Reality-check verdict (how you classify a value)

For CPA/CPL (lower=better):
- `value < implausible_below` → **implausible**. Emit alert "value below realistic floor, won't optimize toward it."
- `value ≤ good_max` → **good**. Aspirational but achievable — proceed.
- `value ≤ realistic_max` → **ok**. Default expectation — proceed.
- `value ≤ unambitious_above` → **worrying**. "You're setting a low bar; the agent will achieve it easily but the business may have more upside."
- `value > unambitious_above` → **off_band**. Operator either misunderstood the scale or has unusual unit economics — emit alert and ask for clarification.

For ROAS (higher=better) — inverted logic, but same verdict labels.

## How `set_kpi_target` rationale must be written

**Required content** (operator feedback 2026-05-13: generic "עסקים שדומים לך" is not enough — the operator wants to see WHICH service the agent analyzed and WHICH competitors it anchored on):

```
תוכנית קובעת:
  1. ערך מומלץ: <value> <unit>   (לדוגמה: ₪90 ל-CPL ל-leads)
  2. למה הערך הזה — **חובה לציין שני דברים ספציפיים**:
     a. **איזה שירות נותח** — שם השירות מ-business_knowledge.products
        (לדוגמה: "ניתחתי את 'משפיענים — שיתופי פעולה עם כוכבי אינסטגרם'"),
        או הרשימה של 2-3 שירותים אם כולם משתייכים לאותו תת-ורטיקל.
        אסור "עסק שדומה לך" כללי.
     b. **איזה מתחרים שימשו עוגן** — שמות מ-business_knowledge.competitors
        (לדוגמה: "מול הצעות המחיר של HumanX, Klear ו-Lemonade Marketing").
        אם מתחרים=[] — כתוב במפורש "אין מתחרים מוגדרים, השוואתי מול ממוצע
        ענפי כללי של תת-ורטיקל X" כדי שהאופרטור ידע שהוא מפסיד דיוק.
  3. איך מגיעים: 3-5 צעדים קונקרטיים — איזה objective, איזה תקציב יומי, איזה
     audience seed, וכמה זמן עד שמצפים לראות את הערך מתייצב.
  4. מה אם לא נצליח: מה ה-fallback (set lower target, expand audience, etc.)

rationale עברית פשוטה — פסקה ראשונה ללא ראשי תיבות.
```

**Multi-product businesses:** when business.products lists distinct services that
match different sub-verticals (e.g. Aiweon = AI agents + AI videos + Campaigner +
influencers → matches `saas_marketing_tech` and `agency_services` simultaneously),
the agent picks the highest-scoring sub-vertical for the proposal but **must say
which one** in rationale §2a. If the operator's reaction is "but my main product
is X, not Y" — they edit products to make X dominate, and the next run reroutes.

**Source of the matched sub-vertical name:** the `estimate_cpl` tool returns
`match.sub` + `match.matched_terms` + `match.confidence_of_match` in its JSON.
Echo `match.matched_terms` into rationale §2a verbatim — that's the proof of
which product words triggered the routing.

## What changes from this file should never break

- The columns referenced (target_cpa_ils, target_cpl_ils, target_roas) — they live in migration 019.
- The verticals — they match `Vertical` enum in `db/types.ts`.
- The numeric scale — ILS for CPA/CPL, dimensionless multiplier for ROAS.

If you find yourself wanting to add a new vertical or a new KPI here, that's a schema change — propose via `alert` first, don't invent.
