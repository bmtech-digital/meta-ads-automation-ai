# Decision Tree — דיאגנוזה לפי תרחיש

> **Source:** [campaigner-spec §17](../../docs/plans/campaigner-spec.md#17-עץ-החלטות-לדיאגנוזה).
> **Prereqs:** [performance-brain.md](performance-brain.md) §§3-5 (data sufficiency + two gates). אל תפעיל את העצים בלעדיהם.
> **Output language:** כל `rationale` ו-`summary` שיוצא מהעץ הזה — עברית פשוטה, רהוטה ודיבורית, שמובנת גם למי שלא בתחום השיווק. ראה [hebrew-copy-style.md §11](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields). פסקה ראשונה — בלי ראשי תיבות באנגלית.

---

## סדר ההפעלה

1. **תמיד קודם §T-1 (Budget Utilization Gate)** — לכל קמפיין פעיל, לפני כל אבחון אחר. אם Meta לא מוציאה את התקציב, אין טעם לאבחן קריאייטיב — אין מספיק חשיפות כדי להסיק.
2. **אחר כך §T0r (Top-Level Router)** — מסווג כל קמפיין שעבר את §T-1 לאחד מ-6 מסלולי החלטה. זה החלק הכי קריטי בעץ: בלי הסיווג, הסוכן נופל אוטומטית ל-§T0 ומציע קריאייטיב חדש בכל מצב.
3. ה-Router מעביר ל-**Gate 1** (§T0 — creative-level) רק אם הסיווג הוא `routine_observation` או `creative_refresh_candidate`. מסלולים אחרים (`scale_up_candidate`, `scale_down_candidate`, `creative_pool_exhausted`, `hands_off`) הולכים לעצים הייעודיים שלהם.
4. אם §T0r הוביל ל-`hands_off` → `skip` decision עם rationale שמציין מה הענף שעצר (cooldown / noise / calendar / learning).
5. אם כל השערים עברו ללא action → `skip` decision עם rationale "healthy, no action needed".

---

## §T-1 — Budget Utilization Gate (must run first)

> **Source:** "Check utilization before the budget setting." Red flag: budget utilization < 50% means Meta is refusing to spend the current budget — do not suggest raising it; find out why Meta will not spend what it already has. Implements M3 in [decision-map.md](../../docs/plans/decision-map.md).
> **Why first:** אם Meta מוציאה רק 30% מהתקציב, ה־5,100 חשיפות שראית ב-30 יום הם תוצאה של underspending, לא תוצאה של ביצוע. אבחון קריאייטיב במקרה הזה הוא טיפול בסימפטום ולא בסיבה.

**חישוב (per-campaign):**

```
window_days = 7   # window יציב; פחות מזה — רעש של Meta delivery
spend_window_ils  = sum(insights.spend)  # last 7 days, per campaign
expected_window   = daily_budget_ils × window_days
utilization       = spend_window_ils / expected_window
```

**Status thresholds:**

| Utilization | Status | משמעות |
| --- | --- | --- |
| < 50% | `severely_under` | Meta מסרבת להוציא את התקציב. בעיית alignment ברורה — pool, audience, או auction. |
| 50% – 80% | `under` | Meta מוציאה חלק; בודקים למה לא הכל. |
| 80% – 105% | `healthy` | תקציב נצרך כראוי. עוברים ל-§T0. |
| > 105% | `over` | overspend בודד — Meta תאזן ביום הבא; לא action בלעדי. |

```
§T-1: Budget Utilization
  │
  ├─ status == "severely_under" (utilization < 50%)
  │  │  פעולה ראשונה: אבחן למה. **בלוק קשיח על `task_type=new_creative`** — אסור להציע
  │  │  וריאנט חדש כשהבעיה היא שאף אחד לא רואה את הקיים. הוסף קריאייטיב = לזרוק עוד דליים
  │  │  למאגר ריק. (guardrail: `no_new_creative_when_underspending` יפסול.)
  │  │
  │  ├─ pool check: האם ה-objective תואם ל-business intent?
  │  │  (CONVERSIONS על LEAD_GENERATION-grade audience, או הפוך → mismatch)
  │  │  → propose alert task_type="alert" עם rationale שמתאר את ה-mismatch.
  │  │    אל תציע objective change אוטומטי — זה מאפס Learning ודורש decision של בעל-עסק.
  │  │
  │  ├─ audience size check: estimated_audience_size < 200K?
  │  │  → propose expand_audience: broad + Advantage+ Audience.
  │  │    rationale (בעברית פשוטה): "Meta לא מצליחה למצוא מספיק אנשים שמתאימים להגדרות
  │  │    הנוכחיות, ולכן היא מוציאה רק חלק קטן מהתקציב. הרחבת הקהל תיתן לה יותר ממי לבחור."
  │  │
  │  ├─ CPM check: CPM נוכחי > 3× ממוצע ישראלי ($8.38)?
  │  │  → סימן שה-auction מתמחר אותנו החוצה. propose alert + propose new_creative
  │  │    only with explicit override (guardrail בודק).
  │  │
  │  └─ אם שום אבחנה לא תופסת:
  │     → log_decision diagnosis "underrun_unknown_cause" עם confidence נמוך,
  │        propose alert task_type="alert" עם rationale שמבקש מהמשתמש לבחון
  │        edits אחרונים / Learning reset.
  │
  ├─ status == "under" (50%-80%)
  │  └─ פעולה: מותר להמשיך ל-§T0, **אבל** ה-rationale של כל הצעה שתיצור מ-§T0 והלאה
  │     **חייב לפתוח** במשפט שמסביר שהתקציב לא נוצל במלואו: "המודעה רצה 7 ימים והוציאה
  │     ₪X מתוך ₪Y מתוכננים (Z%). אנחנו ממליצים גם על [פעולה] כדי לעזור ל-Meta לנצל
  │     את התקציב הקיים." זה דורש מהסוכן להראות receipts גם כשהוא ממשיך, לא לדלג עליהם.
  │
  ├─ status == "healthy" (80%-105%)
  │  └─ פעולה: עבור ל-§T0 כרגיל. תיעד utilization ב-`inputs` של ה-diagnosis decision.
  │
  └─ status == "over" (>105%)
     └─ פעולה: monitoring only. אל תציע scale-down על overspend בודד; Meta תאזן ביום
        הבא. אם over נמשך 3+ ימים → טפל תחת §T2 winner branch.
```

**Output הצפוי מ-§T-1:**

```json
{
  "summary": "ניצול תקציב לקמפיין X: <status> (<utilization>%)",
  "rationale": "<עברית פשוטה — TL;DR בלי מספרים, ואז הנתונים>",
  "inputs": {
    "daily_budget_ils": ...,
    "spend_window_ils": ...,
    "expected_window_ils": ...,
    "utilization": ...,
    "window_days": 7
  },
  "outputs": {
    "status": "severely_under | under | healthy | over",
    "blocks_new_creative": <bool>,
    "suggested_actions": [...]
  }
}
```

**טולים (זמינים מ-2026-05-12):**
- `fetch_insights --level campaign --days 7` — שואב `spend` ושאר metrics לחלון של 7 ימים.
- `fetch_meta_state --object-type campaign --object-id <id>` — שואב `daily_budget` (insights לא מחזיר אותו). הפלט כולל `daily_budget_minor_units` שצריך לחלק ב-100 לקבלת ILS.
- חישוב `utilization = spend_7d / (daily_budget_ils × 7)` נעשה ב-prompt (אין כלי ייעודי בנפרד — זה math פשוט שלא מצדיק tool נוסף).

---

## §T-2 — Per-Campaign Service Anchor (must run after §T-1, before §T0r)

> **Source:** operator feedback 2026-05-13 — "הסוכן רק ניתח את המשפיענים אבל הסרטון שרץ הוא על סוכן AI". Multi-product businesses (e.g. AIWEON: סוכני AI + סרטוני AI + קמפיינים AI + מיתוג משפיעות) need per-campaign sub-vertical anchoring, not aggregate.
> **Why this exists:** without this, `estimate_cpl` would pick whichever sub-vertical the business's aggregate `products[]` matches strongest, and EVERY campaign would get that same anchor. So a campaign about "סוכן AI" would still get the CPL band of "influencers" if influencers dominate the products list — wrong service, wrong band, wrong rationale.

### Per-campaign workflow (for every campaign that passed §T-1)

```bash
# 1. Pull the campaign's Meta name — needed for the matcher
CAMPAIGN_STATE=$(python -m campaigner.tools.fetch_meta_state \
  --business-id $BUSINESS_ID --object-type campaign --object-id $CAMPAIGN_ID)
CAMPAIGN_NAME=$(echo "$CAMPAIGN_STATE" | jq -r '.state.name')

# 2. Call estimate_cpl with the campaign name — terms in the name get ×3 weight
ESTIMATE=$(python -m campaigner.tools.estimate_cpl \
  --business-id $BUSINESS_ID \
  --campaign-name "$CAMPAIGN_NAME")

# 3. Cache for this run — the next decision-tree stages (T0r, T1, T2+, etc.)
#    consume `ESTIMATE.match.sub` + `ESTIMATE.match.matched_terms` instead of
#    re-running the matcher.
```

The `match.matched_terms` array is the **proof of which service the campaign is about**. When the agent writes any rationale, it must reference these terms (per [guardrails.md §26](guardrails.md#26-set_kpi_target_requires_research-חדש-2026-05-12-פתח-static-path-2026-05-13)).

### Why this happens here (between §T-1 and §T0r)

§T-1 already pulls `fetch_meta_state` for `daily_budget` — getting `name` from the same call is free (Meta returns it in the same response). Running §T-2 before §T0r means every router rule sees the per-campaign sub-vertical, so when §T0r asks "is `cpa_vs_target` off?" the answer is computed against the right band, not the business aggregate.

### Behavior when campaign name is uninformative

The `estimate_cpl` tool surfaces this in its `campaign_name_diagnostic` block. When `campaign_name_diagnostic.is_generic = true` (the tool's `is_generic_campaign_name` returned True — empty, < 5 chars, "Campaign", "Campaign 1", "test", "untitled", "$DATE", all-numbers patterns):

- `estimate_cpl` falls back to business-aggregate matching (campaign-name hits 0 terms because no service words are in the name).
- The tool sets `campaign_name_diagnostic.agent_action = "propose_alert_rename_campaign"`.
- **The agent MUST emit a low-priority `alert` proposal** (idempotent — skip if a pending alert for this campaign with `alert_type='generic_campaign_name'` already exists):

```bash
python -m campaigner.tools.propose_task \
  --business-id $BUSINESS_ID --run-id $RUN_ID \
  --task-type alert \
  --campaign-id $CAMPAIGN_ID \
  --urgency low \
  --payload '{"alert_type":"generic_campaign_name","reason":"<from diagnostic.reason>"}' \
  --rationale "שם הקמפיין הנוכחי ('<NAME>') לא ספציפי — הוא לא מאפשר לי לזהות איזה מהשירותים שלך הוא מקדם. אני ממליץ לשנות לשם תיאורי שכולל את שם השירות (לדוגמה: 'סוכן AI - שלב 1'). בלי שם תיאורי, האומדן שלי נופל ל-vertical הכללי של העסק במקום לתת-ורטיקל הספציפי של השירות."
```

The alert is **acknowledgment-only** — operator approving = "I'll rename it" (no automatic Meta API call to rename, that's a future enhancement). Until renamed, every subsequent scan continues with aggregate matching and re-emits the alert at low priority.

### §T-2.1 — Multi-product matched_terms in rationale

When the agent proposes a `set_kpi_target` (or any approval where rationale mentions market context), the rationale **must** name:

- The specific service identified — pulled from `match.matched_terms` (e.g. "ניתחתי את 'סוכן AI'" not "ניתחתי שירות").
- The 1-3 competitors from `business_knowledge.competitors` that anchor the comparison (or, if empty, the explicit "אין מתחרים מוגדרים" sentence).

This is enforced by [guardrails.md §26 rationale content check](guardrails.md#26-set_kpi_target_requires_research-חדש-2026-05-12-פתח-static-path-2026-05-13).

---

## §T0r — Top-Level Router (must run after §T-1, before §T0)

> **Source:** [decision-map §3](../../docs/plans/decision-map.md#3-how-top-practitioners-think--synthesis) (P1-P8) + research synthesis 2026-05-12. Implements the "real campaigner brain" — classify every campaign into one of 6 lanes before deciding what to propose.
> **Why this exists:** עד היום הסוכן נפל ישר ל-§T0 (Gate 1 קריאייטיב) לכל קמפיין שעבר את §T-1. תוצאה: הצעות `new_creative` בכל מצב, גם כשהקמפיין חזק ויש מקום להגדיל תקציב, גם כשהמאגר ריק וצריך firehose, גם כשעדיף לא לגעת. ה-Router הזה מחליף את ה-default ההוא.

### Inputs לסיווג ומהיכן הם באים (עודכן 2026-05-12)

| Input | מקור | טול |
| --- | --- | --- |
| `campaign_status` ∈ {LEARNING, LEARNING_LIMITED, ACTIVE} | Meta object state | `fetch_meta_state.state.status` (Meta delivery status) + פרשנות לפי conversions_7d/days_active |
| `utilization_7d` | §T-1 output | חישוב מ-`fetch_insights` + `fetch_meta_state.daily_budget_minor_units` |
| `cpa_vs_target` (או cpl/roas) | `business.primary_kpi` + יעד | `load_business_knowledge.kpi_target.target_value`. **אם null → קרא ל-`estimate_cpl --business-id $BID --campaign-name "$CAMPAIGN_NAME"` קודם** (חוסך WebSearch + מבטיח התאמת תת-ורטיקל לקמפיין הספציפי; ראה §T-2.1 למטה). אם הוא מחזיר `needs_live_research=false` — הצע `set_kpi_target` עם ה-`research_block` שלו ועקב את הברנצ'. אם `needs_live_research=true` או `confidence_of_match=fallback` → המשך לפי §26 נתיב B (WebSearch חי) או log SKIP. `fetch_insights.actions` ל-current. |
| `hook_rate_top` | Meta insights ad-level | `fetch_insights --level ad --days 7` → max(video_play_actions/impressions) |
| `frequency_7d` | Meta insights | `fetch_insights --level campaign --days 7` |
| `fatigue_flag` | computed locally | `check_creative_fatigue --business-id ... --days 7` (Block 5, 2026-05-12). Per-ad ratio current_cpr / prior_cpr ≥ 2.0 → flag. Aggregate `any_fatigue` at campaign level. |
| `hours_since_last_edit` | Meta object state | `fetch_meta_state.hours_since_last_edit` |
| `active_creative_count` | DB + insights | `list_active_creatives --with-performance --perf-days 7` returns `active_with_impressions_count` (creatives with impressions ≥ 100 in window). This is the §T_PE threshold metric. |
| `days_since_last_creative_add` | DB | `list_active_creatives` order by `created_at DESC LIMIT 1` |
| `last_scale_up_at` + `delta_conv_since_last_scale` | DB + Meta | `check_marginal_return --campaign-id <id>` |
| `cpm_delta_pct` (current vs prior 7d) | Meta insights | `fetch_insights --with-prior-window` |

### Router rules (sequential — first match wins)

```
§T0r: classify campaign C
  │
  ├─ R0  hours_since_last_edit < 72h
  │       → lane: hands_off                              (§T_HO branch "post_edit_cooldown")
  │       why: כל שינוי מאפס למידה. 72 שעות הן זמן ה-re-stabilization של Andromeda.
  │
  ├─ R1  campaign_status == LEARNING (≤ 7d ו-conversions_7d < 50)
  │       → lane: hands_off                              (existing §T4 logic)
  │       why: guardrail `no_learning_phase_touch` חוסם הכל ממילא; אין טעם לנתח.
  │
  ├─ R2  campaign_status == LEARNING_LIMITED
  │       → lane: targeted_intervention                  (existing §T5 logic)
  │       why: יציאה מ-Learning דורשת או scale_up עד min_budget או expand_audience.
  │
  ├─ R3  utilization_7d < 0.5                            (severely under)
  │       → lane: pool_misalignment                      (§T-1 severely_under branch)
  │       why: כל פעולה אחרת לפני שמתקנים pool/audience זריקת תקציב.
  │
  ├─ R4  fatigue_flag == true
  │       → lane: creative_refresh_candidate             (§T1 fatigue branch — firehose 3-5)
  │
  ├─ R5  cpa_vs_target > 3.0  AND  conversions_7d == 0  (3+ ימים)
  │       → lane: emergency_pause                        (§T1 emergency)
  │
  ├─ R6  cpa_vs_target > 1.3 sustained 5+ days
  │     │
  │     ├─ AND CTR > 2% AND no conversions  → lane: landing_page_issue  (§T1 alert)
  │     ├─ AND CTR < 1%                     → lane: creative_refresh    (§T1 CTR-low branch)
  │     └─ otherwise                         → lane: scale_down_candidate (§T_SD)
  │
  ├─ R7  active_creative_count < 5  OR  days_since_last_creative_add > 7
  │       → lane: creative_pool_exhausted                (§T_PE — firehose 3-5 מ-creative-guide §7)
  │       why: ענה לבקשת הלקוח "אין לי עם מה לעבוד". אסור לפעול עד שיש מאגר.
  │
  ├─ R8  cpa_vs_target ≤ 1.0  AND  utilization_7d ≥ 0.95
  │       AND  frequency_7d < 2.5
  │       AND  hook_rate_top > 0.30
  │       AND  fatigue_flag == false
  │       → lane: scale_up_candidate                     (§T2+ — extended winner branch)
  │       why: קמפיין חזק עם מקום לצמיחה. כפוף ל-marginal-return guard ול-cadence cap.
  │
  ├─ R9  utilization_7d > 1.05  sustained 3+ days
  │     │
  │     ├─ AND winner-grade (R8 conditions also true)  → lane: scale_up_candidate (R8)
  │     └─ otherwise                                     → lane: hands_off (§T_HO "sustained_over_no_winner")
  │       why: Meta מאזנת overspend בודד; אם זה נמשך 3+ ימים ולא winner-grade, log SKIP ולא scale.
  │
  └─ R10 default
        → lane: routine_observation                     (§T0 — Gate 1 per creative + SKIP if all healthy)
```

### Output mandatory per כל קמפיין שעבר את ה-Router

```bash
python -m campaigner.tools.log_decision \
  --business-id "$BUSINESS_ID" --run-id "$RUN_ID" \
  --graph-name observe_propose --node-name route \
  --decision-type diagnosis \
  --summary "<קמפיין>: <lane> (<rule_matched>)" \
  --rationale "<עברית פשוטה: מה הסיווג ולמה — ראה hebrew-copy-style §11>" \
  --campaign-id "<id>" \
  --inputs '{"utilization_7d":0.42,"cpa_vs_target":0.85,"hook_rate_top":0.38,...}' \
  --outputs '{"lane":"scale_up_candidate","rule":"R8","next_branch":"§T2+"}'
```

זה ה-receipt שכל ריצה משאירה — בלי קשר אם בסוף הוצעה פעולה. ב-UI זה נראה כ"הסוכן בדק את הקמפיין הזה והגיע למסקנה X" גם כשאין proposal.

---

## §T0 — Early Creative Evaluation (Gate 1)

**חלון:** 48h - 7d מהעלאת הקריאייטיב.

```
FOR EACH active creative:

  ┌─ data sufficient? (≥ 1,000 impressions AND ≥ 50 clicks)
  │  └─ לא → log SKIP, wait for volume, המשך לקריאייטיב הבא
  │
  ├─ Hook rate < 25% אחרי 48h?
  │  └─ מסקנה: לא עוצר גלילה
  │     action: KILL creative (pause), propose new_creative עם hook שונה (§7.5)
  │
  ├─ CTR < 1% עם ≥ 1,000 חשיפות?
  │  └─ מסקנה: הנעה לפעולה חלשה / חוסר התאמה לקהל
  │     action: KILL creative, propose new_creative עם angle אחר
  │
  ├─ Hook 25-35% + CTR תקין?
  │  └─ מסקנה: solid — תן זמן
  │     action: אל תיגע. log SKIP. חוזר בסבב הבא.
  │
  └─ Hook > 35% + CTR > 2%?
     └─ מסקנה: winner potential
        action: propose new_creative × 2-3 (iterate על הזווית המנצחת)
```

**עיקרון קריטי:** ב-Gate 1 **לא** מסתכלים על CPA / ROAS. אלה lagging ב-48h. אם ה-stakeholder שואל "אבל ה-CPA בסדר" — תקן אותו דרך ה-rationale: "Gate 1 בודק אם הקריאייטיב עוצר גלילה ומושך קליק. CPA נבדק ב-Gate 2 רק אחרי יציאה מ-Learning."

---

## §T1 — CPA יקר מדי (Gate 2)

**תנאי כניסה:** קמפיין `status=ACTIVE` (יצא מ-Learning, ≥ 50 המרות ב-7 ימים), CPA > יעד × 1.3 למשך 5+ ימים.

```
CPA > יעד × 1.3 למשך 5+ ימים
  │
  ├─ CTR < 1%?
  │  └─ מסקנה: המודעה לא מעניינת / הקהל לא נכון
  │     action: propose new_creative (firehose 3-5 וריאנטים), לא pause
  │
  ├─ CTR גבוה (> 2%), אין המרות?
  │  └─ מסקנה: בעיה בדף הנחיתה / ב-Offer — לא בקריאייטיב
  │     action: propose alert — "CTR גבוה אבל לנטישה בדף הנחיתה"
  │              (task_type='new_creative' לא יעזור. rationale מציין תחום האחריות)
  │
  ├─ Meta Creative Fatigue flag (CPR ≥ 2× היסטורי)?
  │  └─ מסקנה: שחיקת קריאייטיב — Meta מזהה לבד
  │     action: propose new_creative × 3-5 (diversity).
  │     **אל תציע pause** — guardrail `prefer_add_creative_over_pause` יפסול.
  │
  ├─ Frequency > 3?
  │  └─ monitoring signal בלבד. אם CPR יציב, אל תיגע (guardrail `no_frequency_only_kill`).
  │     אם CPR לא יציב → טפל תחת ענף ה-Fatigue flag למעלה.
  │
  └─ Emergency (CPA > 3× יעד OR 3+ ימים 0 conversions עם תקציב מלא)?
     └─ action: propose pause_campaign עם urgency='urgent'
```

---

## §T2+ — Scale-Up Candidate (extended winner branch)

> **תנאי כניסה:** הגיע מ-§T0r R8 או R9 winner-grade. CPA ≤ יעד, utilization ≥ 95%, frequency < 2.5, hook > 30%, ללא fatigue. **גם** קמפיין שפוגע ביעד (לא רק × 0.8) עם תקציב נצרך לחלוטין — לפי בקשת הלקוח 2026-05-12: "אם קמפיין טוב ויש אפשרות להגדיל אותו אז להמליץ".
> **Source:** Extended from original §T2 + research synthesis 2026-05-12.

### Pre-checks (כולם חייבים לעבור לפני שמציעים scale_up)

```
§T2+: Scale-Up Candidate
  │
  ├─ Pre-check 1: Marginal-return guard (חדש 2026-05-12)
  │  טול: `check_marginal_return --business-id ... --campaign-id ...`
  │  - אם `last_event == null` (אין הגדלה ב-14 יום) → guard passes, continue.
  │  - אם `diagnostic_only == true` (החלון הקודם 0 conversions, או post window עוד לא הבשיל)
  │    → guard passes עם diagnostic note, ammend rationale עם הסיבה.
  │  - אם `passes_guard == false` → BLOCK scale_up. השתמש ב-`block_reason`
  │    מהטול בתור rationale (כבר כתוב בעברית).
  │  guardrail: `marginal_return_check_before_scale_up` יפסול.
  │
  ├─ Pre-check 2: Marginal-CPM guard (חדש 2026-05-12)
  │  IF cpm_last_7d / cpm_prior_7d > 1.15  AND  conversions flat (±5%)
  │  → BLOCK scale_up. log SKIP rationale="cpm_inflation_no_lift".
  │     המשמעות: ה-auction מתמחר אותנו החוצה — יותר תקציב = יותר תחרות פנימית,
  │     לא יותר המרות.
  │
  ├─ Pre-check 3: Cadence cap (חדש 2026-05-12, Roi 2026-05-12)
  │  IF count(approvals WHERE task_type IN ('scale_up','budget_change')
  │                       AND target_id=campaign_id
  │                       AND executed_at within last 7 days) ≥ 1
  │  → BLOCK scale_up. log SKIP rationale="weekly_cadence_cap".
  │     guardrail: `scale_up_cadence_max_1_per_week` יפסול.
  │     הסבר ל-Roi (אם שאל): "הגדלת תקציב כל פעם דורשת ל-Meta לאזן מחדש pacing.
  │     הגבלה ל-פעם בשבוע נותנת זמן למסע ההגדלה הקודם להתבטא בנתונים."
  │
  └─ Pre-check 4: בעיית קופי שמסתתרת מאחורי "winner"
     IF active_creative_count < 5 OR days_since_last_creative_add > 7
     → REROUTE ל-§T_PE (creative pool exhausted).
        scale_up עם מאגר ריק = שריפה מהירה. תחזיר את הסוכן לבנות מאגר קודם.
```

### אם כל ה-Pre-checks עברו — magnitude logic

```
Pre-checks passed → choose magnitude:
  │
  ├─ Branch A: Classic winner (CPA < target × 0.8 + 5-7d stable)
  │  AND hook > 35% AND frequency < 2.0 AND status=ACTIVE
  │  → propose scale_up 30%
  │     guardrail check: `budget_jump_max_30pct` — תנאים עליונים מותרים.
  │
  ├─ Branch B: Solid winner (CPA < target × 0.8 + 5-7d stable, התנאים העליונים לא במלואם)
  │  → propose scale_up 20% (default)
  │
  ├─ Branch C: "פוגע ביעד + מקום לצמיחה" (חדש 2026-05-12)
  │  Roi 2026-05-12: "אם קמפיין טוב ויש אפשרות להגדיל אותו אז להמליץ
  │                   בגלל שאין לנו דברים חדשים על הפרק תגדיל את התקציב
  │                   (רק אם זה באמת יעיל)."
  │
  │  Trigger: cpa_vs_target between 0.85 and 1.05  (פוגע ביעד, לא כוכב)
  │           AND utilization_7d ≥ 0.95
  │           AND hook_rate_top > 0.30 AND frequency_7d < 2.5
  │           AND no fatigue_flag
  │           AND all 4 pre-checks above passed
  │           AND active_creative_count ≥ 5 (יש עם מה לעבוד)
  │  → propose scale_up +15% (שמרני מ-default 20% — קמפיין יציב, לא מצטיין)
  │     urgency='medium'
  │     rationale (עברית פשוטה, פסקה ראשונה ללא ראשי תיבות):
  │       "הקמפיין עומד ביעד ומוציא את כל התקציב שלו, בלי סימני שחיקה.
  │        מציע הגדלה של 15% — Meta כבר יודעת מי הקהל ויש סיכוי גבוה שתעביר
  │        את התקציב הנוסף לאותם אנשים ותביא יותר תוצאות בעלות דומה."
  │     rationale שלב 2 (מותר acronyms עם הסבר):
  │       "CPA (עלות להמרה) X לעומת יעד Y. Frequency Z, hook rate W%.
  │        כל הסימנים יציבים. אם 7 ימים אחרי ההגדלה ההמרות יעלו ב-10%+ —
  │        הצעה הבאה. אם לא — הסוכן יחזיר אותך לאבחון."
  │     payload: {"new_daily_budget_cents":..., "old_daily_budget_cents":...,
  │               "magnitude_pct":15, "marginal_return_baseline_conv":...}
  │     **חובה**: תוכנית mini-section לפי hebrew-copy-style.md §11.6.
```

### חובה: אל תציע horizontal scaling ע"י duplication

מאפס Learning. `no_horizontal_scaling_by_duplication` יפסול. תמיד vertical (budget+).

**Cannibalization check (Advantage+):** v2. ב-MVP לא בודק.

---

## §T_SD — Scale-Down Candidate (חדש 2026-05-12)

> **תנאי כניסה:** הגיע מ-§T0r R6 default (cpa_vs_target > 1.3 sustained 5+ days, ללא fatigue, ללא CTR-low). תחום ה-CPA: 1.3-3.0× יעד (מעל זה Emergency Pause ב-§T1).
> **Source:** Roi 2026-05-12 — "מתי מורידים?" החלטה: scale_down ענף מלא, -15% per step, ניתוק tighter Learning reset.

### למה scale_down ולא pause?

הקמפיין **לא שבור** — הוא יקר. CPA פי 1.3-1.5 מהיעד עם נתונים יציבים = יש פעילות, יש המרות, רק בעלות גבוהה מהרצוי. pause מוחק 7+ ימי למידה. הורדת תקציב משמרת את הלמידה, מאיטה את הקצב, ונותנת לרוי זמן להחליט אם להחליף קופי / קהל / יעד.

### לוגיקה

```
§T_SD: Scale-Down Candidate
  │
  ├─ Pre-check 1: Status check
  │  IF campaign_status != ACTIVE  → BLOCK. log SKIP rationale="scale_down_blocked_not_active".
  │     guardrail: `no_scale_down_in_learning` יפסול.
  │     נימוק: שינוי תקציב בקמפיין שעוד לא יצא מלמידה מאפס את הספירה.
  │
  ├─ Pre-check 2: Recent edit cooldown
  │  IF hours_since_last_edit < 72h  → BLOCK. log SKIP rationale="scale_down_post_edit_cooldown".
  │     נימוק: השינוי הקודם עוד לא התייצב. אל תוסיף שינוי על שינוי.
  │
  ├─ Pre-check 3: Recent conversion check
  │  IF last_conversion_at within 24h  → propose alert במקום scale_down.
  │     נימוק: המרה חיה = הקמפיין רלוונטי. הורדת תקציב יכולה לחתוך מומנטום
  │     בדיוק כשהוא מתחיל לעבוד. מעדיפים שהאדם יחליט.
  │
  ├─ Pre-check 4: Cadence cap (חדש 2026-05-12)
  │  IF count(approvals WHERE task_type='scale_down' AND target_id=campaign_id
  │                       AND executed_at within last 14 days) ≥ 1
  │  → BLOCK. log SKIP rationale="consecutive_scale_down_blocked".
  │     guardrail: `no_consecutive_scale_down_14d` יפסול.
  │     נימוק: שתי הורדות רצופות = פאוזה איטית. אם אחת לא תיקנה — צריך לעצור ולשנות
  │     קופי או יעד, לא להוריד עוד.
  │
  └─ אם כל ה-Pre-checks עברו:
     → propose scale_down -15% (צעד יחיד, לעולם לא יותר ב-proposal אחד)
        urgency='medium'
        rationale (עברית פשוטה, פסקה ראשונה):
          "הקמפיין יקר מהיעד ב-30%-50% אבל יציב — הוא מביא לידים, רק בעלות גבוהה
           מהמתוכנן. מציע להוריד תקציב ב-15% כדי לחסוך עד שתחליפו קופי/קהל,
           בלי לאבד את כל הלמידה שנצברה."
        payload: {"new_daily_budget_cents":..., "old_daily_budget_cents":...,
                  "magnitude_pct":-15, "reason":"cpa_over_target_stable"}
        תוכנית mini-section חובה לפי hebrew-copy-style §11.6 — בדרך כלל:
          1. הורדה -15% עכשיו (שימור Learning)
          2. בעוד 7 ימים: אם CPA חזר לטווח — להגדיל בחזרה. אם נשאר יקר — להציע
             קופי חדש (לא הורדה נוספת).
          3. אם גם הקופי החדש לא משנה — pause ובחינה של pool/objective.
```

### מתי לא scale_down אלא משהו אחר

- CPA > 3× יעד OR 0 conversions 3+ ימים → §T1 Emergency Pause.
- CPR ≥ 2× baseline (fatigue) → §T1 fatigue branch → new_creative × 3-5.
- CTR < 1% → §T1 CTR-low → new_creative עם angle אחר.

scale_down הוא ענף **דיאגנוסטי-שמרני** — "יקר אבל עובד, וצריך זמן להחליט".

---

## §T_PE — Creative Pool Exhausted (חדש 2026-05-12)

> **תנאי כניסה:** הגיע מ-§T0r R7. `active_creative_count < 5` OR `days_since_last_creative_add > 7`.
> **Source:** Roi 2026-05-12 — "חבר אין לי עם מה לעבוד חייב קריאייטיבים חדשים". Pool-exhaustion threshold: 5 או 7-day-staleness (default per Roi).
> **Inputs (מבולוק 5, 2026-05-12):**
> - `active_creative_count` ← `check_creative_fatigue.active_with_impressions_count` *או* `list_active_creatives --with-performance.active_with_impressions_count` (שניהם מחזירים את אותו מספר; הראשון זול יותר אם כבר רץ ל-fatigue check).
> - `days_since_last_creative_add` ← `list_active_creatives` סורק `creative_gallery.uploaded_to_meta_at DESC LIMIT 1`; הסוכן מחשב diff מ-now().

### למה זה ענף נפרד מ-§T1 fatigue?

| ענף | טריגר | פעולה |
| --- | --- | --- |
| §T1 fatigue | Meta Creative Fatigue flag (CPR ≥ 2× baseline) | new_creative × 3-5 + שמירת הקיים |
| §T_PE (חדש) | המאגר עצמו קטן (פחות מ-5 פעילים) או מבוגר (7+ ימים ללא תוספת) | new_creative × 3-5 + log תיעוד שהמאגר התרוקן |

ההבדל קריטי: §T1 מציע קריאייטיב חדש כי הקיים נשחק. §T_PE מציע כי **אין מאגר** — הקמפיין רץ על אדים. המסר לרוי שונה לחלוטין.

### לוגיקה

```
§T_PE: Creative Pool Exhausted (Block 8 — gallery-first 2026-05-13)
  │
  ├─ Step 0 (חדש 2026-05-13): Gallery census — לפני שמייצרים, בודקים מה כבר יש
  │  python -m campaigner.tools.list_active_creatives \
  │    --business-id $BUSINESS_ID --unused-in-campaigns --matches-channel feed
  │  → viable_unused_count: N
  │
  │  סף ההחלטה (target = 3-5 קריאייטיבים בסך הכל):
  │  ├─ N ≥ 3: propose redeploy_creative × min(N, 5) במקום new_creative.
  │  │         rationale (עברית פשוטה, פסקה ראשונה):
  │  │         "המאגר של הקמפיין הזה התרוקן: רק X קריאייטיבים פעילים, אבל בגלריה יש
  │  │          N תמונות/סרטונים שעוד לא נוצלו. נשתמש בהם לפני שניצור חדשים — זול
  │  │          יותר, מהיר יותר, ולא נבזבז אסטים שכבר שילמנו עליהם."
  │  │         payload לכל redeploy_creative:
  │  │           {creative_gallery_id: <id>, adset_id: <adset_id>, link_url: <lp>}
  │  │
  │  ├─ N = 1 או 2: mixed — propose redeploy_creative × N + new_creative × (3 - N)
  │  │         rationale מציין את התערובת: "נטמיע N אסטים מהגלריה שעוד לא נוצלו,
  │  │          ונשלים ב-(3-N) חדשים כדי להגיע למינימום של 3 וריאנטים פעילים."
  │  │
  │  └─ N = 0: propose new_creative × 3-5 (הזרימה הקודמת — firehose מלא).
  │
  ├─ Step 1 (כשהענף הוא new_creative — כלומר N < 3):
  │  propose new_creative × (3-5 minus redeploys כבר מ-Step 0)
  │  - 3-4 hooks שונים × אספקטים 1:1 / 4:5 / 9:16
  │  - אם business_knowledge.creative.allow_video=true → לפחות 1 video
  │  - בחר angles מ-creative-guide §2 שלא בשימוש בקמפיין הזה ב-30 הימים האחרונים
  │
  ├─ rationale ל-new_creative (כש-N = 0):
  │  "המאגר של הקמפיין הזה התרוקן: רק X קריאייטיבים פעילים והאחרון נוסף לפני Y ימים.
  │   הגלריה ריקה מאסטים שעוד לא נוצלו, אז מציעים סדרה של 3-5 וריאנטים חדשים
  │   במגוון זוויות, שתאפשר ל-Meta לבחור מי עובד עכשיו."
  │
  ├─ תוכנית mini-section חובה:
  │  1. אישור הוריאנטים שיועלו (זו ההצעה הנוכחית — redeploy/new לפי הענף).
  │  2. בעוד 7 ימים: לבחון hook rate של החדשים. המנצחים — תיעוד לזווית שעובדת.
  │     המפסידים — נשמרים בגלריה (לא נמחקים — Meta תבחר לבד).
  │  3. הצעה הבאה: עוד 3-5 וריאנטים על הזווית המנצחת (iteration), או על
  │     זווית חדשה אם כולם נכשלו.
  │
  ├─ **Payload contract ל-`new_creative`** (מ-2026-05-12, wired ב-execute_task):
  │  נדרש: `adset_id` (או target_kind='adset' + target_id), `headline`, `primary_text`,
  │  `cta`, `link_url`, ואחד מ-{`image_path` | `creative_gallery_id` | `image_url`}.
  │  אופציונלי: `description`, `page_id`, `name`, `aspect_ratio`, `channel`
  │  (`feed` | `stories` | `reels` — נדרש כדי שגארדריל §28 יוכל לרוץ),
  │  `source_preference: 'generate_new'` (override מפורש של §28).
  │  הקריאייטיב נוצר PAUSED — המשתמש מפעיל ב-Meta UI כשהוא מוכן.
  │
  └─ **Payload contract ל-`redeploy_creative`** (חדש 2026-05-13, Block 8):
     נדרש: `creative_gallery_id`, `adset_id`, `link_url`.
     אופציונלי: `name`, `page_id`, `headline`/`primary_text`/`cta` (override),
     `force_reupload: bool`. אם לאסט בגלריה יש כבר `meta_creative_id` ולא דרסת
     את הקופי — execute_task עושה short-circuit: יוצר Ad חדש על הקריאייטיב הקיים
     ב-Meta בלי upload חוזר. חיסכון בעלות ובזמן.
```

---

## §T_HO — Hands-Off (חדש 2026-05-12)

> **תנאי כניסה:** הגיע מ-§T0r R0 / R1 / R9-otherwise / או כל ענף שאמר "אל תיגע".
> **Source:** The "do-nothing-first" doctrine — Andromeda self-corrects within 48-72h, per decision-map P6.

### למה ענף ייעודי?

עד היום SKIP היה default שקט — הסוכן לא הציע ולא תיעד למה. התוצאה: UI לא מראה "הסוכן בדק והחליט לא לגעת", ויש תחושה שכלום לא קורה. §T_HO מאלץ תיעוד מפורש של "לא נוגעים כי X".

### תת-ענפים

```
§T_HO: Hands-Off
  │
  ├─ post_edit_cooldown (72h)
  │  log SKIP rationale="post_edit_cooldown_72h":
  │    "הקמפיין נערך לפני X שעות. Meta עדיין מאזנת מחדש את הלמידה.
  │     אבחון חוזר מעל למקור-עצמו של הרעש. נחזור בעוד Y שעות."
  │
  ├─ learning_phase (status=LEARNING, < 50 conv, ≤ 7d)
  │  log SKIP rationale="learning_phase_protected":
  │    "הקמפיין בלמידה הראשונית. כל שינוי מאפס את הספירה ל-7 ימים נוספים.
  │     מחכים שייצא לבד או שיגיע ל-budget_daily_min_ils."
  │
  ├─ noise_single_day_spike
  │  signal יום בודד < 3× baseline.
  │  log SKIP rationale="single_day_noise":
  │    "תנודה של יום בודד — לא signal. נדגום שוב מחר."
  │
  ├─ calendar_anomaly (Shabbat / חג)
  │  log SKIP rationale="calendar_anomaly":
  │    "שבת/חג. נתוני יום החג לא משקפים behavior רגיל."
  │
  └─ sustained_over_no_winner (utilization > 1.05 3+ days but not winner-grade)
     log SKIP rationale="sustained_over_no_action":
       "ה-overspend נמשך X ימים אבל הקמפיין לא עומד בתנאי winner.
        scale-down בלי signal של בעיה (fatigue/CPA-high) שובר Learning;
        אנחנו מחכים שאחד הסימנים יופיע."
```

ב-UI, ה-SKIP-ים האלה יוצגו כ"החלטות שקופות" — קלפי "הסוכן בדק את X והחליט לא לגעת כי Y". זה שונה משקט מוחלט.

---

## §T3 — ירידה רוחבית בכל החשבון

**תנאי כניסה:** CPA עלה בכל הקמפיינים הפעילים באותו יום, או ירידה של > 30% ב-conversions יומיות.

```
ירידה רוחבית בחשבון
  │
  ├─ יום בשבוע חריג (שבת/חג)?
  │  └─ אין action. log SKIP rationale="calendar_anomaly"
  │
  ├─ חג / מועד (Pesach, Rosh Hashana, ...)?
  │  └─ v2: Operation Mode "Holiday". ב-MVP אין action, log SKIP rationale="holiday"
  │
  ├─ חדשות חריגות (מלחמה / אירוע ביטחוני)?
  │  └─ v2: Operation Mode "Storm". ב-MVP log SKIP rationale="external_event"
  │     (CPL בישראל קפץ ל-$385 באוגוסט 2025 — זה נורמלי לאירועים כאלה)
  │
  └─ שום אחד מהנ"ל?
     └─ action: propose alert — "ייתכן תקלה טכנית — בדוק Pixel/Events"
        task_type='new_creative' לא מתאים. השתמש ב-log_decision 'error' עם rationale
        מפורט; המשתמש יראה ב-UI.
```

---

## §T4 — קמפיין ב-Learning Phase

**תנאי כניסה:** `status=LEARNING` (conversions_7d < 50 AND days_active ≤ 7).

```
Learning Phase
  │
  ├─ action ברירת מחדל: אל תיגע
  │  └─ guardrail `no_learning_phase_touch` יפסול כל פרופוזל שנוגע בקמפיין זה
  │
  └─ חריג יחיד: תקציב מתחת ל-budget_daily_min_ils (§6 performance-brain)?
     └─ action: propose scale_up עד לתקציב מינימלי
        rationale: "קמפיין לא ייצא מ-Learning ב-תקציב הנוכחי. חישוב מינימלי: (CPA×50)/7 = X"
        guardrail: `no_learning_phase_touch` בודק `task_type` — scale_up חוקי כאן, pause לא.
```

---

## §T5 — קמפיין Learning Limited

**תנאי כניסה:** `status=LEARNING_LIMITED` (conversions_7d < 50 AND days_active > 7 AND not trending up).

```
Learning Limited (>7d בלי 50 conversions)
  │
  ├─ תקציב מתחת ל-budget_daily_min_ils?
  │  └─ action: propose scale_up עד לתקציב מינימלי
  │
  ├─ יותר מ-3 ad sets צרים בקמפיין?
  │  └─ action: propose consolidate — למזג ל-ad set אחד broad
  │     task_type: 'expand_audience' עם payload שמתאר את ה-merge
  │
  └─ קהל צר מאוד (< 1M)?
     └─ action: propose expand_audience — broad + Advantage+ Audience
        rationale: "Andromeda עובד טוב יותר ב-broad"
```

---

## §T6 — Cold Start (חשבון חדש ללא היסטוריה)

**תנאי כניסה:** זה קיים ב-memory — Aiweon Meta account הוא חדש, אין historical baselines.

```
Cold start account
  │
  ├─ §T6.0 — אפס קמפיינים בכלל (active_campaign_count == 0 AND lifetime_spend == 0)
  │  זה Day-Zero. עוד לא קרה כלום בחשבון. תפקידך כאן הוא להציע התחלה — לא לחכות.
  │
  │  ├─ pre-check: business_knowledge מספיק לקמפיין ראשון?
  │  │  דרישות מינימום: vertical, service_regions לפחות אחד, products לפחות אחד.
  │  │  ├─ לא → log SKIP rationale="knowledge_missing_for_first_campaign"
  │  │  │     propose approval task_type=update_business_knowledge
  │  │  │     urgency=urgent, rationale מסביר אילו שדות חסרים.
  │  │  │     אל תציע new_campaign על קרקע חסרה.
  │  │  └─ כן → המשך:
  │  │
  │  ├─ pre-check: tracking_verified ב-business_knowledge?
  │  │  ├─ false → log SKIP rationale="tracking_unverified"
  │  │  │     אל תציע new_campaign — guardrails.md חוסם בלאו הכי.
  │  │  │     הדרך הנכונה: המשתמש לוחץ "בדוק עכשיו" ב-/integrations → מאשר.
  │  │  └─ true → המשך:
  │  │
  │  └─ propose new_campaign (קמפיין ראשוני, urgency=high)
  │     החלטות שאתה לוקח (תיעוד מלא ב-rationale):
  │       • objective ← business_knowledge.vertical (מיפוי ב-CAMPAIGN_BUILDING_RECOMMENDATIONS §2):
  │           ecommerce → CONVERSIONS, leads → LEAD_GENERATION,
  │           awareness → REACH/BRAND_AWARENESS, app → APP_INSTALLS, other → ENGAGEMENT
  │       • daily_budget ← business.daily_budget_ils
  │           אם null → monthly_budget_ils / 30, בעיגול ל-₪10.
  │       • audience: broad + Advantage+ Audience
  │           seed: service_regions (location), customer_age_min/max (אם קיים),
  │           שפה: he. אל תצמצם interests — Andromeda עובד טוב יותר רחב.
  │       • placement: Advantage+ Placements (כולל IG אם selected, אחרת FB בלבד)
  │       • status הצעה: PAUSED (HITL invariant — המשתמש מאשר את הפעלת התשלום)
  │       • creative_brief: פסקה אחת — מהמותג, השירות העיקרי, ו-marketing_angle.
  │           המשתמש או §T6.1 ישלים את הקריאייטיב.
  │
  │     payload חייב לכלול:
  │       requires_human_review=true,
  │       human_review_reason="first_campaign_initialization"
  │
  │     rationale (עברית פשוטה, פסקה ראשונה ללא ראשי תיבות):
  │       "החשבון [שם העסק] עוד לא הריץ קמפיינים. תקציב חודשי ₪X זמין לניצול.
  │        זו ההצעה הראשונה לבחינה שלך: [סוג קמפיין], תקציב יומי ₪Y, פונה ל-[קהל].
  │        הקריאייטיב והעתקה יוכנו בנפרד. אישור כאן יוצר את הקמפיין במצב מושהה —
  │        תוכל לעבור עליו ב-Meta לפני שהתשלום מתחיל."
  │
  │  ├─ §T6.1 — Initial creative batch (gallery-first, Block 8 — 2026-05-13)
  │  │
  │  │  Step A: Gallery census לפני יצירה.
  │  │  python -m campaigner.tools.list_active_creatives \
  │  │    --business-id $BUSINESS_ID --unused-in-campaigns --matches-channel feed
  │  │  → viable_unused_count: N
  │  │
  │  │  Step B: סף ההחלטה (target = 10-12 וריאנטים בסך הכל):
  │  │  ├─ N ≥ 10: propose redeploy_creative × min(N, 12) — נשתמש רק במה שיש בגלריה.
  │  │  │   rationale (עברית פשוטה, פסקה ראשונה):
  │  │  │   "מצאנו N תמונות/סרטונים בגלריה שעוד לא נוצלו לקמפיין — נשתמש בהם
  │  │  │    לפני שניצור חדשים. חיסכון בעלות (הקריאייטיבים האלה כבר עלו לייצור)
  │  │  │    וגם זה Meta-Andromeda-friendly: יותר וריאנטים פעילים זה יותר טוב."
  │  │  │
  │  │  ├─ 5 ≤ N ≤ 9: mixed — propose redeploy_creative × N + new_creative × (12 - N)
  │  │  │   rationale מציין את התערובת:
  │  │  │   "נטמיע N אסטים מהגלריה שעוד לא נוצלו, ונשלים ב-(12-N) חדשים שייצור
  │  │  │    Imagen כדי להגיע למינימום של 10-12 וריאנטים לפתיחה — היעד של
  │  │  │    Andromeda Firehose מלא."
  │  │  │
  │  │  └─ N < 5: propose new_creative × 10-12 (הזרימה הקודמת — firehose מלא).
  │  │      גלריה כמעט ריקה — בכל מקרה צריך לייצר את רוב הוריאנטים.
  │  │
  │  │  ראה creative-guide.md §7 לגיוון angles בענף ה-new_creative.
  │  │
  ├─ §T6.2 — יש קמפיין פעיל אחד או יותר, אבל גיל < 7 ימים:
  │  אין baselines. אין data sufficiency.
  │  action: אל תציע שום scale / pause. log SKIP rationale="cold_start_stabilization".
  │  פעולה יחידה שמותרת: propose new_creative (firehose initial batch אם פחות מ-10 בגלריה).
  │
  ├─ §T6.3 — קמפיין פעיל בגיל 8-14 ימים:
  │  התחלת building baselines (7d window).
  │  apply Gate 1 בלבד. Gate 2 מחייב ≥ 50 conversions שאין עוד.
  │
  └─ §T6.4 — קמפיין פעיל בגיל 15+ ימים:
     baselines מלאים. פועל רגיל (יצא מ-§T6, עבור ל-§T0 וכו').
```

**עקרון מנחה ל-§T6.0:** אתה (Campaigner) חושב במקום המשתמש. המשתמש לא יודע איזה objective לבחור או איזה תקציב יומי הגיוני לקמפיין ראשון — זה תפקידך. ה-approval שלך הוא **safety check** ("Roi, האם אתה רוצה שאני אריץ את זה?"), לא תרגיל מילוי טופס. הצעה בלי המלצה קונקרטית = approval ריק = איכזב את המשתמש.

ר' [memory: Aiweon new account](../../C:\Users\harel.claude\projects\d--meta-ads-automation-ai\memory\project_aiweon_new_account.md) לפירוט נוסף על cold-start playbook.

---

## §T8 — A/B Test Orchestration (חדש 2026-05-13, Block 11)

> **Source:** Block 11 audit (audit gap #5 — "A/B test orchestration as first-class object"). הפרומפטים *דיברו* על וריאנטים, אבל לא היה אובייקט מובנה עם deadline + decision artifact. עם §T8 יש: טבלת `ab_tests`, שני task_types (`ab_test_setup` + `ab_test_decide`), וכלי `evaluate_ab_test`.
> **What it covers:** מבחנים אקטיביים בין 2-4 קריאייטיבים באותו ad set — pure-DB construct שלא שולט בחלוקת תקציב של Meta (Andromeda ממשיכה לעבוד); הוא רק נותן deadline + רושם winner. זה מאפשר לדווח ללקוח "בדקנו זווית X מול Y והנה התוצאה" — בלי לשבור את Andromeda discipline.
> **רץ:** אחרי כל ה-§T0r/§T-routes פר-קמפיין, במקביל ל-§T11 portfolio rebalance, **לפני** §T9 (אורגני).

### למה לא A/B "פורמלי" 50/50?

A/B קלאסי (Meta Split-Test product, 50/50 חלוקה, MDE pre-set) **מופקע ב-§14.15** — Andromeda מחלקת תקציב לא-אחיד במכוון, ו-Meta Split-Test מבטל את זה. §T8 שונה: הקריאייטיבים יושבים באותו ad set, Andromeda מחלקת כרגיל, ואנחנו רק מסמנים אותם כקבוצת השוואה עם deadline. ה"winner" הוא תיעוד למה שכבר קרה, לא הכרזה מאולצת.

### שני נתיבים — setup ו-decide

```
§T8: A/B Test Orchestration
  │
  ├─ Path A: ab_test_setup — להציע מבחן חדש
  │  │  טריגרים אופציונליים (לא חובה — הסוכן יכול גם להציע עצמאית):
  │  │   • §T_PE החלטה על firehose: כשמייצרים 3-5 וריאנטים חדשים, אפשר לסמן 2-4 מהם כקבוצת מבחן
  │  │     עם מטרה מפורשת ("האם זווית A או זווית B עובדת על קהל B2B?")
  │  │   • §T6.1 ראשוני: 12 וריאנטים בפתיחה — אפשר לבחור 4 ולסמן כ-test_name="hooks-cold-start"
  │  │   • אופרטור-יוזם: דרך /ab-tests/new (לא ב-MVP; ב-MVP הסוכן מציע, אופרטור מאשר)
  │  │
  │  ├─ Pre-checks לפני propose:
  │  │  a. ≥ 2 ו ≤ 4 קריאייטיבים (§29 ab_test_requires_min_creatives — חוסם אחרת)
  │  │  b. כל הקריאייטיבים יושבים באותו adset_id (Meta דורש; ad sets שונים = שני tests)
  │  │  c. variant_label ייחודי לכל אחד ('A','B','C','D')
  │  │  d. window_days ≥ 7 (§30 ab_test_min_window_7d — חוסם אחרת)
  │  │  e. אין test פעיל אחר באותו (adset_id, test_name) — partial unique index ב-DB יזרוק
  │  │
  │  └─ propose ab_test_setup (urgency=medium):
  │     payload: {
  │       test_name: "<קצר ועברי, e.g. 'אנגלית-vs-עברית-מאי'>",
  │       campaign_id: "<id>",
  │       adset_id: "<id>",
  │       winner_metric: "hook_rate" | "ctr" | "cpa" | "cpl" | "conversions",
  │       window_days: <7-21>,
  │       creatives: [
  │         {creative_id, variant_label: 'A', creative_gallery_id?},
  │         {creative_id, variant_label: 'B', creative_gallery_id?},
  │         ...
  │       ]
  │     }
  │     rationale (עברית פשוטה, פסקה ראשונה):
  │       "מציעים מבחן רשמי בין X וריאנטים שירוצו ל-N ימים. נשווה לפי <metric>,
  │        ובסוף נדע איזו זווית עובדת טוב יותר לקהל שלך — כדי לבסס עליה את
  │        הקריאייטיבים הבאים. הוריאנטים יישארו כולם פעילים במהלך המבחן —
  │        Meta תחלק תקציב לבד; אנחנו רק רושמים מה קורה."
  │
  ├─ Path B: ab_test_decide — להחליט אחרי שהחלון נסגר
  │  │  טריגר: list_ab_tests --status ready_to_decide מחזיר tests עם planned_end_at ≤ now()
  │  │
  │  ├─ Pre-checks:
  │  │  a. evaluate_ab_test --ab-test-id <id> → snapshot
  │  │     אם confidence == 'insufficient' AND days_elapsed < 14:
  │  │       log SKIP rationale="ab_test_inconclusive_extend"
  │  │       (פעולה אופציונלית: propose alert ל-operator לחכות עוד שבוע)
  │  │     אם confidence == 'insufficient' AND days_elapsed >= 14:
  │  │       propose ab_test_decide עם cancel_instead=true
  │  │       (החלון מספיק ארוך, אבל הוריאנטים לא הבדילו ביניהם — לא winner)
  │  │  b. tracking_health_status == 'healthy' לא חובה כאן (DB-only),
  │  │     אבל אם winner_metric = cpa/cpl ו-tracking לא healthy → השנמך
  │  │     confidence לפי snapshot
  │  │
  │  └─ propose ab_test_decide (urgency=medium):
  │     payload: {
  │       ab_test_id: "<uuid>",
  │       winner_creative_id: "<id>",
  │       winner_variant_label: "A"|"B"|"C"|"D",
  │       decision_reason: "<עברית, 1-2 משפטים: למה ניצח>",
  │       decision_snapshot: { ... },  -- evaluate_ab_test output verbatim
  │       cancel_instead: false        -- true to record "no winner"
  │     }
  │     rationale (עברית פשוטה):
  │       "המבחן '<test_name>' רץ N ימים. וריאנט <label> ניצח לפי <metric>:
  │        <ערך> מול <ערך-של-המתחרה> (פער <X>%). רמת ביטחון: <confidence>.
  │        ההחלטה היא תיעוד למה שעבד — Meta תמשיך לחלק תקציב לבד; אם תרצה
  │        להעמיק את המנצח, צריך הצעה נפרדת של scale_up או של new_creative
  │        בזווית הזו."
  │
  └─ אחרי decide: למה לא לעשות auto-scale-up על המנצח?
     כי Andromeda discipline. אם פוצצים תקציב על המנצח, אחת מהשתיים:
     (1) הקמפיין עוד ב-Learning → reset.
     (2) הקמפיין ACTIVE → §T2+ פותר את זה בכלים שלו (cadence cap, marginal-return).
     ה-test הוא אבחנה; הפעולה היא decision-tree נפרד.
```

### Hard rules ל-§T8

1. **ab_test_setup חייב כל הקריאייטיבים באותו adset.** מבחנים בין ad-sets שונים = רעש; טרגוט שונה / תקציב שונה משפיע. החריג: ai test_setup חוצה ad_sets כשמשנים *רק* את הקריאייטיב — לא נתמך ב-MVP.
2. **decide לא דורש status='healthy' tracking** אבל **הצעת follow-up scale_up** כן (§17).
3. **אסור ab_test_decide על test שלא רץ ≥ 7 ימים** אלא אם cancel_instead=true (§30 חוסם).
4. **אסור 2 ab_test_setup פעילים באותו adset+test_name** — partial unique index יזרוק. אם רוצים להריץ שוב — צריך לעבור עם הקודם ל-decided/cancelled קודם.
5. **respect_hands_off** (§25) חל גם כאן — לא להציע setup/decide על קמפיין hands_off.
6. **decision_snapshot חייב להיות פלט verbatim של `evaluate_ab_test`.** אסור לסוכן "להעריך לבד" ולכתוב dict ידני — צריך לקרוא לכלי שיביא מ-Meta את האימפרשנס/conversion הנכונים.

### גבולות MVP

- **ab_test_setup אוטומטי ב-§T_PE/§T6.1** — לא ב-MVP. ב-MVP §T8 מציע tests רק כשהאופרטור או הסוכן זיהו ענין השוואתי ספציפי. השילוב האוטומטי עם §T_PE הוא לבלוק עתידי.
- **auto-promote winner** — לא ב-MVP. תיעוד בלבד, לא פעולה. ראה למה למעלה.
- **רב-וריאנט (5+)** — לא נתמך. ב-MVP מקס 4.
- **A/B חוצה ad sets / קמפיינים** — לא ב-MVP. צריך טבלה אחרת או צ'אנק אחר של Meta API.

---

## §T9 — Organic Cadence (Phase 3 — page management)

**תנאי כניסה:** העסק חיבר Page פעיל ו/או IG עסקי (`facebook_page.selected=true` או `instagram_business_account.selected=true`). זה ענף מקביל ל-§T0-§T6, רץ באותה ריצת `daily_observe_propose` אחרי שטיפלנו ב-ads. אם אין נכסים שנבחרו, log SKIP rationale="no_organic_assets" ועברו.

**עקרון מנחה:** העסק שכר Campaigner גם כדי שעמודי הרשתות לא יישבו ריקים. **אסור לפסוח על ריצה אורגנית רק כי הלידים בסדר.** הם שני עולמות נפרדים.

### יעדי קצב (target cadence)

| ערוץ | יעד שבועי | מינימום שבועי | משהו דרוש אם... |
|---|---|---|---|
| Facebook Page feed | 4 פוסטים | 2 פוסטים | פחות מ-2 ב-7 ימים אחרונים |
| Instagram feed (image/carousel) | 5 פוסטים | 3 פוסטים | פחות מ-3 ב-7 ימים אחרונים |
| Instagram story | 5-7 סטוריז | 3 סטוריז | פחות מ-3 ב-7 ימים |
| Instagram Reel | 1 Reel | 1 Reel | אין Reel ב-14 ימים |

הספירה היא מתוך `approvals` עם `task_type=publish_*` במצב `executed` או `approved` + `scheduled_for ≤ now()+7d`. כלומר scheduled approvals שעוד לא ירו נחשבים כקצב מתוכנן.

### לוגיקה (per business)

```
For each network in [facebook_page, instagram]:
  │
  ├─ count_7d = posts executed OR scheduled in next 7d (per type)
  ├─ gap_per_type = target_weekly − count_7d
  │
  ├─ אם gap_per_type ≤ 0 לכל הטיפוסים של הערוץ:
  │  └─ log SKIP rationale="organic_cadence_healthy"
  │
  └─ אם gap קיים בטיפוס מסוים:
     ├─ בחר אסט מ-creative_gallery מתאים לטיפוס + לערוץ + לקצב הרצוי:
     │  - publish_fb_post   → image או video מהגלריה; angle מגוון מהלשבוע האחרון
     │  - publish_ig_post   → image (4:5 / 1:1) או carousel; copy ארוך 80-150 מילים
     │  - publish_ig_story  → image (9:16) או video (9:16, ≤60s)
     │  - publish_ig_reel   → video (9:16, ≤90s)
     │
     ├─ אם אין נכס מתאים בגלריה:
     │  └─ propose new_creative במקום publish_* (הסוכן יציע גם creative חדש).
     │     זה approval נפרד. אחרי יצירה והעלאה לגלריה, ריצה הבאה תייצר publish_*.
     │     אסור לפרסם approval `publish_*` עם image_url שמצביע על נכס שלא קיים.
     │
     ├─ כתוב copy לפי hebrew-copy-style.md §12 (organic-specific):
     │  - אורך לפי ערוץ (FB 60-200, IG 80-150, Reel 50-100, Story = ללא קופי)
     │  - hashtags לפי ערוץ (FB 0, IG 3-7, Reel 3-5)
     │  - שורה ראשונה לוכדת (IG חותך אחרי 80 תווים)
     │  - voice מ-business_knowledge.brand_voice
     │
     ├─ בחר scheduled_for לפי peak time:
     │  קריאה ל-`page_audience_signals` עבור ה-page_id. בחר hour_of_week עם
     │  online_score גבוה ב-72 שעות הקרובות. דרישה: scheduled_for ≥ now() + 6h
     │  כדי שלמשתמש יהיה זמן לבדוק לפני הפרסום.
     │
     │  אם אין נתוני `page_audience_signals` (cold-start) → ברירת מחדל:
     │    - feed posts: 20:00 או 21:00 Asia/Jerusalem (cross-network peak ב-IL)
     │    - stories:    14:00 (lunch-break peak)
     │    - Reels:      19:00 (evening discovery)
     │
     ├─ propose_task --task-type publish_<type>
     │  --payload '{...image_url/video_url/caption/hashtags...}'
     │  --scheduled-for '<ISO timestamp ב-Asia/Jerusalem>'
     │  --urgency medium
     │  --rationale 'עברית פשוטה: "לא היה פוסט אורגני ב-X ימים בערוץ Y.
     │               מציע פרסום ב-<scheduled_for> מ-image-<asset_id>:
     │               <copy preview>". הסבר למה הזמן נבחר.'
     │
     └─ log_decision proposal עם diagnosis "organic_cadence_gap"
```

### Hard rules ל-§T9

1. **אסור publish_* בלי שיש אסט מאומת בגלריה.** אם אין — propose new_creative במקום.
2. **אסור scheduled_for קרוב יותר מ-6 שעות.** המשתמש חייב חלון לראות.
3. **אסור 2 publish_* באותו ערוץ ב-aproval queue במצב pending עם scheduled_for בתוך 4 שעות זה מזה.** מפזרים.
4. **angle rotation:** אל תציע 2 פוסטים אורגניים ברצף עם אותו `marketing_angle` (לפי `creative_gallery.marketing_angle` של האסט הנבחר). שמירה על גיוון אנושי.
5. **שמירה על אורגני מאוזן:** אם אתה מציע scale_up על ad campaign באותה ריצה, גם תוודא שיש publish_* מתוזמן באותו השבוע — אסור שהמשתמש ייראה רק ממומן.

### באג שאתה צריך לזכור — קוד שלי לא יודע לדבר עם IG בלי Page-link

ה-Python helper שמפרסם ל-IG (`page_publishing.publish_ig_*`) דורש token של Page. אם ה-IG הנבחר הוא BM-owned ללא linked_page — הוא ייפול עם `TokenLookupError`. רעיון: בעת בחירת publish_ig_*, ודא ש-`meta_ig_accounts.linked_page_id IS NOT NULL` או שיש page-token-fallback. אם לא — propose alert במקום publish, וההסבר ל-Roi: "ה-IG הזה לא מקושר ל-Page, אי אפשר לפרסם דרך API; פרסם ידנית או קשר ל-Page."

---

## §T9.1 — Post-Promote Lane (חדש 2026-05-12, Block 7)

> **Source:** Block 7 audit (post-promote gap, [project_gap_gallery_to_campaign_loop](memory)) — the gallery→campaign loop the operator explicitly cares about.
> **What it covers:** the feedback half of organic publishing. §T9 wrote posts *out*; §T9.1 reads how they performed *back* and proposes the next move. Closes the missing piece between "publish a reel" and "promote what worked".
> **Inputs:** `check_organic_performance --business-id $BUSINESS_ID --days 14` returns `{posts, viral_count, underperformer_count, boost_candidates}` where each post is classified `viral` / `solid` / `underperformer` / `insufficient_data` against the engagement-rate baseline.

### למה ענף נפרד מ-§T9?

§T9 הוא קצב פרסום אורגני (publish_*). §T9.1 רץ **אחרי** §T9, ובוחן את הביצוע של מה שכבר פורסם. שני ענפים — שני סוגי פעולות:

| ענף | מסתכל על | פעולה |
| --- | --- | --- |
| §T9 | קצב פרסום (יעד שבועי vs בפועל) | propose `publish_*` כשיש פער |
| §T9.1 | ביצוע פוסטים שכבר פורסמו | propose `boost_post` על viral; alert על underperformers |

### לוגיקה

```
§T9.1: Post-Promote Lane
  │
  ├─ pre-check: יש פוסטים אורגניים שפורסמו ב-14 ימים האחרונים?
  │  שאילתה: approvals WHERE task_type IN (publish_*) AND external_post_id IS NOT NULL
  │  AND published_at >= now() - 14 days
  │  └─ אין → log SKIP rationale="no_recent_organic_posts_to_evaluate"
  │
  ├─ Step 1: הרץ `check_organic_performance` (one Meta read per post)
  │
  ├─ For each post in `boost_candidates` (classification='viral'):
  │  │  Trigger: engagement_rate ≥ 2× baseline (0.025) AND impressions ≥ 100
  │  │
  │  ├─ pre-check: יש כבר proposal pending של boost_post על אותו external_post_id?
  │  │  └─ כן → log SKIP rationale="boost_proposal_already_pending"
  │  │
  │  ├─ pre-check: tracking_health_status == 'healthy'?
  │  │  └─ לא → log SKIP — boost עם measurement לא תקין = שריפת תקציב.
  │  │     הסוכן יציע verify_pixel_capi קודם.
  │  │
  │  └─ propose `boost_post` (urgency=high)
  │     payload: {
  │       external_post_id: "<post_id>",
  │       adset_id: "<existing_adset_id>",  -- הסוכן בוחר ad set פעיל בקמפיין מותאם
  │       daily_budget_ils: <חישוב לפי utilization headroom ו-monthly_budget>,
  │       page_id: <business.meta_page_id>,
  │       duration_days: 7
  │     }
  │     rationale (עברית פשוטה):
  │       "הפוסט שפורסם בX מקבל כפול מהמעורבות הממוצעת שלך (Y תגובות/שיתופים על Z חשיפות).
  │        זה signal חזק — מציעים להמיר אותו למודעה ממומנת ב-₪W/יום ל-7 ימים,
  │        עם אותם תגובות ושיתופים כ-social proof. עלות נמוכה כי אין צריך לייצר קופי חדש."
  │     תוכנית mini-section חובה:
  │       1. אישור boost של ₪W/יום ל-7 ימים (זו ההצעה הנוכחית).
  │       2. בעוד 7 ימים: אם CPL/CPA בתוך היעד — להציע scale_up.
  │          אם יקר — להחליט אם להמשיך 7 ימים נוספים או להפסיק.
  │       3. שמירה על הפוסט האורגני פעיל — לא להוריד גם אחרי שה-boost רץ.
  │
  ├─ For each post in `underperformers` (classification='underperformer'):
  │  │  Trigger: engagement_rate < 0.5× baseline AND impressions ≥ 100
  │  │
  │  └─ אם 3+ underperformers ברצף עם אותו marketing_angle:
  │       propose `alert` (urgency=medium)
  │       rationale: "3 פוסטים אורגניים ברצף עם זווית X מקבלים פחות ממחצית המעורבות
  │                   הממוצעת. שווה לבחון אם הזווית הזו עוד רלוונטית לקהל שלך, או לעבור לקופי אחר."
  │
  ├─ posts in `insufficient_data` → log_decision skip rationale="insufficient_organic_data"
  │
  └─ posts in `solid` → no action (status quo)
```

### Hard rules ל-§T9.1

1. **אסור boost_post בלי `adset_id` קיים.** ה-boost ad חייב adset לחיות בו (Meta דורש adset לתקציב + טרגוט). אם אין adset מתאים — propose alert במקום, עם ההסבר "צריך adset קיים להעביר אליו את ה-boost".
2. **אסור boost על פוסט שעדיין לא הצטבר ≥ 100 חשיפות.** רעש מדגמי — נחכה.
3. **respect_hands_off חל גם כאן.** אם הפוסט המקורי על קמפיין ב-hands_off → §25 חוסם את ה-boost.
4. **tracking_health_status חוסם boost לא־בריא** (כפי שמכוסה ב-§17 המורחב).

### גבולות MVP

- `check_organic_performance` היום מחזיר metrics בעיקר מ-baseline default (0.025 engagement_rate בארץ 2026); קריאה חיה ל-Meta post insights דורשת page-token Graph call שלא מוטמע עדיין (v2).
- ה-scaffolding שלם — ברגע ש-page-token reads נשלחו, §T9.1 מתחיל לייצר boost proposals אמיתיים.
- `adset_id` ל-boost — הסוכן צריך לבחור adset קיים. ב-MVP: יציע alert ל-operator לבחור adset, או יבחר את ה-adset של ה-campaign העיקרי לפי business_knowledge.

---

## §T11 — Portfolio Rebalancing (חדש 2026-05-13, Block 9)

> **Source:** 2026-05-13 audit gap A — Campaigner מאפטם קמפיין-אחר-קמפיין, לא תיק. כש-Aiweon יריץ 3+ קמפיינים פעילים, חוסר חשיבה portfolio = החמצת ההזדמנות הגדולה של "מעבירים תקציב מהמפסיד לזוכה".
> **What it covers:** הענף הראשון בעץ ההחלטה שלא בודק קמפיין יחיד, אלא **את כל הקמפיינים הפעילים יחד**. שואל: "האם יש קמפיין מצוין שמרעיב לתקציב, וקמפיין יקר ויציב שיכול לוותר על חלק?" אם כן — מציע מהלך מסונכרן: scale_down על אחד + scale_up על השני.
> **רץ:** אחרי כל ה-§T0r-נתבים פר-קמפיין, **לפני** §T9 (אורגני). זה השלב האחרון של החלק ה-paid.

### תנאי כניסה (gate-checks)

```
§T11 רץ רק כאשר כל אלה מתקיימים:
  1. active_campaign_count ≥ 2
     (אם פעיל 1 בלבד — אין על מה לעשות rebalance)
  2. tracking_health_status == 'healthy'
     (rebalance על measurement שבור = שריפת תקציב; §17)
  3. אין hands_off_brief_is_current עם hands_off_campaign_ids מלא ל-2+ מהקמפיינים
     (אם כל המועמדים hands_off — log SKIP rationale="all_candidates_hands_off")
```

### הסיווג — מאיתורים פר-קמפיין שכבר נעשו

הסוכן כבר עבר §T0r על כל קמפיין פעיל ויודע את ה-lane של כל אחד. §T11 בונה שתי רשימות:

| תפקיד בתיק | מי? (לפי §T0r lane + מדדים) | אמת מידה כמותית |
|---|---|---|
| **"רעב לתקציב"** (donor של scale_up) | lane=`scale_up_candidate` + utilization_7d ≥ 0.95 + CPA ≤ target × 0.85 + ACTIVE 7+ ימים | קמפיין שמכרסם תקציב יומי מלא ועדיין מחזיר מתחת ליעד — סימן ברור ש-Meta היתה לוקחת יותר אילו היה לה |
| **"מקור תקציב"** (donor של scale_down) | lane=`scale_down_candidate` + CPA 1.3-3.0× target + ACTIVE 7+ ימים + לא בענף fatigue (יש דרך אחרת לתקן fatigue) | קמפיין יציב אבל יקר — חבל לסגור, אבל יכול לחיות עם פחות עד שיתקן |
| **לא מועמד** | hands_off / learning / cold_start / fatigue / pool_exhausted | הקטגוריות האלה כבר טופלו במסלולים שלהן; אל תיגע |

### לוגיקה

```
§T11 — Portfolio Rebalancing
  │
  ├─ Step 0: gate-checks (למעלה)
  │  אם נכשל → log_decision skip + rationale + עבור הלאה
  │
  ├─ Step 1: בנה את שתי הרשימות מהדיאגנוזות שכבר עשית ב-Step 2 פר-קמפיין:
  │    hungry_winners[]   ← מועמדים ל-scale_up (רשימה ממוינת לפי CPA יחס ליעד — הטובים ראשונים)
  │    expensive_stable[] ← מועמדים ל-scale_down (רשימה ממוינת לפי CPA יחס ליעד — היקרים ראשונים)
  │
  ├─ Step 2: אם hungry_winners ריק OR expensive_stable ריק:
  │    log_decision skip rationale="no_rebalance_pair_available"
  │    (תיק מאוזן מבחינת §T11 — אין מועמדים מסונכרנים)
  │
  ├─ Step 3: בחר את הזוג העליון:
  │    winner   = hungry_winners[0]      (הכי "רעב")
  │    expensive = expensive_stable[0]   (הכי "יקר")
  │
  │    pre-checks על הזוג:
  │    a. winner.campaign_id != expensive.campaign_id (בנאלי)
  │    b. winner לא בקדנס cooldown: scale_ups_last_7d == 0 (§20)
  │    c. expensive לא בקדנס cooldown: scale_downs_last_14d == 0 (§23)
  │    d. winner.marginal_return_passed == true (§21 — אחרת אין טעם להוסיף לו תקציב)
  │    e. אף אחד מהשניים לא ב-hands_off + is_current_month (§25)
  │
  │    כשל באחד מ-a-e:
  │      ├─ נסה את הזוג הבא (hungry_winners[1] + expensive_stable[0], וכו')
  │      └─ אם אזל המאגר — log SKIP rationale="no_eligible_rebalance_pair"
  │
  ├─ Step 4: חישוב הסכום שיועבר:
  │    delta_ils = min(
  │      expensive.daily_budget_ils × 0.15,   -- §22 -15% per step on scale_down
  │      winner.daily_budget_ils × 0.20,      -- §3 +20% per step on scale_up (Branch A)
  │      ₪200                                 -- safety cap לתנועה יומית
  │    )
  │    new_expensive = expensive.daily_budget_ils - delta_ils
  │    new_winner    = winner.daily_budget_ils    + delta_ils
  │
  │    אם delta_ils < ₪10 → log SKIP rationale="rebalance_delta_below_meaningful_threshold"
  │    (חבל לבזבז על תור-אישור על תזוזות זניחות.)
  │
  ├─ Step 5: emit two LINKED proposals (חובה: אותו run_id; כל אחד מציין את השני ב-rationale)
  │
  │    propose_task --task-type scale_down \
  │      --target-kind campaign --target-id <expensive.campaign_id> \
  │      --payload '{
  │        "old_daily_budget_ils": <expensive.daily_budget_ils>,
  │        "new_daily_budget_ils": <new_expensive>,
  │        "rebalance_pair_winner_id": "<winner.campaign_id>"
  │      }' \
  │      --rationale '<עברית פשוטה — ראה דוגמה למטה>' \
  │      --expected-impact '{"freed_budget_ils": <delta_ils>, "linked_to_scale_up_on": "<winner_id>"}' \
  │      --urgency medium
  │
  │    propose_task --task-type scale_up \
  │      --target-kind campaign --target-id <winner.campaign_id> \
  │      --payload '{
  │        "old_daily_budget_ils": <winner.daily_budget_ils>,
  │        "new_daily_budget_ils": <new_winner>,
  │        "rebalance_pair_source_id": "<expensive.campaign_id>"
  │      }' \
  │      --rationale '<עברית פשוטה — ראה דוגמה למטה>' \
  │      --expected-impact '{"added_budget_ils": <delta_ils>, "linked_to_scale_down_on": "<expensive_id>"}' \
  │      --urgency medium
  │
  └─ Step 6: log_decision diagnosis (node_name='portfolio_rebalance') עם summary
            שכוללת את שני ה-target_id, ה-delta, וה-CPA הצפויים.
```

### דוגמה — rationale פר הצעה (עברית פשוטה, פסקה ראשונה ללא ראשי תיבות)

**ל-scale_down של ה"יקר":**
> "מציע להוריד את התקציב של קמפיין X מ-₪150/יום ל-₪127/יום, ולהעביר את ה-₪23 שהתפנו לקמפיין Y שמכרסם את כל התקציב שלו ועדיין מביא לידים זולים מהיעד. הקמפיין X יציב — לא 'גרוע' — אבל הוא עולה יותר מהיעד כבר 9 ימים. ההעברה היא נסיון להזיז כסף ממקום שעדיין לא מצא את הקצב שלו, למקום שכבר הוכיח שהוא יכול לעשות יותר עם יותר."
>
> *(פסקה 2+: יש פירוט מדדים — CPA, utilization, conversions_7d, hook rate — עם glosses בפעם הראשונה.)*

**ל-scale_up של ה"רעב":**
> "מציע להעלות את התקציב של קמפיין Y מ-₪80/יום ל-₪103/יום, ממומן מ-₪23 שמתפנים מקמפיין X (ראה ההצעה הנפרדת). הקמפיין הזה מכרסם את כל התקציב שלו, ועדיין מביא לידים ב-עלות יחידה של ₪42 — הרבה מתחת ליעד של ₪60. הסימן הזה אומר ש-Meta היתה לוקחת ממנו יותר אילו היה לה. ההעלאה היא 28% — בסוף הצעד הראשון נמדוד שוב את ה-עלות-ליחידה לפני שמעלים שוב."

### Hard rules ל-§T11

1. **חובה לראות את שני הצדדים בתור.** אם אחד מהשניים נפסל בגארדריילים, האחר לא נשלח. נסה זוג אחר או log SKIP. **אסור** scale_up בלי המקור שלו, או scale_down בלי המוטב שלו.
2. **אסור rebalance בתוך אותו קמפיין.** אם הסוכן רוצה לחזק adset בתוך קמפיין על חשבון adset אחר באותו קמפיין — זה לא §T11, זה ענף נפרד (consolidate_adsets, לא בהיקף MVP).
3. **delta_ils ≥ ₪10** — מתחת לזה זה רעש.
4. **לא יותר מ-rebalance-pair אחד בריצה.** אם יש 5 רעבים ו-5 יקרים, סוכן MVP מציע רק את הזוג הכי טוב. הזוגות הבאים — בריצות הבאות (אחרי ש-Meta הזיזה למידה).
5. **רישום ב-`expected_impact`.** השדות `linked_to_scale_up_on` / `linked_to_scale_down_on` מאפשרים ל-UI אחר כך להציג "rebalance pair" כיחידה אחת.
6. **כל הגארדריילים הרגילים חלים על שתי ההצעות בנפרד** — §17 (tracking), §20 (scale_up cadence), §21 (marginal-return), §22 (-15% scale_down cap), §23 (no consecutive scale_down), §25 (hands_off), §28 (לא רלוונטי כאן כי אין new_creative). אם §22 חוסם את ה-15% scale_down, יוצא delta קטן יותר בהתאם — אל תעקוף.

### גבולות MVP (חוץ-היקף, נשמר לעתיד)

- **N-קמפיינים rebalance** (לא רק זוג) — Block 10+. דורש חישוב lp/optimization על כל הקמפיינים בו-זמנית. ב-MVP זוג אחד לריצה מספיק.
- **rebalance בין business-units** — לא רלוונטי לאיביאון (חשבון יחיד); ב-v2 (multi-business mode) זה ייהפך לרלוונטי.
- **rebalance בין objective-types** (CONVERSIONS ↔ LEAD_GEN) — לא נוגעים. אלה pools שונים ב-Meta, ערבוב מסכן את שני הקמפיינים.
- **טול ייעודי `compute_portfolio_allocation.py`** — לא נדרש ב-MVP. הלוגיקה היא 30 שורות והסוכן מבצע את ההשוואות בראש מתוך המדדים שכבר נאספו ב-Step 1. אם המסלול יהפוך מורכב (N-קמפיינים) — אז כן.

---

## §T_PA — Paused Campaign Audit (חדש 2026-05-13)

> **Source:** ביקורת אופרטור 2026-05-13 — הסוכן בודק רק קמפיינים פעילים. קמפיינים מופסקים נשארים מחוץ לראדאר, גם כש-30 הימים שלפני ההפסקה מראים ביצוע קרוב-ליעד שראוי לבחינה מחדש.
> **רץ:** אחרי §T11 portfolio rebalance, לפני §T9 organic. פעם אחת לריצה (לא פר-קמפיין).
> **למה זה קריטי:** עיקרון "לא להתגונן, לבחון מחדש" — קמפיין מופסק עם עלות-לליד כמעט-יעד שייך לשולחן הניתוח, לא לארכיון.

### תנאי כניסה

```
1. paused_campaign_count ≥ 1
2. tracking_health_status ∈ {healthy, partial}
   (גם כש-tracking partial אנחנו רוצים לציין הזדמנות, פשוט לא להפעיל מחדש אוטומטית)
```

### הסיווג — לכל קמפיין מופסק

אסוף לכל אחד את 30 ימי הביצוע **לפני** ה-pause. חשב `cpl_actual`, `cpl_vs_target`, `ctr_pct`, `cpm_ils`, `impressions`, `frequency`, `days_since_paused`.

```
FOR EACH paused campaign:

  ├─ days_since_paused > 90  →  SKIP (יותר מדי ישן)
  │
  ├─ cpl_vs_target ≤ 1.2  AND  ctr_pct ≥ 1.5%  →  lane: revival_candidate
  │   (קמפיין שביצע סביב היעד עם הקלקה בריאה — שווה revisit)
  │
  ├─ cpm גבוה (>80) AND impressions < 5000 בחודש  →  lane: narrow_audience_revival
  │   (לא היה רע — היה צר. הפעלה מחדש + הרחבת קהל)
  │
  └─ אחרת  →  lane: archive_candidate (לא מציעים פעולה)
```

### Output

לכל `revival_candidate` או `narrow_audience_revival`: **propose `alert` עם `acknowledgment_only: true`** (לא `resume_campaign` אוטומטי). החלטה להחזיר קמפיין לאוויר היא של בעל-עסק. ה-alert מציג נתוני 30 הימים שלפני ההפסקה + recommendation מסוג "revival עם הרחבת קהל" או "revival עם וריאנט חדש".

אם `tracking_health_status == healthy` ואופרטור אישר alert קודם על אותו קמפיין → בריצה הבאה הסוכן מציע `resume_campaign` קונקרטי.

---

## §T_ORG — Organic Pivot When Paid Is Blocked (חדש 2026-05-13)

> **Source:** ביקורת אופרטור 2026-05-13 — כשמערכת המדידה חלקית, §0.5 חוסם new_creative / scale_up / new_campaign / expand_audience. תוצאת היום: 3 alerts בלבד. הצדק התחתון: גם כש-paid חסום, **organic לא חסום** — פוסטים אורגניים לא צורכים תקציב פרסום ולא תלויים בפיקסל.
> **רץ:** ב-§T0r כענף-default כשה-Router לא מצא lane אחר ו-`tracking_health_status != healthy`. גם רץ במקביל כש-`days_since_last_organic_post > 7`.
> **למה זה קריטי:** הסוכן עובר ממצב "חסום ולכן שותק" למצב "חסום ולכן מציע אקטיביות במסלול אחר".

### תנאי כניסה

לפחות אחד מהשניים:

1. `tracking_health_status != healthy` AND אחת מהפעולות הבאות הייתה ראויה אבל נחסמה (`new_creative`, `scale_up`, `new_campaign`, `expand_audience`).
2. `days_since_last_organic_post > 7` (אין תוכן אורגני שבועי, גם כש-paid עובד).

### הסיווג — מקור אסט

```
§T_ORG: Organic Pivot
  │
  ├─ creative_gallery contains ≥ 1 unused asset matching organic format
  │   →  lane: gallery_organic_publish
  │   action: propose publish_fb_post / publish_ig_post / publish_ig_story / publish_ig_reel
  │           — לפי aspect_ratio של האסט.
  │
  ├─ creative_gallery EMPTY OR no organic-fit asset
  │   →  lane: organic_text_post
  │   action: propose publish_fb_post text-only — קופי לפי brand_voice ו-active_offer.
  │
  └─ all gallery + brand_voice missing  →  lane: organic_seeding_alert
      action: propose alert acknowledgment_only — מבקש 5 אסטים לגלריה + brand_voice.
```

### תקרה

מקסימום **2 הצעות organic ל-§T_ORG בריצה אחת**. יותר מזה = הצפת queue.

---

## §T_BK — Business Knowledge Audit (חדש 2026-05-13)

> **Source:** ביקורת אופרטור 2026-05-13 — ה-vertical של Aiweon היה `leads` (B2C-ish) למרות שהמוצר הוא תוכנה לעסקים. ה-vertical השגוי גרם לרצועת היעד להיות שגויה (60-180 שקל במקום 150-400), והיעד שהוגדר ידנית (50 שקל) היה מתחת לרצועה התחתונה — מה שגרם לסוכן לסמן כל קמפיין כ"לא עומד ביעד" באופן שגוי.
> **רץ:** לפני §T0r על כל ריצה (אחרי load_business_knowledge ב-Step 1). אם §T_BK מזהה בעיה — מציע הצעות לפני שמתחיל לאבחן קמפיינים.
> **למה זה קריטי:** "Garbage in, garbage out". כל אבחון מבוסס על ה-knowledge — אם הוא שגוי, כל ההצעות מוטות.

### בדיקות (כולן רצות; כל hit מייצר alert acknowledgment_only)

```
1. vertical_band_check
   IF target יעד (CPL/CPA/ROAS) נמצא מחוץ לרצועה של vertical:
     →  alert + paired set_kpi_target עם research מ-estimate_cpl.

2. vertical_product_alignment
   IF products / website_url מצביעים על תחום שונה מ-vertical:
     →  alert: "תחום עסקי לא מתאים למוצר. עדכן ב-/business-knowledge."

3. monthly_brief_freshness
   IF monthly_brief IS NULL OR is_current_month == false:
     →  alert עם טיוטה מבוססת usp + ideal_customer + signals אחרונים.

4. brand_voice_completeness
   IF brand_voice IS NULL OR חסר >50% מהממדים:
     →  alert (urgency=low): "פרופיל קול חסר — אורגני יצא גנרי."
```

### תקרה ו-idempotency

מקסימום **3 הצעות §T_BK ל-ריצה**. עדיפות: vertical_band > product_alignment > brief > brand_voice. כל alert §T_BK בודק `pending`/`approved`-לא-נטופל מאותו `alert_type` ב-30 ימים אחרונים — אם קיים, SKIP rationale="t_bk_alert_already_pending". אסור לפוצץ את האופרטור.

---

## §T_AUD — Per-Service Audience Proposals (חדש 2026-05-13, operator-initiated)

> **Source:** ביקורת אופרטור 2026-05-13 — `/audiences` היה read-only. הסוכן יכול היה להציע קהל ב-`expand_audience` כחלק מ-§T-1, אבל לא היה flow ייעודי "פר שירות, מחקר קהל + הצעה". התוצאה: הקהלים שנמשכו מ-Meta היו ראיה, לא חומר עבודה.
> **רץ:** **רק** כשה-runner הוא `propose_audiences_for_service` (operator-initiated מ-/business-knowledge). לא חלק מ-Flow A הרגיל. הפרומפט יכיל `SERVICE_NAME=<שם השירות>`.
> **למה זה קריטי:** סוגר את הלולאה שירות→קהל→קמפיין. Phase 1 של ה-mastery plan (audiences) הסתיים עם sync + propose tools, אבל בלי trigger אופרטיבי הסוכן נשאר פאסיבי על הציר הזה.

### תנאי כניסה (כולם חייבים)

```
1. הפרומפט מכיל "propose audiences for service" + SERVICE_NAME.
2. business_knowledge.products חייב להכיל פריט עם name == SERVICE_NAME (case/whitespace insensitive).
3. השירות חייב להיות עם match לתת-ורטיקל != "other" (קרא matchSubVertical בקוד או הסתמך על products[i].research.sub_vertical אם קיים).
4. tracking_health_status ∈ {healthy, partial, unverified}. unknown → SKIP rationale="tracking_unknown_blocks_audience_research".
```

### שלבי הריצה

```
§T_AUD: Per-Service Audience
  │
  ├─ Step 1: load_business_knowledge → השג את product מה-products array.
  │   אם חסר → log error decision + exit 1. ה-UI כבר חוסם אבל הסוכן מאמת.
  │
  ├─ Step 2: list_audiences --business-id $BUSINESS_ID --service-tag "$SERVICE_NAME"
  │   (Block 13 / migration 024) — service-scoped query. שמור:
  │     • existing_custom_subtypes_for_service = set of (subtype) ל-kind=custom עם service_tag==SERVICE_NAME
  │     • existing_lookalike_seeds_for_service = set of origin_audience_id עם service_tag==SERVICE_NAME
  │     • existing_saved_count_for_service     = count
  │
  │   הרץ גם list_audiences --business-id $BUSINESS_ID --kind all (ללא service-tag) רק כדי לחפש:
  │     • viable_lookalike_seeds = custom audiences with upper_bound ≥ 100 (קהלים ראויים מכל מקום בעסק
  │       יכולים לשמש כ-seed ללוקאלייק — אבל הלוקאלייק שייווצר ימוקם תחת SERVICE_NAME דרך --service-tag).
  │
  ├─ Step 3: load_audience_research_context — בעברית פשוטה, פתיחה של ה-rationale:
  │     • שם השירות
  │     • תת-ורטיקל (product.research.sub_vertical או matchSubVertical)
  │     • service_regions
  │     • brand_voice.tone (אם יש)
  │     • objective הצפוי (LEAD_GENERATION / CONVERSIONS — לפי service-campaign-recommendations.ts)
  │
  ├─ Step 4: החליטו אילו 1-3 קהלים להציע. עץ בחירה:
  │
  │   ┌─ Lane A: WEBSITE Custom Audience (תמיד אם tracking_health == healthy)
  │   │   conditions: tracking_health_status == healthy AND
  │   │               'WEBSITE' NOT IN existing_custom_subtypes for this service
  │   │   payload:    propose_audience --task-type create_custom_audience
  │   │                               --subtype WEBSITE
  │   │                               --rule (Meta inclusions/exclusions JSON)
  │   │   intended_use: "remarketing — מי שביקר בדף השירות '<SERVICE_NAME>' ולא השאיר פרטים"
  │   │
  │   ├─ Lane B: ENGAGEMENT Custom (אם יש Page פעיל ולא קיים)
  │   │   conditions: business_knowledge.facebook_page_id IS NOT NULL AND
  │   │               'ENGAGEMENT' NOT IN existing_custom_subtypes for this service
  │   │   intended_use: "מי שהביע עניין אורגני בעמוד — תזין lookalike או remarketing"
  │   │
  │   ├─ Lane C: LEAD_GENERATION Custom (אם הקמפיינים של השירות הם LEAD_GENERATION)
  │   │   conditions: objective הצפוי == LEAD_GENERATION AND
  │   │               'LEAD_GENERATION' NOT IN existing_custom_subtypes
  │   │   intended_use: "exclude — אנשים שכבר השאירו פרטים, לא נעביר להם שוב את אותו ליד"
  │   │
  │   ├─ Lane D: Lookalike (רק אם יש seed טוב)
  │   │   conditions: ∃ audience ∈ viable_lookalike_seeds שמתאים לשירות
  │   │               (מתאים = subtype WEBSITE/ENGAGEMENT/LEAD_GENERATION עם
  │   │                upper_bound ≥ 100 ומוזכר בשירות זה — או שזה ה-LAL היחיד שעוד אין).
  │   │   payload:    propose_audience --task-type create_lookalike
  │   │                               --origin-audience-id <seed>
  │   │                               --country IL --ratio 0.01 --type similarity
  │   │   intended_use: "הרחבה — אנשים דומים ל-<שם seed>, ratio 1%"
  │   │
  │   └─ Lane E: Saved Audience (broad + Advantage+ semantic seed)
  │       conditions: existing_saved_count < 3 לשירות זה
  │       payload:    propose_audience --task-type create_saved_audience
  │                                  --targeting-spec '{geo_locations: ..., flexible_spec: [{...}]}'
  │       intended_use: "broad — קהל ייחוס לקמפיינים חדשים של השירות, Advantage+ ימצא את ה-pocket בעצמו"
  │
  ├─ Step 5: enforce caps
  │   • מקסימום **3 הצעות לריצה אחת** (operator overload guard).
  │   • Lane D דורש seed קיים. אם אין → דלג, אל תיצור seed ולוקאלייק באותה ריצה.
  │
  └─ Step 6: כל הצעה → propose_audience.py עם:
      --service-tag "$SERVICE_NAME"  (חובה ב-Flow E — Block 13 / מיגרציה 024)
      --intended-use (עברית פשוטה, חובה)
      --rationale     (3-4 שורות, עברית: מה השירות צריך, למה הקהל הזה עכשיו, למה לא אחר)
      --urgency medium  (לא urgent — האופרטור יזם)
      --expires-in-hours 168 (שבוע — האופרטור בחר זמן שלא לחוץ)
```

**Idempotency פר-שירות (Block 13):** לפני כל הצעה, וודא שאין `pending`-approvals באותם 7 ימים שהם:
`payload->>'service_tag' = SERVICE_NAME AND task_type = <לן הנוכחי> AND status = 'pending'`.
אם קיים — log SKIP rationale="t_aud_<lane>_already_pending_for_service".

### דרישות rationale (קצר ומתועד)

פתיחה (פסקה 1, ללא ראשי תיבות באנגלית):

> "לשירות `<SERVICE_NAME>` הצעתי קהל מסוג `<lane_label_he>`. הוא ייתן ל-Meta `<תיאור הפעולה — למשל: רשימה של מבקרי דף השירות שלא השאירו פרטים, כדי לפנות אליהם שוב>`."

פסקה 2 (מותר ראשי תיבות בגלוס):

> "סוג הקהל: Custom WEBSITE (קהל על בסיס מבקרים בדף). נשמר ל-180 ימים. גודל צפוי: לפי תנועת אתר של 30 הימים האחרונים. תלוי בפיקסל פעיל (`tracking_health_status=<status>`)."

פסקה 3 (אופציונלי): קישור לקמפיין רלוונטי או הצעה הבאה (לדוגמה: "ברגע שהקהל יגיע ל-100 איש — אציע ממנו Lookalike").

### exclusivity vs §T-1 expand_audience

§T_AUD יוצר **קהלים חדשים** (Custom/Saved/Lookalike). §T-1 שם targeting פנימי על ad set קיים. הם לא חופפים. אם §T_AUD מציע קהל חדש ו-§T-1 מציע expand_audience על קמפיין קיים — שניהם חוקיים, סדר הפעלה: §T-1 תמיד קודם (per-run), §T_AUD רק כשמופעל ידנית.

### Output (one-line cron summary באנגלית, ל-stdout)

```
✓ §T_AUD service=<SERVICE_NAME> proposed=<N> lanes=[website,lookalike,...] skipped=<reasons>
```

