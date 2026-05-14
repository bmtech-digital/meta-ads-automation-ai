# Guardrails — החוקים שלא חורגים מהם אף פעם

> **Source:** [campaigner-spec §14](../../docs/plans/campaigner-spec.md#14-guardrails).
> **עיקרון:** הכלל הכי קריטי במערכת — הסוכן לא שובר אף guardrail, גם אם "חושב" שכדאי.
> **מימוש עתידי:** `campaigner/tools/check_guardrails.py` (⏳ pending 4.x). עד אז, הסוכן קורא את הקובץ הזה לפני כל proposal ומוודא ידנית.
> **שפת הפלט (rejections + rationale):** עברית פשוטה ודיבורית, מובנת גם למי שלא מהתחום. ראשי תיבות באנגלית רק בפסקה שניה ועם הסבר בסוגריים בפעם הראשונה. ראה [hebrew-copy-style.md §11](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields).

---

## איך להשתמש בקובץ הזה

לפני כל `propose_task.py`, עבור על הרשימה למטה. אם אחד מהחוקים מופעל → **אל תציע**. במקום זה:

```bash
python -m campaigner.tools.log_decision \
  --business-id "$BUSINESS_ID" --run-id "$RUN_ID" \
  --graph-name observe_propose --node-name apply_guardrails \
  --decision-type rejection \
  --summary "Rejected <task_type> on <target_id>: violates <rule_name>" \
  --rationale "<Hebrew: למה הכלל חל כאן>" \
  --guardrail-violations "<rule_name>" \
  --campaign-id "<id>" \
  --outputs "{\"rejected_proposal\":{...}}"
```

**שם ה-rule** (ב-`--guardrail-violations`) חייב להיות תואם לשם ב-snake_case מהרשימה למטה. זה מפתח ה-audit trail של §14.

---

## 1. `no_delete_campaigns`

**כלל:** אין proposal עם `task_type='delete_*'`. השהייה (`pause_campaign`, `pause_adset`) בלבד.

**למה:** מחיקה לא הפיכה, מאבדת היסטוריה, ו-Meta ממיר delete ל-archive אוטומטית. השהייה משיגה אותה תוצאה אופרטיבית עם rollback אפשרי.

**איך להחליף:** `pause_campaign` / `pause_adset`.

---

## 2. `max_tasks_per_day` (§8.3)

**כלל:** תקרת הצעות יומית לפי תקציב העסק:

| `businesses.daily_budget_ils` | מקסימום proposals/יום |
| ----------------------------- | --------------------- |
| < 50                          | 2                     |
| 50 – 500                      | 5                     |
| > 500                         | 10                    |

**למה:** אפליקציה של החלטות הוא מאמץ קוגניטיבי. הצפת המשתמש במשימות → decision fatigue → אישורים אוטומטיים בלי חשיבה.

**איך להחליף:** אחרי step 5 (anti-flood prioritization ב-CAMPAIGNER.md), דלג על proposals עודפים → `log_decision rejection`.

---

## 3. `no_learning_phase_touch`

**כלל:** קמפיין ב-`status=LEARNING` (conversions_7d < 50 AND days_active ≤ 7) → אין `pause_campaign` / `pause_adset` / `expand_audience` / `new_campaign`.

**חריג:** `scale_up` ל-תקציב מינימלי (`budget_daily_min_ils = CPA × 50 / 7`) — אחרת הקמפיין לא ייצא מ-Learning לעולם.

**למה:** שינוי בקמפיין ב-Learning מאפס את האלגוריתם של Meta. 7 ימים הולכים לפח.

---

## 4. `budget_jump_max_30pct`

**כלל:** שינוי תקציב יומי חד פעמי ≤ 20% (default). עד 30% מותר **רק** אם:

- `hook_rate > 35%`
- `frequency < 2.0`
- `status=ACTIVE` (יצא מ-Learning)

קפיצה > 30% → פסילה.

**למה:** Meta מכוילת ל-pacing. קפיצה גדולה מדי → re-entering Learning, reset של ההתקדמות.

**איך להחליף:** פרוט ל-2-3 הצעות scale_up ברצף ימים עוקבים.

---

## 5. `no_audience_change_on_active`

**כלל:** אין `expand_audience` על קמפיין `status=ACTIVE` שעומד ביעד (CPA ≤ יעד). קהל = משתנה יסודי.

**חריג:** קמפיין `LEARNING_LIMITED` מעל 7 ימים בלי 50 conversions — שינוי קהל מותר לפתיחת Learning מחדש.

**למה:** שינוי קהל בקמפיין מוצלח = שבירת מה שעובד. "Don't fix what ain't broken."

---

## 6. `no_horizontal_scaling_by_duplication` (חדש 2026)

**כלל:** אין proposal עם `task_type='new_campaign'` שמעתיק קמפיין מוצלח.

**למה:** Duplication מאפס Learning Phase — 7+ ימים של אופטימיזציה הולכים לפח. Vertical scaling (הגדלת תקציב בקמפיין הקיים) = הדרך היחידה הלגיטימית.

**איך להחליף:** `scale_up` (בכפוף ל-`budget_jump_max_30pct`).

---

## 7. `meta_api_rate_limit`

**כלל:** מקסימום X קריאות/דקה ל-Meta Marketing API (X נקבע לפי `app_rate_limit` — בדר"כ 200/hour user-level).

**למה:** Meta חוסמת tokens על rate limit. חסימה = אי-יכולת לבצע approvals עד שהחסימה פגה.

**איך להחליף:** אם זיהית ריבוי קריאות, קמצן — השתמש ב-cached snapshot מ-`fetch_insights` במקום לקרוא שוב.

---

## 8. `document_every_decision` (§12.1)

**כלל:** כל פעולה → שורה ב-`agent_decisions` דרך `log_decision.py`.

**למה:** §12.1 הוא צורך אמיתי — ללא רישום אין audit, אין debugging, אין UI "למה?".

**אם log_decision נכשל:** הכלי חוזר 3 פעמים אוטומטית. אם עדיין נכשל → exit 1. **לא** ממשיכים ב-"fail-soft".

---

## 9. `explicit_approval_over_threshold_ils`

**כלל:** הצעה שמגדילה spend ב-> ₪500/יום חייבת `urgency='high'` או `'urgent'` לפחות. השפעת תקציב גבוהה = רואה אותה המשתמש בראש הרשימה.

**למה:** הצעת scale_up בתקציב גבוה שתקועה בתור "medium" 48 שעות = שריפת כסף.

---

## 10. `no_pause_on_recent_conversion_24h`

**כלל:** אין `pause_campaign` על קמפיין שהביא המרה ב-24 השעות האחרונות.

**למה:** המרה חיה = המודעה עדיין רלוונטית. השהייה לא לוגית.

**חריג:** Emergency kill (CPA > 3× יעד) גובר על הכלל הזה.

---

## 11. `no_low_res_creative`

**כלל:** קריאייטיב בפירמידה פחות מ-1080p → פסילה ב-`new_creative` proposal.

**למה:** Meta מוריד איכות תצוגה אוטומטית, פוגע ב-hook rate.

**מימוש:** בעת יצירת תמונה דרך `ImageGenerator`, הדגל `aspect_ratio` + dimensions מחזיר 1080x\*. ולידציה על התוצר לפני upload.

---

## 12. `require_95pct_significance_for_ab` (חדש 2026)

**כלל:** הכרזה על winner ב-A/B test דורשת 95% statistical significance (או volume equivalent). אין "hook A עבר 2% > hook B 1.8% אז A ניצח" ב-100 חשיפות כל אחד.

**למה:** Andromeda מחלקת תקציב לא-אחיד במכוון. הבדלי ביצועים בהיקף נמוך = רעש, לא signal.

---

## 13. `prefer_add_creative_over_pause` (חדש 2026)

**כלל:** קמפיין עם Meta Creative Fatigue flag (CPR ≥ 2× baseline) → הצעה אסורה `pause_campaign`. הצעה מותרת: `new_creative` × 3-5.

**למה:** Fatigue בקריאייטיב ≠ בעיה בקמפיין. פאוזה מאבדת את Learning. Firehose של קריאייטיבים מרענן בלי איבוד.

---

## 14. `no_manual_creative_pruning_before_48h` (חדש 2026)

**כלל:** אין `pause_adset` / `pause_campaign` על קריאייטיב חדש (פחות מ-48h חי) **אלא אם** Gate 1 kill trigger פעל (hook < 25% OR CTR < 1% עם volume מספיק).

**למה:** Meta מקציבה תקציב לא-אחיד במכוון — "winning" creatives מקבלים יותר. שחיקה נראית כפרופורציות לא-אחידות ב-dashboard. אל תפרש כ-"צריך לכבות".

---

## 15. `no_frequency_only_kill` (חדש 2026)

**כלל:** Frequency > 3 לבדו → **לא** trigger ל-pause. חייב signal נוסף (CPR ≥ 2×, או CPA > 1.3× יעד).

**למה:** Andromeda מטרגטת טוב יותר. Frequency גבוה ≠ שחיקה. ה-trigger האמיתי הוא Creative Fatigue flag.

**איך לתפוס rationale שמפר את הכלל:** אם ב-`rationale` מופיעה המילה "frequency" בלי מדד אחר תומך → חזור ל-[decision-tree.md §T1](decision-tree.md#t1--cpa-יקר-מדי-gate-2).

---

## 16. `video_preferred_on_equal_cpa`

**כלל:** כאשר מציעים `new_creative` וה-CPA של וריאנטי וידאו ותמונה דומה (±10%), העדף וידאו.

**למה:** וידאו נותן hook rate גבוה יותר ב-2026. CTR דומה + hook טוב יותר = פוטנציאל scale עדיף.

---

## 17. `verify_tracking_infrastructure` (מחובר ל-backend PRD E1 #11; הורחב 2026-05-12 — M1)

**כלל:** הצעות מסוג `new_campaign`, `scale_up`, `new_creative`, או `expand_audience` נחסמות אם הסוכן יודע שמערכת המדידה לא בריאה — כלומר:
- `state.tracking_health_status != 'healthy'` (העדף מקור זה — תוצאת `check_tracking_health.py`, M1 2026-05-12), **או**
- `state.tracking_verified=false` (fallback ל-flag הישן ב-`business_knowledge`).

**למה:** כל הצעה ש**מגדילה הוצאה** במערכת שלא מודדת המרות = שריפת תקציב על optimization בלתי-אפשרי. עד 2026-05-12 הכלל חסם רק `new_campaign`; מאז הוא גם חוסם scale-spend על קמפיינים קיימים מאותה סיבה — Meta לא יודעת מה לאופטם, ההגדלה רק מגדילה ההפסד.

**מה כן מותר במצב לא-בריא:** `pause_campaign` (חירום), `alert`, `set_kpi_target`, `verify_pixel_capi` (המסלול הקנוני לתיקון).

**איך להחליף:** הסוכן מציע `verify_pixel_capi` עם urgency=high כדי לשים את המשימה בראש הרשימה של המשתמש. אם כבר יש pending verify_pixel_capi → `log_decision skip` עם rationale `"tracking_unhealthy_proposal_already_pending"`.

**מימוש:** `check_guardrails._verify_tracking_infrastructure`. הסוכן מעביר ב-`--state` את `tracking_health_status` מתוצאת `check_tracking_health.py` (Step 0.5 ב-Flow A).

---

## 18. `enforce_budget_formula` (מחובר ל-backend PRD E1 #12)

**כלל:** כל `new_campaign` / `scale_up` שהתוצאה שלו תקציב יומי מתחת ל-`(expected_cpa × 50) / 7` → פסילה.

**למה:** §6.3 — קמפיין לא ייצא מ-Learning אם התקציב שלו לא יאפשר ≥ 50 המרות ב-7 ימים. הצעה שמציבה אותו בתקציב נמוך יותר = שריפת כסף ללא exit from Learning.

**דוגמה:** CPA יעד ₪100 → `budget_daily_min_ils = (100 × 50) / 7 = 714`. הצעה עם daily_budget_ils = 500 → rejection.

**איך להחליף:** הצע תקציב שעומד ב-formula, או העלה את ה-CPA יעד אם הלקוח עומד על תקציב נמוך.

---

## 19. `no_new_creative_when_underspending` (חדש 2026-05-12)

**כלל:** קמפיין עם `utilization_7d < 0.50` (per §T-1 — Meta הוציאה פחות מחצי תקציב) → **פסילה ל-`task_type='new_creative'`**.

**למה:** Roi 2026-05-12 — "להוסיף קריאייטיב כשהבעיה היא שאף אחד לא רואה את הקיים = לזרוק עוד דליים למאגר ריק". התסמין הוא pool/audience/auction misalignment, לא חוסר זוויות. הוספת וריאנט לא תגדיל חשיפות אם Meta מסרבת להוציא תקציב.

**איך להחליף:** propose alert (`task_type='alert'`) שמתאר את ה-mismatch (pool / audience size / CPM). אם הסוכן זיהה סיבה ספציפית — propose expand_audience או alert על objective. ראה decision-tree.md §T-1 severely_under branch.

**חריג:** אם operator הציב override מפורש ב-`approvals.payload.override_no_new_creative_when_underspending=true` — מותר, אבל ה-rationale חייב לציין למה.

---

## 20. `scale_up_cadence_max_1_per_week` (חדש 2026-05-12)

**כלל:** מקסימום הצעה אחת של `task_type='scale_up'` (או `budget_change` עם magnitude > 0) לכל קמפיין בכל 7 ימים רצופים. הספירה: `executed_at` של approvals שכבר התבצעו ב-Meta.

**למה:** Roi 2026-05-12 — שני שיקולים נצברים:
1. כל הגדלה דורשת ל-Meta לאזן מחדש pacing. הגדלה רצופה לפני שהקודמת התייצבה = רעש מצטבר.
2. בלי cadence cap, הסוכן יציע 3 הגדלות באותו שבוע על אותו קמפיין — והמשתמש לא יוכל לדעת איזו הזיזה מה.

**איך להחליף:** log SKIP rationale="weekly_cadence_cap" — הסוכן יחכה לשבוע הבא. אם הקמפיין מציע scale_up פי 2 בשבוע — זה signal של marginal-return guard (§22) או של winner real-real אבל אז Roi יאשר ידנית בייעוץ אישי.

**מימוש:** ב-decision-tree §T2+ Pre-check 3. Python check עתידי ב-`check_guardrails.py`.

---

## 21. `marginal_return_check_before_scale_up` (חדש 2026-05-12)

**כלל:** הצעת `scale_up` נדחית אם:
- היתה הגדלה קודמת לאותו `target_id` ב-14 הימים האחרונים, **וגם**
- `delta_conversions(7d post last_scale) < 1.10 × baseline_conversions(7d pre last_scale)` (פחות מ-10% עלייה).

**למה:** Roi 2026-05-12 — "רק אם זה באמת יעיל. אם זה סתם לא נותן כלום אז שלא יציע". בלי הבדיקה הזו, הסוכן יציע +20% גם אחרי שההגדלה הקודמת הוכיחה שאין צמיחה — מה שמבזבז כסף בלי תוצאה.

**איך להחליף:** propose alert (`task_type='alert'`) במקום scale_up. rationale (עברית פשוטה): "ההגדלה הקודמת לא הזיזה המרות. תקציב נוסף לא יעזור — צריך לבחון זווית קופי שונה או לבדוק אם הקהל הגיע לתקרה."

**Edge case:** אין הגדלה קודמת ב-14 יום → הכלל לא חל, scale_up מותר (כפוף לשאר ה-pre-checks).

**מימוש:** ב-decision-tree §T2+ Pre-check 1. הכלי `python -m campaigner.tools.check_marginal_return --business-id ... --campaign-id ...` (זמין מ-2026-05-12) מבצע את כל הבדיקה — כולל חיפוש ב-`approvals`, שאיבת שני חלונות מ-Meta, וחישוב delta. הסוכן קורא את `passes_guard` ו-`block_reason` מהפלט.

---

## 22. `scale_down_max_15pct_per_step` (חדש 2026-05-12)

**כלל:** הצעת `scale_down` שמורידה תקציב יומי ביותר מ-15% בצעד אחד → פסילה.

**למה:** ירידות גדולות שוברות pacing באותו אופן שהגדלות גדולות שוברות אותו. -15% היא ירידה מורגשת ב-Meta ההוצאות אך מספיק קטנה כדי לא לאפס את Learning.

**איך להחליף:** פרוט ל-2 הצעות scale_down ברצף 14 ימים (אבל ראה גם §23 — `no_consecutive_scale_down_14d` שחוסם רצף קצר מדי). אם המצב באמת דורש ירידה גדולה — סימן שצריך pause + ניתוח, לא scale_down.

---

## 23. `no_consecutive_scale_down_14d` (חדש 2026-05-12)

**כלל:** אסור להציע `scale_down` על קמפיין שכבר התבצעה עליו הצעת `scale_down` ב-14 הימים האחרונים.

**למה:** שתי הורדות רצופות = פאוזה איטית. אם ה-scale_down הראשונה לא הביאה את ה-CPA לטווח — סימן שהבעיה היא בקופי, יעד או קהל, לא בקצב ההוצאה. הורדה נוספת רק תכניס לקמפיין spiral של פחות חשיפות → פחות המרות → CPA נראה יותר גרוע ביחס יחסי.

**איך להחליף:** propose new_creative עם angle אחר, או propose alert על pool misalignment. אם באמת אין מה לעשות — pause עם urgency='medium' למחשבה.

---

## 24. `no_scale_down_in_learning` (חדש 2026-05-12)

**כלל:** קמפיין ב-`status=LEARNING` או `LEARNING_LIMITED` → אסור scale_down. גם לא להציע "ירידה קטנה".

**למה:** §3 (`no_learning_phase_touch`) חוסם כבר את רוב הפעולות בלמידה. scale_down ספציפית: שינוי תקציב בלמידה מאפס את ספירת 7 הימים → 7+ ימים נוספים מחכים ל-50 conversions. בלמידה יש רק שתי פעולות לגיטימיות: scale_up עד `budget_daily_min_ils` (חריג ב-§3), או pause במצב emergency.

**איך להחליף:** המתן ליציאה מ-Learning. אם CPA יקר מאוד בלמידה — Emergency check (§T1): CPA > 3× יעד → pause עם urgency='urgent'.

---

## 25. `respect_hands_off` (חדש 2026-05-12 — M2 Monthly Brief)

**כלל:** קמפיין שהמשתמש סימן ב-`businesses.monthly_brief.hands_off_campaign_ids` לחודש הנוכחי → אסור להציע עליו `scale_up` / `scale_down` / `pause_campaign` / `new_creative` / `expand_audience` / `budget_change`. **מותר** `alert` (אם יש משהו שדורש תשומת לב) ו-`observation` (תיעוד ב-`agent_decisions` רגיל).

**למה:** PERSONALITY non-negotiable #4 — "Ask the business intent before recommending". כשהמשתמש סימן ידנית "אל תיגע", הסוכן צריך לכבד את הקביעה הזו, גם אם המספרים מצדיקים פעולה. המשתמש יודע משהו שהסוכן לא יודע (תהליך מקביל, ניסוי שמרני, רגישות עסקית).

**איך לבדוק:** ב-Flow A Step 1 הסוכן טוען `load_business_knowledge` ומקבל `monthly_brief_summary`. אם הקמפיין שעל הפרק נמצא ב-`hands_off_campaign_ids` **ו**-`is_current_month == true` (בריף לא מיושן) → log SKIP rationale="hands_off_per_monthly_brief".

**חריג יחיד:** Emergency Pause לפי §T1 (CPA > 3× יעד OR 3+ ימים 0 conversions עם תקציב מלא). המשתמש לא יכול לחסום emergency, אבל ה-rationale חייב לציין: "פעלתי בניגוד ל-hands_off כי [תנאי החירום]; אנא עדכן את הבריף בהתאם".

**מימוש:** prompt-level בקריאת ה-router (§T0r). Python check עתידי ב-`check_guardrails.py`.

---

## 26. `set_kpi_target_requires_research` (חדש 2026-05-12; פתח static path 2026-05-13)

**כלל:** הצעת `task_type='set_kpi_target'` נדחית אם `payload.research` חסר, או חסר את אחד מהשדות הבאים:

- `market_average` (מספר) — הערך הממוצע שהסוכן מצא במחקר.
- `sources[]` — לפחות 2 רשומות, כל אחת עם `title`, `url`, `extracted` (ציטוט שורה אחת).
- `context_used[]` — רשימת השדות מ-`business_knowledge` שעיצבו את שאילתות החיפוש (`vertical`, `products`, `service_regions`, וכו'). מוכיח שהמחקר היה ספציפי לעסק.

**למה:** המשתמש חייב יכולת לאמת את הערך. בלי `sources` הוא לא יכול. בלי `context_used` אין דרך לדעת אם החיפוש שיקף את ה-vertical / מוצר / אזור של העסק או שהוא חזר ל-band הגנרי. הצעת ערך גנרי לפלטפורמת B2B SaaS ספציפית כאילו הייתה ליד של קבלן שיפוצים = ייעוץ שגוי.

**שני נתיבים מותרים למלא את ה-research block** (שניהם עוברים את הגארדריל באותו אופן):

### נתיב A — סטטי (מועדף, חוסך טוקנים) ⚡

הסוכן קורא קודם ל:

```bash
python -m campaigner.tools.estimate_cpl --business-id $BUSINESS_ID \
    [--stage cold|warm_*|...] [--offer consultation_free|demo_request|...] \
    [--channel lead_form|click_to_whatsapp|...] [--month nov] [--security-event]
```

הכלי מחזיר `research_block` מוכן (תאם מלא ל-§26): `market_average`, `sources[]` (≥2 ציטוטים מ-[cpl-infrastructure.md §9](cpl-infrastructure.md#9-primary-sources-citable-for-researchsources)), `context_used[]`. **שותל אותו ישירות ל-`propose_task --research <json>`.** אפס WebSearch.

**מתי הנתיב הזה תקף:**
- `business.vertical` מוגדר (לא null, לא `other`).
- `business_knowledge.products` או `questionnaire_answers.ideal_customer/usp/main_pain` קיימים — מאפשר match סאב-ורטיקל.
- פלט `estimate_cpl` מחזיר `needs_live_research=false` (כלומר `confidence != 'low'` ו-`confidence_of_match != 'fallback'`).

### נתיב B — חי (WebSearch) — fallback ל-edge cases

חובה ל-WebSearch כש:
- `needs_live_research=true` ב-פלט `estimate_cpl`.
- צריך לאשש פרופוזל high-stakes (תקציב > ₪500/יום) — [cpl-infrastructure.md §10.4](cpl-infrastructure.md#10-when-to-live-websearch-anyway-escape-hatch).
- הערך שאופרטור הציב חורג מה-band ב-`estimate_cpl` ב->2× — ייתכן ויש לו הקשר שהמודל הסטטי לא מכיר.
- מאפיין `business_settings.unusual=true` שהאופרטור הציב.

ב-WebSearch — שאילתות מעוצבות לפי business_knowledge (לדוגמה: `"average cost per lead B2B SaaS Israel 2026"`, `"<vertical-specific term in Hebrew> עלות לליד ממוצעת"`). סינתזה מ-2-5 מקורות. אותם 3 שדות חובה (`market_average`, `sources[]`, `context_used[]`).

**אם גם `estimate_cpl` החזיר `fallback` וגם WebSearch לא זמין:** **אל תציע** `set_kpi_target`. במקום זה, log SKIP עם `rationale="static_fallback_and_websearch_unavailable"`. ההצעה תחכה לריצה הבאה.

### דרישות תוכן `rationale` (חובה — תוקן 2026-05-13 לפי משוב משתמש)

הגארדריל מוסיף **שלוש בדיקות תוכן** ב-rationale כדי שהאופרטור יראה ספציפיות, לא טקסט גנרי:

1. **שם השירות שנותח:** ה-rationale חייב להזכיר במפורש לפחות אחת מ-`match.matched_terms[]` שהוחזרו מ-`estimate_cpl` (לדוגמה: "ניתחתי את 'סוכן AI'", "ניתחתי את 'מיתוג משפיעות'"). אלה המילים שהפעילו את ההתאמה — הוכחה ספציפית לאיזה שירות חוקרים. אם `matched_terms` ריק (`confidence_of_match='fallback'`), ה-rationale חייב להגיד במפורש "לא זוהה שירות ספציפי, ניתחתי את כלל פעילות העסק". **גנרי "עסק שדומה לך" נחסם.**
2. **שם הקמפיין (כש-`campaign_name` הועבר):** אם `estimate_cpl --campaign-name=<X>` שימש, ה-rationale חייב לכלול את `X` (שם הקמפיין מ-Meta) כדי שהאופרטור יראה שהמחקר היה לקמפיין הספציפי, לא לעסק כולו. לדוגמה: "עבור קמפיין 'סוכן AI - שלב 1' (משתייך לשירות 'סוכן AI')". זה החיווט מ-[decision-tree.md §T-2](decision-tree.md#t-2--per-campaign-service-anchor-must-run-after-t-1-before-t0r).
3. **מתחרים שעוגנו:** ה-rationale חייב להזכיר ≥1 שם מ-`business_knowledge.competitors`, או — אם הרשימה ריקה — להגיד במפורש "אין מתחרים מוגדרים, השוואתי מול ממוצע ענפי כללי של [שם תת-ורטיקל]".

**מימוש:** ב-`_set_kpi_target_requires_research` ב-[check_guardrails.py](../tools/check_guardrails.py) — בדיקות רגקס פשוטות:
- לפחות אחד מ-`payload.research.match.matched_terms[]` (או fallback ל-`business_knowledge.products[].name`) חייב להופיע ב-`rationale`.
- אם `payload.research.match.campaign_name` לא ריק → שם הקמפיין חייב להופיע ב-`rationale`.
- לפחות אחד מ-`business_knowledge.competitors[]` חייב להופיע, או הביטוי "אין מתחרים מוגדרים" חייב להופיע מפורש.

ראה גם [kpi-benchmarks.md "How rationale must be written"](kpi-benchmarks.md#how-set_kpi_target-rationale-must-be-written) — ההנחיה המלאה לניסוח.

---

## 27. `no_competitor_hallucinations` (חדש 2026-05-13 — Flow D)

**כלל:** הצעת `task_type='alert'` שה-`payload.alert_type` שלה הוא אחד מ-(`target_drift`, `trending_angle`, `new_format`) או מתחיל ב-`competitive_` — חייבת לכלול `payload.research` עם:

- `sources[]` באורך ≥ 2, כל אחד עם `title` + `url` + `extracted` (ציטוט שורה אחת)
- `context_used[]` לא ריק — רשימת השדות מ-`business_knowledge` שעיצבו את שאילתות החיפוש (`vertical`, `products`, `service_regions`, `competitors`)

**למה:** Flow D הוא מחקר WebSearch על השוק והמתחרים. ה-spec הזכיר את הכלל הזה כ-placeholder ל-v2 ([campaigner-spec.md §14](../../docs/plans/campaigner-spec.md#14-guardrails)) — קודם ל-MVP כשהוסיפים את Flow D, כי בלי enforcement דטרמיניסטי הסוכן יכול לכתוב "מתחרים משתמשים בזווית X" בלי מקור ולגרור את העסק להחלטות על סמך הזיה. עלות לעסק של hallucination כאן גדולה — הוא ידחה הצעה אחת מתוך הזיה, יבזבז משבוע על זווית קריאייטיב מומצאת, או יוריד יעד KPI לפי "ממוצע ענפי" שלא קיים.

**איך להחליף:**
- הרץ מחדש את WebSearch על הטופיק עם שאילתות ספציפיות יותר (כולל שם ה-vertical בעברית + אנגלית, שם המוצר, אזור).
- אם WebSearch מחזיר רק תוצאה אחת — הרחב או דלג על הממצא. תוצאה בודדת היא לא מחקר.
- אם אי-אפשר למצוא ≥ 2 מקורות בתוך 12-query budget של Flow D — log SKIP עם `rationale="insufficient_sources_for_competitive_claim"`. **אל תציע alert.**

**חריג:** `alert_type` כללי (לא בקטגוריה תחרותית — לדוגמה `alert_type='budget_overrun'`, `alert_type='pool_misalignment'`) **לא חל**. הכלל הזה רק על competitive claims, לא על כל ה-alerts.

**מימוש:** ב-`_no_competitor_hallucinations` ב-[check_guardrails.py](../tools/check_guardrails.py). דפוס זהה ל-§26 set_kpi_target_requires_research, שונה רק ב-trigger (task_type+alert_type) ובדרישת `market_average` (לא חלה כאן — competitive alerts אינם הצעת ערך נומרי יחיד).

---

## 28. `prefer_gallery_over_generation` (חדש 2026-05-13 — Block 8)

**כלל:** הצעת `task_type='new_creative'` חסומה אם בגלריה יש ≥ 3 אסטים שעוד לא נוצלו (viable, לא נמחקו, לא מקושרים לאף `executed` ad approval) **באותו ערוץ**. במקום, הסוכן חייב להציע `redeploy_creative` על האסטים הקיימים, או להעביר `payload.source_preference: 'generate_new'` כדי לעקוף ביודעין.

**למה:** Imagen עולה ~$0.02 לתמונה ו-Claude עוד שבריר אגורה לקופי, אבל העלות האמיתית היא הזדמנות. כל קריאייטיב חדש שהסוכן שולח הוא slot אחד פחות לאסט שכבר שילמת עליו. §T9 (אורגני) כבר עובד gallery-first; §T6.1 (קמפיין ראשון) ו-§T_PE (pool הריק) חייבים להתאים. Andromeda גם מעדיף יותר וריאנטים פעילים — אז אין סיבה לזרוק אסטים שהוטמעו ונשארו מאחור.

**איך הסוכן מציית בפועל:**

1. **שלב מקדים — Gallery census** לפני שמציעים `new_creative` או `redeploy_creative`. בקובץ [`prompts/decision-tree.md`](decision-tree.md) §T_PE/§T6.1 — חובה:
   ```bash
   python -m campaigner.tools.list_active_creatives \
     --business-id $BUSINESS_ID \
     --unused-in-campaigns \
     --matches-channel <feed|stories|reels>
   ```
2. **קרא** `viable_unused_count` מהפלט.
3. **החלטה לפי הסף** (כפי שמתואר ב-§T_PE ו-§T6.1):
   - `N ≥ 3` (או 10 לקמפיין ראשון) → propose `redeploy_creative` במקום `new_creative`.
   - `0 < N < 3` (או 1-9 לקמפיין ראשון) → mixed: redeploy על מה שיש + new לשאר.
   - `N = 0` → propose `new_creative` רגיל.
4. **payload** ל-`new_creative` חייב לכלול `channel` (`feed` / `stories` / `reels`) כדי שגארדריל §28 יוכל למצוא את ה-count לערוץ הנכון. בלי `channel` — §28 מחזיר `skipped:true` (לא נכשל, אבל חוסר ה-`channel` בעצמו אמור להעיר לסוכן שהוא לא הגדיר את היעד).

**override מפורש:** הוסף `source_preference: 'generate_new'` ל-`payload`. השתמש בו רק כשיש סיבה מוצדקת — למשל כל ה-N האסטים בגלריה נדחו במחזורי learning, או הזווית של הקמפיין החדש שונה מהותית מכל מה שיש.

**מימוש:** ב-`_prefer_gallery_over_generation` ב-[check_guardrails.py](../tools/check_guardrails.py). ה-context fetcher (`_fetch_context`) מריץ את ה-SQL ל-`viable_unused_gallery_count_for_channel` כשה-payload מכיל `channel`. אחרת — `skip`.

---

## 29. `ab_test_requires_min_creatives` (חדש 2026-05-13 — Block 11)

**כלל:** הצעת `task_type='ab_test_setup'` חייבת לכלול `payload.creatives` עם **בין 2 ל-4 וריאנטים**. פחות מ-2 = אין מה להשוות; יותר מ-4 = הדגם פר וריאנט קטן מדי כדי להחליט בביטחון בזמן סביר.

**למה:** A/B test פורמלי דורש לפחות שני וריאנטים להשוואה. בגבול העליון: Andromeda פוצלת תקציב בין הוריאנטים, ו-5+ וריאנטים אומרים שכל אחד יקבל פחות מ-20% מהתקציב — מספיק לדגימה אבל לא מספיק לקבל החלטה אמינה תוך 7 ימים. למבחנים מורכבים יותר עדיף לפצל לשני tests עוקבים.

**מימוש:** ב-`_ab_test_requires_min_creatives` ב-[check_guardrails.py](../tools/check_guardrails.py). בודק `payload.creatives` בלבד — אם פחות מ-2 או יותר מ-4 → fail.

**איך להחליף:** הוסף וריאנט נוסף לפני ההצעה (אם פחות מ-2), או פצל לשני tests (אם 5+).

---

## 30. `ab_test_min_window_7d` (חדש 2026-05-13 — Block 11)

**כלל:** הצעת `task_type='ab_test_setup'` חייבת `payload.window_days >= 7`. ההצעה ל-`task_type='ab_test_decide'` תיחסם אם זמן ההחלטה (`ab_tests.started_at + window_days`) טרם הגיע.

**למה:** Andromeda צריכה לפחות 7 ימים כדי לחלק תקציב באופן יציב בין וריאנטים. החלטה ב-3-5 ימים מסתמכת על fluctuations של תחילת הקמפיין — לא על אות אמיתי. זה תואם גם את §12 `require_95pct_significance_for_ab` (נפח לאמינות).

**מימוש:** ב-`_ab_test_min_window_7d` ב-[check_guardrails.py](../tools/check_guardrails.py). שני נתיבים:
1. `ab_test_setup` — בודק `payload.window_days >= 7`. fail אחרת.
2. `ab_test_decide` — בודק שה-`ab_test_id` קיים, status='running', וכבר עברו ≥ 7 ימים מ-`started_at`. אם עברו פחות → fail עם הודעה "מוקדם מדי, חכה עוד N ימים".

**חריג:** אם הוצע `cancel_instead=true` ב-`ab_test_decide` — הכלל לא חל. ביטול הוא לגיטימי בכל זמן.

**איך להחליף:** הגדל את `window_days` ל-7+, או חכה לפני שמציע decide. אם הוריאנטים מובהקים *מאוד* מוקדם (margin > 50%, sample ≥ 1,000 לכל וריאנט) — שקול cancel + start_test חדש מקופי שכבר נראה ככישלון, במקום לעקוף את חלון 7 הימים.

---

## 32. `rationale_has_approve_reject_footer` (חדש 2026-05-13 — תגובה לתסכול אופרטור)

**כלל:** כל proposal — כל `task_type` — חייב להכיל ברציונל את שתי המחרוזות `אישור` ו-`דחייה` (עם מפריד `=`/`—`/`:` תוך 5 תווים אחריהן). חסר אחת מהן → fail.

**למה:** ה-UI מציג כפתורי "אשר" / "דחה" ללא קונטקסט נוסף. בלי השורות הקבועות "אישור = X, דחייה = Y" בסוף הרציונל, האופרטור צריך לנחש מה כל לחיצה גורמת. תיעוד מ-2026-05-13: אופרטור התלונן ש-`alert` עם רציונל ללא הנחיה ברורה גרם לו לאי-ודאות אם "אשר" אמור לבצע משהו או רק לסגור התראה.

**מימוש:** ב-`_rationale_has_approve_reject_footer` ב-[check_guardrails.py](../tools/check_guardrails.py). regex פשוט: `r"אישור\s*[=—:]"` ו-`r"דחייה\s*[=—:]"`. שניהם חייבים להופיע. הסדר לא משנה (פתיחה/סגירה — לפי כתב הסגנון [hebrew-copy-style.md §11 רול 7](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields), השורות בסוף).

**איך להחליף:** הוסף את שתי השורות לפי הטמפלט ב-[hebrew-copy-style.md §11 טבלת task_type](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields). אסור לפסוח על זה גם ב-`alert` (שם זה הכי קריטי).

---

## 33. `alert_requires_acknowledgment_only_flag` (חדש 2026-05-13)

**כלל:** הצעת `task_type='alert'` חייבת `payload.acknowledgment_only === true`. חסר השדה, או `false`, או ערך מסוג אחר → fail.

**למה:** `alert` הוא ה-task_type היחיד שאין מאחוריו קריאת Meta או עדכון DB אוטומטי. ה-UI חייב לדעת לזה כדי לרנדר כפתור "סגור / ראיתי" במקום "אשר / דחה" — אחרת האופרטור חושב שהוא מאשר פעולה כשבעצם הוא רק מסמן שראה. אם יש פעולה אמיתית — השתמש ב-task_type הנכון (`set_kpi_target`, `publish_*`, `boost_post`, `redeploy_creative`, `new_creative` וכו'), לא ב-`alert`.

**מימוש:** ב-`_alert_requires_acknowledgment_only_flag` ב-[check_guardrails.py](../tools/check_guardrails.py). בדיקה: `prop.task_type != 'alert'` → skip; אחרת `payload.acknowledgment_only is True` → pass, אחרת fail.

**איך להחליף:** הוסף `"acknowledgment_only": true` ל-payload. אם הסיבה שכתבת alert היא שיש פעולה — שנה ל-task_type אמיתי, אל "תחבא" את הפעולה תחת alert.

---

## 34. `rationale_paragraph_1_clean` (חדש 2026-05-13 — תגובה לתסכול אופרטור)

**כלל:** הפיסקה הראשונה של רציונל (הטקסט עד הקו ריק הראשון, או 400 התווים הראשונים אם אין הפרדה) לא תכיל אף אחד מהאסימונים האסורים המפורטים ב-[hebrew-copy-style.md §11 טבלת ה-forbidden](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields).

**רשימה מבוצעת בקוד** (ב-`_rationale_paragraph_1_clean`):

- **ראשי תיבות של מטריקות:** `CPM`, `CTR`, `CPA`, `CPL`, `CPR`, `ROAS`, `CPC`, `CPI`.
- **שמות מנועי Meta:** `Andromeda`, `Advantage\+`, `Advantage Plus`, `Dynamic Creative`.
- **מצבי Meta:** `LEARNING`, `LEARNING_LIMITED`, `LEARNING LIMITED`, `ACTIVE`, `INACTIVE`, `PAUSED`, `LIMITED`, `CAMPAIGN_LIMITED`.
- **שמות פלייסמנט באנגלית** (סטוריז/ריילז/פיד בעברית מותרים): `Stories`, `Reels`, `Feed`, `Right Column`, `Audience Network`.
- **אסימוני CTA:** `MESSAGE_PAGE`, `LEARN_MORE`, `SIGN_UP`, `SHOP_NOW`, `GET_OFFER`, `CONTACT_US`, `SEND_MESSAGE`.
- **אסימוני סוכן פנימיים:** `Flow A/B/C/D`, `dispatcher`, `tracking gate`, `tracking health`, `task_type`, `business_knowledge`, `monthly_brief`, `propose_task`, `execute_task`, `verify_pixel_capi`, `agent_decisions`, `approvals`, סיומות `.py`/`.sql`/`.md`.
- **Meta engineering:** `AEM`, `CAPI`, `Aggregated Event Measurement`, `Conversions API`, `Events Manager`, `Business Manager`, `Graph API`, `Marketing API`, `Pixel ID`.

**למה:** הפיסקה הראשונה היא הקריאה הראשונה של האופרטור. אופרטור ללא רקע פרסום צריך להבין מה מוצע ולהחליט אשר/דחה מפיסקה אחת. אסימון באנגלית = עצירה לתרגם או לדלג. תיעוד 2026-05-13: כרטיס alert שראה האופרטור הכיל בפיסקה ראשונה את `Flow B`, `tracking gate`, `execute_task.py:225`, `verify_pixel_capi`, `AEM`, `Business Manager` — לא קריא.

**מימוש:** ב-`_rationale_paragraph_1_clean` ב-[check_guardrails.py](../tools/check_guardrails.py). מפצל לפיסקה ראשונה לפי `\n\n` או 400 תווים, מריץ rgx-מאוחד מול הרשימה למעלה. כל hit → fail עם רשימת האסימונים שזוהו. case-sensitive ברובם (מילים באנגלית).

**איך להחליף:** קרא את הפיסקה הראשונה שלך ולשאל "האם בעל-עסק שלא קרא marketing-101 יבין את זה?". אם לא — תרגם לעברית טבעית. ראשי תיבות מותרים בפיסקה 2+ עם הסבר בסוגריים בפעם הראשונה.

---

## 37. `respect_prior_rejections` (חדש 2026-05-13 PM — לולאת פידבק)

**כלל:** הצעה חדשה שמשתייכת ל-`(task_type, target_kind, target_id)` שכבר נדחה בעבר עם סיבה משמעותית (לא bulk-reset/anti-flood/system) ב-60 הימים האחרונים, חייבת לעמוד באחד משני התנאים:

1. **לציין במפורש את הדחייה הקודמת ברציונל** ולתאר מה השתנה — דוגמה: "ראיתי שדחית הצעה דומה ב-13.5 כי 'אין הסבר איזה שירות אני נותן'. הפעם הקופי ממוקד לשירות `service_tag=influencer_match` שמופיע ב-business_knowledge.products".
2. **אם אי-אפשר להבדיל מהותית** מההצעה שנדחתה — לדלג ולכתוב `log_decision rejection rationale="respect_prior_rejection_no_meaningful_change"`.

**למה:** עד 2026-05-13 הסוכן לא קרא דחיות עבר — הוא חזר על אותה הצעה כל ריצה. אופרטור Roi התלונן: "הוא לא לומד שאמרתי לא". זה החוק שמרים את הסוכן מ-junior שחוזר על עצמו ל-consultant שזוכר.

**מימוש:** ב-`_respect_prior_rejections` ב-[check_guardrails.py](../tools/check_guardrails.py). ה-context fetcher (`_fetch_context`) מריץ SQL פר proposal: כמה דחיות לא-bulk קיימות ב-60 יום אחורה לאותו `(task_type, target_kind, target_id)`. הכלל קורא את הספירה + בודק שהרציונל הנוכחי מכיל לפחות אחד מהאינדיקטורים הבאים: `"דחית"`, `"דחיתי"`, `"דחיית"`, `"דחיה קודמת"`, `"הפעם שונה"`, `"השתנה"`, או הזכרה של תאריך מ-60 הימים האחרונים.

**איך להחליף:** הוסף שורה ברציונל שמצטטת את הדחייה ומסבירה מה השתנה. אם אי-אפשר — לדלג.

**הכלי שמזין את ה-context:** [tools/load_feedback_history.py](../tools/load_feedback_history.py) — חייב לרוץ ב-Flow A Step 1.6 לפני שמציעים. אם הוא לא רץ, הגארדריל יחזיר `skipped:true`.

---

## 38. `new_campaign_payload_completeness` (חדש 2026-05-13 PM — תגובה לתסכול אופרטור)

**כלל:** הצעת `task_type='new_campaign'` חייבת payload שמכיל את כל השדות הנדרשים ליצירת קמפיין שלם ב-Meta (campaign + ad set + ad). חסרון של אחד מהם → פסילה.

**שדות חובה (לפי 3 הרמות):**

ברמת הקמפיין:
- `campaign_name` (str, שם תיאורי בעברית)
- `objective` (אחד מ-OUTCOME_LEADS / OUTCOME_TRAFFIC / OUTCOME_ENGAGEMENT / OUTCOME_SALES / OUTCOME_AWARENESS / OUTCOME_APP_PROMOTION)
- `special_ad_categories` (list — Meta דורשת הכרזה מפורשת גם אם ריקה. ברירת מחדל ל-Aiweon: `[]`)
- `daily_budget_ils` OR `lifetime_budget_ils` (אחד מהשניים — לא שניהם)

ברמת ה-ad set:
- `adset_name` (str)
- `optimization_goal` (תואם ל-objective; ראה decision-tree §T6)
- `billing_event` (כמעט תמיד IMPRESSIONS)
- `targeting.geo_locations` (חובה לפי Meta — לפחות `countries:["IL"]`)
- `targeting.age_min` (חובה; מינימום 18 ב-2026)
- עבור OUTCOME_LEADS: `promoted_object.page_id`
- עבור OUTCOME_SALES / OFFSITE_CONVERSIONS: `promoted_object.pixel_id` + `promoted_object.custom_event_type`

ברמת המודעה:
- `ad_name` (str)
- `creative_kind` ("image" או "video")
- `creative_source` — אחד מ-{`image_path`, `creative_gallery_id`, `video_path`, `existing_post_id`}
- `copy.headline` (≤ 40 תווים)
- `copy.primary_text` (80-150 תווים)
- `copy.cta` (Meta enum)
- `copy.link_url` (URL יעד)
- `identity.page_id`

**שדות מומלצים (בלי לפסול):**
- `bid_strategy` (ברירת מחדל LOWEST_COST_WITHOUT_CAP אבל עדיף לציין במפורש)
- `spend_cap_ils` (משכבה — מומלץ monthly_budget × 0.5)
- `targeting.targeting_automation.advantage_audience` (ברירת מחדל 1 ב-2026)
- `targeting.publisher_platforms` + positions (אחרת Meta בוחר אוטומטית)
- `service_tag` (חובה לעסקים עם מספר שירותים — Aiweon)
- `marketing_angle` (לתיעוד פנימי + מעקב §T_PE)
- `hypothesis` (משפט עברית של למה הקמפיין יעבוד)

**למה:** עד 2026-05-13 ה-payload של new_campaign היה פתוח — הסוכן יכל להציע "{campaign_name: 'X', daily_budget_usd: 50, ...}" עם targeting ריק או חסר. ה-MetaClient היה נכשל בזמן ביצוע עם שגיאת API לא ברורה, האופרטור היה צריך לאשר בלי לדעת מה חסר. עכשיו, אם חסר משהו, ה-`check_guardrails` פוסל ב-Flow A Step 4 והמפעיל רואה רשימה מסודרת של מה חסר ב-rationale.

**מימוש:** ב-`_new_campaign_payload_completeness` ב-[check_guardrails.py](../tools/check_guardrails.py). בודק קיום של כל השדות הנדרשים מעל, ומחזיר רשימה ספציפית של מה חסר.

**איך להחליף:** השלם את ה-payload לפני שאתה מנסה להציע. אם חסר מידע על העסק (page_id, pixel_id) — קרא ל-`load_business_knowledge` ותשלוף משם. אם חסר קופי — תייצר אותו לפי `hebrew-copy-style.md §§2-9` (קופי לקוח, לא רציונל אופרטור).

---

## 39. `respect_active_plans` (חדש 2026-05-13 PM — \"junior → consultant\" #2)

**כלל:** אם קיימת תוכנית-פעולה חיה (forward step מתוך תוכנית קודמת) על אותו `target_id` ב-21 הימים האחרונים, ההצעה הנוכחית חייבת לעמוד באחד מהשניים:

1. **לקדם את התוכנית הקיימת** — הרציונל פותח במשפט שמצטט את הצעד שלך הקודם, מציין שהתנאי שלו התקיים (או לא התקיים), ומסביר איך ההצעה הנוכחית היא הצעד הבא בתוכנית. דוגמה: _"בריצה מ-7.5 התחייבתי: 'אם הניצול עלה ל-80% — להציע sale_up'. הניצול עלה ל-87%. ההצעה הזאת היא הצעד הבא בתוכנית."_
2. **לדלג מפורש** — אם המצב שונה מספיק שהתוכנית הישנה לא רלוונטית, לא להציע פעולה חדשה ולכתוב `log_decision skip rationale="active_plan_superseded — תוכנית X מ-7.5 כבר לא רלוונטית כי [הסיבה]"`.

**אסור:** לתקוף קמפיין שיש לו תוכנית חיה עם הצעה חדשה שאין לה קשר לתוכנית, **בלי להזכיר אותה כלל**. זה הטעות הקלאסית של junior — שכח מה הוא אמר אתמול ומציע משהו אחר היום בלי לסגור את הלולאה.

**למה:** הוספתי את `load_active_plans` ב-Step 1.6 שמחזיר את כל הצעדים הפתוחים — אבל בלי גארדריל הסוכן יכול לקרוא ולהתעלם. עם §39, ה-prompt-only memory הופך ל-binding: אופרטור Roi רואה דרך ה-rationale שהסוכן ממשיך מאיפה שהפסיק, לא מתאפס כל ריצה.

**מימוש:** ב-`_respect_active_plans` ב-[check_guardrails.py](../tools/check_guardrails.py). ה-context fetcher (`_fetch_context`) מריץ SQL פר proposal: יש תוכנית חיה (פלט של `load_active_plans` שמורה ב-`agent_decisions`)? אם כן — בודק שהרציונל הנוכחי מכיל לפחות אחד מהאינדיקטורים: `"בריצה הקודמת"`, `"התחייבתי"`, `"תוכנית מ-"`, `"בתוכנית"`, `"הצעד הבא"`, `"כפי שאמרתי"`, `"כפי שתכננתי"`. case-sensitive Hebrew matching.

**Skip cases:**
- `task_type='alert'` עם `acknowledgment_only=true` → exempt (אקנולג'מנט אינו פעולה).
- אין תוכנית חיה לאותו `target_id` → pass.
- אין `target_id` בכלל (account-level) → skip עם הערה.

**איך להחליף:** קרא את הפלט של `load_active_plans` בתחילת הריצה. לכל קמפיין שיש לו תוכנית חיה — או הצע את הצעד הבא ותציין את התוכנית, או דלג מפורש עם `log_decision skip`. אסור להציע משהו אחר באותו קמפיין בלי הזכרה.

---

## 41. `copy_must_match_brief_voice` (חדש 2026-05-13 PM — \"קופי לקוח\" #1)

**כלל:** קופי לקוח (headline / primary_text / description ב-payload של `new_campaign`, `new_creative`, `redeploy_creative`, `boost_post` כשהאופרטור משנה copy) לא יכיל שום אסימון מהרשימה האסורה של hebrew-copy-style §3 (pan-Israeli + Aiweon-specific). כל הופעה → פסילה.

**ההבחנה מ-§34:** §34 חל על **רציונל אופרטור** (Roi קורא). §40 חל על **קופי לקוח** (הקהל של Aiweon קורא ב-Facebook/Instagram). שני קהלים שונים, שני קודים אסורים שונים אבל חופפים.

**רשימות שהכלל בודק (case-sensitive ברובן):**

- pan-Israeli ספאם: `לחץ כאן`, `מוגבל בזמן!`, `הזדמנות של פעם בחיים`, `מהפכה`, `פריצת דרך`, `בלעדי`, `!!!`, `???`, `חינם!!`, `רק היום`.
- Aiweon-specific (§3 hard-ban): superlatives `המוביל`, `מספר 1`, `הטוב ביותר`, `פורץ דרך`, `מהפכני`; specific-ROI claims `X3 לידים`, `חיסכון של %`, `פי N מכירות`; marketing-ese `פתרון 360`, `end-to-end`, `holistic`, `ecosystem`, `synergy`, `workflow`, `funnel`, `engagement` (transliterated).
- **AI overuse:** המילה "AI" או "בינה מלאכותית" יכולה להופיע **פעם אחת** בכל קופי. שתיים פעמיים → פסילה.

**למה:** עד 2026-05-13 PM הקופי שהסוכן הציע נכתב לפי כללי §§2-9 שהיו prompt-only. ב-`compose_copy_brief` יש עכשיו רשימה דטרמיניסטית — אבל בלי גארדריל שבודק את הפלט, הסוכן יכול \"לשכוח\" ולהציע קופי שהאופרטור צריך לדחות באופן ידני. §40 הופך את ה-style guide ל-binding.

**מימוש:** ב-`_copy_must_match_brief_voice` ב-[check_guardrails.py](../tools/check_guardrails.py). מאתר את שדות הקופי בכל payload לפי task_type (`payload.copy.headline`, `payload.copy.primary_text`, `payload.copy.description`; ל-`new_creative`: `payload.headline`, `payload.primary_text`). מריץ regex על כל אחד.

**Skip cases:**
- `task_type` שאינו יוצר/משנה קופי: `alert`, `scale_up`, `scale_down`, `expand_audience`, `set_kpi_target`, `pause_*`, `resume_*`, וכו'.
- `boost_post` בלי copy override → skip (יורש את ה-copy של הפוסט האורגני שכבר אושר בעבר).

**איך להחליף:** אם קיבלת פסילה, קרא לאיזה אסימון נכשלת — מופיע ב-`forbidden_tokens_in_copy`. תרגם לפי `compose_copy_brief` opening pattern או §3 substitution table. אסור לפתור את זה ע\"י דחיפת אסימון לרציונל במקום בקופי — הקהל קורא רק את הקופי.

---

## 31. חוקים דחויים ל-v2

לא מיושמים ב-MVP — אזכור למיקום ארכיטקטוני:

- `remarketing_min_budget_ils` — רימרקטינג ≥ ₪50/יום גם בעונה חלשה
- `external_source_allowlist` — רק אתרים אמינים (רק לכלים שיצרכו web research)

---

## טמפלט rejection Hebrew

```
סיבה: <rule_name>
הקמפיין/קריאייטיב: <id>
הממצא: <מה נמצא שמפר את הכלל>
למה הכלל חל: <1-2 משפטים>
מה הייתי ממליץ במקום: <חלופה אם קיימת, או "אין פעולה מותרת כרגע">
```
