# EVALUATION.md — איך אנחנו מעריכים קמפיינים

> **מה זה המסמך הזה?**
> לא אפיון מלא (ר' `docs/plans/campaigner-spec.md` §6, §17 לפרטי מימוש).
> לא spec — **שפה משותפת** של איך אנחנו חושבים על "טוב" ו"רע" בקמפיין.
> קריאה של 10 דקות שאחריה כל מפתח / prompt-writer / reviewer (אנושי או AI) מבין את הפילוסופיה.
>
> **אם אתה עורך `prompts/*.md`, `guardrails.py`, או `tools/check_*.py`** — קרא את זה קודם.

---

## 1. השאלה המרכזית

המנוע שלנו עונה שוב ושוב על שאלה אחת:

> **"האם הישות הזאת (קריאייטיב / ad set / קמפיין / חשבון) מספיק טובה — ואם לא, מה עושים?"**

כל החלטה — scale, pause, refresh, kill, ignore — נובעת משאלה זו. אם המודל שלנו לשאלה הזו שגוי, כל פעולת הסוכן תהיה שגויה. לכן המסמך הזה הוא נכס הליבה.

---

## 2. העיקרון המרכזי: **שני שערים** (Two Gates)

**במקום היררכיית מדדים אחת — יש שני שלבים נפרדים.** זה השינוי הגדול מהאפיון הראשוני.

```
Creative uploaded
      │
      ▼
┌──────────────────────────────────────────┐
│   Gate 1 — Leading Signals               │
│   חלון: 48h – 7d                          │
│   מטרה: האם הקריאייטיב זכאי להמשיך?     │
│   מדדים: Hook Rate, CTR, Thumb-Stop     │
│   החלטה: KILL / KEEP / SCALE iterate    │
└──────────────────────────────────────────┘
      │ passed
      ▼
┌──────────────────────────────────────────┐
│   Gate 2 — Lagging Signals               │
│   חלון: post-learning (~50 conv / 7d)    │
│   מטרה: האם הכסף חוזר?                   │
│   מדדים: CPA, ROAS, Meta Fatigue Flag   │
│   החלטה: SCALE / STEADY / PAUSE          │
└──────────────────────────────────────────┘
```

**למה שני שערים ולא היררכיה אחת?**
כי CPA הוא **לגגינג** — הוא מתייצב רק אחרי 50 המרות / 7 ימים. אם אנחנו מחכים לו כדי להרוג קריאייטיב גרוע, שרפנו 5 ימי תקציב על משהו שהיה ברור לנו ב-48h שהוא לא יעבוד. Gate 1 הורג מוקדם; Gate 2 מאשר הצלחה.

**זה מתנגד לאינטואיציה הישנה** של "CPA זה המדד החשוב". CPA כן החשוב — אבל רק **אחרי** שהקריאייטיב עבר את Gate 1.

---

## 3. עיקרון השני: **יחסי, לא אבסולוטי**

**"טוב" לא מדד מוחלט.** אין מספר שמתאר "קמפיין טוב". יש רק:

- **טוב ביחס ל-baseline היסטורי של החשבון** (חלונות 7/14/30 ימים)
- **טוב ביחס לקמפיינים אחרים באותו חשבון**
- **רק כ-fallback: טוב ביחס לחציון ענפי 2026**

**למה זה קריטי:** CPL ממוצע של Aiweon הוא ₪85. בעסק שני — ₪250. שניהם יכולים להיות "טובים" עבור העסק שלהם. לא משנה שהחציון הגלובלי הוא $27.66. ה-baseline הפנימי הוא האמת.

**השלכה מעשית:**

```
❌ "CPL ₪110 זה רע כי החציון הגלובלי נמוך יותר"
✅ "CPL ₪110 זה 29% מעל ה-baseline של 30 הימים האחרונים של החשבון — סמן כבעייתי"
```

### ישראל 🇮🇱 — אזהרת קריטיות

**אל תכפיל benchmarks גלובליים ב-factor עבור ישראל.** המספרים האלה לא צייתנים:

| מדד | ישראל 2025 | גלובל 2025 | יחס               |
| --- | ---------- | ---------- | ----------------- |
| CPM | $8.38      | $20.15     | ~40% נמוך         |
| CPL | $104.72    | $41.53     | **2.5× יותר יקר** |

נוסף לכך: ישראל סובלת מ-volatility קיצוני באירועים ביטחוניים (CPL קופץ ל-$385 בחודשי מלחמה). **Operation Modes דחוי ל-v2** — אבל הסוכן כבר מודע לקיומה של תופעה זו.

**הכלל:** לא משתמשים במספרים גלובליים לישראל — רק ב-baseline של החשבון עצמו.

---

## 4. מדדים — מי אומר מה

### Gate 1 — Leading signals (החלטות מהירות)

| מדד                 | מה הוא אומר                | Kill trigger          | Good  |
| ------------------- | -------------------------- | --------------------- | ----- |
| **Hook Rate (3s)**  | האם הקריאייטיב עוצר גלילה? | < 25% אחרי 48h        | > 35% |
| **CTR (מוקדם)**     | האם יש עניין / התאמה לקהל? | < 1% עם ≥1,000 חשיפות | > 2%  |
| **Thumb-Stop Rate** | גרסה מדויקת יותר של Hook   | < 20% אחרי 48h        | > 30% |

**עיקרון:** אם קריאייטיב נכשל ב-Gate 1, **לא מסתכלים על CPA** — לא אמין עדיין. kill ומעבר הלאה.

### Gate 2 — Lagging signals (החלטות אסטרטגיות)

| מדד                            | מה הוא אומר          | Kill / Action                        | Good               |
| ------------------------------ | -------------------- | ------------------------------------ | ------------------ |
| **CPA**                        | כמה עולה המרה        | > 1.3× יעד ל-5+ ימים → refresh/pause | ≤ יעד              |
| **ROAS**                       | כמה מחזירים על שקל   | < Break-even → pause                 | ≥ רווחיות מינימלית |
| **Meta Creative Fatigue flag** | Meta עצמה מזהה שחיקה | CPR ≥ 2× היסטורי → הוסף קריאייטיבים  | לא מסומן           |
| **Frequency**                  | כמה פעמים קהל רואה   | **לא trigger עצמאי**                 | מדד monitoring     |

**דגשי חובה:**

- ❌ **Frequency > 3 כבר אינו קריטריון kill.** זה היה נכון ב-2021; לא נכון ב-2026.
- ✅ **Meta Creative Fatigue flag החליף אותו** — CPR (cost per result) שעולה פי 2 מה-baseline. זה ה-signal האמיתי של שחיקה.

---

## 5. רמת ההערכה — איפה זה קורה?

**שינוי קריטי מהפרה-Andromeda:**

```
לפני (Pre-2024):
  evaluation level = ad set
  logic: "ad set אחד = ad אחד = אחראי לביצועים"

אחרי (Post-Andromeda 2025-2026):
  evaluation level = creative + campaign aggregate
  logic: "Meta מחלקת תקציב לא-אחיד בין קריאייטיבים בתוך ad set —
         לא אד סט רע, קריאייטיב שלא עובד בתוך אד סט מצליח"
```

**מעשית זה אומר:**

- **Gate 1** רץ **פר-קריאייטיב** — כל קריאייטיב נבחן בנפרד
- **Gate 2** רץ **פר-קמפיין** (aggregate) — CPA של הקמפיין ככלל, לא פר-ad set
- ad set כמעט אף פעם לא הישות לה-action — Advantage+ מחליפה את רוב ה-targeting

---

## 6. זמן — מתי אנחנו פועלים?

**המחקר של 2026 מדבר volume, לא time.** החלפנו את הסף הישן של "72 שעות" בסף של נפח.

### Data Sufficiency Checklist

```
לפני כל החלטה ברמת קריאייטיב (Gate 1):
  ✅ ≥ 1,000 חשיפות על הקריאייטיב
  ✅ ≥ 50 clicks על הקריאייטיב
  ✅ לפחות 48h מהעלאה/שינוי אחרון

לפני כל החלטה ברמת קמפיין (Gate 2):
  ✅ 50+ המרות ב-7 ימים (יציאה מ-Learning Phase)
  ✅ CPA יציב 5-7 ימים

לפני A/B winner declaration:
  ✅ 95% statistical significance

חריג יחיד — emergency kill:
  CPA > 3× יעד OR ≥ 1× תקציב יומי + 0 המרות ל-3+ ימים
  → "שריפת כסף" → 🚨 urgency='urgent'
```

**מה זה פותר:** בעבר המנוע היה "מחכה 72 שעות" גם על קמפיין שקיבל 12,000 חשיפות ביום אחד. עכשיו הוא פועל לפי דאטה אמיתית.

---

## 7. תרחישי החלטה בשפה טבעית

**אלה הן הדרכים שהמנוע חושב — לא algoritmim, זה reasoning.**

### תרחיש A: קריאייטיב חדש כישלון

> "Video_03 עלה לפני 50 שעות. יש 1,200 חשיפות, 8 clicks. Hook rate 19%, CTR 0.67%."
>
> **Gate 1 החלטה:**
> Hook rate < 25% threshold + CTR < 1%. שני leading signals אומרים שזה לא עובד. לא משנה מה CPA יראה בעוד 5 ימים — בזבוז של 5 ימי תקציב.
>
> **פעולה:** KILL (השהיה). לוג `decision_type='proposal'` עם rationale: "Gate 1 kill: hook+CTR below threshold, high confidence at 48h."

### תרחיש B: קמפיין מעולה שלא מקבל תקציב

> "Campaign 'Aiweon Agency' יצא מ-learning לפני 4 ימים. CPA ₪42 (יעד ₪50). Hook rate 41%. Frequency 1.7. תקציב היומי נוצל במלואו 3 מתוך 4 ימים."
>
> **Gate 2 החלטה:**
> CPA ≤ יעד × 0.9 יציב. Hook > 35%. Frequency נמוך (לא שחיקה). תקציב נוצל. זה winner.
>
> **פעולה:** Scale Up 20%. כי Hook > 35% ו-frequency < 2.0, יכול גם 30% (אבל שמרני כדי לא לזעזע Learning).
>
> **לא** duplication — זה מאפס Learning.

### תרחיש C: קמפיין עם Creative Fatigue flag

> "Campaign 'Q2 Push' פעיל 12 ימים. CPA התחיל ב-₪48, עלה ל-₪71 ב-6 ימים האחרונים. Meta Fatigue flag פעיל (CPR × 2.3). Frequency 3.2."
>
> **Gate 2 החלטה:**
> CPR flag של Meta טריגר, CPA > 1.3× יעד. אבל: **לא משהים את הקמפיין**. הפעולה היא _הוספת_ קריאייטיבים חדשים — לא פאוזה.
>
> **פעולה:** הוספת 5 קריאייטיבים חדשים מהגלריה + יצירה של 3 דרך `generate_creative.py`. תן ל-Andromeda להחליף ה-under-performers באופן טבעי.
>
> **זה הפוך לאינטואיציה הישנה** של "פרציה גבוהה = כבה".

### תרחיש D: תנודה יומית לא משמעותית

> "Campaign 'Aiweon SaaS': CPA היום ₪78, אתמול ₪52. עברו רק 18 שעות מהעלאת קריאייטיב חדש."
>
> **החלטה:**
> Time floor (48h) לא עבר. זו נוייז, לא signal. מחכים.
>
> **פעולה:** `decision_type='skip'` עם rationale "insufficient time-since-edit". לא מציעים כלום.

---

## 8. מה לעולם לא לעשות (Deprecated Rules)

**אם אתה כותב prompt חדש, guardrail, או מציע פיצ'ר — ודא שאינך משחזר אחד מאלה:**

| חוק ישן (pre-2024)                 | למה הוא שגוי עכשיו                          |
| ---------------------------------- | ------------------------------------------- |
| 1 ad set = 1 ad                    | Andromeda מעדיפה ad sets עם 10+ קריאייטיבים |
| הפרדה לקמפיינים TOFU/MOFU/BOFU     | Meta מזהה stage פנימית — Advantage+         |
| Manual placement optimization      | ספק aspect ratios; תן ל-Meta                |
| Horizontal scaling ע"י duplication | מאפס Learning Phase                         |
| Narrow interest targeting          | Andromeda עובד טוב יותר ב-broad             |
| **Frequency > 3 = kill**           | **Creative Fatigue flag החליף אותו**        |
| Daily edits based on 1-3 days data | מפריע ל-Learning                            |
| Single winning creative reliance   | מביא לשחיקה מהירה                           |
| Hook Rate > 30% כ-binary           | עכשיו banded: >35% / 25-35% / <25%          |
| אחרי 5-7 ימים — השאר top 3-5       | Andromeda מחלקת תקציב לא-אחיד — don't prune |
| Time-based sufficiency (72h)       | Volume-based (1,000 impr + 50 clicks)       |

**כלל:** כל trigger שמופעל בלבד מ-Frequency, או pause מבוסס CPA בלבד ב-48h, או פרסום של single-winner strategy — עבר על אחד מהמוסלחים. תחזור לסעיף 4.

---

## 9. מתי שואלים בן אדם

**הסוכן לא יודע הכל.** יש תרחישים ש**חייבים** אישור אנושי:

1. **כשהיצירה של החשבון חדשה (< 30 ימים).** אין עדיין baseline אמין. רמת ביטחון נמוכה. הסוכן מציע עם urgency='low' ו-rationale שמציין "baseline מצומצם".

2. **כשאין primary benchmark data** (ענפים ישראליים ללא data). הסוכן יבקש אישור על ספים ראשוניים מהבעלים.

3. **כשיש קונפליקט בין leading ל-lagging signals.** למשל: Hook 45% (מעולה) אבל CPA × 2 (איום). אולי בעיה בדף נחיתה? שואלים.

4. **כשיש מספר winners בו-זמנית ב-ad set.** אין פרקטיקה מוסכמת; הסוכן מציע 2-3 אפשרויות (scale winners / pause losers / expand) והמשתמש בוחר.

5. **כשרוצים קפיצת תקציב > 30%.** חוקי היסוד עדיין שמרניים למרות Andromeda. אישור מפורש.

6. **בזמן אירוע ביטחוני/חירום בישראל** (דחוי ל-v2 — Operation Modes). בינתיים: אם CPL קופץ פתאום ×2+ ואין הסבר אחר, Claude אמור לבקש confirmation לפני שעוצר/משהה.

---

## 10. שאלות פתוחות — מה המנוע לא יודע

**שקיפות: המחקר של 2026 לא פתר הכל.** אלה הדברים שבהם המנוע לא פועל עד שמישהו עונה:

- **ספים ספציפיים לוורטיקלים ישראליים** — אין primary data פומי. לאייוון MVP: 30 ימי calibration לפני הפעלת kill decisions מלאים.
- **CI math ל-CPA movement** — אין מספר רשמי. נשתמש ב-volume heuristics.
- **ניהול מספר winners ב-ad set** — open debate. שואלים את המשתמש.
- **סובלנות Andromeda לקפיצות > 30%** — practitioners עדיין שמרניים. נשמור על 20-30% ב-MVP.
- **שחיקה של GenAI creatives** — אין data 2026 לטווח ארוך. מעקב צמוד.
- **Awareness vs direct conversion לנישות שירות ישראליות** — open debate. ל-Aiweon: נתחיל ב-direct, נוסיף warming אם צריך.

---

## 11. הקשר למימוש

מסמך זה מתורגם לקוד ב:

| אלמנט                        | מיקום                                                                |
| ---------------------------- | -------------------------------------------------------------------- |
| Two gates logic              | `campaigner/prompts/performance-brain.md` + `decision-tree.md`       |
| Leading signals check        | `campaigner/tools/check_data_sufficiency.py`                         |
| Deprecated rules enforcement | `campaigner/guardrails.py` (5+ new guardrails 2026)                  |
| Baselines rolling window     | `campaigner/lib/baselines.py` (windows 7/14/30)                      |
| Creative firehose            | `runners/weekly_creative_firehose.sh` + `tools/generate_creative.py` |
| Human-in-the-loop approval   | טבלת `approvals` ב-Supabase                                          |
| Decision trail               | טבלת `agent_decisions`                                               |

**אם החלפת עיקרון ב-EVALUATION.md — לא מספיק.** חייב לעדכן את הקוד המקביל, את `prompts/*.md` שClaude טוען, ואת הguardrails. אחרת השינוי הוא תיאורטי בלבד.

---

## 12. מקורות

- **`docs/plans/campaigner-spec.md`** §3.4, §6, §7, §14, §17 — אפיון מלא
- **`docs/deep_research/findings-diff.md`** — deltas בין האפיון למחקר 2026
- **`docs/deep_research/grok-meta-evaluation-andromeda-2026-04-15.md`** — מחקר #1
- **`docs/deep_research/manus-meta-evaluation-andromeda-2026-04-16.md`** — מחקר #2 (data ישראל)

---

**Revision:** 1 — 2026-04-16
**Next review:** כשמתווסף מחקר שלישי (Perplexity / Gemini DR / ChatGPT DR), או אחרי 30 ימי production של Aiweon.
