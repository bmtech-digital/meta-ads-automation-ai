# Hebrew Copy Style — Aiweon Brand Voice

> **Audience:** Claude (the agent), loaded into context on every invocation.
> **Scope:** §§1-9 govern **customer-facing ad copy** (headlines, hooks, CTAs). §11 governs **operator-facing rationale** (the "למה?" in the approvals UI). Both apply on every run.
> **Status:** **v0.5 — 2026-05-13 (Block 12).** §§1-9 now LOCKED — `[TBD]` markers replaced with Aiweon-specific brand voice based on Roi's voice-conversation answers: ידידותי-מקצועי tone, multi-segment audience (4 personas selected by `service_tag`), hard-ban on specific-ROI claims without data, proof-points-as-process for cold-start period. §11 unchanged from v0.4. v0.4 added §11.6 — every rationale must close with an ordered `תוכנית` mini-section (1, 2, 3 steps). v0.3 widened the paragraph-1 forbidden list.
> **Target lock date:** 2026-05-10 (per [decisions-log §1.5](../../docs/plans/decisions-log.md#15-hebrew-copy-style--authorship)).
> **Owner:** Roi (admin@aiweon.co.il). Update triggers listed in §10.

---

## How to use this file (for Claude)

When generating Hebrew ad copy, read this file top to bottom before writing anything. Apply the rules in §2-7. Cross-check every generated variant against §3 (forbidden list) and §9 (hard constraints). If a requested CTA or angle isn't covered here, surface the gap in your output so the operator can add it — don't silently invent.

---

## 1. Brand overview

- **Name:** Aiweon
- **Tagline:** הבית של מותגים ויוצרי תוכן
- **Positioning:** AI-based digital marketing agency + SaaS platform, based in Israel.
- **Domain:** aiweon.co.il
- **Primary language:** Hebrew (MVP scope). English/Arabic deferred.

### What Aiweon sells

Aiweon היא **פלטפורמת שיווק משפיענים מבוססת AI** עם מספר שירותים שונים (ייצור תוכן, ניהול קמפיין משפיענים, שיווק אורגני, ניהול קמפיינים ממומנים). הסוכן קורא את `business_knowledge.products[]` עם `service_tag` כדי לדעת **עבור איזה שירות הקמפיין הספציפי הזה**, ומכוון את הקופי לכאב ולקהל של אותו שירות בלבד — לא לכל "תחום השיווק". אסור לערבב מסרים בין שירותים בקופי אחד.

### Who we sell to

**Multi-segment** — לפי השירות שהקמפיין מקדם, הקופי מכוון לאחד מ-4 קהלים:

1. **מנהלי שיווק בחברות בינוניות-גדולות** (Marketing Manager / VP) — efficiency + measurability + ROI לדיווח להנהלה
2. **בעלי מותגי DTC / e-commerce** — מייסד או מנהל שמרכיב הכל בעצמו; רגיש לעלות וזמן
3. **מנהלי content / influencer marketing דדיקייטד** — אנשי תוכן שכבר עושים, צריכים יותר efficiency
4. **סוכנויות שיווק שעובדות עם מותגים** (B2B2C) — Aiweon ככלי עבודה של הסוכנות, לא של המותג

הסוכן בוחר את הסגמנט לפי `business_knowledge.questionnaire_answers.ideal_customer` + `service_tag` של הקמפיין. אם לא ברור — דיפולט: סגמנט 1 (מנהלי שיווק), הקהל הרחב ביותר ל-B2B SaaS ישראלי 2026.

### What problem we solve (for the customer)

**הכאב משתנה לפי השירות**, אבל ה-spine משותף: **שיווק עם משפיענים לוקח שעות שבועיות של ניהול ידני — מציאה, פנייה, מו"מ, ניהול קמפיין, מדידה — בלי שום אינדיקציה אם בחרת נכון.** Aiweon ממיר את התהליך הידני הזה לפלטפורמה: ה-AI מצמיד יוצרים שמתאימים, המערכת מנהלת את הקשר, והיא מחזירה דוח אחד מסודר. הקופי מתמקד בעולם של הלקוח (סיפור על "שעות שאתה לא מקבל בחזרה") ולא ב-Aiweon ("יש לנו טכנולוגיית match-making מבוססת ML"). הראשון מוכר, השני קורא להשוואה עם מתחרים שהלקוח לא מכיר.

---

## 2. Voice dimensions

### Formality

**Option A — "אתה/את" singular, ידידותי-מקצועי.** מקצועי אבל לא יבש; כמו שמסבירים לעמית בקפה, לא כמו שמדברים מפודיום. נעול 2026-05-13.

- **Use "את/אתה" singular** (לא "אתם"). כל סטטיסטיקה ש-Meta נתנה ב-2026 מראה שמודעות עם פנייה אישית singular ב-IL מקבלות hook-rate גבוה יותר מ-plural.
- **Gender:** כשלא ברור מי בצד השני — דיפולט **infinitive form** ("לוקח לך זמן..." במקום "אתה לוקח / את לוקחת"). אם הקהל זוהה מ-`business_knowledge.questionnaire_answers.ideal_customer` כ-נשים-בעיקר — אז "את" עקבית, ולהיפך. **אסור** לערבב מין באותה מודעה.
- **Distance:** קרוב אבל לא חבר ("בוא נסתכל" — OK; "בוא נראה איך זה הולך אחי" — לא).

### Energy level

**Calm / advisory — "מומחה שמסביר".** נעול 2026-05-13.

לא "בואו נתחיל!" ולא "אצלנו השיווק חי!". הקופי מציג בעיה אמיתית, מסביר איך אנחנו פותרים אותה, ונותן צעד הגיוני הבא. אם נשמע כמו פרסומת רדיו — נסח מחדש.

### Humor

**Straight-faced, no humor.** נעול 2026-05-13.

הומור עובד טוב ב-DTC; ב-B2B Israeli SaaS 2026 הוא יוצר distrust. הקהל שלנו כבר ראה מספיק "תכנון של פרסומאי שחושב שהוא מצחיק" — הוא מצפה שאנחנו נכבד את הזמן שלו.

**חריג:** אם הקמפיין מציע שירות "ייצור תוכן" וה-ICP הוא DTC קטן, אפשר רוורד מעודן (irony קל). זה ההיוצא היחיד מהכלל; כל יציאה אחרת דורשת `requires_human_review=true` בהצעה.

### Technical register

**Plain Hebrew.** נעול 2026-05-13.

ROAS, CPA, CPM, CTR — **אסור** במודעות-לקוח (מותר ברציונל לאופרטור, ראה §11). "החזר על הוצאת פרסום" / "עלות לליד" / "אחוז הקלקות" — לא, גם הם — סוכן ישראלי ממוצע לא מדבר ככה ב-2026. תרגום הולם: "שווה לכל שקל", "ליד באיכות שמתאימה לעסק שלך", "אחוזי תגובה גבוהים".

**יוצא דופן יחיד:** "AI" מותר פעם אחת לכל קופי, ולא בתור buzzword עצמאי אלא כתיאור של איך משהו עובד ("AI שמנתח את הקהל של כל יוצר ומשווה לקהל שלך").

### We sound like

ייעוץ עסקי שמתחבא בלשון יום-יום. מודלים מנחים (לא קולות לחקות מילולית — רק לחוש את ה-register):

- **Riskified** (עברית-עסקית, ידידותית, מסבירה תהליך חכם בלי buzz)
- **Lemonade** (כשהם מסבירים תהליך, לא כשהם מתבדחים) — שילוב של ידידות וברירות פעולה
- **AppsFlyer / Monday.com** ב-Hebrew company-blog שלהם — pro tone, no condescension

### We do NOT sound like

- ❌ "סדנה חינם של אסטרטגיית שיווק שתשנה את חייך" (גורו-Facebook קלאסי — overpromise, no proof)
- ❌ "המהפכה הבאה ב-AI לעסקים" (gen-AI hype 2024-2025 — מיותר ב-2026)
- ❌ פרסומות "הקליק כאן וקבל המדריך החינמי" (lead-gen sleazy ב-IL)
- ❌ "אנחנו הסוכנות המובילה ל-X" (אסור self-positioning בלי data — ראה §3)

---

## 3. Lexicon

### Forbidden words and phrases (pan-Israeli spam-feel — always reject)

- `לחץ כאן` (dead giveaway of template copy; use contextual CTA instead)
- `מוגבל בזמן!` (overused; cheapens actual scarcity when we need it)
- `הזדמנות של פעם בחיים`
- `מהפכה`, `פריצת דרך`, `בלעדי` — all overused to the point of meaninglessness
- `!!!` / `???` — never more than one exclamation/question mark in a row
- `חינם!!` — zero exclamation marks. "חינם" alone, once, is fine when literally true.
- `רק היום` unless literally true for today (adherence matters for Meta policy too)
- ALL CAPS English words mid-Hebrew sentence ("CTR", "ROI" OK; "LAST CHANCE" — no)

### Aiweon-specific forbidden terms (נעול 2026-05-13)

**Hard-ban (פסילה אוטומטית):**

- **מבטיחי ROI ספציפי בלי data** — "X3 לידים", "חיסכון של 80%", "פי 5 מכירות", "70% תוצאות יותר טוב". כל מספר ROI/efficiency במודעה חייב להיות **מבוסס על data מותג ספציפי שמופיע ב-business_knowledge.questionnaire_answers.what_worked_before**, או על מקור חיצוני שמצוטט באישור (Aiweon הספציפית, לא נתונים גלובליים). אחרת — לא מציעים את המספר.
  - חריג שמותר: claims על תהליך, לא על תוצאה — "במקום ימים — דקות" (תיאור של הזמן שהפלטפורמה לוקחת), "AI שמנתח מאות פרופילים בדקות" (תיאור של מה הפלטפורמה עושה). אסור: "השיגו 5× יותר engagement".

- **Superlatives שחוקים** — "המוביל", "מספר 1", "הטוב ביותר", "פורץ דרך", "מהפכני", "המהפכני". כולל וריאציות "המוביל ב-AI", "המוביל בישראל", "המוביל בענף". כל "מוביל"/"לידר" — פסילה.

- **בז'ארגון שיווק (Marketing-ese)** — "פתרון 360", "end-to-end", "holistic", "גלובלי", "חוצה תעשיות", "workflow" (הילית), "engagement" (הילית), "funnel" (הילית), "ecosystem", "synergy", "integration" כשם עצם הילית. הילית = מותר ברציונל לאופרטור (§11) עם gloss; **אסור** במודעות-לקוח.

- **AI overuse** — "AI" / "בינה מלאכותית" מותר פעם אחת לכל קופי. אם הופיע פעמיים — regen. הפוקוס במודעה הוא על **התוצאה לעסק** ("מצא בדקות"), לא על **הטכנולוגיה** ("AI מתקדם מבוסס ML"). הלקוח לא קונה AI; הוא קונה את הזמן שמתפנה.

- **כל מילה ממילון §3 הכללי** למעלה (לחץ כאן, מהפכה, רק היום, וכו') — נשארות פסולות גם ב-Aiweon.

### Preferred vocabulary for our category (נעול 2026-05-13)

ברירות מחדל לאוצר מילים — הסוכן חוזר על הצורות האלה לעקביות מותג:

| הקשר | מותג Aiweon משתמש ב- | לא ב- |
| --- | --- | --- |
| הטכנולוגיה | **"AI"** (פעם אחת, רק כתיאור איך משהו עובד) | "בינה מלאכותית" (יותר ארוך), "ML" (טכני מדי), "אוטומציה" (לא מדויק — Aiweon מנתחת, לא רק מאוטמטת) |
| הקהל הקצה של הלקוח | **"הקהל שלך"** / **"הלקוחות שלך"** | "המבקרים", "הגולשים", "ה-users" |
| מי שכתוב במודעה | **"מותגים"** (כשמדברים על Aiweon's customer base) / **"העסק שלך"** (כשפונים ישירות) | "עסקים", "חברות", "ארגונים" — generic מדי |
| ה-side-effect של Aiweon | **"חוסכים זמן"** / **"מעבירים ידיים"** | "מייעלים תהליכים", "אופטמיזציה" — buzzy מדי |
| השלב במשפך | **"שלב ראשון"** / **"שלב הבא"** | "Top of funnel", "TOFU", "אחרי הרישום" |
| יוצרי תוכן בפלטפורמה | **"יוצרים"** או **"משפיענים"** — שניהם OK, נטה ל**"יוצרים"** ב-feed (קצר יותר) ול**"משפיענים"** כשמדברים על reach (ספציפי יותר) | "אינפלואנסרים" (אנגלית בעברית — לא), "סלבים" (סלנג, לא matches Aiweon tone) |
| שלב הקנייה | **"להתחיל"** / **"להירשם"** (לפלטפורמה) | "לקנות עכשיו" — Aiweon לא רץ בקופי כ-eCommerce |
| תוצאת המוצר | **"קמפיין מותאם"** / **"תוצאה מותאמת"** | "הצלחה", "ROI" — אסורים פר Hard-ban |

### Common AI-generated mistakes in Hebrew (always check for)

- **Literal translation from English patterns:** "תן לעצמך" (from "give yourself"), "זה הזמן שלך" (from "your time"), "הכנס את עצמך" — all sound translated.
- **Masculine default for mixed audiences** — default to plural "אתם" or infinitive forms, not masc singular "אתה" unless audience is male-only.
- **Gender-inflection mixing mid-sentence** — "השאר את הפרטים שלך ותקבלי" (masc imperative + fem future) — always catch.
- **ו'/וכו'/ועוד** as filler to pad length — never acceptable.
- **Overly formal registers** ("אשר על כן", "נבקש בזאת") — too bureaucratic for social ads.
- **Emoji positioning** — in Hebrew RTL, emoji direction often breaks. Prefer no emoji, or ≤1 per ad at the end.

---

## 4. CTAs (call-to-action phrases)

### By campaign objective (prefer these; reject others unless operator overrides)

**Leads (objective=LEAD_GENERATION):** ranked, נעול 2026-05-13

1. **"לקבל הדגמה"** (Meta button: `LEARN_MORE` או `BOOK_APPOINTMENT` אם זמין) — דיפולט ל-B2B SaaS, נשמע safe יותר מ-"להשאיר פרטים"
2. **"להתחיל ניסיון"** (Meta button: `SIGN_UP`) — כשהשירות הוא self-serve והניסיון אכן חינם
3. **"לקבוע שיחת היכרות"** (Meta button: `BOOK_APPOINTMENT`) — כשהמכירה דורשת human; מתאים לסוכנויות שיווק

**אסור** "להשאיר פרטים" — generic, mass-feel, רוב הלקוחות זמינים ל-WhatsApp מ-`business.contact_whatsapp` ולכן form-fill מוסיף friction בלי לשפר את ה-conversion.

**Sales / Conversions (objective=CONVERSIONS):**

1. **"להירשם"** (Meta: `SIGN_UP`) — דיפולט ל-B2B SaaS
2. **"להתחיל היום"** (Meta: `SIGN_UP`) — variation ידידותית, אותו אובייקטיב

**אסור** "לקנות עכשיו" / "Shop Now" — Aiweon אינה eCommerce; שימוש ב-CTA כזה יבזבז קליקים.

**Traffic / Awareness:**

1. **"מידע נוסף"** (Meta: `LEARN_MORE`) — דיפולט
2. **"לקרוא עוד"** — variation, אותו אובייקטיב

**Engagement (publish_ig_post / publish_ig_reel — אורגני):**

- אין CTA מבני בפוסטים אורגניים. הקופי עצמו מסתיים בשאלה פתוחה ("מה אצלך עובד?") או הזמנה רכה ("ספרו בתגובות").

### Aiweon-specific CTA selection by service (נעול 2026-05-13)

הסוכן קורא `service_tag` של הקמפיין ובוחר CTA לפי הטבלה:

| `service_tag` | CTA דיפולט | שלב הלקוח |
| --- | --- | --- |
| influencer_matching | "לקבל הדגמה" | מחקר/השוואה — לקוח מבין הרעיון, רוצה לראות איך זה עובד |
| content_creation | "להתחיל ניסיון" | פעולה — לקוח רוצה תוצר ראשון |
| organic_marketing | "מידע נוסף" | למידה — concept חדש, פחות הבנה ברורה |
| paid_campaigns | "לקבוע שיחת היכרות" | high-touch — דרוש דיון לפני התחייבות |

### Meta ad-format CTA buttons

The ad platform itself offers CTA buttons (Get Quote, Sign Up, Learn More, etc.). Match the Hebrew CTA **in the primary text** to what the button says — if button is "Sign Up", text should end with "להירשם" and not "לקבל הצעה" (this creates a confusing friction for users).

---

## 5. Headlines

### Hard constraints

- **Length:** 5-7 Hebrew words. One line of 40 chars max at standard Hebrew feed rendering.
- **Benefit-driven:** Focus on customer outcome, not Aiweon's feature.
- **No punctuation clutter:** Max one punctuation mark (`.`, `?`, or nothing). No exclamation in headlines.

### Structural patterns we prefer (נעול 2026-05-13)

Aiweon's brand voice לא משתמש ב-headline aggressive. שלושה דפוסים מותרים, בסדר עדיפות:

1. **תיאור-תהליך קצר** — מה הלקוח מקבל, בלשון פשוטה
   - "התאמה אוטומטית בין מותג למשפיענים"
   - "ניהול קמפיין משפיענים, פחות עבודה"
   - "תוכן מותאם לקהל שלך, בדקות"
2. **שאלה מבוססת-כאב** — מבטא את הכאב מבלי לבטיח פתרון
   - "כמה זמן לוקח לך לבחור משפיען?"
   - "מי מנהל לך את הקמפיין מול 5 יוצרים?"
3. **Outcome ב-timeframe ספציפי** — רק כש-timeframe ניתן לקיים מבחינת הפלטפורמה
   - "התאמת יוצרים בדקות, לא בימים"
   - "דוח קמפיין מסודר בסוף השבוע"

**אסור pattern Question + Hype** ("למה המתחרים שלך מכפילים מכירות?"). זה אנטי-Aiweon. גם **אסור Declarative + Promise** ("השיווק שלך לא חייב לעלות ככה") — נשמע כמו פסיכולוג של שיווק, לא מקצועי.

**דפוס דיפולט כשלא ברור איזה לבחור:** דפוס 1 (תיאור-תהליך) — הכי בטוח, הכי "Aiweon" tone-wise.

### Anti-patterns (reject)

- "גלה את [thing]" — imperative-adventure register; worn out
- "[Number] סיבות למה..." — listicle tease; works on blogs, not ads
- Starting with brand name — "Aiweon היא..."

---

## 6. Primary text

### Opening hook (first 1-3 lines before "...ראה עוד")

Hebrew feed renders ~80-120 characters before the "see more" break. The hook must land there.

**Rules:**

- First sentence ≤12 words.
- Lead with the **customer's reality or question**, not our product.
- No generic openers: avoid "האם אתה..." (too template).

**3 hook templates** (נעול 2026-05-13 — אלו לא ניסוחים סופיים, אלו patterns שהסוכן ממלא):

1. **Hook זמן** — "ניהול קמפיין עם משפיענים לוקח שעות שבועיות" / "מציאת יוצר שמתאים למותג שלך לוקחת ימים"
2. **Hook לבחירה** — "איך יודעים אם משפיען נכון למותג שלך? לפי data, לא לפי גוט-פילינג"
3. **Hook השאלה הפתוחה** — "כמה משפיענים בדקת לפני שבחרת את האחרון?"

**אסור hooks ש-Aiweon לא משתמש בהם:**

- ❌ "האם אתה..." (template, ראינו את זה אלף פעם)
- ❌ "תכירו את [Aiweon/שם המוצר]..." (אסור לפתוח עם שם המותג)
- ❌ "AI שינה את הכל..." (overpromise, ראה §3 AI overuse)

### Body

- **Length:** 40-80 words total is the sweet spot for Meta placements in Hebrew. Longer works only if the opening earns it.
- **Structure:** Hook (הכאב) → claim ספציפי על מה Aiweon עושה אחרת → soft proof (volume או process, לא ROI) → CTA.
- **One idea per ad.** If there are three angles, that's three ads, not one.

### Proof points we can use (נעול 2026-05-13)

**Aiweon נמצאת ב-cold start (החשבון חדש, ראה memory project_aiweon_new_account.md)** — אין עדיין case studies מבוססי data משלנו. עד שיש, ה-proof points הזמינים הם:

| סוג | דוגמה | מתי להשתמש |
| --- | --- | --- |
| **Process-based** (תיאור איך הפלטפורמה עובדת) | "AI שמנתח מאות פרופילים בדקות"; "התאמה אוטומטית לפי קטגוריה + טון + קהל" | תמיד מותר — לא מבטיח תוצאה, רק מתאר תהליך |
| **Speed-based** | "במקום ימים — דקות"; "דוח קמפיין סוף השבוע, לא בעוד חודש" | מותר — Speed הוא הבדל אמיתי בין פלטפורמה לתהליך ידני |
| **Volume of catalog** | "X+ יוצרים פעילים בפלטפורמה" | רק אם המספר זמין ב-`business_knowledge.questionnaire_answers.platform_metrics` — אסור להמציא. אם לא — לוותר על proof, לא לזייף. |
| **Logo proof** | "מותגים מובילים בישראל עובדים איתנו" | רק אם יש לפחות 3 לוגוים זמינים ב-business_knowledge. אסור — "מותגים מובילים" כ-tag-line חסר תוכן. |

**אסור הסוגים האלה של proof points עד שיש data אמיתי:**

- ❌ "X3 לידים" / "חיסכון של 80%" / "פי 5 engagement" — כל מספר ROI/יחס. נחסם דטרמיניסטית.
- ❌ "X חודשים שאנחנו מובילים בקטגוריה" — Aiweon חדשה, אסור.
- ❌ "אלפי מותגים השתמשו..." — overpromise, אסור עד שמספר אמיתי זמין.

**עיקרון על:** במצב cold-start, **proof on process > proof on result**. כשהפלטפורמה תצבור data ב-3-6 חודשים, יתעדכן §6 כדי לכלול outcome-proof אמיתי (כשיש).

---

## 7. Cultural + regulatory context

### Hebrew-specific

- Right-to-left; emoji and English words break flow — use sparingly.
- Biblical/literary references can land well but risk sounding preachy; default to modern Hebrew.
- Military/security metaphors are **always off** in 2026 IL context.

### Calendar sensitivity

- **Shabbat:** No scheduled launches Friday afternoon → Saturday night. The Meta cron respects this via business timezone; copy should also avoid "השבוע" framing that becomes weird over Shabbat.
- **Holidays (חגים):** Pass, Rosh Hashana, Succot, Hanukkah, Purim, Shavuot — impose their own pause windows. When a campaign spans a holiday, the copy should acknowledge it only if the offer is holiday-tied; otherwise stay neutral.
- **Tisha B'Av / fast days:** No promotional energy on these dates.
- **Memorial Day / Independence Day / Yom Kippur:** Full blackout for promotional content.

### Audience segments (IL-specific, נעול 2026-05-13)

Aiweon's B2B buyers הם בעיקר **חילוני סקולרי**. הקופי כתוב בעברית מודרנית עירונית, בלי הקשרים דתיים-לאומיים או מסורתיים. **אסור** ב-Aiweon's customer-facing copy:

- ❌ ביטויים מהמסורת/דתי בלי הקשר ("ברוך השם", "בעזרת השם", "אבא שבשמיים")
- ❌ Russian transliterations אלא אם הקמפיין ספציפי לקהל Russian-speaking
- ❌ ערבית — לא ב-MVP (חוסר תמיכה ב-platform-level)

**הסגמנטים שנכללים:** חילוני (דיפולט), דתי לאומי (passes בלי התאמה ספציפית — שפת ה-pro-tone לא מתנגשת עם תפיסת עולמם).

**הסגמנטים שלא:** חרדי (דורש register שונה לחלוטין + Aiweon Meta Page לא מתאימה ל-rabbi-approval channels), ערבי-ישראלי (דורש תרגום).

**איך הסוכן מיישם:** בעת בחירת `targeting` ב-`new_campaign`, הסוכן **לא** מצמצם לפי דת — הוא משאיר רחב + Advantage+ Audience. ה-locking בא דרך **בחירת הקופי** (העברית המודרנית עצמה מטרגטת חילוני/דתי-לאומי בפועל; חרדי לא יקליק על Aiweon ad בלי קשר).

### Current-event sensitivity (2026)

- Wartime context: avoid flippant tone, avoid urgency copy that sounds like news ("אל תפספסו!"), avoid military vocabulary even as metaphor.
- Political neutrality: no sides, no slogans, no flags as visuals unless Independence Day.

---

## 8. Worked examples

### ✅ Good — Aiweon influencer_matching service, B2B Lead-gen (נעול 2026-05-13)

**Headline:** התאמת משפיענים שמתאימים למותג שלך
**Primary text:**

> מציאת היוצר הנכון לקמפיין שלך יכולה לקחת שבוע של פגישות וטבלאות.
>
> Aiweon מנתחת את הקהל של כל יוצר ומשווה לקהל שעובד למותג שלך — ומחזירה רשימה מסודרת בדקות.
>
> רוצה לראות איך זה עובד על הקטגוריה שלך?

**CTA button:** לקבל הדגמה
**Why this works (Claude למידה):**

- Hook (משפט 1) על הכאב האמיתי — "שבוע של פגישות וטבלאות" — לקוח מזהה את הסיטואציה
- Line 2 מסביר תהליך, לא מבטיח תוצאה (process-proof, מותר)
- "AI" מופיע פעם אחת ("Aiweon מנתחת") כשם פעולה, לא buzzword עצמאי
- CTA מתאים לסגמנט (לקבל הדגמה — B2B SaaS דיפולט per §4)
- אין מספרי ROI, אין superlatives, אין "מהפכני"

### ✅ Good — Aiweon content_creation service, DTC (נעול 2026-05-13)

**Headline:** תוכן מותאם לקהל שלך, בדקות
**Primary text:**

> אם את מנהלת מותג DTC, אז את יודעת — תוכן זה צוואר הבקבוק. כל יום בלי פוסט עולה reach.
>
> Aiweon מייצרת לך תוכן שמותאם ל-tone של המותג ולקהל שכבר עובד — אז את לא צריכה לבחור בין מהירות לאיכות.
>
> ניסיון ראשון על המותג שלך — חינם.

**CTA button:** להתחיל ניסיון
**Why this works:**

- "את" נשמר עקבי לאורך כל המודעה — אין mixing
- אין hype בכותרת, יש benefit ספציפי (timeframe מותר כי הוא תהליכי)
- "AI" לא מופיע (חסכון על "AI overuse" guardrail) — Aiweon כשם המותג מספיק
- CTA תואם service (content_creation → "להתחיל ניסיון" per §4 service table)

### ❌ Bad — pattern to always reject

**Headline:** מהפכה בעולם השיווק!!! הזדמנות של פעם בחיים
**Primary text:**

> לחץ כאן עכשיו כדי לקבל גישה בלעדית למערכת המהפכנית שלנו!!
>
> אל תפספסו — רק היום מחיר מיוחד.

**Why it's bad:**

- Three forbidden phrases: מהפכה, הזדמנות של פעם בחיים, לחץ כאן.
- Exclamation stacking (`!!!`, `!!`).
- "רק היום" without actual same-day offer.
- No differentiation — could be any SaaS/agency ad.
- Hype without substance; Andromeda will likely throttle delivery.

**Note for v0.6:** when Aiweon אוספת case studies אמיתיים עם logo + מספרים, להחליף את הדוגמאות למעלה ב-real examples + להוסיף שלישית per-service. עד אז ה-2 הדוגמאות שלמעלה הן הקנון.

---

## 9. Hard constraints Claude must enforce before returning copy

Every copy variant Claude produces must pass **all** of these programmatic checks:

1. **No forbidden phrase from §3** appears (case-insensitive, substring match).
2. **Headline ≤ 7 words**.
3. **Primary text opening ≤ 120 characters** before first paragraph break.
4. **One gender register per ad** — no mixing masc/fem verbs within the same copy block.
5. **CTA is from the approved list (§4)** for the current objective — or flag the gap.
6. **No more than 1 exclamation or question mark** in headline; ≤ 2 across entire primary text.
7. **Emoji count ≤ 1** per ad, placed at end only.

When a variant fails any check, regenerate rather than relaxing the rule.

---

## 11. Operator-facing rationale (`rationale`, `summary` fields)

> **This section applies to the agent's reasoning output shown to Roi — not to customer ad copy.** §§2-9 govern what the customer sees on Facebook/Instagram. §11 governs what Roi sees in the approvals UI and in `agent_decisions`.

### Why this matters

**Assume the reader is not a marketing or ads professional.** The operator (Roi today, an Aiweon teammate or client tomorrow) may have zero exposure to Meta jargon. The first paragraph of every rationale must be readable _and speakable aloud_ by such a reader — they decide approve / reject / investigate from paragraph 1 alone, without consulting a glossary or asking what an acronym means. If you would not say it to a friend over coffee, do not write it in paragraph 1.

Acronyms buried in paragraph 2 (with first-use glosses) are fine; acronyms in paragraph 1 are not — they force the operator to translate before they can think.

### Hard rules for every `rationale` field

1. **Open with a TL;DR.** One sentence, ≤ 20 words, plain Hebrew that someone outside the field can read aloud and immediately understand. Substitute the everyday-Hebrew equivalent: "Meta לא מצליחה למצוא לקוחות בעלות הגיונית", "הקמפיין עוד לא הספיק ללמוד מי הקהל הנכון", "רוב התקציב לא נוצל". The TL;DR answers three questions in one breath: *מה הבעיה? למה זה קורה? מה מוצע?* Blank line after the TL;DR.

   **Forbidden in paragraph 1** (every category below — translate before writing):

   | Category | Forbidden tokens | Plain-Hebrew substitute |
   | --- | --- | --- |
   | Metric acronyms | `CPM`, `CTR`, `CPA`, `CPL`, `CPR`, `ROAS` | "עלות לאלף חשיפות", "אחוז הקלקות", "עלות להמרה", "עלות לליד", "עלות לתוצאה", "החזר על הפרסום" |
   | Meta engine / feature names | `Andromeda`, `Advantage+`, `Advantage+ Audience`, `Dynamic Creative` | "מערכת הפרסום של Meta", "הרחבת קהל אוטומטית", "בחירת קריאייטיב אוטומטית" |
   | Meta state strings | `LEARNING`, `LEARNING_LIMITED`, `ACTIVE`, `INACTIVE`, `PAUSED` | "בלמידה", "תקוע בלמידה", "פעיל", "לא פעיל", "מושהה" |
   | Performance metric names | hook rate, frequency, benchmark, reach | "קצב משיכת תשומת לב", "תדירות חשיפה לאדם", "ממוצע השוק", "כמות חשיפות" |
   | Ad-format ratios | `9:16`, `4:5`, `1:1` | "וריאנט אנכי למובייל", "פורמט פיד נמתח", "פורמט מרובע" |
   | Placement names (English) | `Stories`, `Reels`, `Feed`, `Right Column` | "סטוריז", "ריילז", "פיד", "טור צד" |
   | Meta CTA enum tokens | `MESSAGE_PAGE`, `LEARN_MORE`, `SIGN_UP`, `SHOP_NOW`, `GET_OFFER`, `CONTACT_US` | "שלח הודעה", "מידע נוסף", "להירשם", "לקנות עכשיו", "קבלת הצעה", "צור קשר" |
   | Internal doc references | "לפי creative-guide §2", "לפי decision-tree §17", "לפי §6.4 ב-performance-brain" | תרגם את הכלל לעברית טבעית. הקורא לא יודע מה זה creative-guide. |
   | `placement`, `cta`, `model_tier`, `aspect_ratio` field-names | — | אל תזכיר את שם השדה הטכני בכלל. דבר על המהות. |
   | **Agent-internal jargon** (חדש 2026-05-13 — תגובה לתסכול אופרטור) | `Flow A`/`Flow B`/`Flow C`/`Flow D`, `dispatcher`, `tracking gate`, `tracking health`, `task_type`, `business_knowledge`, `monthly_brief`, `propose_task`, `execute_task`, `verify_pixel_capi`, `agent_decisions`, `approvals`, שמות קבצי `.py`/`.sql`, מספרי שורות (`foo.py:225`), שמות פנימיים של lanes (`§T0`, `§T2+`, `§T11`) | תאר את ההתנהגות העסקית, לא את שם הקוד. דוגמה: במקום "ה-dispatcher של Flow B חוסם" → "הביצוע האוטומטי לא רץ"; במקום "tracking gate חוסמת" → "מערכת המדידה חלקית חוסמת אצלי הצעות חדשות"; במקום "ה-rationale של propose_task" → "ההסבר שאני שולח לך". |
   | **Meta engineering jargon** (חדש 2026-05-13) | `AEM`, `CAPI`, `Aggregated Event Measurement`, `Conversions API`, `Events Manager`, `Business Manager`, `iOS 14`, `DNS TXT record`, `Graph API`, `Marketing API`, `pixel ID`, `webhook`, `app_id`, `access_token` | "אירועי המרה מאוחדים" (AEM), "אירועים מצד השרת" (CAPI), "מנהל האירועים של Meta", "מנהל העסקים של Meta". `iOS 14` מותר בפסקה 2+. שמות מותג של Meta (כמו "Business Manager") מותרים רק כשמדברים על המוצר עצמו, ועם תרגום בעברית באותה שורה. |

2. **Then the analysis.** Detailed reasoning with numbers and evidence. Here acronyms are allowed **on first use** with a short Hebrew gloss in parentheses:

   | Acronym                         | First-use gloss                                  |
   | ------------------------------- | ------------------------------------------------ |
   | `CPM`                           | CPM (עלות לאלף חשיפות)                           |
   | `CTR`                           | CTR (אחוז הקלקות)                                |
   | `CPA`                           | CPA (עלות להמרה)                                 |
   | `CPR`                           | CPR (עלות לתוצאה)                                |
   | `ROAS`                          | ROAS (החזר על הוצאת פרסום)                       |
   | `Andromeda`                     | Andromeda (מנוע ה-ML של Meta מ-דצמבר 2024)       |
   | `LEARNING` / `LEARNING_LIMITED` | תקוע בלמידה (Meta state: `LEARNING_LIMITED`)     |
   | `Advantage+ Audience`           | Advantage+ Audience (הרחבת קהל אוטומטית של Meta) |

   After first use in the same rationale, the acronym alone is fine.

3. **No hype or sales voice.** This is diagnostic prose for an operator, not ad copy. The §3 forbidden list (`מהפכה`, `בלעדי`, `!!!`, `חינם!!`) is doubly out of place here. Write like a junior analyst briefing a senior one — factual, specific, short.

4. **Link action to diagnosis, not symptom.** Weak: _"מוצע להרחיב קהל כי ה-CPM גבוה."_ The CPM being high is a _symptom_. Strong: _"הקהל צר מדי כך ש-Meta לא מצליחה למצוא המרות; הרחבה תאפשר ללמידה להתקדם."_ The diagnosis explains what the action fixes and why.

5. **Numbers earn their place.** Every number in the rationale either anchors the decision (`CPM 128 לעומת 8.38 — פי 15`) or is irrelevant and should be cut. Don't pad with metrics that didn't drive the proposal.

6. **Every proposal closes with a `תוכנית` mini-section.** To restate the root cause in priority order — ranking items 1-N so the operator can see where the diagnosis points — and to address the operator perception that proposals are isolated single-actions, every rationale ends with an ordered plan:

   ```
   **תוכנית:**

   1. [הפעולה הנוכחית — מה האישור הזה עושה]
   2. [צעד הבא הצפוי — מה הסוכן יציע אם הנוכחי יאושר ויתבצע]
   3. [צעד שני הבא — אופציונלי, אם הסיפור ארוך]
   ```

   - **שלב 1** הוא תמיד ההצעה הנוכחית בלשון פעולה ("להרחיב קהל ל-broad", "להוסיף וריאנט אנכי לסטוריז").
   - **שלבים 2-3** הם צפי — מה הסוכן ימליץ הלאה תלוי בתוצאה. כתוב אותם כתנאי: "אם 7 ימים אחרי ההרחבה הניצול עדיין נמוך — להציע בדיקה של ה-objective". זה לא מחייב את הסוכן בעתיד, אבל מראה למשתמש שיש מחשבה ארוכת-טווח.
   - **אם הסיפור באמת קצר** (למשל overrun בודד, או diagnosis-only) — מותר רק שלב 1, אבל ציין: "אין צעדים נוספים מתוכננים."
   - **לעולם לא** "תוכנית: 1. לאשר את ההצעה הזו." זו טאוטולוגיה. שלב 1 חייב לתאר את הפעולה במונחים עסקיים, לא במונחי UI.

   **דוגמה — תוכנית קצרה ל-§T-1 underrun:**

   > **תוכנית:**
   >
   > 1. להרחיב את הקהל ל-broad + הרחבה אוטומטית של Meta — כדי שיהיה לה יותר ממי לבחור.
   > 2. לחזור בעוד 7 ימים: אם הניצול עלה מעל 80% — להמשיך לאבחון קריאייטיב רגיל. אם נשאר נמוך — לבדוק אם היעד של הקמפיין תואם למה שאתה רוצה למכור.
   > 3. רק אחרי שהתקציב נצרך כראוי 14 ימים, להציע הוספת קריאייטיבים חדשים.

7. **Every rationale closes with an explicit `אישור = / דחייה =` footer.** (חדש 2026-05-13 — תגובה לתסכול אופרטור שתיאר "לא ברור לי מה כפתור 'אשר' עושה ב-alert").

   הסיבה: כפתורי "אשר" / "דחה" ב-UI מוצגים ללא קונטקסט. אם הרציונל לא מסביר במפורש מה כל לחיצה גורמת, האופרטור צריך לנחש. אסור.

   **פורמט מחייב — שתי שורות בסוף הרציונל (אחרי `תוכנית:`, או במקום אם הסיפור קצר מדי לתוכנית):**

   ```
   אישור = <מה קורה בפועל אם המשתמש לוחץ "אשר" — בלשון פעולה, ספציפי, ללא מילים סתומות>.
   דחייה = <מה קורה אם המשתמש לוחץ "דחה" + מה הוא יכול לכתוב בשורת "סיבת דחייה" כדי להשפיע על הצעות עתידיות>.
   ```

   - **אם ה-task_type מבצע פעולה אמיתית** (`budget_change`, `set_kpi_target`, `publish_*`, `boost_post`, `redeploy_creative`, `new_creative`, `new_campaign`, `scale_up`, `scale_down`, `expand_audience`, `pause_campaign`, `resume_campaign`) — `אישור = ` מתאר את השינוי הקונקרטי שיתבצע (איזה שדה משתנה, מה עולה לאוויר ב-Meta, איזו מודעה נוצרת).
   - **אם ה-task_type הוא `alert` (אקנולג'מנט בלבד)** — `אישור = סוגר את ההתראה ומסמן אצלי שראית. אין שינוי אוטומטי ב-Meta או בבסיס הנתונים. הפעולה עצמה מתבצעת על ידך ב-<מקום ספציפי>.`
   - **`דחייה = `** מתאר תמיד שתי עובדות: (א) מה לא יקרה, (ב) למה כתיבה בשורת "סיבת דחייה" משמעותית (כי הסיבה נכנסת ל-`agent_decisions` ומשמשת אותי בריצות הבאות).

   **טמפלט "אישור = / דחייה =" לפי task_type — להתחיל ממנו ולא מאפס:**

   | task_type | אישור = | דחייה = |
   | --- | --- | --- |
   | `set_kpi_target` | משנה את שדה היעד (CPL/CPA/ROAS) בבסיס הנתונים. אין שינוי ב-Meta. בריצה הבאה אני אאבחן קמפיינים לפי היעד החדש. | משאיר את היעד הקיים. אם אתה רוצה ערך אחר — כתוב אותו בשורת "סיבת דחייה" ואני אחזיר הצעה מעודכנת. |
   | `publish_fb_post` / `publish_ig_post` | הפוסט עולה לאוויר על העמוד הציבורי תוך כמה דקות, עם הטקסט/תמונה המצורפים. נשאר עד שתוריד ידנית. | לא מתפרסם כלום. אם הניסוח לא טוב — כתוב מה לחדד בשורת "סיבת דחייה" ואני אחזיר ניסוח חדש בריצה הבאה. |
   | `publish_ig_story` | סטורי עולה לאוויר על חשבון אינסטגרם לטווח 24 שעות. | לא מתפרסם כלום. כתוב מה הבעיה ואני לא אציע שוב את אותו נכס. |
   | `publish_ig_reel` | ריל עולה לפיד אינסטגרם. נשאר לתמיד. | לא מתפרסם. כנ"ל. |
   | `boost_post` | פוסט אורגני קיים הופך למודעה בתשלום. מתחילים לשלם מיד. | הפוסט נשאר אורגני בלבד. |
   | `new_creative` / `redeploy_creative` | מודעה חדשה נוצרת בקמפיין במצב "מושהה" (PAUSED). אתה חייב להפעיל ידנית. | לא נוצרת מודעה. |
   | `scale_up` / `scale_down` / `budget_change` | התקציב היומי של הקמפיין משתנה ב-Meta תוך 15 דקות (Cron הביצוע הבא). | התקציב נשאר. |
   | `expand_audience` | הגדרת הקהל בקמפיין משתנה. מאפס למידה — שבעה ימים של איזון מחדש. | הקהל נשאר. |
   | `pause_campaign` / `pause_adset` / `resume_campaign` | הסטטוס משתנה ב-Meta תוך 15 דקות. | הסטטוס נשאר. |
   | `alert` (חובה) | סוגר את ההתראה ומסמן אצלי שראית. אין שינוי אוטומטי בשום מקום. הפעולה עצמה (אם יש) מתבצעת על ידך ב-\<מקום ספציפי: Meta Business Manager / עמוד "פרטי העסק" / וכו'\>. | ההתראה נסגרת כ"לא רלוונטית" / "לא מסכים". אם זיהיתי שגוי — כתוב בשורת "סיבת דחייה" ואני לא אחזיר את אותה התראה. |

8.5. **If a prior rejection exists on the same `(task_type, target_id)`, the rationale MUST acknowledge it.** (חדש 2026-05-13 PM — לולאת פידבק, הקפיצה מ-junior ל-consultant.)

   Step 1.6 ב-Flow A טוען `load_feedback_history` שמחזיר דחיות אמיתיות (לא bulk-resets) ב-90 הימים האחרונים, מקובץ לפי `(task_type, target_kind, target_id)`. אם הוא מחזיר רשומה שמתאימה להצעה שאתה עומד לכתוב — אתה חייב לבחור באחת משתי האפשרויות:

   **א. לצטט + להבדיל** — פתח את הפסקה השנייה (האנליטית, לא ה-TL;DR) במשפט כמו: _"ראיתי שדחית הצעה דומה ב-12.5 כי 'אין הסבר איזה שירות אני נותן'. הפעם הקופי ממוקד ל-service_tag X שמופיע ב-products."_ הסוכן חייב לכלול לפחות אחד מהפעלים: דחית/דחיתי/דחייה קודמת/בפעם הקודמת/הפעם שונה/השתנה. גארדריל §37 בודק את זה ב-regex.

   **ב. לדלג + לתעד** — אם אחרי שמסתכלים על הדחייה הקודמת אין דרך מהותית להבדיל את ההצעה הנוכחית, **אל תציע**. במקום זאת:
   ```bash
   python -m campaigner.tools.log_decision ... --decision-type skip \
     --rationale "respect_prior_rejection_no_meaningful_change — דחית ב-X את אותה הצעה כי Y. אין שינוי במצב שמצדיק חזרה."
   ```

   ה-`load_recent_actions_outcomes` (גם Step 1.6) משלים את התמונה — אם אתה רואה ש-`scale_up` הקודם הוריד CPL ב-18%, ציין את זה: _"ה-scale_up מ-7.5 הוריד את עלות הליד ב-18% — אני מציע scale_up דומה."_ אם הוא **העלה** CPL ב-22%, אל תחזור עליו בלי הסבר מה השתנה. אופרטור שזוכר את הניסיון הקודם מצפה שגם אתה תזכור.

   **דוגמה — pattern עברי שעובר את §37:**

   > בפעם הקודמת (12.5) דחית הצעת yedid דומה כי "אין הסבר איזה שירות אני נותן". הפעם הצעת היעד ספציפית לשירות **influencer_match** (מתוך הפרודקטים שלך), עם רצועת מחירים מצומצמת לשירות הזה: 130-180 שקל (לא הממוצע הגנרי 230 שקל ל-B2B SaaS).

   **דוגמה — pattern שנכשל ב-§37:**

   > הצעה: עדכן יעד עלות לליד מ-50 שקל ל-150 שקל. הסיבה: השוק נמצא ב-110-290 שקל.
   > (אין אזכור לדחייה הקודמת → §37 פוסל.)

8. **Every `alert` proposal MUST carry `payload.acknowledgment_only: true`.** (חדש 2026-05-13)

   הסיבה: ה-task_type `alert` הוא היחיד שאין מאחוריו קריאת Meta. כדי שה-UI ידע להראות כפתור "סגור / ראיתי" במקום "אשר / דחה" — הפילד הזה חייב להיות נוכח. אם השדה חסר על `alert` → `check_guardrails` יפסול את ההצעה (rule §33 `alert_requires_acknowledgment_only_flag`).

   ```json
   {
     "task_type": "alert",
     "payload": {
       "alert_type": "<קטגוריה_בעברית_עם_underscore>",
       "message": "<גוף ההתראה בעברית פשוטה>",
       "next_steps": ["...", "..."],
       "acknowledgment_only": true
     }
   }
   ```

   `acknowledgment_only: false` אסור על `alert` — אם יש פעולה אמיתית, השתמש ב-task_type מתאים (`set_kpi_target`, `publish_*`, וכו'), לא ב-`alert`.

### `summary` field — the one-line version

`summary` appears in queue lists and the decision feed. Rules:

- Hebrew, ≤ 70 characters.
- Pattern: `<פעולה> ל<יעד> — <סיבה בקצרה>`.
- ✅ `הרחבת קהל לקמפיין Aiweon-Leads — תקוע בלמידה 20 יום`
- ❌ `expand_audience on 120243246572990443 — CPM 128x benchmark`

Use the campaign's human name when available (not the Meta numeric ID). Use Hebrew for the reason even if the underlying metric is English.

### Worked example — the "הרחבת קהל" case

**❌ Before (jargon-first — what the UI currently shows):**

> USD 128 CPM בשבוע האחרון לעומת benchmark ישראלי USD 8.38 — יחס של פי 15. זהו סימן חד-משמעי לקהל צר מאוד שמונע מהקמפיין לצבור המרות ולצאת מ-Learning. הקמפיין פעיל 20 ימים ועדיין ב-LEARNING_LIMITED עם 5 לידים בלבד. מעבר ל-Broad Targeting עם Advantage+ Audience יוריד את ה-CPM, יגדיל את החשיפה לקהל רלוונטי, ויאפשר ל-Meta למצוא קונברטורים בעלות נמוכה יותר. CTR 2.36% מראה שהבעיה היא בגודל הקהל, לא בקריאייטיב.

Problem: an operator without ads background can't tell what this says until sentence 3. "CPM", "benchmark", "LEARNING_LIMITED", "Advantage+" all demand translation before the argument lands.

**✅ After (TL;DR-first):**

> הקמפיין עולה פי 15 מהממוצע בישראל כי הקהל צר מדי, ועדיין לא מצליח ללמוד אחרי 20 יום. מוצע להרחיב קהל כדי לאפשר ל-Meta למצוא המרות בעלות סבירה.
>
> הנתונים: CPM (עלות לאלף חשיפות) 128 USD לעומת ממוצע ישראלי 8.38 USD. הקמפיין פעיל 20 יום, 5 לידים, תקוע בלמידה (Meta state: `LEARNING_LIMITED`) — Meta לא מקבלת מספיק המרות לאופטימיזציה. CTR (אחוז הקלקות) 2.36% מראה שהקריאייטיב עצמו עובד; הבעיה בהיקף הקהל. המעבר ל-Broad Targeting עם Advantage+ Audience (הרחבת קהל אוטומטית של Meta) מרחיב את מאגר הקהל פי כמה.

Why this works:

- Paragraph 1 answers _מה / למה / מה מוצע_ without a single acronym — the operator can approve or reject here.
- Paragraph 2 has the numbers an expert can validate, with acronyms glossed on first use.
- Action is linked to diagnosis (הקהל צר → הרחבה), not to symptom (CPM גבוה → הרחבה).

### When to break these rules

Never. This is the operator's daily interface — consistency beats cleverness. If the TL;DR is hard to write because the signal is ambiguous, that's a data-sufficiency issue — log a `skip` decision per [performance-brain §6.4](performance-brain.md#64-data-sufficiency) instead of forcing a weak proposal.

---

## 12. Organic content copy (Phase 3 — page management)

עד עכשיו הקובץ עסק ב-ad copy שבכרטיסיה ממומנת. ב-Phase 3 הסוכן מנהל גם פוסטים אורגניים, סטוריז ו-Reels בפייסבוק ובאינסטגרם. כל ערוץ הוא קונטקסט שונה — קופי שעובד ב-ad לא בהכרח עובד ב-feed אורגני.

### עקרון מנחה

**ad copy = שכנוע ב-3 שניות. organic copy = שיחה.** ב-ad המטרה היא שמישהו ילחץ. ב-organic המטרה היא שמישהו ירגיש שהמותג שלנו חי, שייך, מדבר אליו. הירידה ב"מאמץ שכנועי" מותרת ומבורכת — אבל אסור שתהפוך ל-bland.

### לפי ערוץ

**Facebook Page post (feed):**
- אורך: 60-200 מילים לפוסט עם תמונה. פוסט טקסט בלבד עד 60 מילים — מעבר לכך FB מקצץ אותו.
- שורה ראשונה לוכדת. אם המשתמש בארור-נייד רואה רק את התקציר — שיהיה משפט אחד שמעמיד את ההקשר.
- ללא hashtags ב-FB. הם לא עוזרים לחשיפה ונראים זרים בעמוד מותג ישראלי.
- ללא CTA buttons (זה ad concept). לקריאה לפעולה — link במקום או "התגובות פתוחות".

**Instagram feed post (image / carousel):**
- אורך: 80-150 מילים. רוב הקריאה נחתכת אחרי "...more"; שורה 1-2 חייבות לעמוד לבד.
- Hashtags: 3-7 רלוונטיים ב-IL (לא 30 כמו ב-US). שילוב של רחב (#שיווק_דיגיטלי) וצר (#influencer_marketing_il). חוסכים מקום בכוונה.
- Emoji: 1-2 לפסקה לכל היותר. בכוונה לא להתפזר.
- אם זה carousel: ה-caption מסביר את הסיפור הכולל; כל סלייד מספר חלק. אל תחזור על הסיפור בכל סלייד.

**Instagram story:**
- **אין קופי שנשלח ל-API.** סטורי הוא visual-first. הטקסט נכנס בעריכה ב-app, לא דרך Graph.
- מה כן עושים: ה-`image_url` או `video_url` שמועלה כבר מכיל את הטקסט גרפית כשרלוונטי (החלטה של מי שיצר את הקריאייטיב, לא של זה שמפרסם).
- אם יש headline סוגסטיבי בגלריה — להעביר אותו ל-payload לתיעוד פנימי, לא ל-API.

**Instagram Reel:**
- Caption: 50-100 מילים. שורה 1 = hook חזק (שאלה, declaration, contradiction). שורה 2 משלימה. השאר רץ אחרי "...more".
- Hashtags: 3-5. סופר ספציפיים לסרטון.
- אין emoji מיותרים — Reels זה video-first; ה-caption משלים, לא מתחרה.
- CTA: רך. "ספרו בתגובות..." / "שמרו לכשתצטרכו". אסור "לחצו על הקישור" (Reels אין link rendering).

### Voice mapping מ-business_knowledge

הסוכן קורא `business_knowledge.brand_voice` לפני שכותב organic copy. ל-Aiweon (influencer marketing platform, B2B):
- **לא:** סופרלטיבים, האשטגים אגרסיביים, אמוג'יז של חגיגה.
- **כן:** practical, evidence-backed, אומר את מה שכל marketer באמת חושב אבל לא אומר בקול.
- **טון בפוסט אורגני:** "אנחנו לומדים בקול רם." טיפים, observations מ-campaigns אמיתיים (אנונימיים), ביקורת על שטיקים שלא עובדים.

### מקור לתמונה / וידאו

הסוכן מושך מ-`creative_gallery` קודם. אם אין נכס מתאים — מציע `generate_creative` ב-approval נפרד, ממתין לאישור + הפקה, ורק אז יוצר את ה-`publish_*` approval. אסור לפרסם approval עם `image_url` שמצביע על נכס שעוד לא קיים.

### Hard constraints — organic-specific

הסוכן חייב לעבור בלעדם לפני שולח `publish_*` approval:

1. **אורך תקין לערוץ** (טבלה למעלה). חורג → תקצר.
2. **אין hashtags ב-FB; יש 3-7 ב-IG feed; 3-5 ב-Reels; 0 בסטורי.**
3. **emoji ≤ 2 לפסקה. אסור באלכסון אם זה לא מוסיף משמעות.**
4. **שורה 1 חייבת לעמוד לבד** (כי IG חותך אחרי 80 תווים, FB אחרי קצת יותר).
5. **אם זה IG carousel** — caption מתאר את ה-overall, לא חוזר על מה שמופיע על כל סלייד.
6. **אסור CTA buttons** באורגני — זה ad-concept.
7. **קישורים בלבד ב-FB**. ב-IG feed/Reel: לינק בביו (אל תכתוב "לחצו על הלינק בביו" יותר מפעם בחודש).
8. **שמירה על voice** מ-`business_knowledge.brand_voice` ומ-§1-§2 כאן. ספאמית-תחושה → לדחות עצמית.

---

## 10. Update protocol

**Owner:** Roi (admin@aiweon.co.il).

**Iteration triggers:**

- Phase 2 first creative batch shows systematic issues (e.g., Claude keeps producing a pattern Roi flags as off).
- A creative variant underperforms 2 consecutive weeks and voice contribution is suspected.
- Aiweon team requests a voice shift (new positioning, new audience segment).

**Edit discipline:**

- Small lexicon adds (1-2 words) → Roi edits directly, no approval loop.
- Structural rewrites (§2 dimensions, §5-6 rules) → open a new session, diff the change in `docs/plans/decisions-log.md` as an amendment to §1.5.

**Version marker:** update the date at the top of this file on every non-trivial edit.
