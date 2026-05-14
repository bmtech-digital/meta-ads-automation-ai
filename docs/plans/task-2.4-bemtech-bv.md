# Task 2.4 — Bemtech Business Verification (Guidance)

> **Prereq:** [decisions-log §1.2](decisions-log.md#12-meta-business-verification--timing) ✅ — hybrid: BV מתחיל Phase 0 במקביל, תשתית dual-mode (`businesses.meta_auth_mode`).
>
> **Companion file:** [`bemtech-bv-requirements.md`](bemtech-bv-requirements.md) — רשימת המסמכים שצריך לאסוף. הפרד כדי שיהיה לך checklist שאפשר להשתמש בו כשמכינים את התיק.
>
> **Output של המשימה:** חבילת BV מוגשת ב-Business Manager, מסמכים מגובים. מה שכתוב כאן הוא המסלול — לא קוד. **הגשה עצמה נשארת אצלך** (Roi).
>
> **לא חוסם Phase 1** — רץ במקביל לפיתוח. צפוי להסתיים בזמן Phase 2-3.

---

## 1. למה Bemtech BV (ולא Aiweon BV)

1. **MVP עובד מהיום** על User Token של משתמש עם גישה ל-`act_202495959` (dev) ול-ad account של Aiweon בעתיד. לא חוסם פיתוח.
2. **BV של Bemtech** (ולא של Aiweon) כי:
   - Bemtech היא בעלת ה-Business Manager שמארח את ה-app `Campaigner by Aiweon`.
   - אחרי BV מאושר → ניתן להפיק **System User Token** — טוקן ללא expiry, מחליף את ה-rotation של 60 יום.
   - **Bemtech BV הוא prereq ל-Tech Provider status** — נדרש ל-v2 כדי להציע את Campaigner ללקוחות ללא BV של הלקוח.
3. **Aiweon BV** — לא נדרש ל-MVP. אם Aiweon רוצה להגיש BV נפרד בעתיד — זה path נפרד, לא חלק מ-2.4.

ראה [decisions-log §1.2](decisions-log.md#12-meta-business-verification--timing) להקשר מלא.

---

## 2. Prerequisites — Business Manager ready

לפני שמתחילים BV, ה-Business Manager של Bemtech חייב להיות מוגדר נכון. אם עוד לא הוקם / חסר דברים — צריך לתקן קודם.

### 2.1 BM exists

- [ ] Business Manager של Bemtech קיים ב-[business.facebook.com](https://business.facebook.com).
- [ ] אם לא: יוצרים חדש → "Create Account" בפינה הימנית → מזינים שם עסק + שם מלא + אימייל עבודה.
- [ ] BM ID נרשם כאן: `[TBD — מופיע ב-Business Settings → Business Info, 15 ספרות]`

### 2.2 Business Info מוגדר

ב-Business Settings → Business Info, שדות אלה חייבים להיות מוגדרים ו**להתאים בדיוק** למסמכים שתעלו:

- [ ] **Legal business name** — בדיוק כפי שכתוב ב-תעודת התאגדות (כולל "בע"מ" אם רלוונטי; שמירה על עברית/אנגלית כמו במסמך המקור).
- [ ] **Business address** — זהה לכתובת שמופיעה ב-נסח החברה או ב-תעודת עוסק, **וגם** לכתובת בחשבונית תשתית שתעלו.
- [ ] **Business phone** — מספר שניתן לקבל שיחות עליו. Meta יכולה להתקשר/לשלוח SMS לאימות.
- [ ] **Business email** — אימייל עסקי, לא gmail אישי. אידיאלי `admin@bemtech.co.il` או דומה.
- [ ] **Business website** — URL של אתר אמיתי (לא בפיתוח). Meta בודקת שהאתר מקשר חזרה לעסק.

### 2.3 Assets Claimed

- [ ] Ad account `act_1390480923117690` מקושר ל-BM (Business Settings → Accounts → Ad Accounts).
- [ ] ה-Facebook Page של Aiweon (או Bemtech) מקושר ל-BM (Business Settings → Accounts → Pages).
- [ ] Pixel מקושר אם יש (Business Settings → Data Sources → Pixels).
- [ ] App `Campaigner by Aiweon` (כש-Roi יוצר אותו ב-2.2) יקושר ל-BM (Business Settings → Accounts → Apps).

**הערה:** חלק מה-verification מאמת Cross-consistency בין ה-assets. אם Ad Account ב-BM אחר ובדיוק "שם של חברה אחרת" — זה flag.

---

## 3. תהליך ההגשה

### 3.1 נקודת הכניסה

Business Settings → **Security Center** → **Business Verification** → "Start Verification".

### 3.2 שלבי הטופס

Meta מציגה ~5 מסכים:

**מסך 1 — Business details**

- Legal business name (אוטומטי מ-Business Info; לאמת שזה מדויק)
- Company registration number (`ח.פ` לחברה בע"מ, `ע.מ` לעוסק מורשה)
- Country: Israel
- Business address (אוטומטי מ-Business Info)
- Date of incorporation (תאריך התאגדות)

**מסך 2 — Document upload (1 of 2)**

- העלאת **מסמך אחד** מהקטגוריה "Legal entity proof":
  - חברה בע"מ: תעודת התאגדות **או** נסח חברה עדכני (<6 חודשים)
  - עוסק מורשה: תעודת עוסק מורשה **או** אישור ניהול ספרים
- פורמטים מקובלים: PDF, JPG, PNG. <8MB, קריא, כל הדף נראה.

**מסך 3 — Document upload (2 of 2)**

- העלאת **מסמך שני** מהקטגוריה "Address proof":
  - חשבונית ארנונה / חשמל / מים / אינטרנט (<3 חודשים)
  - **או** אישור בנק (<3 חודשים) — חשבון עסקי, לא אישי
  - **או** הסכם שכירות רשמי חתום

**מסך 4 — Phone / email verification**

- Meta שולחת SMS/call למספר הטלפון שמצוין ב-Business Info. צריך לקבל ולהזין את הקוד.
- לפעמים גם verification code לאימייל.

**מסך 5 — Review & Submit**

- בדיקה סופית של כל השדות.
- Submit → החבילה עוברת לתור ה-review של Meta.

### 3.3 זמני המתנה

- **Baseline:** 1-2 שבועות.
- **אם Meta מבקשת הבהרה:** + עוד 1-2 שבועות לכל סיבוב.
- **Worst-case מעשי:** 4-6 שבועות, במיוחד אם יש אי-התאמה קטנה בין מסמכים.

---

## 4. מה לעשות אחרי Submit

### 4.1 במהלך ה-review

- [ ] לא לשנות שום דבר ב-Business Info (שם, כתובת, טלפון) — כל שינוי מבטל את ה-verification הנוכחי.
- [ ] לא ליצור/למחוק assets ב-BM אם אפשר להימנע.
- [ ] לעקוב אחרי אימיילים ל-admin@bemtech.co.il (או האימייל שהגדרת ב-Business Info). הודעות חשובות מ-Meta לא תמיד מגיעות ל-inbox ראשי — לבדוק Spam/Promotions.
- [ ] יכולה להגיע שיחת טלפון או SMS נוספים לאימות משני.

### 4.2 אם יש Clarification request

Meta בדרך כלל כותבת: _"We need additional information to complete your verification"_. ה-request מופיע גם ב-Security Center.

**כללי ברזל:**

- **לענות בתוך ה-thread הקיים**, לא לפתוח submission חדש (= reset של ה-clock).
- לקרוא לאט — רוב ה-clarifications הם אחד מהדברים ב-§5 (pitfalls).
- להעלות מסמך משופר (scan טוב יותר, מסמך עדכני יותר, כתובת תואמת).

### 4.3 אם approved ✅

זה המקום שבו ה-spec/PRD מסתעף — **infrastructure side** של Campaigner מתעדכן:

- [ ] יצירת **System User** ב-Business Settings → System Users → Add → Admin.
- [ ] שיוך הרשאות ל-System User — Assigned Assets → Ad Account `act_...` → "Manage campaigns" access.
- [ ] Generate Access Token → לבחור את ה-app `Campaigner by Aiweon` → לבחור scopes: `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `instagram_basic` → Generate.
- [ ] **הטוקן אין לו expiry.** לשמור ב-Google Secret Manager כ-`meta-token-aiweon-system-user` (ראה [decisions-log §1.1](decisions-log.md#11-secret-management--google-secret-manager) לשמות).
- [ ] לעדכן ב-DB: `businesses.meta_auth_mode = 'system_user_token'` עבור השורה של Aiweon.
- [ ] לעדכן ב-runner (כש-Phase 0 של Secret Manager יהיה חי): לשלוף `meta-token-aiweon-system-user` במקום `meta-token-aiweon`.
- [ ] **לבטל** את ה-reminder של rotation כל 60 יום (יומן / heartbeats alert).

### 4.4 אם rejected ❌

- לקרוא את הסיבה. רוב הדחיות נופלות על §5 (pitfalls).
- לתקן את הבעיה. לא לנסות להגיש שוב מיד — לפעמים צריך לעדכן את Business Info לפני שהטופס בכלל נפתח מחדש.
- אפשר להגיש שוב — אין סנקציה על מספר ניסיונות.

---

## 5. הסיכונים הנפוצים (ה-pitfalls של BV ישראלי)

| #   | סיכון                                      | איך נראה בפועל                                                                                | איך להימנע                                                                                                                  |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | **אי-התאמת שם**                            | "בעמטק בע"מ" ב-תעודת התאגדות, "Bemtech Ltd." ב-BM, "בעמטק" בנסח עדכני                         | להעתיק את השם מ-תעודת התאגדות **מילה במילה** ל-Business Info. אם יש גרסה אנגלית רשמית ברשם — להשתמש בה; אחרת להיצמד לעברית. |
| 2   | **אי-התאמת כתובת**                         | רשומה ב-רשם: "רחוב הרצל 1, תל-אביב". ב-BM: "הרצל 1 ת״א". בחשבונית ארנונה: "הרצל 1 ת״א 61000". | להעתיק מהמסמך הרשמי העדכני ביותר (רגיל נסח חברה). לוודא שאותו format מופיע בכל 3.                                           |
| 3   | **מסמכים שפג תוקפם**                       | נסח חברה מ-2024 (מעל שנה) נדחה                                                                | נסח עדכני של <6 חודשים; חשבונית תשתית <3 חודשים.                                                                            |
| 4   | **איכות scan ירודה**                       | צילום של מסך, חתוך, מטושטש                                                                    | סריקה אמיתית 300dpi, PDF אם אפשר, כל המסמך בפריים.                                                                          |
| 5   | **חשבונית על שם אחר**                      | חוזה שכירות על שם הבעלים הפרטי, לא על שם החברה                                                | צריך חשבונית על שם **הישות המשפטית** שמגישים בשמה. אם לא אפשר — מכתב רשמי ממשכיר עם חתימה.                                  |
| 6   | **טלפון לא מגיב**                          | Meta מתקשרת → שיחה מוחמצת → ה-verification נתקע                                               | להחזיק את הטלפון פתוח במשך 48 שעות אחרי submit. לוודא שה-voicemail פועל.                                                    |
| 7   | **אתר לא חי / לא מקשר לעסק**               | `bemtech.co.il` מחזיר 404, או מציג מוצר אחר                                                   | לוודא שהאתר עולה, ושיש בו שם העסק + פרטי קשר שתואמים ל-BM.                                                                  |
| 8   | **הגשת submission חדש במקום לענות inline** | מגיעה בקשת clarification, Roi פותח submission חדש → clock מתאפס                               | תמיד לענות בתוך ה-thread הקיים ב-Security Center.                                                                           |

---

## 6. Tech Provider — v2 enabler (deferred)

לאחר ש-BV מאושר, אפשר להגיש בקשת **Tech Provider** ב-Meta (program נפרד, לא חלק מ-2.4).

- **Timeline:** 2-4 שבועות נוספים אחרי BV.
- **Purpose:** מאפשר לפלטפורמה (Campaigner) לנהל ad accounts של לקוחות צד-שלישי **בלי** שכל לקוח יצטרך BV משלו. זה המסלול המהיר של v2 ("מסלול מהיר" מ-[§1.2](decisions-log.md#12-meta-business-verification--timing)).
- **Requirement:** BV של Bemtech מאושר + App Review של `Campaigner by Aiweon` מאושר (= task 2.2 נגמר בפועל).
- **לא חלק מ-2.4 scope.** שיחה עתידית ב-conversation-map של v2.

מקורות:

- [Meta Tech Provider program docs](https://developers.facebook.com/docs/development/tech-providers)

---

## 7. Scope של 2.4 — מה סוגר / מה לא סוגר

**סוגר ✅:**

- **Roi אוסף את המסמכים** לפי [`bemtech-bv-requirements.md`](bemtech-bv-requirements.md).
- **Roi מוודא ש-Business Manager מוכן** (§2 לעיל).
- **Roi מגיש** את ה-BV ב-Security Center.
- **Roi מטפל ב-clarifications** אם יש.
- **Meta מאשרת.**
- **Infrastructure flip** (§4.3) — יצירת System User Token + עדכון `businesses.meta_auth_mode` + העלאה ל-Secret Manager. זה task קטן (~2 שעות) שנעשה מיד אחרי האישור.

**לא סוגר (לא בסקופ 2.4):**

- Tech Provider application — deferred ל-v2.
- App Review של `Campaigner by Aiweon` — task 2.2 (track נפרד, לא תלוי ב-BV).
- Aiweon BV — אם בעתיד יוחלט שנדרש (לא כרגע).

---

## 8. קישורים רלוונטיים

- [`bemtech-bv-requirements.md`](bemtech-bv-requirements.md) — רשימת מסמכים
- [decisions-log §1.2](decisions-log.md#12-meta-business-verification--timing) — החלטה + הקשר
- [Business Manager](https://business.facebook.com/settings) — הכתובת שאליה Roi נכנס
- [Meta Business Help — Verify your business](https://www.facebook.com/business/help/2058515294227817)
- [Meta Tech Provider program](https://developers.facebook.com/docs/development/tech-providers) — deferred ל-v2
