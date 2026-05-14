# Campaigner — Decisions Log

> **מטרה:** תיעוד של כל החלטה סגורה מ-`conversation-map.md`. כל ערך כולל: מה ההתלבטות, מה הוחלט, למה, ואילו שינויים בקבצים נעשו בעקבות ההחלטה.
>
> **למי זה:** ל-Roi לחזור אחורה, ול-Claude / מפתח חיצוני שנכנס לפרויקט אחרי דילוג כדי לקלוט את הקונטקסט בלי לקרוא את כל השיחות.
>
> **איך לקרוא:** כל ערך עומד בזכות עצמו. אם חזרת לאחור כי ההחלטה צריכה שינוי — עדכן במקום (וסמן ב-`conversation-map.md` שהפריט חזר להיות 🟡).

---

## 1.1 Secret management — Google Secret Manager

**סטטוס:** ✅ סגור 2026-04-19
**Owner:** Roi
**Scope:** `ANTHROPIC_API_KEY`, `META_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`. לא כולל `BUSINESS_ID` (לא secret).

### ההתלבטות

- **Spec §21 + §11.8** אמרו Google Secret Manager, עם runner שפותח ב-`gcloud secrets versions access latest`.
- **Backend PRD §3 + §4.4** אמרו `.env.production` mounted on Cloud Run Job, נכתב בזמן deploy ע"י `gcloud run jobs update --env-vars-file`.
- ה-PRD הכיר ב-tradeoff במפורש: _".env on-instance is simpler than Secret Manager but means a compromised Cloud Run service exposes all three tokens."_

### ההחלטה

**Google Secret Manager ל-production. `.env` מקומי נשאר ל-dev בלבד.**

### הנימוקים (בסדר יורד של חשיבות)

1. **Rotation path נקי יותר.** META_ACCESS_TOKEN מתחלף כל ~60 יום. עם `.env` כל rotation = redeploy של ה-Cloud Run Job. עם Secret Manager — `gcloud secrets versions add`, וה-tick הבא של ה-cron (תוך ≤15 דק') שולף אוטומטית. אפס downtime.
2. **Audit trail חינם.** Meta token יכול לשרוף תקציב אמיתי; service_role עוקף RLS. Cloud Audit Logs רושם כל `gcloud secrets versions access` — יש baseline (3 קריאות לכל cron tick) שאפשר להשוות אליו. עם `.env` אין log כזה.
3. **אין קובץ secrets פיזי מחוץ ל-GCP.** `.env.production` חי איפשהו (מחשב מקומי, CI). Secret Manager מעביר הכל פנימה ל-GCP — אין סיכון git-ignore שנשבר / backup לא מוצפן / CI logs.

**המחיר:** ~30 דקות setup חד-פעמי (3 secrets, service account, IAM bindings).

### dev-local

`.env` בתיקיית הפרויקט, ב-`.gitignore`. סיבות:

- dev משתמש ממילא בערכים אחרים (ad account `act_202495959`, ולא Bemtech production).
- ה-rotation של 60 יום לא חל על ה-dev token באותו קצב.
- network-hop ל-GCP בכל הרצה ידנית של כלי = חיכוך פיתוח.

`.env.example` (שמות בלי ערכים) כן בגיט.
Python tools: `os.getenv(...)` זהה ב-prod וב-dev. `python-dotenv` נטען כשיש קובץ `.env`.

### שמות ה-secrets ב-GCP

| שם ב-Secret Manager | ערך                        |
| ------------------- | -------------------------- |
| `anthropic-api-key` | `sk-ant-...`               |
| `meta-token-aiweon` | Meta long-lived user token |
| `supabase-sr`       | Supabase service_role key  |

### שמות ה-service account

`campaigner-runner@bemtech-478413.iam.gserviceaccount.com` — ייעודי, לא default compute SA. מקבל `roles/secretmanager.secretAccessor` על כל אחד מ-3 ה-secrets בנפרד (לא project-wide).

### קבצים שהשתנו

1. [`docs/plans/campaigner-backend-prd.md`](campaigner-backend-prd.md):
   - **§2.1 CLI table, שורת `rotate-token`** — המנגנון עבר מ-`gcloud run jobs update` ל-`gcloud secrets versions add meta-token-aiweon`. אין יותר redeploy בזמן rotation.
   - **§3 Integration Points table (3 שורות: Anthropic, Meta, Supabase)** — ציון מפורש שה-secret מגיע מ-Secret Manager, נשלף בתחילת כל invocation.
   - **§4.4 Security & Privacy** — הוחלפה הפסקה של `.env` בפסקאות מפורטות: Secrets (production), Runtime access pattern, IAM, Audit trail, Log redaction, Blast-radius, Dev-local, Supabase service_role.
   - **§5 Phase 0 checklist** — עודכן פריט Anthropic key; נוסף פריט "Secret Manager + service account setup" (~30 דק') עם 5 sub-tasks.

2. [`docs/plans/campaigner-spec.md`](campaigner-spec.md): לא שונה — כבר מסכים עם ההחלטה (ראה §21 tech stack ו-§11.8 runner example).

3. [`CLAUDE.md`](../../CLAUDE.md): לא שונה — אין בו התייחסות לאופן אחסון ה-secrets, רק לשמות המשתנים.

### מה נשאר פתוח (depends on)

- **Phase 0 execution:** ה-setup עצמו (יצירת 3 ה-secrets + service account + IAM bindings + enable audit logs). תוכנן שיקרה לפני כתיבת הקוד הראשון של `runners/*.sh`.
- **ℹ️ תלות עם 1.2 (Business Verification timing):** ברגע שתושלם Business Verification ויהיה System User Token, ה-rotation של Meta token יכול להיעלם לגמרי. עד אז — ה-Secret Manager הוא האמצעי לסיבוב הטוקן כל 60 יום.

---

## 1.2 Meta Business Verification — timing

**סטטוס:** ✅ סגור 2026-04-19
**Owner:** Roi
**Scope:** רק timing של BV של Bemtech. לא כולל BV של לקוחות עתידיים (שיחת v2), לא כולל ההגשה עצמה (משימת אדמין 2.4).

### ההתלבטות

- **Backend PRD §5** הגדיר את ה-BV כ-"Phase 6 lever, not a Phase 0 blocker" — כלומר לחיות עם manual rotation של 60 יום עד סוף התהליך.
- **האלטרנטיבה:** להתחיל את ההכנה כבר ב-Phase 0 במקביל לפיתוח, כך שה-BV יאושר לפני go-live.
- ה-tradeoff הזוהה:
  - דחיה → פחות admin work עכשיו, אבל rotation ידני לנצח (לפחות עד שמישהו יזכר לסדר).
  - התחלה עכשיו → חודש מסמכים + 1-2 שבועות Meta review, אבל רץ במקביל לפיתוח ומחסל קטגוריית סיכון שלמה.

### ההחלטה

**Hybrid — מתחילים הכנת BV ב-Phase 0, ממשיכים לפתח במקביל, חיים עם rotation עד שה-BV מאושר. התשתית נבנית כ-dual-mode מראש.**

### הנימוקים (בסדר יורד של חשיבות)

1. **הזמן של BV רץ במקביל לפיתוח.** חודש הכנת מסמכים + 1-2 שבועות Meta = ~5-6 שבועות. זה קצר יותר מ-Phase 1+2+3, אז אין עלות בלוח זמנים.
2. **מחסל סיכון ש-PRD עצמו מסמן "High / Full agent outage".** שכחת rotation = הסוכן מת. טוקן יציב מעלים את הסיכון.
3. **תשתית dual-mode פותחת את v2 למוצר שוק.** הכוונה ל-v2 היא לתת ללקוחות שתי בחירות:
   - מסלול מהיר — User Token עם rotation (מתחילים מיד, ללא בירוקרטיה של הלקוח)
   - מסלול יציב — BV של הלקוח + System User Token (לוקח שבועיים להתחיל, יציב לנצח)
   - זה דורש שהתשתית תומכת בשני המסלולים **מההתחלה**, לא ש-rotation יהיה workaround זמני שמוסר.
4. **Bemtech BV הוא prereq ל-Tech Provider status של Meta** — שנדרש ל-v2 כדי להציע את המסלול "בלי BV של הלקוח". לא מסתדר להשאיר לסוף.
5. **ה-`campaigner rotate-token` CLI הופך ל-feature מלא ולא ל-one-shot.** זה טוב — נדרש ל-MVP ונשאר רלוונטי ל-v2.

### תכולת ההחלטה

- **Bemtech BV:** הכנת מסמכים מתחילה Phase 0. הגשה כשמוכן. צפוי להשלים בזמן Phase 2-3.
- **MVP מתחיל על User Token** (המצב הנוכחי) עם rotation כל 60 יום.
- **אחרי אישור BV:** Bemtech עוברת ל-System User Token. ה-rotation נשאר במערכת ל-v2.
- **תשתית dual-mode:** הסכמה תומכת בשני סוגי auth; כלים קוראים `businesses.meta_auth_mode` ומתנהגים בהתאם.

### קבצים שהשתנו

1. [`docs/plans/campaigner-backend-prd.md`](campaigner-backend-prd.md):
   - **§3 Integration Points** — שורת Meta Marketing API עברה מ-"Future plan: System User Token" לניסוח dual-mode מפורש. שני המסלולים first-class.
   - **§5 Phase 0 checklist** — פריט BV עבר מ-"Phase 6 lever, not a Phase 0 blocker" ל-"Document prep begins Phase 0 in parallel with dev".
   - **§5 Technical Risks** — שורת token expiry עודכנה לשקף ש-BV רץ במקביל, rotation נשאר load-bearing בגשר ובעתיד v2.

2. [`docs/plans/conversation-map.md`](conversation-map.md):
   - 1.2 סומן ✅ עם קישור לכאן.
   - **נוסף task 2.4** — "הגשת BV של Bemtech" (קבוצה 2, משימה אדמינסטרטיבית, prereq: 1.2 סגור).
   - עדכון סעיף "סטטוס נוכחי".

3. [`CLAUDE.md`](../../CLAUDE.md): לא שונה — אין התייחסות למנגנון auth ספציפי.

4. [`docs/plans/campaigner-spec.md`](campaigner-spec.md): לא שונה — הסולם של Meta ב-§1302-1310 כבר מתאר את המצב נכון. הוספת שדה `businesses.meta_auth_mode` תיקרה כשכותבים את migration 001 (משימה 4.1).

### מה נשאר פתוח (depends on)

- **2.4 הגשת BV (task אדמין):** איסוף מסמכים של Bemtech (ח.פ, רישום חברה, אישור בנק), הקמת Business Manager אם לא קיים, הגשה. זמן הכנה ~חודש. לא חוסם את הפיתוח.
- **migration 001 (businesses table):** הוספת שדה `meta_auth_mode text not null default 'user_token' check (meta_auth_mode in ('user_token', 'system_user_token'))`. יש לעשות בתוך 4.1.
- **`campaigner rotate-token` CLI:** יידרש להיות production-grade — load-bearing לפחות עד אישור BV, וגם ל-v2 מסלול מהיר.
- **Calendar reminder ב-50 יום:** צריך להיות ממוכן (לא "אני אזכור"). אפשרויות: `heartbeats` table מוסיף alert אוטומטי לפי `token_expiry_date`, או reminder ידני ביומן Google. נחליט בעת בניית ה-`rotate-token`.

### דגש ל-v2 (מחוץ ל-scope של 1.2 אבל נגזר ממנה)

כש-v2 יגיע (= ad account שני), יהיה צריך להכריע על **onboarding policy ללקוחות**:

- האם להפוך BV של הלקוח לחובה?
- אם לא — איך מטפלים במסלול User Token rotation מצד הלקוח? (web UI ל-refresh, reminder במייל, וכד')
- זו שיחה חדשה במפת השיחות של v2, לא כאן.

---

## 1.3 Meta App Review — bundle vs serial

**סטטוס:** ✅ סגור 2026-04-19
**Owner:** Roi
**Scope:** בחירת אסטרטגיית הגשת ה-App Review + תכולת החבילה. לא כולל ההגשה עצמה (משימת אדמין 2.2) ולא `whatsapp_business_management` (v2).

### ההתלבטות

- **Backend PRD §5 open question 4** ניסח את ההתלבטות: "Bundle all at once unless there's a specific reason not to" — כלומר נטיה לא-מפורשת ל-bundle, לא החלטה.
- האלטרנטיבה: serial — להגיש את `ads_management` (הקריטי) לבד, ואז wave שני עם השאר.
- הטריגר להתלבטות: serial מקטין blast-radius של rejection, אבל מכפיל את זמן הקלנדר של 2-4 שבועות.

### ההחלטה

**Bundle. הגשה אחת של כל שש ההרשאות יחד: `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `instagram_basic`. `whatsapp_business_management` לא נכלל (v2).**

### הנימוקים (בסדר יורד של חשיבות)

1. **Serial מכפיל זמן קלנדרי ללא תועלת פונקציונלית.** 2-4 שבועות × 2 גלים = עד 8 שבועות; 3 גלים = עד 12. Phase 0 כבר רץ במקביל ל-BV (1.2), אין טעם להאריך עוד.
2. **Wave 1 עם `ads_management` בלבד לא מייצר מודעה אמיתית.** מודעה דורשת גם `pages_read_engagement` לפרסום creative שמתייחס ל-Page, וגם `instagram_basic` ל-Advantage+ Placements (ש-CAMPAIGN_BUILDING_RECOMMENDATIONS מחייב). לכן wave 1 יתן "Advanced Access" שאינו מאפשר להריץ קמפיין מלא עד wave 2 — רווח זמן מדומה.
3. **Video demo אחד מכסה את כל ה-surface.** זרימה אחת של 3 דקות מדגימה fetch (ads_read) → proposal → approval/execute (ads_management) → heartbeat context (business_management + pages_show_list) → fatigue (pages_read_engagement) → IG preview (instagram_basic). פיצול = וידאו חלקי לכל גל + confusion ל-reviewer.
4. **סיכון "one rejected = all blocked" מנוהל ב-reality.** Meta בדרך כלל מבקש clarification inline באותו submission thread, לא דוחה את הכל. ההשפעה של בעיה בהרשאה אחת מוגבלת לזמן תיקון בתוך אותו הגל, לא דחיית הגל כולו.

### תכולת ההגשה

| #   | Permission              | תכלית עיקרית                                                 |
| --- | ----------------------- | ------------------------------------------------------------ |
| 1   | `ads_management`        | יצירה/עדכון/השהיה/תקציב של קמפיינים לאחר אישור אנושי         |
| 2   | `ads_read`              | קריאת insights יומיים ל-observe-propose loop ולזיהוי fatigue |
| 3   | `business_management`   | אימות Business Manager ↔ ad account/page/pixel (guardrail)   |
| 4   | `pages_show_list`       | אימות שה-page_id המוגדר נגיש ב-Business (heartbeat)          |
| 5   | `pages_read_engagement` | קריאת engagement trends ל-creative fatigue detection         |
| 6   | `instagram_basic`       | אימות לינקאז' IG ל-Advantage+ Placements מלא                 |

### Deliverable של השיחה

[`docs/plans/meta-app-review-submission.md`](meta-app-review-submission.md) — טיוטה מלאה באנגלית הכוללת:

- App overview narrative משותף
- Use-case מלא לכל אחת מ-6 ההרשאות (purpose, flow, data accessed, justification, video timestamp)
- תסריט video demo אחד של ~3 דקות
- רשימת מסמכי תמיכה (Privacy, Data Deletion, Data Usage)
- Submission checklist
- טבלת סיכונים ידועים

### Placeholders שנותרו לסגור ב-task 2.2

שלושה `[TBD]` ב-§2 של מסמך ההגשה:

- **App name** — האם לשנות שם לאפליקציה הקיימת (Meta App ID `3175000345993024`, שירש מה-fork הברזילאי), או ליצור אפליקציה חדשה "Campaigner by Aiweon". ההמלצה: ליצור חדשה — האפליקציה הקיימת נושאת היסטוריה לא-רלוונטית שיכולה לפגוע ב-review.
- **Privacy Policy URL** — דומיין `aiweon.co.il` קיים, אבל URL ספציפי ל-privacy לא אותר בקוד. צריך או להשתמש בקיים / לפרסם דף חדש.
- **Data Deletion URL או instructions** — לא קיים; צריך או להקים endpoint / לתעד mailto process.

### קבצים שהשתנו

1. [`docs/plans/meta-app-review-submission.md`](meta-app-review-submission.md) — **נוצר חדש**. Deliverable המרכזי של השיחה.
2. [`docs/plans/decisions-log.md`](decisions-log.md): נוסף הערך הזה (§1.3).
3. [`docs/plans/conversation-map.md`](conversation-map.md): 1.3 סומן ✅ + עדכון "סטטוס נוכחי".
4. [`docs/plans/campaigner-backend-prd.md`](campaigner-backend-prd.md): §5 Open questions — פריט 4 סומן כנסגר עם הפניה כאן.

ה-spec והקוד לא השתנו (אין קוד לממש; ההחלטה היא אדמיניסטרטיבית).

### מה נשאר פתוח (depends on)

- **2.2 הגשת Meta App Review (task אדמין):** בניית 3 ה-URL-ים (Privacy, Data Deletion, Terms), יצירה/שינוי-שם של אפליקציית Meta, הקלטת video, הגשה. זמן הכנה ~שבוע + 2-4 שבועות Meta review. לא חוסם את הפיתוח של Phase 1 (שמתבצע על dev token + test account `act_202495959` שלא דורש App Review).
- **App Review ו-BV הם מסלולים נפרדים** אצל Meta. App Review יכול להתחיל עכשיו ללא קשר לסטטוס ה-BV. רק System User Token (1.2 dual-mode) דורש BV מאושר.
- **החלטת App name:** אם מעדיפים ליצור app חדש — זה מייצר Meta App ID חדש, מה שמחייב לעדכן את `META_APP_ID` בסביבת dev וב-Secret Manager (production כשיוקם). החלטה נגזרת שתיסגר בתחילת 2.2.

---

## 1.4 Staging/prod schema sync — dual-write + CI diff

**סטטוס:** 🟡 **Re-opened 2026-04-19** (ראה Amendment למטה). ✅ סגור במקור 2026-04-19.
**Owner:** Roi
**Scope:** מנגנון סנכרון ה-migrations בין `public` ו-`staging` בפרויקט Supabase היחיד (settled ב-[frontend PRD §418](campaigner-frontend-prd.md)). כולל גם הגדרת dev-local target. לא כולל mechanism של הרצת migrations מול Supabase (3.2 — עדיין פתוח).

### ההתלבטות

התלבטות כפולה:

1. **Dev target במקום Supabase staging.** Roi רצה לפתח מקומית לפני שהפרויקט ב-Supabase קיים ("אין לי עדיין API"). עלתה גם שאלת מאקרו — האם להישאר ב-Supabase בכלל או לעבור ל-Mongo כמו ב-`generic_agent`.
2. **מנגנון סנכרון `public` ↔ `staging`.** שלוש אופציות:
   - **A.** Dual-write — כל migration כותב לשתי הסכמות באופן explicit, fully-qualified.
   - **B.** Unqualified DDL + הרצה פעמיים עם `search_path` שונה.
   - **C.** תבנית + render script.

### ההחלטות

1. **Supabase נשאר stack ה-DB** (לא עוברים ל-Mongo). ההשוואה ל-`generic_agent` כבר נעשתה בשיחה קודמת וההחלטה על stacks שונים מכוונת.
2. **Dev-local target = Postgres 16 ב-Docker** דרך `docker-compose.yml`. זהה ל-Supabase מבחינת DDL/SQL; אפס rework במעבר.
3. **Dual-write (A) + CI diff check** לסנכרון `public` ↔ `staging` ב-Supabase.

### הנימוקים

**למה Supabase נשאר** (באופן שלא חוזרים על ההחלטה הקודמת):

- Schema היחס-רלציוני (§10 של הספק) מתאים ל-Postgres 1:1.
- RLS מובנה ל-v2 multi-tenant.
- Supabase Storage ל-`creative_gallery`.
- `generic_agent` הוא פרויקט נפרד עם צרכי-נתונים שונים; אין יתרון באחדת סטאקים.

**למה Postgres-in-Docker ל-dev-local** (ולא Supabase staging כ-dev target):

- Roi יכול להתחיל לפתח עכשיו בלי להמתין להקמת Supabase project.
- 10 דקות setup (service ב-compose, 2 פקודות).
- Parity מלא ל-prod — אותו engine (Postgres 16), אותן migrations.
- אין network hop = iteration loop מהיר יותר.

**למה Dual-write (A) ולא B/C** (בסדר יורד של חשיבות):

1. **בטיחות אפליקציה.** ב-B יש סיכון של "dev tool כותב בטעות ל-prod" אם `search_path` לא נכון ב-session. ב-A כל statement מכיל את שם הסכמה במפורש — אין סיכון כזה.
2. **Debuggability.** קריאת `001_businesses.sql` מראה את שתי הסכמות זו ליד זו. ב-B צריך לשחזר איזה `search_path` היה באיזה session.
3. **MVP volume.** 7 migrations × ~2× = פעולה חד-פעמית קטנה. C (templating) הוא over-tooling ל-scope זה.
4. **Divergence risk מנוהל ע"י CI diff.** פקודת SQL אחת שמשווה `information_schema.columns` בין הסכמות; נכשל build אם יש drift.

### תכולת ההחלטה

- **migration file convention:** שני בלוקים זהים במבנה, `public.<name>` ואז `staging.<name>`. Fully qualified בכל מקום. אין `search_path` dependency.
- **FKs בתוך סכמה.** אין cross-schema FKs.
- **Application code:** בוחר סכמה דרך `CAMPAIGNER_SCHEMA` env var, עם שמות fully qualified בכל query.
- **Local workflow:** `docker compose up -d postgres` → `CREATE SCHEMA staging` → ריצת migrations ב-for-loop.
- **CI drift check:** script ב-`migrations/check_drift.sh` (נכתב, יחוסר ב-3.1 כשמגדירים CI).
- **Supabase runner:** נשאר פתוח (3.2).

### Open follow-up (לא חוסם; ייתכן conversation חדש בהמשך)

תפקיד Supabase `staging` schema השתנה (לא בוטל). **לפני 1.4** זה היה ה-dev target; **אחרי 1.4** זה pre-prod integration target — מאפשר לוודא שהסביבה המנוהלת של Supabase מתנהגת כמו Postgres הגולמי לפני push ל-`public`. ערכו המוסף: לתפוס באגים ב-Supabase-specific features (RLS עם `auth.uid()`, triggers, extensions, PostgREST cache) שלא בהכרח מופיעים ב-Docker המקומי.

**המלצה שלא נסגרה:** לבנות את ה-`staging` schema כמו שמוגדר ב-migrations, אבל לא להשקיע בו אופרטיבית לפני Phase 1. כש-Phase 0-1 רצים ואנחנו רואים אם באמת עולים באגים Supabase-specific שה-local לא תפס — נסגור אם `staging` ממשיך להיות מתוחזק או ש-`public` בלבד מספיק. שיחה חדשה בעת הצורך, לא חוסמת כלום.

### קבצים שהשתנו

1. **[`docker-compose.yml`](../../docker-compose.yml)** — נוסף `postgres` service (Postgres 16 Alpine), healthcheck, volume לפרסיסטנטיות, mount של `./migrations`. `campaigner` service קיבל `depends_on: postgres` + `DATABASE_URL` env var.
2. **[`migrations/README.md`](../../migrations/README.md)** — נוצר חדש. מכיל: convention עם template, הוראות run ל-local, placeholder ל-Supabase runner (3.2), CI drift check script, הסבר למה A ולא B/C.
3. [`docs/plans/decisions-log.md`](decisions-log.md): נוסף הערך הזה (§1.4).
4. [`docs/plans/conversation-map.md`](conversation-map.md): 1.4 ✅ + עדכון "סטטוס נוכחי".
5. [`docs/plans/campaigner-backend-prd.md`](campaigner-backend-prd.md): §5 Open Question #3 סומן Resolved עם הפניה כאן.

ה-spec לא השתנה — §10 כבר תומך בדואליות הסכמות (לא מצריין, אבל לא סותר).

### מה נשאר פתוח (depends on)

- **3.1 CI/CD pipeline** — ה-`check_drift.sh` צריך להיקשר ל-GitHub Actions.
- **3.2 מנגנון הרצת migrations מול Supabase** — אם `supabase db push`, `psql` ידני, או אחר.
- **4.1 כתיבת migrations** — הקבצים 001-007 עצמם; יעקבו אחרי ה-convention שנקבע כאן.
- **Open follow-up** (מעל) — האם `staging` schema ב-Supabase שורד את Phase 0-1.

### Amendment 2026-04-19 — Re-open: DB choice

Roi ציין שהוא עדיין לא מחויב ל-Supabase ושוקל סטאק חלופי (כמו ב-`generic_agent` — Mongo + Redis). ביקש שבינתיים ה-**local stack** יעבוד בפרדיגמה של `generic_agent` כדי שהפיתוח המקומי יהיה consistent עם האצבעות שלו.

**מה השתנה בפועל (local only, ללא שינוי spec/PRD):**

1. [`docker-compose.yml`](../../docker-compose.yml) — service `postgres` הוחלף ב-`mongo` (mongo:7, ללא auth, port 27017) + `redis` (redis:7-alpine, port 6379). `campaigner` service מקבל `MONGO_URL`, `MONGO_DB`, `REDIS_URL`.
2. [`migrations/001-007.sql`](../../migrations/_sql_pending_decision/) — עברו ל-`migrations/_sql_pending_decision/`. לא נמחקו, לא שונו. ממתינים להכרעה.
3. [`migrations/mongo/init_mongo.py`](../../migrations/mongo/init_mongo.py) — חדש. יוצר 7 collections + indexes שמתרגמים את SQL מ-§10. Idempotent.
4. [`scripts/bootstrap_local_db.sh`](../../scripts/bootstrap_local_db.sh) — נכתב מחדש: מתחיל mongo+redis, ממתין ל-healthchecks, קורא ל-init_mongo.py.
5. [`scripts/validate_local_env.py`](../../scripts/validate_local_env.py) — נכתב מחדש: Mongo connection + 7 collections + indexes + Redis PING + round-trip על `businesses`.
6. [`requirements.txt`](../../requirements.txt) — נוסף `pymongo>=4.6`, `redis>=5.0`. `psycopg[binary]` נשאר (במקרה שהכרעה תחזור ל-Postgres).
7. [`migrations/README.md`](../../migrations/README.md) — שכתוב מלא. מסביר את המצב הביניים, traceability ל-§10, ומה יקרה בכל הכרעה אפשרית.

**מה נשאר כמות שהוא (spec/PRDs — כוונה מכוונת):**

- [`campaigner-spec.md §10`](campaigner-spec.md) — הסכמה הרלציונית לא שונתה. ה-spec עדיין מייצג את הכוונה המקורית.
- [`campaigner-backend-prd.md`](campaigner-backend-prd.md) — לא שונה.
- [`campaigner-frontend-prd.md`](campaigner-frontend-prd.md) — לא שונה (עדיין מזכיר Supabase Auth + RLS).
- [`CLAUDE.md`](../../CLAUDE.md) — לא שונה.

העדכון של המסמכים האלה יקרה רק אחרי ההכרעה הסופית — לא שווה לחזור ולערוך אותם פעמיים.

**Open decision:** איזה DB מרוחק בפרוד. לא חוסם את Phase 1 — הפיתוח המקומי יכול להתחיל מיד על Mongo+Redis, וה-tools שיכתבו ב-`campaigner/lib/` יצטרכו abstraction קל (או רק להחליף מימוש) כשההכרעה תתקבל.

**Open tradeoff to think about:** ככל שהפיתוח ב-Mongo מתקדם, ה-cost של "לחזור ל-Postgres/Supabase" גדל (כל כלי שנכתב מול pymongo ייכתב מחדש מול supabase-py; ה-RLS/Auth שנשמר ב-frontend PRD נהיה non-trivial למימוש ב-Mongo). **המלצה:** לסגור את ההכרעה המרוחקת לפני תחילת Phase 1 (4.1-4.3) — לא להמתין.

**Owner של ההכרעה החוזרת:** Roi.
**Status:** פתוח — שיחה חדשה במפת השיחות (מומלץ להוסיף כ-1.4b או כ-v2 של 1.4).

---

## 1.5 Hebrew copy style — authorship

**סטטוס:** ✅ סגור 2026-04-19 (החלטת authorship + lo"z). **Content:** 🟡 v0 skeleton כתוב; v1 fill-in ועד 2026-05-10.
**Owner:** Roi (admin@aiweon.co.il)
**Scope:** מי אחראי ל-`prompts/hebrew-copy-style.md` — גרסה ראשונית + תחזוקה שוטפת. לא מבנה טכני של הקובץ (נסגר תוך כדי בניית ה-skeleton).
**Deadline:** v1 lock ב-**2026-05-10** (שלושה שבועות מהיום). לפני Phase 2 יש עוד buffer.

### ההתלבטות

שלוש אופציות + hybrid:

- **A** Operator-authored (Roi כותב מאפס)
- **B** Aiweon team-authored (marketer מהצוות של Aiweon)
- **C** חילוץ מחומרים קיימים (AI-assisted extraction)
- **D** Hybrid: C מייצר טיוטה → B/A review + iterate

### ההחלטה

**D-lite + Roi כ-owner יחיד** (אין צוות marketing נפרד בעסק שמעורב בתהליך; Roi = authority + reviewer).

**"Lite"** כי הנחת היסוד של D — שיש חומר משמעותי לחלץ ממנו — אינה מחזיקה. Roi חשף ש-**החשבון החדש של Meta נטול היסטוריה**, וגם החומר ה-organic של Aiweon (website + social) דל יחסית. לכן:

- C-step (extraction): קליל. ניצלתי טאגליין ("הבית של מותגים ויוצרי תוכן"), positioning, שם, דומיין.
- שאר המבנה: **skeleton** עם `[TBD]` מפורשים לכל מה שדורש קלט ייחודי של Aiweon, + defaults ברי-שימוש בכל מקום שאפשר.

### הנימוקים

1. **אין צוות Aiweon אחר להמתין לו.** Roi עונה על Q1 ברורות — הוא גם ה-owner וגם ה-reviewer, אין delegated authority.
2. **חשבון Meta חדש = אין creative archive לחלץ ממנו.** C המלא קורס. נותר רק חילוץ light מה-web presence הקיים.
3. **Skeleton עם `[TBD]` עדיף על דף ריק.** נותן ל-Roi framework להגיב עליו במקום לחשוב מאפס.
4. **Phase 2 = ~4-5 שבועות מהיום.** אין לחץ של שבוע. 3 שבועות איטרציה = buffer לסיבוב 2 של review אם יידרש.
5. **Voice אמיתי יתגלה ב-Phase 2 דרך creative iteration.** המסמך הזה הוא starting point, לא final version. אין טעם להשקיע יותר משבוע עכשיו מעבר לסיבוב אחד של Roi.

### תכולת ההחלטה

**Owner:** Roi — עורך ישיר לתוספות lexical קטנות; שיחה חדשה + decisions-log amendment לשינויי structure.

**לו"ז:**

- **היום (2026-04-19):** v0 skeleton כתוב ב-[`campaigner/prompts/hebrew-copy-style.md`](../../campaigner/prompts/hebrew-copy-style.md).
- **עד 2026-04-26:** Roi עובר על ה-skeleton, ממלא את ה-`[TBD]` (דואג ל-§1 overview, §2 voice dimensions, §3 preferred lexicon, §4 CTAs, §5 headline patterns, §6 proof points, §7 audience segments, §8 working examples).
- **עד 2026-05-03:** אני סורק את הגרסה הממולאת, מפיק feedback על עקביות / חוסרים / מילים נוספות שכדאי לאסור. סיבוב 2.
- **עד 2026-05-10:** v1 נעול. Claude יכול להיטען עליו ב-Phase 2.

**Iteration triggers post-lock** (מ-§10 של הקובץ):

- Phase 2 creative מראה דפוס שיטתי שגוי.
- Variant underperforms שבועיים → חשד שה-voice תורם.
- Aiweon מבקש שינוי positioning.

### קבצים שהשתנו

1. **[`campaigner/prompts/hebrew-copy-style.md`](../../campaigner/prompts/hebrew-copy-style.md)** — נוצר חדש (10 סעיפים, v0 skeleton, `[TBD]` markers).
2. [`docs/plans/decisions-log.md`](decisions-log.md): נוסף הערך הזה (§1.5).
3. [`docs/plans/conversation-map.md`](conversation-map.md): 1.5 ✅ + עדכון סטטוס.
4. [`docs/plans/campaigner-backend-prd.md`](campaigner-backend-prd.md): §5 Open Question #2 סומן Resolved עם הפניה כאן.

ה-spec ו-CLAUDE.md לא שונו — הם כבר מתייחסים ל-`prompts/hebrew-copy-style.md` ככלי, לא לתוכנו.

### מה נשאר פתוח (depends on)

- **Q2 של השיחה (מבנה צוות של Aiweon)** — Roi ענה באופן משתמע ("אני ה-owner"), אין מצב שיעבור אליו שינוי.
- **v1 content (המילויים של `[TBD]`)** — עבודה של Roi בשבוע הקרוב. לא חוסם Phase 0/1.
- **Feedback loop עם Phase 2 בפועל** — כש-Claude מתחיל לייצר copy, סביר שיתגלו פערים שהמסמך לא צפה. מובנה כ-update protocol ב-§10.
- **Alternative לקטלוג ערוצים (חרדי, ערבי)** — out-of-scope ל-MVP; נכתב כ-TBD אבל ברור שנשאר ריק ב-v1.

---

## 1.6 web/frontend — repo topology

**סטטוס:** ✅ סגור 2026-04-19
**Owner:** Roi
**Scope:** איפה חי ה-Next.js frontend. אופציות שנשקלו: `web/` sibling ב-monorepo / repo נפרד / pnpm workspaces. Output: החלטה + עדכון spec §19 + עדכון frontend PRD preamble.

### ההתלבטות

- **A.** `web/` sibling ב-monorepo — Python backend + Next.js frontend ב-repo אחד.
- **B.** Repo נפרד `campaigner-web`.
- **C.** monorepo root עם packages (pnpm workspaces / Turborepo).

### ההחלטה

**A — `web/` sibling ב-monorepo.**

### הנימוקים (בסדר יורד של חשיבות)

1. **Solo dev.** Roi עובד לבד על שני הצדדים. Cross-repo coordination = מס זמן שלא מוצדק.
2. **המפרט כבר מניח זאת אופרטיבית.** [frontend PRD §417](campaigner-frontend-prd.md) מתאר CI שבונה image מ-`web/`, push ל-`generic-agent-repo/campaigner-web` ב-Artifact Registry, ו-`kubectl apply`. הפייפליין הזה זהה במונו וב-polyrepo (Docker image = build-artifact, לא git-artifact) — אין יתרון מבני ל-B.
3. **Type sharing לא כואב כרגע.** Backend הוא Python, frontend הוא TypeScript — אין `@shared/types` פוטנציאלי משותף. הפקת types מ-DB schema ל-TypeScript תיעשה כ-script ב-CI, ללא overhead של package.
4. **"התחל מונו, פצל אחר כך" הפוך הרבה יותר קל** מ-"התחל פולי, אחד". Git filter-branch / `git-subtree split` הופכים שנה של commits ל-repo נפרד בכמה דקות; ההפך דורש reshuffle של pipelines + Artifact Registry + IAM.
5. **Generic-agent-cluster משותף.** שני הצדדים פרוסים לאותו GKE cluster (frontend PRD §417); monorepo משקף את טופולוגיית ה-deploy.

**C נדחתה כ-over-tooling** — pnpm workspaces מתאים למונו של JS-first; להכניס workspace manager ל-repo שרובו Python זה overhead בלי benefit.

### תכולת ההחלטה

- **מבנה:** `web/` sibling ל-`campaigner/`, `migrations/`, `scripts/`, ושאר ה-repo.
- **שני Dockerfile-ים:** `Dockerfile` בשורש = backend (Claude CLI + Python); `web/Dockerfile` = frontend (Next.js). לא משותפים.
- **CI with path filters:** GitHub Actions יריץ frontend build רק כש-`web/**` שונה, ו-backend build רק כש-`campaigner/**`, `migrations/**`, `scripts/**`, `requirements.txt`, או root `Dockerfile` שונים. מונע re-builds מיותרים.
- **Docker Compose נשאר backend-only בינתיים.** כש-Phase 0 של frontend מגיע (task 4.7), compose יקבל שלישיית services: `postgres`, `campaigner`, `web`.
- **Images ב-Artifact Registry:** `generic-agent-repo/campaigner` (backend) + `generic-agent-repo/campaigner-web` (frontend) — שניהם נפרדים, שניהם מאותו repo.

### קבצים שהשתנו

1. [`docs/plans/campaigner-spec.md`](campaigner-spec.md) §19 — עץ התיקיות עודכן: נוסף `web/` עם Dockerfile משלו בין `migrations/` ל-legacy files. גם תוקן ל-`007_heartbeats.sql` נוסף + `scripts/` + `docker-compose.yml`. נוספה הערה על monorepo topology ו-CI path filtering.
2. [`docs/plans/campaigner-frontend-prd.md`](campaigner-frontend-prd.md) preamble — נוספה שורת "Repo topology" שמציינת את ההחלטה כאן ואת ה-CI path filtering.
3. [`docs/plans/decisions-log.md`](decisions-log.md): נוסף הערך הזה (§1.6).
4. [`docs/plans/conversation-map.md`](conversation-map.md): 1.6 ✅.

ה-backend PRD לא שונה — טופולוגיה של frontend לא רלוונטית לו.

### מה נשאר פתוח (depends on)

- **3.1 CI/CD pipeline** — יגדיר בפועל את ה-GitHub Actions workflow עם path filters לשני הצדדים.
- **4.7 Frontend Phase 0** — היצירה הפיזית של `web/` (Next.js scaffold). ההחלטה כאן רק קובעת שזה יהיה ב-`web/` ולא ברepo נפרד.
- **Schema→TypeScript generation:** כש-frontend Phase 0 רץ, נדרש script (probably `scripts/generate_web_types.sh`) שמייצר `web/lib/db-types.ts` מה-Supabase schema. לא חוסם את 1.6 — יוחלט בפרטי יישום של 4.7.

---

## 1.7 גישת משתמשים שניים — single-user MVP + C-hook לעתיד

**סטטוס:** ✅ סגור 2026-04-19
**Owner:** Roi
**Scope:** policy של access control ב-MVP. לא כולל מימוש RLS policies בפועל (נגזר מ-4.1/4.7).

### ההתלבטות

- **A.** רק Roi ב-MVP (single-user).
- **B.** שני משתמשים (operator + viewer) עם RLS מלא.
- **C.** Stakeholder מקבל רק async report (weekly digest).

### ההחלטה

**A + hook ל-C בעתיד.** MVP מריץ single-user עם אימייל יחיד (`admin@aiweon.co.il`). ה-`agent_decisions` + `approvals` כבר נשמרים בשלמות, כך שכש-need לדיגסט עתידי מתבהר — מימוש C (script שבונה email weekly) הוא עבודה של יום-יומיים בלי שינוי schema.

### הנימוקים (בסדר יורד של חשיבות)

1. **אין ודאות שקיים "marketer ב-Aiweon" כ-persona נפרדת.** מ-[1.5](decisions-log.md#15-hebrew-copy-style--authorship) עלה ש-Roi הוא owner יחיד לכל ה-brand voice, ומ-[1.5 Q1 response] שאין צוות Aiweon אחר שמוגדר כ-authority. בניית multi-user ל-persona שייתכן ולא קיים = premature.
2. **RLS test harness ב-B הוא time sink.** [frontend PRD §378](campaigner-frontend-prd.md) מגדיר "three-user setup" כ-gate ל-Phase 0. ב-A ה-harness עדיין קיים כ-boilerplate אבל אין policies ממשיות לבדוק — חסכון של 2-3 ימי פיתוח ב-Phase 0.
3. **B מייצר policies שבורות סמויות.** Policies של "viewer רואה רק business X" אין להן קיום אמיתי עד שיש user שני; שגיאות יישום יתגלו רק כשהמצב יעלה.
4. **Hook ל-C זול בעתיד.** ה-schema הנוכחי (spec §10.4, §10.5) תומך במה שצריך — `agent_decisions` עם timestamps + approvals state machine. `weekly_digest.py` במסגרת v2 או ב-iteration ב-Phase 6 — לא חוסם.
5. **החלטה הפיכה.** אם Aiweon פתאום דורש גישה — הוספת policy pair + onboarding flow, לא data migration. פתוח כל יום.

### תכולת ההחלטה

- **Frontend auth:** Supabase Auth עם allow-list של אימייל יחיד `admin@aiweon.co.il`. מימוש: middleware בוחן `session.user.email ?? ''` מול ENV VAR `ALLOWED_OPERATOR_EMAIL`. לא user table.
- **RLS:** נשאר **enabled** על כל הטבלאות (spec §10.7), אבל policy לכל טבלה הוא `USING (true)` עבור `service_role` (backend), וב-frontend ה-anon key מרגיש את ה-RLS רק כשה-auth session קיים. לא יוצרים `user_business_access` table ב-MVP.
- **`businesses.user_id` או דומה:** **לא נדרש ב-MVP.** יתווסף במסגרת 4.1 של v2 כש-user_business_access נכנס.
- **Testing:** frontend ל-Phase 0 בודק רק (a) unauthenticated → redirected to login, (b) authenticated-as-Roi → sees everything. ה-"wrong-business" test נכנס ל-v2.

### קבצים שהשתנו

1. [`docs/plans/decisions-log.md`](decisions-log.md): נוסף הערך הזה (§1.7).
2. [`docs/plans/conversation-map.md`](conversation-map.md): 1.7 ✅ + עדכון סטטוס.

**לא שונו מכוון:**

- Backend PRD — לא מזכיר multi-user ב-MVP, אין מה לעדכן.
- Spec §10.7 — RLS enabled נשאר (infrastructure ready for v2).
- Frontend PRD §378 "three-user setup" — נשאר במסמך כ-**v2 gate**, לא MVP gate. זה amendment קטן שייעשה בפתיחת frontend Phase 0 (task 4.7), לא כאן.

### מה נשאר פתוח (depends on)

- **v2 trigger:** כשמתווסף business שני או כש-Aiweon marketer מבקש גישה — נפתחת שיחה חדשה ב-conversation-map של v2: "multi-user onboarding policy".
- **C-hook במסגרת Phase 6 או v2:** כשמתבהר שה-digest דרוש — `scripts/weekly_digest.py` קורא `agent_decisions` + `approvals` ב-window של 7 ימים, מפיק email/PDF. לא חלק מ-MVP scope.
- **Frontend Phase 0 task 4.7:** צריך לעדכן את §378 של frontend PRD כש-task נפתח — להעביר את "three-user setup" מ-Phase 0 gate ל-v2 gate. tracked כ-follow-up, לא חוסם 1.7.

---

## 3.1 CI/CD pipeline

**סטטוס:** ✅ סגור 2026-04-19 (backend workflow + WIF setup doc); frontend workflow נדחה ל-4.7.
**Owner:** Roi
**Scope:** GitHub Actions workflow ל-backend (PR lint-equivalent + main build-push). ה-deploy step נדחה עד שיסגור 1.4 ויוגדר target פרוד. frontend workflow נדחה ל-task 4.7 (כי `web/` לא קיים).

### ההתלבטות

ארבעה מפתחות:

1. **פלטפורמה** — GitHub Actions vs Cloud Build.
2. **טריגרים** — PR/push/tags.
3. **Tests ב-CI** — GH Actions `services:` native vs `docker compose` כמו local.
4. **Deploy gate** — להפעיל מיד, לדחות לגמרי, או build+push ללא deploy.

### ההחלטות

1. **GitHub Actions** — הרפו על GitHub, solo dev, אפס ops. Cloud Build חזק כשיש GCP monoculture עמוקה; פה over-tooling.
2. **טריגרים:** PR → test בלבד; push ל-`main` → test + build + push; tags → דחוי ל-Phase 6.
3. **Tests דרך `docker compose`** — נשמר ה-feedback "הכל דרך docker compose" ([MEMORY: docker_workflow](../../../.claude/projects/d--meta-ads-automation-ai/memory/feedback_docker_workflow.md)). Parity מלא עם local. מחיר: 10-20 שניות orchestration overhead — שווה.
4. **Build + push ל-Artifact Registry, בלי deploy.** Images decoupled מ-1.4 (אין DB config ב-image). שלב deploy ייווסף כשורות נוספות כש-1.4 + Cloud Run project יוסדרו — לא refactor.
5. **Auth מ-GH ל-GCP דרך Workload Identity Federation**, לא SA-key-in-secret. Same rotation philosophy של [§1.1](#11-secret-management--google-secret-manager).
6. **Gate:** `vars.AR_PUSH_ENABLED == 'true'` — שלט אב ב-GitHub repo variables. עד ש-Roi מפעיל, `build-push` מדולג (לא כושל).

### הנימוקים העיקריים

1. **Test ב-CI משקף runtime אמיתי.** `validate_local_env.py` פועל מול mongo+redis אמיתיים, בתוך הcampaigner image — אם משהו נשבר ב-Dockerfile או ב-init, ה-CI תופס. זה gate משמעותי גם בלי pytest עדיין.
2. **Build-push independent מ-DB choice.** Image תוכן = קוד + requirements; שום השפעה מ-Supabase/Mongo בתמונה עצמה. לכן אין סיבה לחסום את ה-pipeline על 1.4.
3. **WIF > SA key** — רוטציה חינם, אין secret גולמי בקובץ GH, consistency עם §1.1.
4. **Gate של `vars.AR_PUSH_ENABLED`** פותר את הבעיה ש"ה-setup לא בוצע עדיין": workflow קיים בקוד, לא כושל בלי WIF. Roi מפעיל כשמוכן.

### קבצים שנוצרו/שונו

1. **[`.github/workflows/backend.yml`](../../.github/workflows/backend.yml)** — נוצר חדש. שני jobs: `test` (PR + push), `build-push` (push בלבד, עם gate). path filters לפי [§1.6](#16-webfrontend--repo-topology).
2. **[`docs/plans/task-3.1-cicd-setup.md`](task-3.1-cicd-setup.md)** — נוצר חדש. הוראות one-time של Roi: יצירת AR repo + WIF pool/provider + SA ייעודי `campaigner-ci` עם `roles/artifactregistry.writer` בלבד + binding + GH vars/secrets.
3. [`docs/plans/decisions-log.md`](decisions-log.md): נוסף הערך הזה (§3.1).
4. [`docs/plans/conversation-map.md`](conversation-map.md): 3.1 ✅ + עדכון סטטוס.

**לא שונו מכוון:**

- `docs/plans/campaigner-backend-prd.md` + `campaigner-frontend-prd.md` — לא היו CI/CD פרוטים; ה-workflow נקשר ל-PRD-ים בעקיפין דרך ה-spec §19 עץ הקבצים, שלא השתנה (אין צורך לעדכן).

### מה נשאר פתוח (depends on)

- **WIF setup עצמו** — Roi מריץ את 6 הצעדים ב-[task-3.1-cicd-setup.md](task-3.1-cicd-setup.md). לא חוסם שום פיתוח (test job רץ גם בלי WIF).
- **Frontend workflow** — נכנס כחלק מ-task 4.7 לפי מבנה זהה.
- **Deploy step** — נוסף כ-job שלישי (`deploy-jobs`) אחרי ש-1.4 סגורה ו-Cloud Run Job/GKE מוגדרים.
- **Linter** — אם וכש-`campaigner/` מגיע ל-reality (4.2+), להוסיף `lint` job לפי הכלי שנבחר.

---

## 3.2 מנגנון הרצת migrations

**סטטוס:** ✅ סגור חלקית 2026-04-19 — **local בלבד**. ה-remote mechanism נדחה עד שה-[§1.4 amendment](#14-stagingprod-schema-sync--dual-write--ci-diff) תוכרע.
**Owner:** Roi
**Scope:** איך migrations רצות — pattern, runner, ordering, idempotency. לא כולל תוכן ה-migrations עצמן (4.1).

### ההתלבטות

- **כלי ייעודי** (Alembic/Flyway ל-SQL, mongo-migrate ל-Mongo) vs **Python scripts רגילים**.
- **Forward-only** vs **up+down**.
- **Runner יחיד לכל סביבה** vs **runner per environment**.

### ההחלטות

1. **Python scripts idempotent**, לא כלי migration ייעודי. כל קובץ עומד בזכות עצמו, בודק קיום לפני יצירה, נשמר פעיל גם ב-re-run.
2. **Forward-only.** אין down migrations ב-MVP — Git revert + re-write migration חדש במקרה rollback.
3. **Ordering:** prefix נומרי (`001_*.py`, `002_*.py` וכו'). היום יש קובץ אחד — `migrations/mongo/init_mongo.py`. כשיגיע השני (במסגרת 4.1) — rename ל-`001_init.py` + הוספת `002_*.py`, עם runner loop ב-bootstrap.
4. **Runner:** `scripts/bootstrap_local_db.sh` עבור local; remote runner ייכתב כש-1.4 תוכרע (ייתכן `scripts/migrate_remote.sh` שקורא ל-`supabase db push` או ל-loop של Python).
5. **Application:** תמיד דרך `docker compose run --rm campaigner python migrations/...` — host Python אינו ה-execution path.

### הנימוקים

1. **Idempotency > tooling** — לכלים ייעודיים יש migration state table שנותן אמיתי rollback semantics, אבל המחיר הוא תלות ב-package עם lifecycle משלו. ב-MVP של 1-7 migrations, `db.list_collection_names()` + `create_index` (idempotent by default) מכסים 100% מהצורך.
2. **Forward-only** — MVP אין production state לשחזר; bug ב-migration = fix ב-migration חדש. Down migrations יוצרות ambiguity ("מה קרה ב-prod באמת?") ללא תועלת.
3. **Numbered prefix** — Convention ברורה, grep-friendly, עמיד גם בלי ORM.
4. **Same pattern cross-DB** — אם Postgres ינצח ב-1.4, `002_feature.sql` עוקב את אותה convention של `002_feature.py`. אין rework של המנגנון, רק של הקבצים.

### State נוכחי (already in place)

- [`migrations/mongo/init_mongo.py`](../../migrations/mongo/init_mongo.py) — 7 collections + indexes. Idempotent (בודק קיום לפני יצירה). ~117 שורות.
- [`scripts/bootstrap_local_db.sh`](../../scripts/bootstrap_local_db.sh) — runner שמרים compose → waits for health → runs init. Has `--reset` flag.
- [`migrations/README.md`](../../migrations/README.md) — תיעוד ה-convention + traceability ל-spec §10.

**כלום לא שונה בהחלטה הזאת.** ה-mechanism כבר מומש ב-[§1.4 amendment](#14-stagingprod-schema-sync--dual-write--ci-diff). 3.2 מרימה את זה לרמת decision מתועדת — ה-convention ש-4.1 יכתוב כלפיה, ולא ad-hoc.

### Remote mechanism — נדחה

נסגר רק אחרי ש-1.4 תוכרע:

- **אם Supabase ינצח:** `scripts/migrate_remote.sh` קורא ל-`supabase db push` (או ל-`psql` ישיר עם `FROM (SELECT version FROM schema_migrations)` semantics). ה-SQL migrations ב-`_sql_pending_decision/` חוזרות לפעולה.
- **אם Mongo ינצח:** `scripts/migrate_remote.sh` מפעיל את אותם `migrations/mongo/*.py` אבל עם `MONGO_URL` של Atlas/self-hosted. Idempotency נשמרת — אפשר להריץ את אותו קובץ על prod כמה פעמים ללא נזק.
- **בכל מקרה:** ה-runner יקרא מ-Secret Manager ([§1.1](#11-secret-management--google-secret-manager)) ל-connection string של ה-remote.

### קבצים שהשתנו

1. [`docs/plans/decisions-log.md`](decisions-log.md): נוסף הערך הזה (§3.2).
2. [`docs/plans/conversation-map.md`](conversation-map.md): 3.2 🟡 partial (local ✅, remote pending 1.4).

**לא שונו** — migrations/README.md ו-init_mongo.py + bootstrap נכתבו כבר במסגרת 1.4 amendment ומממשים את ההחלטה נכון. לא נדרש שינוי.

### מה נשאר פתוח (depends on)

- **Remote runner (חלק ב' של 3.2)** — נכנס לשיחה חדשה אחרי ש-1.4 תוכרע. צפוי להיות ~30 דקות עבודה של shell script.
- **Migration #2** — כש-4.1 ירחיב את ה-init ל-migrations נפרדים, יצטרך rename של `init_mongo.py` ל-`001_init.py` + לולאה ב-bootstrap. טריוויאלי.

---

## 3.3 Backup / DR

**סטטוס:** ✅ policy framework סגור 2026-04-19. Implementation נדחה עד ש-1.4 תוכרע (provider-specific).
**Owner:** Roi
**Scope:** הגנת ה-DB בלבד. Code נשמר ב-git (לא צריך נפרד). Meta API state לא ניתן לגיבוי (source of truth הוא Meta). Imagen-generated images: regenerable (hash של prompt + seed), לא שווה גיבוי.

### ההתלבטות

- האם Supabase-built-in daily backups (7-30 ימים retention) מספיקים, או צריך layer עצמאי?
- RTO/RPO formal vs eyeballed?
- מה לגבות ומה לא?
- איך לוודא שהגיבוי אמיתי (test-restore cadence)?

### ההחלטות

1. **Two-layer backup:**
   - **Layer 1 — managed provider daily backups.** Supabase/Mongo Atlas built-in (בחירת provider תלויה ב-1.4). Retention 30 ימים ברירת מחדל.
   - **Layer 2 — weekly independent dump ל-GCS bucket נפרד.** `mongodump` או `pg_dump` (לפי 1.4), העלאה ל-`gs://bemtech-backups-campaigner/` עם lifecycle rule של retention 90 ימים.
2. **RTO = 24 שעות. RPO = 24 שעות.** לא פורמלי; מתבסס על "solo operator, לקוח אחד, הכל HITL." אם restoration לוקחת יום — acceptable. אם שחזור מגלה שאיבדנו 24 שעות אחרונות — acceptable.
3. **Test restore quarterly** (אחת ל-3 חודשים). ידני, בסביבת staging. "Untested backup = no backup" — לא קיצור דרך.
4. **מה לגבות:** כל 7 ה-collections/tables של spec §10. במיוחד:
   - `agent_decisions` — audit trail היסטורי, אי אפשר לשחזר מ-Meta.
   - `approvals` — state machine של החלטות HITL.
   - `creative_gallery` — hash + metadata (images עצמם ב-Storage, להם provider backup משלו).
5. **מה לא לגבות:** קוד (git), Meta state (API = source of truth), Imagen images (regenerable deterministically מ-prompt + seed).

### הנימוקים

1. **Managed-only לא מספיק.** Supabase/Atlas יכולים להיסגר/להתעייף/להיות למעלה מה-retention. GCS dump = insurance ברמה של provider אחר. המחיר זניח (~$0.02/חודש ל-storage של ~1GB dumps).
2. **RTO/RPO eyeballed = adequate ל-single-customer MVP.** כשנגיע לשני ad accounts ו/או SLA עם Aiweon, לפתוח שיחה חדשה (v2).
3. **Test restore רבעוני** — לא חודשי (overkill), לא שנתי (too late לגלות). רבעוני מכוון את המאסטר: השלישי בכל רבעון הופך ל-self-test.
4. **Not backing up Imagen images** — deterministic regeneration (Vertex SDK + same prompt + same seed) מייצר אותה תמונה. גיבוי ה-prompt + seed זה כבר חלק מ-`creative_gallery` ב-DB. ה-PNG הגולמי זה waste.

### Implementation — נדחה (provider-specific)

נסגר אחרי 1.4:

**אם Supabase ינצח:**

- Layer 1: מופעל automatically ב-Supabase dashboard (Point-in-Time Recovery). ללא קוד.
- Layer 2: `scripts/weekly_backup.sh` — `pg_dump $SUPABASE_CONN_STRING | gzip | gsutil cp - gs://bemtech-backups-campaigner/week-$(date +%V)-$(date +%Y).sql.gz`. Cron weekly.
- Test restore: `gsutil cp` → `psql` to staging schema → `validate_local_env.py` equivalent.

**אם Mongo ינצח:**

- Layer 1: Atlas Automated Backup או ה-equivalent של self-hosted.
- Layer 2: `mongodump --uri="$MONGO_URL" --archive | gzip | gsutil cp - gs://...`.
- Test restore: `mongorestore` ל-staging cluster.

**Cloud Scheduler job:** נוסף ל-runners ב-Phase 5 לפי decision של 1.4.

### קבצים שהשתנו

1. [`docs/plans/decisions-log.md`](decisions-log.md): נוסף הערך הזה (§3.3).
2. [`docs/plans/conversation-map.md`](conversation-map.md): 3.3 🟡 partial (policy ✅, impl pending 1.4).

אין קוד או קבצים חדשים — policy בלבד. ה-impl (script + cron) נכנס כ-task נפרד אחרי 1.4.

### מה נשאר פתוח (depends on)

- **Implementation (חלק ב')** — שיחה חדשה אחרי 1.4. צפוי ~45 דקות לכתיבת `weekly_backup.sh` + `monthly_restore_test.sh` + Cloud Scheduler config.
- **GCS bucket `bemtech-backups-campaigner`** — יצירה חד-פעמית, ~2 דקות. Task של Roi.
- **First test restore** — Q3 2026 (~3 חודשים אחרי go-live).

---

## 3.4 הגנה מ-infinite loops של Claude

**סטטוס:** ✅ סגור 2026-04-19. DB-agnostic; implementation נכנסת במלואה ב-runners ו-lib (tasks 4.2/4.6), השיחה הזאת סוגרת את ה-design.
**Owner:** Roi
**Scope:** הגנה מ-unbounded Claude execution ב-headless runners. לא כולל guardrails על Meta API quotas (נושא נפרד) או על Imagen cost (rate-limited ממילא).

### ההתלבטות

**הסיכון:** Claude Code ב-`claude -p`, headless, מריץ tools ב-loop. שגיאה שמייצרת retry → tool call → אותה שגיאה → retry. בלי upper bound, invocation יכול לשרוף מאות דולר תוך דקות.

**האלטרנטיבות שנשקלו:**

- **A.** להסתמך רק על `--max-turns` של Claude Code.
- **B.** Cost ceiling בלבד — watch cumulative spend, kill at threshold.
- **C.** Multi-layer: prevention (max-turns) + detection (cost ceiling per-run) + anomaly detection (daily aggregate).

### ההחלטה

**C — הגנה בשלושה שכבות.** כל שכבה עצמאית; failure של אחת לא שוברת את האחרות.

### Layer 1 — `--max-turns` per runner (prevention)

סוגר את ה-worst case של loop אינסופי באותה invocation.

| Runner                        | --max-turns | נימוק                                                                                                                          |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `daily_observe_propose.sh`    | 40          | fetch → analyze → 5-10 proposals × (check + write) ≈ 30 turns maximum. 40 = 33% buffer.                                        |
| `execute_approvals.sh`        | 30          | read approvals → for each (~5 max) → re-check guardrails + execute. ≈ 20 turns. 30 = 50% buffer.                               |
| `weekly_creative_firehose.sh` | 60          | Andromeda מעודד 10-50 creatives. Per creative: prompt + generate + validate + write. 10 creatives × 5 turns = 50. 60 = buffer. |

Hit של max-turns → Claude מחזיר exit code שאינו 0. Runner לוכד, כותב `agent_decisions` עם `decision_type='max_turns_exceeded'`.

### Layer 2 — per-invocation cost ceiling (detection + hard kill)

Claude Code CLI תומך ב-`--output-format json` שמחזיר `total_cost_usd` בסוף run. Runner wrapper בודק:

| Runner                   | Cost ceiling | Hard kill?           |
| ------------------------ | ------------ | -------------------- |
| daily_observe_propose    | $2.00        | אזהרה ב-log, לא kill |
| execute_approvals        | $1.00        | אזהרה ב-log, לא kill |
| weekly_creative_firehose | $5.00        | אזהרה ב-log, לא kill |

**למה לא hard kill?** כי `--max-turns` הוא ה-prevention. Cost ceiling = **anomaly flag** — אם run חד-פעמי עולה פי 3 מהצפוי אבל הושלם, רוצים לדעת ולא לבטל נתונים כבר שנכתבו.

Log entry: `decision_type='cost_anomaly'` עם `run_cost_usd` + baseline.

### Layer 3 — daily cost anomaly check (monitoring)

`scripts/check_daily_cost.py` רץ אחרי חצות IL:

- Query `agent_decisions` ב-24 שעות אחרונות.
- Sum `outputs.run_cost_usd` לפי `run_id`.
- השווה ל-rolling 7-day baseline.
- טריגר alert אם `today > 2x baseline` **או** `today > $15` absolute.

**MVP alert mechanism:** log בלבד + email ל-`admin@aiweon.co.il`. לא PagerDuty, לא Slack — overkill.

**מתי מפעילים:** רק אחרי ש-Phase 2 רץ שבועיים (שיש baseline). עד אז — eyeballing ידני של Roi.

### Schema additions (document now, implement in 4.1)

`agent_decisions` מקבל שדה `outputs.run_cost_usd` (float, nullable). Backward compatible — קיים בתיעוד של [spec §10.5](campaigner-spec.md) כחלק מ-JSONB outputs, רק צריך לכתוב אותו בפועל.

גם: `decision_type` enum מקבל שני ערכים חדשים:

- `max_turns_exceeded` — Layer 1 hit.
- `cost_anomaly` — Layer 2 flag.
- (קיימים: `propose`, `approve`, `reject`, `execute`, `run_summary`, ...)

אין שינוי schema ברמת migration — רק תוכן של enum-like column. `outputs` ב-Mongo הוא document field חופשי; ב-Postgres זה JSONB — שניהם מקבלים שדות חדשים בלי DDL.

### הנימוקים

1. **3 layers, לא layer אחד** — `--max-turns` הוא deterministic אבל שם "soft" (Claude עצמו בוחר מתי לעצור); cost ceiling תופס cases שבהם max-turns לא הגיע אבל single turn נורא יקר (e.g., context explosion); daily anomaly תופס drift ארוך טווח שהיומי לא רואה.
2. **Hard kill רק ב-Layer 1** — Layer 2/3 מזהירים בלי לקטוע, כי ה-execution כבר קרה וה-data כבר ב-DB. קטיעת write-in-progress הופכת inconsistency, לא פותרת.
3. **Baseline-aware alert** — threshold absolute לבד לא מספיק ($15 אולי מעט/הרבה מדי). Rolling baseline נמדד "לפי מה שרגיל בשבועיים האחרונים" — ככל שה-agent מתפתח ועובד יותר, ה-baseline מותאם אוטומטית.
4. **Claude Code native `--max-turns` > wrapper** — כלום להטעמה, flag אחד ב-CLI. Home-grown watcher שקורא stdout = hack מיותר.

### קבצים שהשתנו / להישתנות

1. [`docs/plans/decisions-log.md`](decisions-log.md): נוסף הערך הזה (§3.4).
2. [`docs/plans/conversation-map.md`](conversation-map.md): 3.4 ✅ + עדכון סטטוס.

**Implementation landing (future):**

- `runners/daily_observe_propose.sh`, `runners/execute_approvals.sh`, `runners/weekly_creative_firehose.sh` — task 4.6. כל runner יקרא ל-`claude -p ... --max-turns N --output-format json | python campaigner/lib/cost_tracker.py`.
- `campaigner/lib/cost_tracker.py` — task 4.2. Parse JSON output, log `run_summary` decision עם `run_cost_usd`, kick anomaly flag אם ceiling.
- `scripts/check_daily_cost.py` — task 4.6 או Phase 2. Query + email alert.

### מה נשאר פתוח (depends on)

- **Baseline gathering** — דורש ~2 שבועות של Phase 2 לפני ש-Layer 3 באמת שימושי. עד אז, eyeballing ידני.
- **Alert transport** — email דרך SendGrid/SMTP? או רק log ל-Cloud Logging עם alert policy ב-GCP? מחליטים ב-Phase 2 כשה-check_daily_cost.py נכתב.
- **Upper bound הולם** ל-monthly cost — לא ב-scope של 3.4, אבל ראוי לקבל eyeball: אם Claude monthly > $100/חודש (4× ה-estimate ב-CLAUDE.md) = incident.

---

## 1.8 PRD gap closure — schema additions + §1.7 alignment

**סטטוס:** ✅ סגור 2026-04-20
**Owner:** Roi
**Scope:** סגירת חוסרים שזוהו בסקירה משותפת של backend + frontend PRDs: שדות schema שה-PRDs הפנו אליהם ולא היו ב-migrations 001-007, וסתירות בין ה-frontend PRD ל-[§1.7](#17-גישת-משתמשים-שניים--single-user-mvp--c-hook-לעתיד) (user_business_access, stakeholder persona, three-user setup).

### ההתלבטות

12 פריטים שזוהו בסקירה:

1. `user_business_access` — frontend PRD מניח שהטבלה קיימת; §1.7 קבע שלא.
2. `businesses.meta_auth_mode` — בmigration 001 אבל לא ב-spec §10.1.
3. תוקף טוקן Meta — ה-PRDs מפנים ל-"פרסר טקסט חופשי מ-agent_decisions.summary", צריך שדה structured.
4. Phase 4 frontend — סתירה פנימית: AC אומר "no filters", non-goals אומר "no batch approve, no CSV", אבל Phase 4 מתאר את שלושתם.
   5-7. `baselines.low_confidence`, `business_knowledge.tracking_verified` + tracking\_\* fields, `approvals.approved_by_override` — PRDs מפנים; אין ב-schema.
5. `payload.guardrail_override_required` — מי הכותב, ואיך frontend שואל ב-WHERE ללא JSONB dig.
6. `approved_by` — מה הערכים ב-CLI? ב-web?
7. `refresh_baselines.py` — spec §18.1 מגדיר cron slot, אבל לא את ה-runtime (Job נפרד? entrypoint? SA?).
8. `onboarding/aiweon.yaml` — מוזכר ב-spec §11.5 ובbackend PRD; schema לא מוגדר.
9. `heartbeats.expected_duration` — frontend מחשב `×2` לאיתור overdue, הערך לא נשמר באף מקום.

### ההחלטה

כל 12 נסגרו ב-batch אחד (מיגרציה 008 + עדכוני מסמכים). אין החלטות עיצוב חדשות — רק alignment עם החלטות קיימות (§1.7, §3.1, §3.4, §1.2).

### תכולת ההחלטה

**Schema — migration [008_schema_additions.sql](../../migrations/008_schema_additions.sql):**

- `businesses.meta_access_token_expires_at timestamptz` — structured token expiry.
- `business_knowledge.tracking_verified boolean` + 4 שדות tracking — Day-Zero guardrail.
- `baselines.low_confidence boolean` — cold-start flag per EVALUATION §9 #1.
- `approvals.approved_by_override jsonb` — soft-guardrail override payload.
- `approvals.guardrail_override_required boolean GENERATED` — משקף `payload.guardrail_override_required` לשאילתות.
- אינדקס חלקי: `approvals_override_idx` (business_id, status) WHERE `guardrail_override_required = true`.

**Spec updates:**

- §10.1: הוספנו `meta_access_token_expires_at` + `meta_auth_mode` (sync עם migration 001).
- §10.2: הוספנו 5 שדות tracking.
- §10.3: הוספנו `low_confidence`.
- §10.4: הוספנו `approved_by_override` + `guardrail_override_required` generated column + הערך `dry_run` ב-status enum. Comment על `approved_by` מראה ערכים אפשריים.
- §10.7: דוגמת RLS מעודכנת למדיניות §1.7 (allow-list ב-middleware + `auth.jwt() ->> 'email'` ב-policy). `user_business_access` מסומן במפורש כ-v2.
- §10.8: הוסף הסבר ש-`expected_duration` נחיה כ-constant ב-`campaigner/lib/flow_config.py`, לא כעמודה.
- §10.9 (חדש): טבלת סיכום למיגרציה 008 + פרוטוקול כתיבת `payload.guardrail_override_required`.
- §11.5: הוסף מבנה YAML מלא ל-`onboarding/<business>.yaml`.
- §18.1: הוסף פסקה על ה-runtime של `monthly-baseline-refresh` (Cloud Run Job נפרד, entrypoint אחר, בלי Anthropic secret).

**Backend PRD updates:**

- AC חדש: "`approved_by` values" — `admin@aiweon.co.il` (web) | `terminal` (CLI) | `auto` (v2).
- AC חדש: "`expected_duration` per flow — constant, not column" + endpoint `/api/flow-config`.
- AC חדש: "`monthly-baseline-refresh` runtime" — Cloud Run Job נפרד.
- AC מעודכן: "Guardrails split" — פסקה "Where `payload.guardrail_override_required=true` comes from" מפרטת ש-`propose_task.py` הוא ה-writer.
- `rotate-token` — כותב ל-`businesses.meta_access_token_expires_at` + שורת audit, לא רק ל-summary.
- Data model — הוסף הערה ש-retention 90 ימים, frontend מציג 30 ימים default.
- הסרת persona "Aiweon marketing stakeholder" (§1.7).

**Frontend PRD updates:**

- Personas: הסרת Stakeholder; הוסף callout ש-§1.7 דוחה את ה-persona ל-v2.
- Problem statement: הסרת "stakeholder laptop" + "Aiweon's marketing team".
- Tier 3: הסרת "cross-business data leakage" (single business).
- US-F6 Decision history: operator (לא stakeholder). הוסף הערה על retention 90 vs UX 30.
- Data Access — RLS-First: נכתב מחדש למדיניות §1.7 (allow-list + `auth.jwt()`, בלי `user_business_access`).
- Phase 0 scaffold: test harness הועבר מ-three-user ל-two-case.
- Phase 4: הוברר — gate filter, Realtime, 30↔90 toggle. Campaign filter/batch approve/CSV **לא** בPhase 4 (v2).
- Token-expiry warning AC: קורא מ-`businesses.meta_access_token_expires_at` (לא agent_decisions.summary).
- Auth AC: הוסף middleware check מול `ALLOWED_OPERATOR_EMAIL`.
- E-F2 RLS tests: הוברר ל-MVP (two-case) + v2 (three-case).

### הנימוקים

1. **חוסר תיעוד של שדה ב-PRD גורר או קוד שבור או migration נסתר בהמשך.** §10.9 מרכז את חמשת השדות החדשים במקום אחד, PRDs מפנים אליו.
2. **§1.7 כבר סגר את ה"שני משתמשים" — ה-frontend PRD פשוט לא עודכן.** אין שינוי עיצוב פה, רק alignment. ה-follow-up ב-§1.7 ("task 4.7 צריך לעדכן §378") — בוצע עכשיו במקום מאוחר יותר, כי בלי העדכון ה-developer שיתחיל frontend יבנה בלבול.
3. **סתירות פנימיות בPhase 4 הן חוב אמיתי.** ה-AC אומר "no filters", non-goals אומר "no batch", אבל Phase 4 מבטיח את שלושתם. אי-אפשר לבחור phase exit criterion בלי לפתור.
4. **`expected_duration` כ-constant ולא כעמודה** — 4 ערכים, משתנים נדיר, שינוי דרך PR. טבלה נפרדת היא over-engineering.
5. **Generated column למקום לפרסר JSONB** — Supabase Realtime filter לא יודע לנווט ב-JSONB בלי functions; generated + index פותר גם שאילתות UI.

### קבצים שהשתנו

1. [`migrations/008_schema_additions.sql`](../../migrations/008_schema_additions.sql) — חדש.
2. [`migrations/README.md`](../../migrations/README.md) — הוסף 008 לטבלאות.
3. [`docs/plans/campaigner-spec.md`](campaigner-spec.md) — §10.1/10.2/10.3/10.4/10.7/10.8/10.9/11.5/18.1.
4. [`docs/plans/campaigner-backend-prd.md`](campaigner-backend-prd.md) — Personas, AC לגבי approved_by/expected_duration/refresh_baselines, rotate-token, Guardrails split, retention.
5. [`docs/plans/campaigner-frontend-prd.md`](campaigner-frontend-prd.md) — Personas, Problem Statement, Tier 3, US-F6, Phase 0/4, Auth, Token-expiry AC, RLS section, E-F2.
6. [`docs/plans/decisions-log.md`](decisions-log.md) — §1.8 הזה.

### מה נשאר פתוח (depends on)

- **Post-migration RLS policies file** — צריך ליצור `migrations/rls_policies.sql` (נפרד מ-001-008) עם הpolicies של §1.7. נדחה עד תחילת Frontend Phase 0 (task 4.7) — אז ה-DB target יהיה ברור.
- **`flow_config.py` + `/api/flow-config` Route Handler** — ייווצרו ב-task 4.2 (backend lib) ו-task 4.7 (frontend) בהתאמה.
- **`campaigner rotate-token` — עדכון `meta_access_token_expires_at`** — ייכתב ב-task 4.6 (CLI).

---

## 1.9 Creative gallery, manual video upload, multi-service campaign structure

**סטטוס:** ✅ סגור 2026-04-20
**Owner:** Roi
**Scope:** ארבע החלטות שמגיעות מ-UX feedback על approval detail + שאלת portfolio structure של סוכנות מרובת-שירותים. כל הארבע שלובות כי כולן משנות איך הסוכן מציע `new_campaign` ואיך הוא מושך נכסים.

### ההתלבטות

1. **גלריה standalone** — frontend PRD ([§2 line 186](campaigner-frontend-prd.md)) קבע במפורש: אין דף גלריה ב-MVP, רק inline preview באישור. Roi ביקש דף מלא: list + upload + preview + delete + tagging. זה היפוך מפורש.

2. **וידאו ב-MVP** — spec §7.1 קבע: "יצירת וידאו AI ❌ MVP, ✅ v2". Roi ביקש שהוידאו יעלה ידנית מהעלאות משתמש מהיום הראשון. AI video generation נשאר v2; העלאה ידנית — MVP.

3. **`new_campaign` budget-aware** — spec §10.1 כולל `businesses.monthly_budget_ils` וסעיף §2.1 מגדיר "ניהול תקציב חודשי" כיכולת MVP #1, אבל עץ ההחלטות בפועל ([decision-tree.md](../../campaigner/prompts/decision-tree.md)) לא מכיל כלל שבודק תקציב לפני הצעת `new_campaign`. התוספת: הסוכן חייב לבדוק headroom מול `monthly_budget_ils`, ואם אין — להמליץ הגדלת תקציב עם פרויקציית לידים צפויה.

4. **Portfolio structure למפרסם רב-שירותי** — שאלה חדשה מ-Roi: כמה קמפיינים במקביל כשמפרסם מוכר 5 שירותים שונים? לא היה בשום doc. נסגר בעזרת research agent (דוח: 2026-04-20) שהתבסס על ה-deep_research/ הקיים + CAMPAIGN_BUILDING_RECOMMENDATIONS.md §1.

### ההחלטה

**1. דף גלריה מלא ב-MVP.** Route `/gallery`: רשימה, העלאה (תמונה + וידאו), תצוגה מקדימה, מחיקה, תיוג (`marketing_angle`, `aspect_ratio`, `kind`, `service_tag` חדש). הסוכן מושך מהגלריה כשהוא מציע `new_creative` או `new_campaign`.

**2. וידאו manual ב-MVP.** טבלת §7.1 מתעדכנת: "יצירת וידאו AI ❌ MVP ✅ v2" נשאר, מתווסף שורה חדשה "העלאת וידאו ידנית ✅ MVP". ולידציה ב-upload endpoint לפי מגבלות Meta: MP4/MOV, ≤ 4GB, aspect ratio 1:1 / 4:5 / 9:16 / 16:9, משך 1-241 שניות.

**3. `new_campaign` budget-aware.** עץ החלטות חדש §T7 ב-decision-tree.md:

```
לפני כל propose new_campaign:
  current_monthly_spend = sum(active daily_budget × 30) + spent_this_month
  headroom = monthly_budget_ils - current_monthly_spend

  IF headroom < (target_cpa × 50) / 7 × 30
    → אל תציע new_campaign. במקום זה:
        IF יש winner קיים (CPA < target × 0.8 לאורך ≥ 5 ימים)
          → propose scale_up על ה-winner
        ELSE
          → propose alert + המלצת הגדלת תקציב חודשי
             rationale: "כדי לפתוח שירות נוסף בעלות יעד ₪X, נדרשים ₪Y לחודש נוספים.
                        צפי: Z לידים נוספים לחודש לפי baseline."
  ELSE
    → המשך בזרם new_campaign הרגיל
```

**4. Multi-service portfolio rules** (מ-research 2026-04-20, מבוסס על grok §1, manus §1, CAMPAIGN_BUILDING §1):

**שאלת onboarding חדשה:** "Do these services share a buyer persona and funnel?" — לכל זוג שירותים, מקבץ אותם ל-**persona groups**. מספר הקבוצות = `G`.

**כללי מבנה (hard, deterministic):**

| תנאי                                               | מבנה                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `G == 1` + target CPL אחיד בין השירותים (±30%)     | **1 קמפיין + 1 ad set**, שירותים = creative variants מתויגים |
| `G == 1` + target CPL נבדל > 30%                   | **1 קמפיין + עד N ad sets** (אחד לשירות), CBO פעיל           |
| `G >= 2` + תקציב ≥ `G × (max target CPA × 50) / 7` | **G קמפיינים** נפרדים                                        |
| Otherwise                                          | כפייה ל-`G = 1`, התראה למשתמש שהתקציב לא תומך בהפרדה         |

**Hard caps ל-MVP:**

- **Max 3 ad sets per campaign**. מעל זה = over-segmentation (flagged as deprecated ב-CAMPAIGN_BUILDING §10).
- **Max 2 parallel campaigns per business**. שלישי דורש HITL justification מפורש.
- **CBO only** — אסור ABO בין שירותים. חלוקה "הוגנת" בין שירותים היא ABO מחופש ויוצרת את אותה over-segmentation.
- **Creative quota per ad set, not per service:** 10-12 initial + 3-5/week. ב-consolidated setup (G=1, ad set אחד, 5 שירותים) = ~2 קריאייטיבים ראשוניים לשירות, rotation שבועי של ~1 לשירות.
- **Cannibalization flag:** אם שני קמפיינים פעילים על אותו broad audience (אותו gender/age/region) — הסוכן מציין את זה באישור ומציע merge.

### הנימוקים

1. **גלריה** — השיחה עם Roi (2026-04-20): "אמרנו שהוא יכול למשוך תמונות סרטונים מהגלריה". ה-spec §7.1 כבר הזכיר "שליפה מגלריה ✅ MVP" אז ההחלטה עקבית; מה שחסר היה ה-UX לכניסת התוכן (user upload).

2. **וידאו** — AI video generation = expensive + v2 feature. Manual upload = pure storage + ולידציה, אפס עלות runtime. מאפשר לפרסומאי להשתמש בתוכן קיים שלו (צילומי לקוחות, סרטוני portfolio) בלי להמתין ל-v2.

3. **Budget awareness** — spec כבר גדר את היכולת ("ניהול תקציב חודשי"), אבל בלי כלל מפורש בעץ ההחלטה הסוכן היה יכול להציע קמפיין חדש בלי מודעות ל-cap. ההמלצה "הגדל תקציב" היא Andromeda-native — winner קיים עם headroom יקבל את הכסף בלי Learning reset.

4. **Portfolio structure** — research מצא שההבדל העיקרי הוא persona, לא service count. 5 שירותים לאותו SMB owner ישראלי = קמפיין אחד עם 10-12 creatives מתויגים. הפרדה לקמפיינים שונים מפצלת את נפח ה-lead events פי N ומפילה את רוב הקמפיינים מתחת לסף 50 events/week של Learning. `G × (target CPA × 50) / 7` הוא הסף ההכרחי, לא המלצה.

### קבצים שהשתנו

1. [`docs/plans/campaigner-frontend-prd.md`](campaigner-frontend-prd.md):
   - §2 — פריט creative preview (line ~117): הוסרה השורה "No standalone creative gallery page in MVP — deferred to v2". הוסף section חדש "**Creative gallery page (`/gallery`)**" עם AC מלא.
   - §2 Non-Goals — הוסרה השורה "Standalone creative gallery page".

2. [`docs/plans/campaigner-backend-prd.md`](campaigner-backend-prd.md):
   - §2 — הוסף US-B12 (manual asset upload with validation), US-B13 (budget-aware new_campaign), US-B14 (multi-service onboarding + structure rules).
   - §2 AC — הוסף bullets ל-upload endpoint, video validation, service_tag, multi-service caps.

3. [`docs/plans/campaigner-spec.md`](campaigner-spec.md):
   - §7.1 table — נוסף שורה "העלאת וידאו ידנית ✅ MVP".
   - §10.6 `creative_gallery` — נוסף `service_tag text` (אופציונלי, לתיוג שירות).
   - §11 — נוסף flow 4 (gallery-sourced new_campaign trigger from daily observe-propose).
   - §17 (decision tree) — נוסף §T7 (budget-aware new_campaign), §T8 (multi-service structure validator).

4. [`campaigner/prompts/decision-tree.md`](../../campaigner/prompts/decision-tree.md):
   - נוסף §T7 + §T8 עם הכללים הדטרמיניסטיים המלאים.

5. [`campaigner/prompts/hebrew-copy-style.md`](../../campaigner/prompts/hebrew-copy-style.md):
   - נוסף §11 (TL;DR-first rationale, acronym glossing, summary pattern) — החלטה קשורה מאותה שיחה.

6. [`campaigner/CAMPAIGNER.md`](../../campaigner/CAMPAIGNER.md):
   - Rule #4 עודכן לכוון ל-§11 ב-hebrew-copy-style.md במקום לקובץ כולו.

7. [`migrations/009_gallery_additions.sql`](../../migrations/009_gallery_additions.sql) — חדש. מוסיף `creative_gallery.service_tag`, enum ל-`generated_by` שכולל `'manual_upload'` (כבר בscheme אבל בלי CHECK), Storage bucket policy ל-video uploads.

### מה נשאר פתוח (depends on)

- **Onboarding form update** — הטופס המובנה ב-frontend `/business-knowledge` צריך שדה חדש "services" (מערך) + שאלת "persona groups" (matrix UI של זוגות שירותים). זה חלק מ-business_knowledge.questionnaire_answers. ייכתב ב-task 4.9 (frontend business knowledge form, Phase 3).
- **Storage bucket + signed URLs** — Supabase Storage bucket `creative-gallery` + RLS policies + signed URL generation לתצוגה מקדימה ב-UI. ייכתב ב-task 4.8 (backend upload endpoint).
- **Video ולידציה programmatic** — aspect ratio + duration + codec נבדקים ב-upload endpoint, לא ב-CLI. library נבחר בזמן implementation (probably `ffprobe` דרך subprocess).
- **Research ופערים פתוחים** — 6 שאלות onboarding שה-research דגל ([report 2026-04-20](../../C:\Users\harel\AppData\Local\Temp\claude\d--meta-ads-automation-ai\fd5833f0-a880-4a92-8457-092fcda5e3da\tasks\af66344b2357329a2.output), §5): per-service target CPL, funnel divergence, sales-team bandwidth, persona overlap, flagship service, budget ceiling. ייכנסו ל-questionnaire ב-task 4.9.

---

## 1.12 Meta integration scope — dual-path tokens + capability layer

**סטטוס:** ✅ סגור 2026-05-11
**Owner:** Roi
**Scope:** Meta OAuth, token storage, scope/capability mapping, App Review submission strategy. לא כולל: WhatsApp messaging, webhook subscriptions לתוכן אורגני (שלב 2).

### ההתלבטות

3 שאלות חוסמות עלו לפני שאפשר היה לכתוב את [`meta-integration-readiness.md`](meta-integration-readiness.md):

1. **CRM scope** — האם Campaigner מתרחב ל-CRM מלא (`workspace`, `crm_account`, `crm_contact`), נשאר ממוקד עם hook חיצוני, או מחליטים אחר כך?
2. **Tenancy** — האם prod מפעיל רק את Aiweon (System User Token), רק SaaS רב-משתמשי (OAuth), או שניהם?
3. **Instagram Login path** — FB Login + IG-linked-to-Page (הקוד הנוכחי), Instagram Login ישיר, או שניהם?

### ההחלטה

| # | החלטה |
|---|---|
| 1 | **Hook חיצוני.** אין `workspace` / `crm_account` / `crm_contact` בריפו. מוסיפים `external_crm_ref jsonb` ל-`approvals`, `creative_gallery`, ולכל טבלאות `meta_*` החדשות. |
| 2 | **שני המסלולים.** Aiweon = System User Token (נתיב A, ללא תפוגה). SaaS עתידי + demo ל-App Review = OAuth long-lived (נתיב B, ~60 יום עם sliding). שתי הדרכים חיות במקביל ומובחנות דרך `businesses.meta_auth_mode`. |
| 3 | **FB Login + IG-linked-to-Page בלבד.** קוד נתיב יחיד, use case יחיד ב-App Review. |

### הנימוקים (בסדר יורד של חשיבות)

1. **יציבות תפעולית — System User Token.** השאלה של Roi "אני לא רוצה להתחבר כל שנייה" נפתרת לא ע"י שיפור UX של OAuth, אלא ע"י לא להפעיל prod מ-User Token בכלל. System User Token מ-Business Manager לא פג; Page tokens שנגזרים ממנו גם הם ללא תפוגה. זה הסטנדרט של Meta לאוטומציות in-house ולאג'נסי. ההחלטה תלויה ב-§1.2 (Business Verification) — שכבר ✅.

2. **OAuth חובה ל-App Review, גם אם Aiweon לא צריכה.** Meta דורשת screencast עם משתמש test שמחבר את החשבון. בלי Path B אי אפשר להגיש את `ads_management`. לכן Path B נבנה גם אם אין כרגע tenant SaaS.

3. **CRM hook ולא CRM מלא.** הזכרת `workspace`/`crm_account`/`crm_contact` בתוכנית של Roi מקורה ב-Aiweon SaaS הרחב, לא ב-Campaigner. ייצור של טבלאות CRM ריקות עכשיו = פי 2 עבודה + סיכון Meta לדחות App Review על "scope creep" (היישום לא תואם use case). עמודות `external_crm_ref` שומרות על האפשרות לחיבור עתידי בלי לקבע צורה.

4. **מסלול IG יחיד = פחות שטח דחייה.** Meta מגישה Instagram API דרך 3 use cases שונים; שני שלהם פעילים מ-2024 (FB Login + IG Login). תמיכה בשניהם = פי 2 בדיקות + פי 2 use cases ב-App Review + סיכוי דחייה גבוה אם אחד לא ברור. הקוד הקיים ב-[`web/src/lib/meta.ts:505-517`](../../web/src/lib/meta.ts#L505-L517) כבר מניח Page-token-via-FB-Login → לא משנים.

### Tiering ל-App Review — בסיס להחלטות עתידיות

הגשת כל ה-scopes ב-bundle אחד = סיכוי דחייה גבוה (כל skopa לא ברור מפיל את כולן). מגישים ב-4 tiers:

| Tier | Use case | Scopes | תלוי ב- |
|---|---|---|---|
| 1 | Read Marketing + Pages + IG | `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`, `ads_read`, `business_management` | BV (חלקית) |
| 2 | Publish to Pages + IG | `pages_manage_posts`, `instagram_content_publish` | Tier 1 ✅ |
| 3 | Marketing API write | `ads_management` | Tier 2 ✅ + BV `verified` |
| 4 | WhatsApp | `whatsapp_*` | track נפרד |

### קבצים שהשתנו / נוצרו

1. [`docs/plans/meta-integration-readiness.md`](meta-integration-readiness.md) — **חדש**. תוכנית מלאה: שני המסלולים, capability layer, OAuth routes, 5 שלבי יישום.
2. [`migrations/011_meta_connections.sql`](../../migrations/011_meta_connections.sql) — **חדש**. טבלאות `meta_connections`, `meta_pages`, `meta_ig_accounts`, `meta_ad_accounts`, `meta_oauth_state`.
3. [`migrations/012_meta_api_audit.sql`](../../migrations/012_meta_api_audit.sql) — **חדש**. טבלת `meta_api_calls` ל-audit + GDPR + rate-limit accounting.
4. [`migrations/013_agent_mode_and_crm_hooks.sql`](../../migrations/013_agent_mode_and_crm_hooks.sql) — **חדש**. `businesses.agent_mode` + `external_crm_ref` על `approvals` ו-`creative_gallery`.
5. [`web/src/lib/meta-capabilities.ts`](../../web/src/lib/meta-capabilities.ts) — **חדש**. Scope groups + capability spec + readiness check (pure, ללא Graph calls).
6. [`web/src/lib/schemas/meta-connection.ts`](../../web/src/lib/schemas/meta-connection.ts) — **חדש**. Zod schemas לחיבור + readiness + asset selection.
7. [`web/CLAUDE.md`](../../web/CLAUDE.md) — **עודכן**. הכלל "No direct Meta API calls from the web" משתנה ל-"No direct Meta **write** calls; reads עבור OAuth + readiness מותרים דרך `meta-capabilities.ts`".

### מה נשאר פתוח (depends on)

- **Phase 2 (encryption):** `web/src/lib/crypto.ts` + secret `meta-encryption-key-v1` ב-GCP Secret Manager. לא בענף הזה.
- **Phase 3 (OAuth routes):** `/api/meta/oauth/*` + `/api/meta/deauthorize` + `/api/meta/data-deletion`. לא בענף הזה.
- **Phase 4 (UI):** `/integrations` route + asset picker + readiness dashboard. לא בענף הזה.
- **Phase 5 (Submit):** live deploy של callback URLs + screencasts + הגשת Tier 1. תלוי ב-§1.2 BV verified.
- **Webhooks אורגניים (feed/comments/mentions):** שלב 2 — `docs/plans/meta-webhooks-phase2.md` (טרם נכתב).
