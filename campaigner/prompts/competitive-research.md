# Competitive Research — Weekly Market Intelligence

> **Audience:** Claude (the agent), loaded in **Flow D only**. Not part of the Flow A/B/C load order — token weight.
> **Scope:** WebSearch-driven research about market prices, trending creative angles, new ad formats, and competitor positioning in the business's vertical + region. **No Meta Ad Library in Slice 1.**
> **Output:** 3-5 `task_type='alert'` proposals per run, each with a populated `research` block (sources[] ≥ 2, context_used[]).
> **Cadence:** Mon 11:00 Asia/Jerusalem, weekly. One hour after Flow C so the runs don't collide.

---

## What this flow is — and is not

**It IS:** structured WebSearch shaped by `business_knowledge` (vertical, products, service_regions, competitors), synthesized into actionable insights the operator can read in /approvals and act on by adjusting briefs, ordering new creatives, or shifting strategy.

**It IS NOT:**
- A creative generator. Flow C does that.
- A direct-action flow. Every output is an `alert` (informational). The operator decides what to do.
- Permission to make claims without sources. Every alert that names a competitor, cites a price, or asserts a trend MUST attach `research.sources[] ≥ 2` with title + url + extracted quote. **Guardrail §27 `no_competitor_hallucinations` blocks proposals that violate this.**

---

## Inputs the agent loads at start

1. `load_business_knowledge --business-id $BUSINESS_ID` — gives you `vertical`, `products`, `service_regions`, `competitors`, `customer_age_*`, `ideal_customer`, `usp`, `brand_voice`. **All of these shape your queries.** A B2B SaaS platform in Israel selling to brand managers is a different query than a contractor in Tel Aviv selling to homeowners.
2. (Optional) `load_baselines --business-id $BUSINESS_ID` — current CPL/CPA/ROAS your account is seeing. Useful for the "is your current target stale?" thread of research.
3. (Optional) Recent agent_decisions where `node_name='competitive_research'` from the last 7 days — **cache check.** If you already researched the same topic this week, skip and log SKIP with `rationale="competitive_research_cache_hit"`.

Do NOT call `fetch_insights` here — that's Flow A's job. This flow is pure market-external.

---

## The three research lanes

Run each lane only if it adds value. Quality > quantity. **Total query cap per run: 12 WebSearch invocations.**

### Lane 1 — Market price drift (priority: high)

**Goal:** Detect if the median CPL/CPA/ROAS for the business's vertical + region has shifted since the operator's last target was set.

**Queries (shape per business — these are templates):**
```
"average cost per lead {vertical} Israel 2026"
"Meta lead ads CPL benchmark {vertical_hebrew} 2026"
"{vertical} marketing benchmark Israel Q1 2026"
```

Replace `{vertical}` with the actual `business_knowledge.vertical` (translated for the search — `b2b_saas` → "B2B SaaS"; `leads` → "B2C services" or the specific service vertical).

**Output:**
- If finding is **stale by ≥15%** vs the operator's current target → propose `task_type='alert'` with `alert_type='target_drift'`, `message="היעד הנוכחי (₪X) נמצא Y% מתחת/מעל לטווח השוק העדכני (₪A-₪B). מקור: [התאריך]. שווה לבחון עדכון."`, `next_steps=["לשקול לעדכן יעד דרך /business-knowledge", "להריץ set_kpi_target עם מחקר חדש"]`.
- If finding is **in band** → log observation, no proposal (this isn't news).

### Lane 2 — Trending creative angles (priority: medium)

**Goal:** What new angles are getting traction in this vertical right now? Output is "angles to consider for the next Flow C run", not "make this creative now."

**Queries:**
```
"trending Meta ad creative {vertical} 2026"
"{vertical} ad copy hooks that convert 2026"
"viral ads {vertical_hebrew} Israel"
"best performing {vertical} Facebook ads 2026"
```

**Output:**
- 1-2 `task_type='alert'` proposals with `alert_type='trending_angle'`, `message="זווית חדשה שמופיעה בכמה מקורות עבור [vertical]: '[angle in Hebrew]'. שימוש: [where it shows up]. רעיון לקריאייטיב: [one-line copy idea]."`, `next_steps=["לדרג zווית הזו ב-Flow C הבא", "להפיק 1-2 וריאנטים לבדיקה"]`.
- Maximum 2 trending_angle alerts per run. If you find more, rank by:
  1. Number of independent sources mentioning it (≥3 is strong)
  2. Recency (≤6 months old beats >12 months)
  3. Alignment with `business_knowledge.usp` + `brand_voice` (does this angle fit who Aiweon/the business actually is?)

### Lane 3 — New ad formats / placements (priority: low, opportunistic)

**Goal:** Catch when Meta or the platform layer rolls out a new format that fits the vertical (e.g., "Reels for B2B is now showing 2x click-through vs feed posts").

**Queries:**
```
"Meta new ad format 2026"
"Instagram Reels B2B Israel performance"
"Facebook Advantage+ {vertical} 2026"
```

**Output:**
- At most 1 `task_type='alert'` with `alert_type='new_format'`, `message="פורמט חדש: [name]. למה רלוונטי לעסק הזה: [one line]. עדויות: [source summary]."`
- Skip this lane entirely if you used your 12-query budget on Lane 1+2.

---

## The `research` block contract — mandatory

Every alert payload MUST embed a `research` object with this shape:

```json
{
  "alert_type": "target_drift" | "trending_angle" | "new_format",
  "message": "Hebrew, plain language, no acronyms in p1",
  "next_steps": ["...", "..."],
  "research": {
    "lane": "market_price" | "trending_angle" | "new_format",
    "queries_run": ["...", "..."],
    "sources": [
      {"title": "...", "url": "https://...", "extracted": "one-line quote that supports the claim"},
      {"title": "...", "url": "https://...", "extracted": "..."}
    ],
    "context_used": ["vertical=b2b_saas", "products=influencer_platform", "service_regions=ישראל"],
    "researched_at": "ISO-8601 timestamp"
  }
}
```

**Hard requirements (enforced by guardrail §27):**
- `sources[]` length ≥ 2 (single-source claims are not research)
- Every source has `title` + `url` + `extracted`
- `context_used[]` is non-empty (proves the search was business-specific)
- Any number in `message` (CPL ₪, percentage, etc.) MUST be extractable from at least one source's `extracted` field

---

## Output cap + prioritization

Per run, propose **at most 5 alerts total**, prioritized:

1. Lane 1 alerts (target_drift) — most actionable, can shift the next week's KPI math
2. Lane 2 alerts (trending_angle) — feeds Flow C
3. Lane 3 alerts (new_format) — strategic, rarely urgent

If you have more findings than 5, log the rest as `observation` decisions (visible in /history Block 3) and pick the top 5 to propose.

If you have zero findings worth surfacing — that's a legitimate outcome. Log a single `observation` decision with `summary="weekly_research_no_signal"` and exit. **Do not propose empty alerts to "fill the quota."**

---

## What to write in Hebrew

Per [hebrew-copy-style.md §11](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields):

- **Paragraph 1 of the rationale:** plain Hebrew, no English acronyms. The operator must understand it without marketing background.
- **Paragraph 2+:** technical detail with first-use glosses allowed (e.g., "CPL (עלות לליד)").
- **Numbers:** always with ₪ prefix for ILS, x suffix for ROAS, % for percentages.
- **Competitor names:** quote them as the source spells them. Don't translate brand names.

Example rationale opening for a `target_drift` alert:
> *"בדיקה שבועית: היעד שהגדרת לעלות לליד נמוך ב-30% מהממוצע השנתי בענף B2B SaaS בישראל. הטווח הנוכחי בשוק הוא ₪150-₪400. המשך לטרגט ₪90 ייתן לסוכן חופש פעולה צר מדי — הוא יפסול הצעות שמטרגטות אוכלוסיות שמרניות שעלולות בעצם להתאים."*

---

## What NOT to do in Flow D

- **Don't propose `new_creative` directly.** Even if you found a great angle — pipe it through `alert` so the operator decides, and Flow C generates the actual variant the week after.
- **Don't propose `set_kpi_target` directly.** Suggest it in `next_steps` of a `target_drift` alert; let the operator initiate. (`set_kpi_target` is its own proposal flow with its own research requirements per §26.)
- **Don't research things the agent already saw this week.** Check `agent_decisions.outputs.competitive_research_topics` for the last 7 days. Cache hit → SKIP with rationale.
- **Don't paste competitor ad copy verbatim into the alert.** Cite the angle / theme; copyright + voice integrity matter. "מתחרים משתמשים בזווית 'ROI calculator'" — OK. "מתחרה X כתב: 'חסוך 40 שעות בחודש'" — NOT OK (copyright risk + voice drift).
- **Don't trust a single source.** §27 requires ≥ 2. If WebSearch returns only one result for a query, expand the query or skip the finding.

---

## Where truth lives

| Question | Read |
|---|---|
| Output payload contract for `alert` | [`../tools/propose_task.py`](../tools/propose_task.py) VALID_TASK_TYPES `alert` entry |
| Source attribution + research block format | [kpi-benchmarks.md §"Primary flow: live research"](kpi-benchmarks.md#primary-flow-live-research) |
| Guardrail enforcement | [guardrails.md §27](guardrails.md) `no_competitor_hallucinations` |
| Hebrew voice rules | [hebrew-copy-style.md §11](hebrew-copy-style.md) |
| Flow D protocol | [`../CAMPAIGNER.md` §Flow D](../CAMPAIGNER.md#flow-d--weekly-competitive-research) |
