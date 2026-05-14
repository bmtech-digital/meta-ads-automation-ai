# Creative Guide — מנוע הקריאייטיב

> **Source:** [campaigner-spec §7](../../docs/plans/campaigner-spec.md#7-מנוע-קריאייטיב) + [CAMPAIGN_BUILDING_RECOMMENDATIONS.md](../../docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md).
> **מודל:** **Andromeda-era Firehose** — 10-50+ קריאייטיבים מגוונים פעילים, continuous additions, אל תחתוך ידנית.
> **Hebrew copy:** לקופי עצמו — קרא [hebrew-copy-style.md](hebrew-copy-style.md). הקובץ הזה עוסק בעקרונות המבניים.

---

## 1. Firehose vs. תפיסה ישנה

| Pre-Andromeda (לא משתמשים)                   | Andromeda 2026 (current)                            |
| -------------------------------------------- | --------------------------------------------------- |
| 9-15 קריאייטיבים, אחרי 5-7 ימים השאר top 3-5 | 10-12 ראשוני + 3-5/שבוע, אל תחתוך ידנית             |
| Manual pruning של underperformers            | תן ל-Meta להרעיב חלשים. חתוך רק hook < 25% אחרי 48h |
| Single winning creative — מקסם אותו          | 10-50+ diversity — שחיקה נדחית                      |
| Horizontal testing (campaign per angle)      | One campaign, diversity בתוך ad set                 |

**למה:** Meta ב-Andromeda מחלקת תקציב לא-אחיד במכוון. קריאייטיב שמקבל 5% מהתקציב עם CTR גבוה = Meta בוחנת אותו. **לא צריך "לאלץ"** יותר תקציב.

---

## 2. Initial Batch — פתיחת קמפיין חדש

**10-12 קריאייטיבים בפתיחה:**

```
3-4 Hooks × 3 aspect ratios = ~12
```

### 3-4 Hooks שונים (angles לפי §7.5 בספק)

| זווית                    | מתי                               | דוגמה                               |
| ------------------------ | --------------------------------- | ----------------------------------- |
| **רגש / חוויה**          | מוצרים רגשיים, הורים, אירועי חיים | "החיוך שלהם שווה הכל"               |
| **תועלת ישירה**          | שירותים פרקטיים                   | "קיר צילום שישדרג כל בת מצווה"      |
| **דחיפות / מבצע**        | עונות, סוף-מלאי                   | "נשארו מקומות אחרונים למאי!"        |
| **רשימת יתרונות**        | B2B, טכני                         | "🌟 עיצוב אישי 🌟 אביזרים 🌟 מזכרת" |
| **חברתי (Social Proof)** | עסקים חדשים                       | "אלפי הורים כבר בחרו בנו"           |
| **השוואה**               | שווקים תחרותיים                   | "למה כולם עוברים אלינו?"            |

הסוכן בוחר **3-4 זוויות שונות** לקמפיין (לא כולן) → Meta Dynamic Creative בוחר את הזוכה.

### 3 Aspect Ratios

לכל hook — תמיד 3 פורמטים:

| Ratio | Dimensions | Placement מועדף                 |
| ----- | ---------- | ------------------------------- |
| 1:1   | 1080×1080  | Feed universal                  |
| 4:5   | 1080×1350  | Feed (מומלץ — תופס יותר screen) |
| 9:16  | 1080×1920  | Stories / Reels                 |

**אל תקצה placement ידני** — תן את כל ה-ratios, Meta בוחרת לבד (Andromeda).

---

## 3. Continuous Additions — תוספת שבועית

**3-5 קריאייטיבים חדשים לשבוע**, בצורת proposals `task_type=new_creative` ב-`weekly_creative_firehose.sh`:

- **הוסף** — אל תחליף. האקטיבים הקיימים ממשיכים עד שטריגר Kill (Gate 1) פעל.
- **מגוון** — כל תוספת צריכה להיות שונה מהקיים (hook חדש, angle חדש, פורמט שלא בשימוש).
- **כלל זהב:** **אל תחתוך ידנית** — guardrail `no_manual_creative_pruning_before_48h` יפסול. חיתוך רק כש-Gate 1 kill trigger פעל: hook < 25% OR CTR < 1% עם ≥ 1,000 חשיפות.

### 3.1. Gallery-first sourcing (Block 8, 2026-05-13)

**עקרון:** לפני שמייצרים אסט חדש, בדוק מה כבר יש בגלריה ולא נוצל. Imagen עולה כסף; הגדול יותר — כל אסט שלא הוטמע הוא slot מבוזבז שכבר שילמת עליו.

**הזרימה (חובה לפני כל `new_creative` ב-§T6.1 ו-§T_PE):**

```bash
python -m campaigner.tools.list_active_creatives \
  --business-id $BUSINESS_ID \
  --unused-in-campaigns \
  --matches-channel <feed|stories|reels>
# → viable_unused_count: N
```

**הסף (לפי שלב הסוכן):**

| שלב | יעד וריאנטים | N ≥ סף → redeploy | אמצע → mixed | אחרת → new_creative |
| --- | --- | --- | --- | --- |
| §T6.1 (cold start, קמפיין ראשון) | 10-12 | N ≥ 10 → רק redeploy_creative | 5 ≤ N ≤ 9 → mix | N < 5 → רק new |
| §T_PE (pool הריק, שבועי) | 3-5 | N ≥ 3 → רק redeploy_creative | N = 1-2 → mix | N = 0 → רק new |

**ה-task_type הנכון:**

- **`redeploy_creative`** — אסט מהגלריה (תמונה/וידאו) שלא נוצל עוד. payload: `{creative_gallery_id, adset_id, link_url}`. אם הגלריה גם שמרה `meta_creative_id` קודם, execute_task עושה short-circuit: יוצר Ad חדש על אותו creative בלי upload חוזר.
- **`new_creative`** — ייצור חדש (Imagen → תמונה → קריאייטיב חדש ב-Meta). payload חייב לכלול `channel` כדי שגארדריל §28 יוכל לקרוא את ה-count לערוץ.

**override:** אם הסוכן חייב לייצר חדש למרות שיש גלריה (למשל הזווית של הקמפיין החדש שונה מהותית) — מעביר `source_preference: 'generate_new'` ב-payload. השתמש בזה רק עם הצדקה ברורה ב-rationale.

---

## 4. Placement-Specific Copy

מה שעובד בפיד **לא עובד** בסטוריז. לכל placement, קופי שונה:

| מיקום               | מאפייני קופי                          | דוגמה                                    |
| ------------------- | ------------------------------------- | ---------------------------------------- |
| **Feed**            | עד 3 שורות לפני "קרא עוד", כותרת חזקה | "זוכרים את בת המצווה שלכם? הגיע תורם..." |
| **Stories / Reels** | קצר, ישיר, Overlay Text גדול          | "החלק למעלה להזמנה! 👆"                  |
| **Right Column**    | כותרת בלבד                            | "קיר צילום לבת מצווה"                    |

**הסוכן מייצר וריאנטים פר-מיקום** — לא גרסה אחת שמותחים על כל הפורמטים.

---

## 5. Copy Generation — תהליך

**לכל קריאייטיב, Claude מייצר:**

```json
{
  "headline": "<= 40 chars בעברית>",
  "primary_text": "<עד 3 שורות לפיד, 1 שורה לסטוריז>",
  "description": "<אופציונלי — 25 chars לפני CTA>",
  "cta": "LEARN_MORE | SHOP_NOW | SIGN_UP | CONTACT_US | ...",
  "angle": "<emotion | urgency | benefit | social_proof | comparison>",
  "placement": "feed | stories | right_column"
}
```

**Cross-check לפני כל וריאנט:**

1. האם הוא עומד ב-[hebrew-copy-style.md](hebrew-copy-style.md) §3 (forbidden) ו-§9 (hard constraints)?
2. האם ה-angle כתוב ב-`outputs.angle`? (נדרש לאנליטיקה)
3. האם הקופי מתאים ל-placement שנבחר?

---

## 6. Image Generation — תהליך

דרך `CreativeClient.generate_image(prompt, aspect_ratio, save_path)` ([campaigner/lib/creative.py](../lib/creative.py)) — לא דרך הכלי הישן ישירות.

**Prompt structure:**

```
<subject description>. <mood/emotion>. <setting>. <style>.
Professional, high quality, 4K, commercial photography.
```

**דוגמה:**

```
Happy Israeli family celebrating Bat Mitzvah at a colorful photo wall decorated with balloons and flowers. Warm, joyful mood. Modern event hall, soft evening lighting. Candid documentary style. Professional, high quality, 4K, commercial photography.
```

**Aspect ratio חובה:** 1:1 / 4:5 / 9:16 — לא "landscape" / "portrait".
**Model tier:** `fast` (default, $0.02/img) עד שיש data שה-quality של `standard` מוסיף ROI.

**Post-generation:** ולידציה ש-dimensions ≥ 1080 (guardrail `no_low_res_creative`).

---

## 7. Variation Strategy — 10 וריאנטים מ-prompt בסיסי

שימוש ב-`CreativeClient.generate_variations(base_prompt, variations, aspect_ratio)`:

**Base prompt:**

```
Happy Israeli family celebrating Bat Mitzvah at a colorful photo wall decorated with balloons and flowers.
```

**Variations list** (6-10 שונות):

```python
variations = [
    "Close-up of smiling teenage girl",
    "Wide shot showing the whole decorated wall",
    "Parents hugging the celebrating teen",
    "Friends taking selfie in front of the wall",
    "Detail shot of balloon decorations",
    "Cake-cutting moment with family around",
]
```

תוצאה: 6 קריאייטיבים שונים באותו angle — מגוון visual בלי שחיקת הקונספט.

---

## 8. Creative Fatigue — איך לזהות

**לא לפי Frequency.** Frequency > 3 לבדו לא signal — זה מה שהפקענו ב-§14.15.

**הסימן האמיתי — Meta Creative Fatigue flag:** CPR (Cost Per Result) של קריאייטיב ספציפי ≥ 2× מה-baseline ההיסטורי שלו. מופיע ב-Ads Manager וב-API (field: `meta_creative_fatigue` בעתיד, כרגע דרך השוואת CPR).

**כשסימון פעיל:**

1. `task_type='new_creative'` × 3-5 — הוסף וריאנטים חדשים עם angle שונה
2. **אל תציע** `pause_campaign` — guardrail `prefer_add_creative_over_pause` יפסול.

---

## 9. Firehose MVP scope — מה כן ומה לא

### ✅ ב-MVP

- Copy generation בעברית (Claude, 10-20 וריאנטים לפי batch)
- כותרות / CTA (Claude)
- יצירת תמונות (Vertex Imagen דרך `CreativeClient`)
- שליפה מגלריה קיימת (`creative_gallery` table) — Block 8 2026-05-13 הפך את זה ל-**default**: §T6.1 ו-§T_PE עושים gallery-first, ייצור חדש רק כשאין מספיק אסטים מתאימים. ראה §3.1 וגארדריל §28 `prefer_gallery_over_generation`.
- `redeploy_creative` task_type (Block 8) — לפרוס אסט קיים מהגלריה לקמפיין חדש, עם short-circuit כשיש כבר `meta_creative_id`.
- Continuous additions (3-5/שבוע) — gallery-first; new_creative רק כשהגלריה לא מספיקה.

### ❌ ב-MVP, ✅ ב-v2

- Image expansion (outpainting)
- Background swap
- Text overlay אוטומטי על תמונה
- יצירת וידאו AI
- Voice-over AI
- Regeneration loop (Claude מתקן על בסיס feedback)

---

## 10. Flow אישור קריאייטיב

```
Agent → propose_task.py --task-type new_creative
  → approvals row (status='pending')
  → user approves in web platform
  → Flow B (execute) picks up approved rows
  → execute_task.py uploads to Meta דרך MetaClient.upload_image + create_ad_creative + create_ad
  → approval.status='executed' + agent_decisions row 'execution'
```

**אם נדחה:** rejection_reason נשמר. ב-MVP אין regeneration אוטומטי — הקריאייטיב נגמר.

---

## 11. Rationale להצעת `new_creative` — שפת בעל-עסק

> **חוק מחייב:** ה־`rationale` של הצעת `new_creative` מציית ל־[hebrew-copy-style.md §11](hebrew-copy-style.md#11-operator-facing-rationale-rationale-summary-fields) **באותה רמת חומרה** כמו אבחון ביצועים. הקורא הוא בעל עסק שמאשר כסף אמיתי, לא איש שיווק.

### מה אסור בפסקה הראשונה

- **שמות פורמטים טכניים:** `9:16`, `4:5`, `1:1` → "וריאנט אנכי למובייל", "וריאנט מרובע", "פורמט פיד נמתח".
- **שמות placement באנגלית:** `Stories`, `Reels`, `Feed`, `Right Column` → "סטוריז", "ריילז", "פיד", "טור צד".
- **טוקני CTA של Meta:** `MESSAGE_PAGE`, `LEARN_MORE`, `SIGN_UP` → "שלח הודעה", "מידע נוסף", "להירשם".
- **שמות מנועי ML של Meta:** `Andromeda`, `Advantage+` → "מערכת הפרסום של Meta", "הרחבת קהל אוטומטית".
- **הפניות פנימיות לקבצים שלנו:** "לפי creative-guide §2", "לפי decision-tree §17" → תרגם את הכלל לעברית טבעית במקום ההפניה.
- **מדדים באנגלית:** `CTR`, `CPM`, `hook rate`, `frequency` → "אחוז הקלקות", "עלות לאלף חשיפות", "קצב משיכת תשומת לב", "תדירות חשיפה". (אסור בפסקה 1; מותר עם gloss בפסקה 2+.)

### מה כן בפסקה הראשונה

- **משפט TL;DR אחד, ≤ 20 מילים, נשמע טבעי בפה.** עונה: _מה אני מציע? למה זה יעזור?_
- כתוב כמו ש**מסבירים לחבר** ליד הקפה, לא כמו שכותבים סיכום לקובץ Slack של צוות שיווק.

### דוגמה — לפני / אחרי

**❌ Before (המצב היום, הצעה שנדחתה ע"י הלקוח):**

> מציעים וריאנט קצר ל-Stories שמראה מה תוצאת השיחה הראשונה — כך גולש שמדלג על פיד יכול להבין בשנייה מה Aiweon עושה בלי לקרוא טקסט ארוך. הקמפיין הזה משדר בפיד בלבד (אין וריאנט 9:16). ב-30 ימים, 5,100 חשיפות עם CTR 2.94% — ביצועים מעולים שראוי להרחיב ל-placements נוספים. לפי creative-guide §2 כל קמפיין צריך 3 פורמטים (1:1, 4:5, 9:16). וריאנט 9:16 פותח Reels ו-Stories ל-Andromeda (מנוע ה-ML של Meta מ-דצמבר 2024) — שיכולה להפיץ שם בעלות נמוכה יותר. כותרת 4 מילים, גוף קצר, ה-CTA MESSAGE_PAGE תואם.

הבעיה: בעל עסק שלא יודע מה זה "9:16", "Stories", "CTR", "placements", "Andromeda", "MESSAGE_PAGE" לא יכול להחליט עד שהוא מתרגם בראש.

**✅ After (TL;DR בעברית טבעית):**

> נוסיף וריאנט אנכי שמתאים לסטוריז וריילז — כדי שהמודעה תופיע במקומות שבהם רוב הגולשים נמצאים היום, לא רק בפיד.
>
> כרגע המודעה רצה בפיד בלבד. ב-30 ימים היא קיבלה 5,100 חשיפות וכ-3 מתוך 100 גולשים שראו אותה הקליקו — ביצוע טוב שמצדיק להרחיב. הוספת וריאנט אנכי תפתח לפניה גם את הסטוריז והריילז של פייסבוק ואינסטגרם, מקומות שבהם מערכת הפרסום של Meta יכולה להפיץ מודעות במחיר נמוך יותר. הכותרת קצרה (4 מילים), הטקסט הראשי תמציתי, וכפתור הפעולה ("שלח הודעה") תואם לאופי המוצר.

### בדיקה עצמית לפני שמירת ה-`rationale`

לפני שכתבת `propose_task.py --rationale "..."`, עבור על הפסקה הראשונה ושאל: *האם בעל מסעדה / בעל סטודיו / יזם סולו, בלי שום רקע פרסומי, יבין מה אני מציע מהמשפט הזה לבד?* אם לא — נסח מחדש לפני שהפרופוזל נכנס לתור.
