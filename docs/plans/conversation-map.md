# Conversation Map — Campaigner MVP

> **איך להשתמש:** כל שיחה חדשה מתחילה בשורת פתיחה אחת בלבד (מועתק מסעיף להלן).
> שיחה אחת = נושא אחד. אחרי סגירה — שיחה חדשה לנושא הבא.
> סדר מומלץ: 1.1 → 1.2 → 1.3 (במקביל ל-2.2) → 1.4 → 2.1 → 1.5 → 1.6 → 1.7 → קבוצה 3 → קבוצה 4.

---

## קבוצה 1 — החלטות פתוחות

סוגרים לפני כתיבת קוד. ~30-60 דק' כל אחת.

### 1.1 ניהול secrets — ✅ 2026-04-19

**פתח:** _"בוא נסגור איך אנחנו שומרים secrets — Google Secret Manager כמו שה-spec אומר, או `.env.production` על Cloud Run כמו שה-backend PRD אומר"_
**Scope:** `ANTHROPIC_API_KEY`, `META_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`. לא `BUSINESS_ID`.
**Output:** הכרעה + amendment ב-PRD/CLAUDE.md.
**החלטה:** Google Secret Manager ל-production; `.env` ל-dev-local. תיעוד מלא ב-[decisions-log.md §1.1](decisions-log.md#11-secret-management--google-secret-manager).

### 1.2 Meta Business Verification — timing — ✅ 2026-04-19

**פתח:** _"נכריע אם להתחיל Business Verification ב-Phase 0 או לדחות ל-Phase 6 כמו שה-PRD מציע"_
**Scope:** רק ה-timing.
**Output:** החלטה + השלכות (rotation ידני vs System User Token).
**החלטה:** Hybrid — הכנת BV מתחילה Phase 0 במקביל לפיתוח; עד האישור חיים עם rotation כל 60 יום; תשתית dual-mode מראש (`businesses.meta_auth_mode`). תיעוד מלא ב-[decisions-log.md §1.2](decisions-log.md#12-meta-business-verification--timing).

### 1.3 Meta App Review — bundle או serial — ✅ 2026-04-19

**פתח:** _"בוא נחליט אילו Meta permissions מגישים באותה הגשה — bundled או איטרטיבית"_
**Scope:** `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `instagram_basic`. לא `whatsapp_business_management`.
**Output:** רשימת permissions להגשה + תבנית use-case לכל אחד.
**החלטה:** Bundle — הגשה אחת של כל 6 ההרשאות יחד עם video demo משותף. deliverable מלא ב-[meta-app-review-submission.md](meta-app-review-submission.md). תיעוד מלא ב-[decisions-log.md §1.3](decisions-log.md#13-meta-app-review--bundle-vs-serial).

### 1.4 Staging/prod schema sync — ✅ 2026-04-19 → 🟡 re-opened 2026-04-19 (DB choice)

**פתח:** _"בוא נחליט איך מסנכרנים migrations בין הסכמות `public` ו-`staging` באותו Supabase project"_
**Scope:** ה-mechanism + dev-local target.
**Output:** החלטה + `migrations/README.md` + עדכון `docker-compose.yml`.
**החלטה:** שלוש החלטות באותה סגירה — (1) Supabase נשאר (re-opening Mongo/generic_agent נסגר עוד פעם), (2) dev-local = Postgres ב-Docker, (3) סנכרון `public`↔`staging` = dual-write + CI diff. תיעוד מלא ב-[decisions-log.md §1.4](decisions-log.md#14-stagingprod-schema-sync--dual-write--ci-diff).

### 1.5 Hebrew copy style — מי כותב — ✅ 2026-04-19 (החלטה); 🟡 content fill-in עד 2026-05-10

**פתח:** _"בוא נסגור מי כותב את brand voice של Aiweon — אני, צוות Aiweon, או חילוץ מחומרי שיווק קיימים"_
**Scope:** רק תוכן — לא המבנה הטכני.
**Output:** deliverable definition + owner + deadline.
**החלטה:** D-lite hybrid — AI מייצר skeleton + חילוץ light, Roi כ-owner יחיד ממלא `[TBD]` וחותם v1 עד 2026-05-10. Skeleton ב-[campaigner/prompts/hebrew-copy-style.md](../../campaigner/prompts/hebrew-copy-style.md). תיעוד מלא ב-[decisions-log.md §1.5](decisions-log.md#15-hebrew-copy-style--authorship).

### 1.6 `web/` monorepo — ✅ 2026-04-19

**פתח:** _"בוא נכריע אם ה-frontend חי כ-`web/` sibling בתוך הרפו, או ברeppo נפרד"_
**Scope:** רק ה-repo topology.
**Output:** החלטה + עדכון spec §19.
**החלטה:** A — `web/` sibling ב-monorepo. שני Dockerfile-ים, CI עם path filters. [decisions-log §1.6](decisions-log.md#16-webfrontend--repo-topology).

### 1.7 גישת משתמשים שניים — ✅ 2026-04-19

**פתח:** _"בוא נחליט איך נותנים גישה read-only לאיש השיווק של Aiweon, או שדוחים ל-v2"_
**Scope:** רק ה-policy.
**Output:** החלטה בין "רק אתה ב-MVP" / "שני משתמשים RLS" / "stakeholder רואה רק history".
**החלטה:** A — single-user (רק Roi) ב-MVP, עם hook זול ל-C (weekly digest) בעתיד. RLS enabled כ-infrastructure ready אבל בלי policies של multi-tenant עדיין. [decisions-log §1.7](decisions-log.md#17-גישת-משתמשים-שניים--single-user-mvp--c-hook-לעתיד).

---

## קבוצה 2 — משימות אדמין (long lead)

פעולות, לא שיחות החלטה. להתחיל אחרי הפריט המקביל מקבוצה 1.

### 2.1 יצירת פרויקט Supabase

**פתח:** _"בוא נעבור שלב-שלב על יצירת פרויקט Supabase — region, schema setup, user_business_access, first migration"_
**Prereq:** 1.4 סגור.

### 2.2 הגשת Meta App Review — ✅ 2026-04-19 (scope של השיחה; הגשה חסומה על Phase 1)

**פתח:** _"בוא נכין את חבילת הגשת ה-Meta App Review — use-case, video demo, privacy policy"_
**Prereq:** 1.3 סגור.
**סטטוס:** 5 החלטות טקסטואליות סגורות + 3 supporting docs מנוסחים ([privacy](meta-app-review-privacy-policy.md) / [deletion](meta-app-review-data-deletion.md) / [usage summary](meta-app-review-data-usage-summary.md)). השיחה נסגרה. **הגשה עצמה (video + Live Mode + submit) חסומה על Phase 1 ומנוהלת דרך [submission doc §7 checklist](meta-app-review-submission.md#7-submission-checklist-task-22)** — לא שיחה חדשה, אלא execution של ה-checklist הקיים כש-CLI מוכן.

### 2.3 Anthropic key + GCP quotas — 🟡 deliverable מוכן 2026-04-19

**פתח:** _"בוא נוודא ש-Anthropic API key ו-GCP Imagen quotas מוכנים ל-Phase 1"_
**Prereq:** 1.1 סגור.
**סטטוס:** checklist + validation script + .env.example מעודכנים. הרצת ה-checklist בפועל נשארה על Roi (ראה [task-2.3-keys-and-quotas.md](task-2.3-keys-and-quotas.md)).

### 2.4 הגשת BV של Bemtech — 🟡 תשתית מוכנה 2026-04-19

**פתח:** _"בוא נעבור על הכנת חבילת BV של Bemtech — מסמכי חברה, Business Manager setup, הגשה"_
**Prereq:** 1.2 סגור.
**זמן הכנה:** ~חודש (איסוף מסמכים) + 1-2 שבועות Meta review. רץ במקביל לפיתוח, לא חוסם phase.
**סטטוס:** 2 docs מוכנים — [task-2.4-bemtech-bv.md](task-2.4-bemtech-bv.md) (הנחיות תהליך + pitfalls + post-approval actions) ו-[bemtech-bv-requirements.md](bemtech-bv-requirements.md) (checklist דרישות מסמכים + fields). ההגשה עצמה + איסוף המסמכים אצל Roi.

---

## קבוצה 3 — מילוי פערים

נושאים שה-PRDs לא מכסים.

### 3.1 CI/CD pipeline — ✅ 2026-04-19

**פתח:** _"בוא נתכנן מה קורה מ-git push ועד Cloud Run Job / GKE — GitHub Actions? ידני?"_
**החלטה:** GH Actions + WIF + compose-based tests + build+push ל-AR (deploy נדחה). Backend workflow live; frontend נדחה ל-4.7. תיעוד: [decisions-log §3.1](decisions-log.md#31-cicd-pipeline), setup one-time של Roi ב-[task-3.1-cicd-setup.md](task-3.1-cicd-setup.md).

### 3.2 מנגנון הרצת migrations — 🟡 local ✅ 2026-04-19; remote pending 1.4

**פתח:** _"בוא נחליט איך מריצים את 7 ה-SQL migrations — `supabase db push`, psql ידני, או mechanism אחר"_
**Prereq:** 1.4 סגור (חלק ב').
**החלטה (local):** Python scripts idempotent, forward-only, numbered prefix, דרך `docker compose`. כבר מומש ב-[§1.4 amendment](decisions-log.md#amendment-2026-04-19--re-open-db-choice). Remote runner ייכתב אחרי 1.4. תיעוד: [decisions-log §3.2](decisions-log.md#32-מנגנון-הרצת-migrations).

### 3.3 גיבוי / DR — 🟡 policy ✅ 2026-04-19; impl pending 1.4

**פתח:** _"בוא נחליט על backup strategy ל-Supabase — Supabase-built-in enough, או לגיבוי נוסף?"_
**החלטה:** Two-layer — managed provider daily + weekly independent dump ל-GCS bucket (`bemtech-backups-campaigner/`, 90-day retention). RTO/RPO = 24h. Quarterly test-restore. Implementation נדחה ל-post-1.4. תיעוד: [decisions-log §3.3](decisions-log.md#33-backup--dr).

### 3.4 הגנה מ-infinite loops של Claude — ✅ 2026-04-19

**פתח:** _"בוא נתכנן איך נזהה תקלה כמו infinite tool-call loop לפני שהחשבוניות של Anthropic מגיעות"_
**החלטה:** 3-layer defense — `--max-turns` per runner (prevention) + per-invocation cost ceiling (detection, log not kill) + daily anomaly alert (monitoring, baseline-aware). Implementation landing ב-tasks 4.2/4.6. תיעוד: [decisions-log §3.4](decisions-log.md#34-הגנה-מ-infinite-loops-של-claude).

---

## קבוצה 4 — פיתוח בפועל (phases, לא שיחות יחידות)

אחרי קבוצות 1+2+3.

### 4.1 כתיבת migrations

**פתח:** _"בוא נכתוב את `migrations/001_businesses.sql` (ואז 002-007) לפי spec §10"_

### 4.2 `campaigner/lib/`

**פתח:** _"בוא נעטוף את `meta_ads_manager.py` → `campaigner/lib/meta_client.py` וכמו כן `image_generator.py`, `supabase_client.py`"_

### 4.3 הכלים הראשונים

**פתח:** _"בוא נבנה את 4 הכלים הראשונים: `fetch_insights.py`, `load_baselines.py`, `log_decision.py`, `propose_task.py` — לפי חוזה §11.6"_

### 4.4 CAMPAIGNER.md + prompts

**פתח:** _"בוא נחבר את `campaigner/CAMPAIGNER.md` + `prompts/performance-brain.md` בעברית, מעוגנים ב-CAMPAIGN_EVALUATION"_
**Prereq:** 1.5 סגור.

### 4.5 Golden set (13 תרחישים)

**פתח:** _"בוא נכתוב את 13 ה-fixtures של golden-set E1 ב-`tests/golden/`"_
**Prereq:** 4.4 הושלם.

### 4.6 CLI ו-runners

**פתח:** _"בוא נבנה את `campaigner` binary + `runners/_.sh` + Dockerfile"\*

### 4.7 Frontend Phase 0

**פתח:** _"בוא נתחיל web frontend Phase 0 — Next.js scaffold + auth + deploy pipeline"_
**Prereq:** backend Phase 5 הושלם.

---

## תיעוד התקדמות

אחרי כל שיחה, הסטטוס נשמר בקובץ הזה (עמודת "סטטוס" להוסיף ליד כל פריט):

- `⬜` לא התחיל
- `🟡` בתהליך
- `✅` סגור + מתי

**סטטוס נוכחי (2026-04-19):**

- 1.1 ניהול secrets — ✅ 2026-04-19 ([decisions-log §1.1](decisions-log.md#11-secret-management--google-secret-manager))
- 1.2 Meta BV timing — ✅ 2026-04-19 ([decisions-log §1.2](decisions-log.md#12-meta-business-verification--timing))
- 1.3 Meta App Review bundle/serial — ✅ 2026-04-19 ([decisions-log §1.3](decisions-log.md#13-meta-app-review--bundle-vs-serial))
- 1.4 Staging/prod schema sync — ✅ 2026-04-19 → 🟡 **re-opened 2026-04-19** (DB choice — Supabase/Postgres vs. Mongo; local moved to Mongo+Redis; [amendment](decisions-log.md#amendment-2026-04-19--re-open-db-choice))
- 1.5 Hebrew copy style authorship — ✅ 2026-04-19 החלטה; 🟡 content v1 lock עד 2026-05-10 ([decisions-log §1.5](decisions-log.md#15-hebrew-copy-style--authorship))
- 1.6 `web/` monorepo — ✅ 2026-04-19 ([decisions-log §1.6](decisions-log.md#16-webfrontend--repo-topology))
- 1.7 גישת משתמשים שניים — ✅ 2026-04-19 ([decisions-log §1.7](decisions-log.md#17-גישת-משתמשים-שניים--single-user-mvp--c-hook-לעתיד))
- **קבוצה 1 הושלמה — 7/7 ✅**
- 2.2 Meta App Review — ✅ 2026-04-19 (scope של שיחה; הגשה חסומה על Phase 1, מנוהלת כ-checklist ב-submission doc)
- 2.3 Anthropic key + GCP quotas — 🟡 deliverable מוכן 2026-04-19 (checklist + validation script; הרצה על Roi)
- 2.4 Bemtech BV — 🟡 תשתית מוכנה 2026-04-19 (guidance + requirements checklist; איסוף מסמכים + הגשה על Roi)
- 3.1 CI/CD pipeline — ✅ 2026-04-19 (backend workflow + WIF setup doc; frontend נדחה ל-4.7; deploy נדחה post-1.4)
- 3.2 מנגנון migrations — 🟡 local ✅ 2026-04-19 (כבר מומש ב-1.4 amendment); remote pending 1.4
- 3.3 Backup/DR — 🟡 policy ✅ 2026-04-19; impl pending 1.4
- 3.4 Infinite loop protection — ✅ 2026-04-19 (design סגור; impl landing בtasks 4.2/4.6)
- **קבוצה 3 — 2/4 ✅ מלא, 2/4 🟡 partial (חסומים על 1.4)**
- שאר הפריטים — `⬜`
