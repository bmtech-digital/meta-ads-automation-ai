# Performance Brain — מה זה "קמפיין טוב"

> **Source:** [campaigner-spec §6](../../docs/plans/campaigner-spec.md#6-performance-brain---מה-זה-קמפיין-טוב) + [CAMPAIGN_EVALUATION.md](../../docs/CAMPAIGN_EVALUATION.md).
> **Scope:** שני שערים — Leading signals (creative-level, 48h-7d) ו-Lagging signals (campaign-level, post-learning).
> **עקרון זהב:** "טוב" זה **יחסי** לעצמך, לא מוחלט. Baseline של החשבון הספציפי שולט — benchmarks גלובליים משמשים רק לרמה שניה.
> **שפת הפלט:** כשהמסקנות מהקובץ הזה נכתבות ל-`rationale`/`summary` — עברית פשוטה ודיבורית, מובנת גם למי שלא מהתחום. כללים מלאים ב-[hebrew-copy-style.md §11](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields).

---

## 1. בחירת KPI ראשי לפי סוג עסק

הסוכן בוחר KPI אוטומטית מ-`business_knowledge.vertical`:

| סוג עסק   | KPI ראשי            | משני              | reference point גלובלי 2026            |
| --------- | ------------------- | ----------------- | -------------------------------------- |
| eCommerce | **ROAS**            | CPA, AOV          | חציון 1.86; יעד בריא 2.5x+             |
| לידים B2C | **CPL**             | CTR, Lead Quality | חציון גלובלי $27.66; **ישראל $104.72** |
| Awareness | **CPM + CTR**       | Reach, Frequency  | CTR חציון 2.19%                        |
| אפליקציות | **CPI + Retention** | CTR               | —                                      |

**ה-reference הוא רק נקודת התחלה.** החלטות מתבססות על baseline של החשבון (`baselines` table, windows 7/14/30 days).

### ⚠️ ישראל ≠ Global × factor

אל תסתמך על benchmarks גלובליים מוכפלים ב-factor כלשהו:

- **CPM ישראל:** ~$8.38 — **~40% נמוך** מהגלובל ($20.15)
- **CPL ישראל:** **$104.72 — ~2.5× הגלובל** ($41.53)
- **תנודתיות:** CPL קפץ ל-$385 באוגוסט 2025 (אירוע ביטחוני)

**משמעות:** ערך שנראה "גבוה" גלובלית עשוי להיות תקין לישראל (CPL). ערך שנראה "טוב" גלובלית עשוי להיות חשוד לישראל (CPM). השתמש רק ב-baseline של החשבון.

---

## 2. Learning Phase — מתי לא לגעת

```
if conversions_7d < {{learning.min_conversions_for_exit}} AND days_active <= {{learning.max_days_before_limited}}:
    status = LEARNING           # DON'T TOUCH — reject any proposal that targets this campaign
if conversions_7d < {{learning.min_conversions_for_exit}} AND days_active > {{learning.max_days_before_limited}} AND not volume_trending_up:
    status = LEARNING_LIMITED   # options: increase_budget | consolidate_adsets | expand_audience
else:
    status = ACTIVE              # apply Gate 2 evaluation
```

**חישוב תקציב מינימלי ליציאה מ-Learning:**

```
budget_daily_min_ils = (expected_cpa_ils × {{learning.min_conversions_for_exit}}) / {{learning.max_days_before_limited}}
# דוגמה: CPA יעד ₪100 → תקציב מינימום ₪715/יום
```

קמפיין עם תקציב מתחת ל-`budget_daily_min_ils` לעולם לא ייצא מ-Learning. זו דיאגנוזה `diagnosis` לגיטימית → הצעה `scale_up` עד לתקציב מינימלי.

---

## 3. Data Sufficiency — לפני כל החלטה

**Volume-based thresholds (עיקר):**

```
Gate 1 (leading, creative-level):
  ✅ ≥ {{gate_1.impressions_floor}} חשיפות לכל קריאייטיב
  ✅ ≥ {{gate_1.clicks_floor}} clicks לכל קריאייטיב (לאמינות CTR)

Gate 2 (lagging, campaign-level):
  ✅ {{learning.min_conversions_for_exit}}+ המרות (יציאה מ-Learning)
  ✅ CPA יציב {{gate_2.expensive_sustained_days}}-7 ימים

A/B test declarations:
  ✅ {{gate_2.ab_test_significance_pct}}% statistical significance
```

**Time-based safety floor:**

```
✅ ≥ {{gate_1.evaluation_window_hours}}h מהשינוי המשמעותי האחרון
```

בלי זה — הסוכן רואה את ה-ramp של Meta delivery ומפרש אותו כטרנד.

**חריג — Emergency Kill (התעלם מה-thresholds למעלה):**

```
CPA > {{gate_2.emergency_threshold}}× יעד
   OR (הוצאה ≥ תקציב יומי מלא AND 0 המרות למשך {{gate_2.emergency_zero_conv_days}}+ ימים)
   → 🚨 הצעה דחופה (urgency='urgent')
```

---

## 4. Gate 1 — Leading Signals (ברמת קריאייטיב, חלון 48h-7d)

**למה Gate 1?** כי CPA/ROAS ב-48h אחרי העלאת קריאייטיב = רעש. leading signals אמינים מוקדם יותר.

| עדיפות | מדד                 | "טוב" | Kill trigger           |
| ------ | ------------------- | ----- | ---------------------- |
| 1      | **Hook Rate (3s)**  | > {{gate_1.hook_rate_good_pct}}% | < {{gate_1.hook_rate_kill_pct}}% אחרי {{gate_1.evaluation_window_hours}}h         |
| 2      | **CTR** (מוקדם)     | > {{gate_1.ctr_good_pct}}%  | < {{gate_1.ctr_kill_pct}}% עם ≥ {{gate_1.impressions_floor}} חשיפות |
| 3      | **Thumb-stop rate** | > {{gate_1.thumbstop_good_pct}}% | < {{gate_1.thumbstop_kill_pct}}% אחרי {{gate_1.evaluation_window_hours}}h         |

**קריאה:**

- Hook > {{gate_1.hook_rate_good_pct}}% + CTR > {{gate_1.ctr_good_pct}}% → winner potential. Iterate (2-3 וריאנטים דומים).
- Hook {{gate_1.hook_rate_kill_pct}}-{{gate_1.hook_rate_good_pct}}% + CTR תקין → solid. אל תיגע.
- Hook < {{gate_1.hook_rate_kill_pct}}% אחרי {{gate_1.evaluation_window_hours}}h → kill. הוסף וריאנט עם angle שונה.
- CTR < {{gate_1.ctr_kill_pct}}% עם ≥ {{gate_1.impressions_floor}} חשיפות → kill, גם אם hook בסדר (CTA/offer לא עובד).

---

## 5. Gate 2 — Lagging Signals (ברמת קמפיין, post-learning)

| עדיפות | מדד                             | "טוב"        | Kill trigger              |
| ------ | ------------------------------- | ------------ | ------------------------- |
| 1      | **CPA**                         | ≤ יעד        | > {{gate_2.expensive_threshold}}× יעד למשך {{gate_2.expensive_sustained_days}}+ ימים   |
| 2      | **ROAS**                        | ≥ Break-even | נמוך מרווחיות מינימלית    |
| 3      | **Meta Creative Fatigue flag**  | לא מסומן     | CPR ≥ {{gate_2.fatigue_cpr_multiple}}× baseline היסטורי |
| 4      | **Frequency** (monitoring only) | —            | **לא trigger עצמאי**      |

**קריאה:**

```
🟢 Winner: CPA ≤ יעד × {{gate_2.winner_ratio}} יציב {{gate_2.expensive_sustained_days}}-7 ימים + hook > {{gate_1.hook_rate_good_pct}}%
   → §T0r R8/R9 → §T2+ Branch A/B ({{scaling.scale_up_branch_b_pct}}%/{{scaling.scale_up_branch_a_pct}}% scale_up)
   חובה: marginal-return guard + cadence cap לפני שמציעים.

🟢 Solid-Strong: CPA between {{gate_2.winner_ratio}}-1.05× יעד + utilization ≥ {{solid_strong.util_floor}} + hook > {{solid_strong.hook_floor}}
   → §T0r R8 → §T2+ Branch C (+{{scaling.scale_up_branch_c_pct}}% scale_up — Roi 2026-05-12)
   "פוגע ביעד + מקום לצמיחה" — מקרה שלא קיבל ענף עד 2026-05-12.

🟡 Average: KPI ב-baseline ±{{gate_2.baseline_band_pct}}%, ללא triggers
   → §T0r → לפי active_creative_count:
     active_count < 5 OR last_add > 7d → §T_PE (creative pool exhausted → firehose)
     active_count ≥ 5 AND recent activity → §T_HO (hands_off — log SKIP, no action)
   **חשוב:** "average + מאגר בריא" = אל תיגע. אל תוסיף קריאייטיבים אוטומטית רק כי 'יש שבוע'.
   זה היה הפטרן הישן שגרם להצעות מיותרות. הוספה רק כשהמאגר באמת התרוקן.

🟠 Expensive-but-stable: CPA between {{gate_2.expensive_threshold}}-{{gate_2.emergency_threshold}}× יעד {{gate_2.expensive_sustained_days}}+ ימים, ללא fatigue, ללא CTR-low
   → §T0r R6 default → §T_SD (scale_down -{{scaling.scale_down_step_pct}}%)
   חדש 2026-05-12 — קודם אופציה זו לא היתה ענף; היה רק "pause או refresh".

🔴 Loser: CPA > {{gate_2.expensive_threshold}}× יעד {{gate_2.expensive_sustained_days}}+ ימים
   AND Creative Fatigue flag (CPR ≥ {{gate_2.fatigue_cpr_multiple}}×) → §T1 fatigue → new_creative × 3-5 (לא פאוזה!)
   AND CTR < {{gate_1.ctr_kill_pct}}% → §T1 CTR-low → new_creative עם angle אחר
   AND CTR > {{gate_1.ctr_good_pct}}% + 0 conv → §T1 LP issue → alert (בעיה בדף הנחיתה)

🚨 Emergency: CPA > {{gate_2.emergency_threshold}}× יעד OR {{gate_2.emergency_zero_conv_days}}+ ימים 0 conv עם תקציב מלא
   → §T1 emergency → pause_campaign urgency='urgent'

ℹ️ Frequency > 3 לבד
   → monitoring signal. אם CPR יציב, אל תיגע.
   → אם CPR גבוה → טפל תחת Creative Fatigue.
```

### מה זה Meta Creative Fatigue flag?

Meta מסמנת קריאייטיב כ-fatigued כאשר **CPR (Cost Per Result) גבוה פי 2 מה-baseline ההיסטורי של אותו קריאייטיב**. זה זמין ב-Ads Manager ובמקביל ב-API (`meta_creative_fatigue`). **זה הטריגר האמיתי, לא Frequency**.

---

## 6. חוקים Pre-Andromeda שהופקעו

אם הגעת לניסוח של proposal / rationale שחוזר על אחד מאלה — **עצור וחזור לסעיף 4-5**:

| חוק שהופקע                         | למה                                          | מה החליף אותו                                              |
| ---------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Frequency > 3 = auto-kill          | Andromeda מטרגטת טוב יותר; freq גבוה ≠ שחיקה | Meta Creative Fatigue flag (CPR ≥ {{gate_2.fatigue_cpr_multiple}}×)                      |
| 1 ad set = 1 ad                    | Andromeda מעדיפה ad sets גדולים              | ad set אחד עם 10+ ads                                      |
| Horizontal scaling ע"י duplication | duplication מאפס Learning                    | Vertical scaling (budget) בלבד                             |
| Narrow interest targeting          | Advantage+ עובד טוב יותר broad               | Broad + creative diversity                                 |
| הסתמכות על single winning creative | מביא לשחיקה מהירה                            | 10-50+ קריאייטיבים מגוונים                                 |
| Manual pruning ב-5-7 ימים          | Andromeda מחלקת תקציב לא-אחיד במכוון         | Continuous additions; אל תחתוך ידנית לפני Gate 1 threshold |
| 72h time-based sufficiency         | נפח > זמן                                    | ≥{{gate_1.impressions_floor}} חשיפות + ≥{{gate_1.clicks_floor}} clicks                                 |

**Guardrail אקטיבי** `no_frequency_only_kill` יפסול אוטומטית כל proposal שה-rationale שלו מסתמך רק על frequency (§14).

---

## 7. איך לנסח diagnosis

כל `log_decision --decision-type diagnosis` דורש:

- `summary` (עברית, שורה אחת): "קמפיין 'מטבחים': winner (ROAS 4.2, יצא מלמידה)"
- `rationale` (עברית, 2-4 משפטים): מציין את המספרים, את ה-baseline, ואת המסקנה
- `inputs` (JSON): המדדים ששמת בבסיס ההחלטה
- `outputs` (JSON): `{"label":"winner|solid|loser|fatigued","suggested_actions":[...]}`
- `confidence` (0..1): אמון ה-LLM. פחות מ-0.5 → עדיף `skip` במקום diagnosis מהוסס.

**דוגמה טובה:**

```json
{
  "summary": "קמפיין 'מטבחים': winner (ROAS 4.2, יצא מלמידה)",
  "rationale": "ROAS 4.2 מעל baseline 2.8 (50% מעל), CTR 2.1% (>1.5% threshold), Frequency 1.8 (<2.5). יצא מ-Learning לפני 5 ימים. מתאים ל-scale up של 20%.",
  "campaign_id": "1234567890",
  "inputs": {
    "cpa": 42,
    "baseline_cpa": 60,
    "ctr": 2.1,
    "frequency": 1.8,
    "days_active": 12,
    "conversions_7d": 68
  },
  "outputs": { "label": "winner", "suggested_actions": ["scale_up_20pct"] },
  "confidence": 0.88
}
```

**דוגמה רעה:**

```json
{
  "summary": "קמפיין נראה טוב",
  "rationale": "המספרים נראים בסדר",
  "confidence": 0.7
}
```

אין מספרים → אין דיאגנוזה. אם אין מספרים, השלב הוא `skip` לא `diagnosis`.

---

## 8. Portfolio Thinking — מעבר לקמפיין יחיד (חדש 2026-05-13, Block 9)

> **הקשר:** עד 2026-05-13 הסוכן ראה כל קמפיין כיחידה עצמאית. כש-Aiweon (או כל לקוח) מריץ 2+ קמפיינים פעילים, "אופטימיזציה פר קמפיין" מחמיצה את ההזדמנות הגדולה: **להזיז כסף ממקום שלא צומח למקום שצומח.**

### למה זה נושא של performance-brain ולא רק decision-tree?

כי הקריטריון "טוב יחסי לעצמו" (§5 Solid-Strong) מקבל משמעות שונה כשמשווים שני קמפיינים:

- קמפיין X: CPA 110% מהיעד, utilization 90% — "average". יחסי לעצמו: OK.
- קמפיין Y: CPA 80% מהיעד, utilization 99% — "winner-hungry". יחסי לעצמו: עומד בלמעלה מהיעד.
- **יחד:** Y רעב, X יציב-יקר. ה-portfolio אומר "תעביר ₪X לטובת Y".

הקמפיין X לא "רע". הוא פשוט פחות טוב מ-Y עם אותו תקציב. זאת הראייה ש-§T11 מוסיף.

### שני התפקידים בתיק

| תפקיד | סימנים | מה הסוכן מציע |
|---|---|---|
| **"רעב לתקציב" (hungry winner)** | `lane = scale_up_candidate` + `utilization_7d ≥ {{solid_strong.util_floor}}` + `CPA ≤ target × {{gate_2.winner_ratio}}` + ACTIVE 7+ ימים + `marginal_return_passed == true` | יעד לקבלת תקציב — הצעת `scale_up` |
| **"יקר אבל יציב" (expensive stable)** | `lane = scale_down_candidate` + `CPA between {{gate_2.expensive_threshold}}-{{gate_2.emergency_threshold}}× target` + ACTIVE 7+ ימים + לא fatigue (יש מסלול אחר) + לא Learning (§24) | מקור לוויתור על תקציב — הצעת `scale_down` -{{scaling.scale_down_step_pct}}% |

קמפיינים ב-hands_off / learning / cold_start / fatigue / pool_exhausted **אינם** מועמדים — כבר טופלו במסלולים שלהם.

### המתמטיקה של ה-rebalance

```
delta_ils = min(
  expensive.daily_budget_ils × ({{scaling.scale_down_step_pct}} / 100),   # §22: scale_down ≤ {{scaling.scale_down_step_pct}}%/step
  winner.daily_budget_ils    × ({{scaling.scale_up_branch_b_pct}} / 100), # §3 Branch A: scale_up {{scaling.scale_up_branch_b_pct}}%/step
  ₪{{portfolio.safety_cap_ils}}                                            # safety cap on daily movement
)
```

הסף התחתון: `delta_ils ≥ ₪{{portfolio.delta_floor_ils}}`. מתחת לזה — רעש, log SKIP.

### למה לא לאחד הכל ב-`portfolio_rebalance` task_type?

שיקלנו את זה. הבעיה: rebalance הוא **שתי פעולות נפרדות** ב-Meta (UPDATE budget על שני adsets שונים). אם אחד מצליח והשני נכשל, יש מצב לא-עקבי. שני proposals נפרדים מהדהדים את הריאליות של ה-API — האופרטור רואה שני אישורים מקושרים, יכול לאשר/לדחות יחד או בנפרד, וה-execute_task מטפל בכל אחד עצמאית. השדה `expected_impact.linked_to_*` ב-payload מאפשר ל-UI אחר-כך להציג אותם כיחידה.

### מתי **לא** לעשות rebalance

- כל המועמדים hands_off (`monthly_brief.is_current_month + hands_off_campaign_ids` מכסים את כל הזוגות).
- tracking_health_status != 'healthy' — measurement שבור עושה כל rebalance הימור.
- אין hungry_winner ATALL — אין למי להעביר.
- אין expensive_stable — מי שמת לב, יש כאן מצב כשהתיק "כולו מנצח" שזה דוקא מצב טוב לסקייל-אפ הוליסטי (קרה כשתקציב חודשי underrun + winner — מטופל ב-§T10, לא ב-§T11).
- delta_ils < ₪10 — לא שווה את החיכוך של תור-אישור.

### תזכורת: רק זוג אחד לריצה

§T11 שולח **rebalance pair אחד בלבד לריצה** (הזוג העליון לפי הדירוגים). הזוגות הבאים נשמרים לריצות עתידיות אחרי ש-Meta הזיזה למידה ל-72 שעות. זה מותאם לפילוסופיית Andromeda של "let it stabilize".
