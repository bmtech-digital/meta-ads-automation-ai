# 📘 מסמך אפיון: סוכן AI קמפיינר פייסבוק/אינסטגרם

> **סטטוס:** אפיון MVP (Phase 2 - Technical Design) — **Revision 2** (2026-04-16)
> **תאריך:** 15/04/2026 (revision: 16/04/2026 — עדכונים מ-Deep Research)
> **שפת המסמך:** עברית (עם תרגום טכני לאנגלית בקוד)
> **קהל יעד:** צוות פיתוח
> **בסיס:** נבנה על בסיס `CAMPAIGNER_AGENT_SPEC.md` המקורי (15/04/2026) + החלטות טכניות + 2 מחקרי AI חיצוניים (Grok, Manus — 16/04/2026)
>
> **Revision 2 (2026-04-16)** — שינויים גדולים ב-§3.4, §6 (כל הסעיף), §7.2, §14, §17. כל ה-deltas מתועדים ב-`docs/deep_research/findings-diff.md`. מומלץ לקרוא את ה-findings-diff לפני עריכת קוד של המנוע.

---

## 📝 שינויים מהאפיון הראשוני

מסמך זה מחליף את האפיון הראשוני. השינויים המרכזיים:

**עיקרון מנחה ב-MVP: "Claude Code Native + Terminal First".**
הסוכן הוא Claude Code עצמו (headless mode). אין שכבת orchestration חיצונית (אין LangGraph). cron מפעיל `claude -p "..."` עם Anthropic API key. Claude קורא קבצי `.md` עם חוקים וידע, מפעיל כלי Python קטנים דרך ה-Bash tool, וכותב ישירות ל-Supabase. המשתמש שולט בכל דבר מהטרמינל (אישור/דחייה/inspection). הפלטפורמה הוובית היא layer דק מעל ה-DB — לא חלק מה-engine. **המעבר ל-LangGraph נדחה ל-v2** ויופעל כשמוסיפים חשבון מודעות שני (ר' מסמך נפרד שיתועד בעתיד).

| תחום | היה (אפיון ראשוני) | השתנה ל-(MVP) |
|---|---|---|
| Orchestration | Multi-agent עם LangGraph + FastAPI + React | **Claude Code Native (headless `claude -p`)** |
| LLM | Claude Sonnet 4.6 / Opus 4.6 | **Claude (דרך Claude Code + Anthropic API)** |
| שליטה של המשתמש | Web approval UI | **Terminal-first** — CLI לאישור/דחייה/inspection; ה-web קורא מאותו DB |
| DB ראשי | PostgreSQL + RLS | **Supabase** (Postgres + Auth מנוהל) |
| Vector DB | Qdrant / pgvector ל-RAG | **הוסר מ-MVP** — ידע עסקי ב-markdown + structured JSONB |
| HITL | LangGraph `interrupt()` + checkpointer | **Async-via-DB** — טבלת approvals + cron |
| Observability | LangSmith / Langfuse | **טבלת `agent_decisions`** — Claude מתעד כל החלטה ישירות |
| Queue | Redis + Celery | **הוסר מ-MVP** — cron בלבד |
| Meta API | Facebook Marketing API SDK | **נשאר** — קוד `facebook-business` קיים ברפו |
| יצירת תמונות | Vertex AI Imagen | **נשאר** — `image_generator.py` קיים ברפו |
| Multi-tenant | תומך מיום ראשון | **דחוי ל-v2** — MVP עסק אחד (Aiweon) |
| LangGraph | MVP | **דחוי ל-v2** — מופעל כשמוסיפים עסק שני |
| Gemini (Vertex AI) | שקלתי ל-MVP | **דחוי ל-v2 ביחד עם LangGraph** |
| Operation Modes | Storm / Off-Season / Peak / Normal | **דחוי ל-v2** — Normal בלבד ב-MVP |
| War Chest (תקציב שנתי) | Annual heatmap + Budget Borrowing | **דחוי ל-v2** |
| RLHF | Vector-based preference learning | **דחוי ל-v2** |
| Master View | דשבורד רב-עסקי | **דחוי ל-v2** (עסק אחד ב-MVP) |

### 🔭 מתי עוברים ל-v2 (LangGraph)

ברגע שיש יותר מחשבון מודעות אחד מנוהל על ידי המערכת. הסיבות:
- צורך ב-orchestration מקביל של מספר עסקים + בידוד state
- Cross-business intelligence דורש node dedicated
- Auditability של flows מסובכים — LangGraph + LangSmith נותנים visual trace
- Concurrency במילים — CC session-per-business עלול להיות יקר; LangGraph יותר יעיל

**מסמך נפרד ייכתב** בעתיד: `docs/plans/langgraph-v2-migration.md` — יתאר את תכנית המעבר במלואה.

---

## 📖 תוכן עניינים

1. [חזון המוצר](#1-חזון-המוצר)
2. [היקף MVP - מה בפנים ומה בחוץ](#2-היקף-mvp---מה-בפנים-ומה-בחוץ)
3. [מחקר רקע - Meta Ads 2026](#3-מחקר-רקע---meta-ads-2026)
4. [אפיון המוח - מודל החשיבה](#4-אפיון-המוח---מודל-החשיבה)
5. [שכבות הידע](#5-שכבות-הידע)
6. [Performance Brain - מה זה "קמפיין טוב"](#6-performance-brain---מה-זה-קמפיין-טוב)
7. [מנוע קריאייטיב](#7-מנוע-קריאייטיב)
8. [מערכת משימות ותדירות](#8-מערכת-משימות-ותדירות)
9. [ארכיטקטורה](#9-ארכיטקטורה)
10. [מודל נתונים - Supabase Schema](#10-מודל-נתונים---supabase-schema)
11. [Claude Code Invocation Pattern](#11-claude-code-invocation-pattern)
12. [מנגנון דיווח החלטות](#12-מנגנון-דיווח-החלטות)
13. [אישורים מ-Meta](#13-אישורים-מ-meta)
14. [Guardrails](#14-guardrails)
15. [Business Knowledge - טופס+שאלון](#15-business-knowledge---טופסשאלון)
16. [Auto-Approval](#16-auto-approval)
17. [עץ החלטות לדיאגנוזה](#17-עץ-החלטות-לדיאגנוזה)
18. [Cron Schedule](#18-cron-schedule)
19. [מבנה פרויקט Python](#19-מבנה-פרויקט-python)
20. [Tech Stack](#20-tech-stack)
21. [הערכת עלויות LLM](#21-הערכת-עלויות-llm)
22. [מחוץ ל-MVP - דחיות ל-v2](#22-מחוץ-ל-mvp---דחיות-ל-v2)
23. [שאלות פתוחות / TODO](#23-שאלות-פתוחות--todo)
24. [מקורות](#24-מקורות)

---

## 1. חזון המוצר

בניית סוכן AI שמחליף **קמפיינר פייסבוק/אינסטגרם אנושי** - ברמה של הקמפיינר הטוב בתחום ואף יותר, בזכות יכולות AI (מחקר אוטונומי, עיבוד דאטה, ייצור קריאייטיב בקנה מידה).

**מאפיינים (חזון מלא):**
- פלטפורמת **SaaS** לבעלי עסקים שמפעילים חשבונות מודעות בפייסבוק
- **Multi-tenant** - משתמש אחד מנהל כמה עסקים במקביל
- **Human-in-the-Loop** מלא - הסוכן מציע, המשתמש מאשר. אין פעולות אוטונומיות פרועות
- **Creative-First** - מותאם לאלגוריתם Andromeda של Meta (ר' סעיף 3)

**Scope MVP (מטרת מסמך זה):**
- **עסק אחד** (Aiweon) - multi-tenant דחוי ל-v2
- Facebook + Instagram בלבד
- עברית בלבד
- CRM פנימי מינימלי
- **Claude Code Native** — הסוכן הוא Claude Code עצמו, לא שכבת orchestration חיצונית
- **Terminal First** — כל שליטה דרך CLI. ה-web platform רק קוראת מה-DB

**הרחבות עתידיות:** Multi-tenant, LangGraph orchestration, Google Ads, TikTok, שפות נוספות, CRM מתקדם, WhatsApp Business, Operation Modes, War Chest, RLHF, Master View (ר' סעיף 22).

---

## 2. היקף MVP - מה בפנים ומה בחוץ

מתוך 18 יכולות הליבה שהוגדרו באפיון הראשוני (סעיף 2 המקורי):

### 2.1 יכולות MVP (In Scope)

| # | יכולת | פירוט |
|---|---|---|
| 1 | ניהול תקציב חודשי | המשתמש נותן תקציב חודשי, הסוכן מחלק בין קמפיינים |
| 2 | Human-in-the-Loop | הסוכן מציע דרך טבלת `approvals`, המשתמש מאשר |
| 3 | יצירה/עצירה של קמפיינים | יצירת קמפיינים חדשים והשהיית קיימים (לא מחיקה) |
| 6 | דשבורד סקירה | נתוני כל קמפיין + דשבורד כללי |
| 7 | זמן למידה | מעקב אחר Learning Phase של כל קמפיין |
| 8 | הגדרת "טוב/רע" | Performance Brain (סעיף 6) |
| 10 | Business Knowledge File | טופס+שאלון מובנה (סעיף 15) — **לא RAG** |
| 16 | יצירת קריאייטיב | שימוש ב-`image_generator.py` הקיים (Imagen) + Claude לקופי |
| 17 | Guardrails | חוקים קשיחים (סעיף 14) |
| 18 | הגבלת משימות למשתמש | Anti-flood (סעיף 8.3) |

### 2.2 יכולות דחויות ל-v2 (Out of Scope)

| # | יכולת | סיבת הדחייה |
|---|---|---|
| 4 | Multi-campaign Testing (Advantage+) | מורכב ל-MVP; עסק יחיד עם פעילות נמוכה לא דורש זאת |
| 9 | בניית קהלים וטירגוטים אוטומטית | דורש לוגיקה עמוקה; ב-MVP הסוכן מציע — לא בונה אוטומטית |
| 11 | מודעות הקשר (מלחמה/קורונה/עונה) | דורש Operation Modes + מקורות חיצוניים; ר' §22 |
| 12 | אופטימיזציה חשבונית כוללת | MVP מתמקד בקמפיין יחיד |
| 13 | ניהול כמה עסקים | Multi-tenant דחוי |
| 14 | מעקב המרות WhatsApp | דורש WhatsApp Business API + אינטגרציה עם Pixel |
| 15 | סקירה תקופתית חכמה | ב-MVP cron קבוע — ללא ANN adaptive scheduling |

### 2.3 דרישות טכניות MVP

- ✅ מידות מדויקות לכל פורמט (1:1, 4:5, 9:16)
- ✅ התאמה ל-Andromeda - Creative-First
- ✅ Stateless Python processes invoked by cron
- ✅ Supabase כמאגר נתונים יחיד
- ✅ Claude (דרך Claude Code CLI + Anthropic API)
- ❌ לא web app מלא - רק backend + API לשימוש הפלטפורמה הוובית הקיימת

---

## 3. מחקר רקע - Meta Ads 2026

*(סעיף זה נשמר מהאפיון הראשוני ללא שינוי — זהו ידע בסיסי שלא השתנה.)*

### 3.1 Meta Andromeda - שינוי פרדיגמה

Andromeda הוא מנוע ה-Machine Learning החדש של Meta שמחליף את מערכת המסירה הקיימת. נכון ל-2026, **Andromeda מפעיל את כל המסירה בפייסבוק ובאינסטגרם**.

**השינוי הקריטי:**
- **לפני:** הגדרת קהל → מציאת קריאייטיב שמתאים
- **אחרי (Andromeda):** הקריאייטיב נכנס ראשון → המערכת מוצאת את הקהל המתאים

**השלכה על התכנון שלנו:**
הסוכן חייב להיות **Creative-First**. ההשקעה הכי חשובה היא ביצירה של וריאנטים רבים, לא במיקרו-טירגוט.

**תוצאות מדווחות:**
- Creative-based targeting משפר המרות ב-8-17%
- מפרסמים שהפעילו Advantage+ Creative: +22% ROAS

### 3.2 Advantage+ ו-"Power of One"

Meta דוחפת לקונסולידציה רדיקלית:
- **במקום:** 10 קמפיינים + 50 ad sets
- **חדש:** קמפיין אחד + ad set אחד לכל offer/מוצר
- איחוד cold + warm audiences באותו קמפיין

**תקציב מינימלי:** $100/יום (מתחת לזה האלגוריתם לא לומד). מומלץ: $150-300/יום ל-eCommerce קטן-בינוני.

### 3.3 Learning Phase

- **סף יציאה:** 50 אירועי המרה ב-7 ימים (ברמת ad set)
- **שינויים שמאפסים למידה:** שינוי קהל, תקציב ב->20%, **החלפת** קריאייטיב, שינוי bid strategy
- **חשוב:** **הוספת** קריאייטיב לad set עם ≥10 קריאייטיבים קיימים בד"כ **לא** מאפסת — זה מה שמאפשר את ה-firehose model (§7.2)
- **Scaling מותר:** 20-30% כל 2-3 ימים. קפיצות של 50%+ שוברות למידה (Andromeda אולי סובל יותר, אבל פרקטיקה 2026 עדיין שמרנית)
- **Learning Limited:** אם לא מגיע ל-50 המרות תוך 7 ימים ואין trend עולה — המערכת מכריזה שלא יצליח ללמוד

### 3.4 Benchmarks ענפיים 2026

**מקורות עדכניים (2025-2026):** Triple Whale (Apr 2026 update, ~35k brands), AdAmigo (Jan 2026), Superads (Israel-specific).

**Global medians (Triple Whale 2025):**

| מדד | חציון גלובלי | YoY | טווח ענפי |
|---|---|---|---|
| CTR | **2.19%** | +13.5% | Sales 1.38% / Leads 2.59% / Traffic 1.71% (AdAmigo 2026) |
| CPA | **$38.19** | +1.04% | Electronics $49.48 / Baby $30.04 |
| ROAS (חציון) | **1.86x** | +1.29% | יעד בריא 2.5x+; AdAmigo Sales ROAS ~2.79 |
| CPM | **$14.19** | +20.03% | Health/Travel ~$20.70 / Auto ~$10.01 |
| CVR | ~1.6% | — | Food/Bev 2.02% / Electronics 1.20% |

#### 🇮🇱 Benchmarks ישראל 2025 — שונים משמעותית מהגלובל

| מדד | ישראל | גלובל | יחס |
|---|---|---|---|
| CPM | **$8.38 avg** | $20.15 | **~40% נמוך** |
| CPL | **$104.72 avg** | $41.53 | **~2.5× יותר יקר** |

**תנודתיות 2025 בישראל:**
- CPM נע בין $4.85 (יוני) ל-$14.90 (נובמבר)
- CPL קפץ ל-$385 באוגוסט, $309 בנובמבר, $255 באוקטובר (אירועים ביטחוניים)

**מסקנה לסוכן:** ⚠️ **אל תסתמך על benchmarks גלובליים מוכפלים ב-factor עבור ישראל.** הנחת ה"30-50% נמוך" מהאפיון הראשוני **שגויה** — נכון ל-CPM, לא נכון ל-CPL. הסוכן מחשב baseline דינמי לפי החשבון הספציפי (§6.2). נתוני MENA מעבר לישראל — לא נמצאו primary sources פומביים.

**מקורות:** Triple Whale (Apr 7, 2026); AdAmigo (Jan 29, 2026); Superads Israel CPM/CPL reports; מפורט ב-`docs/deep_research/`.

### 3.5 Creative Volume & Specs

**Meta דורשת לאופטימיזציה (2026 post-Andromeda):** **10-50+** קריאייטיבים מגוונים פעילים.
**מינימום לעבודה רצינית:** 10-12 קריאייטיבים מגוונים בפתיחה; **continuous additions** של 3-5/שבוע (ר' §7.2).

**מידות לכל פורמט:**

| פורמט | מידות | יחס | הערות |
|---|---|---|---|
| Feed Square | 1080×1080 | 1:1 | תומך |
| **Feed Vertical** ⭐ | **1080×1350** | **4:5** | **מומלץ** - CTR גבוה משמעותית |
| Stories/Reels | 1080×1920 | 9:16 | חיוני - 78% יותר ביצועים |
| Right Column | 1200×628 | 1.91:1 | דסקטופ בלבד |

**וידאו:** H.264, AAC, עד 4GB, 30fps או פחות.

---

## 4. אפיון המוח - מודל החשיבה

הסוכן פועל ב-4 שלבים מחזוריים, שמפוזרים בין שתי הפעלות cron נפרדות. **אין LangGraph ב-MVP** — כל flow הוא קריאה אחת ל-Claude Code במצב headless, כש-Claude הוא ה-orchestrator.

```
┌─── Flow 1: Observe-Propose (cron יומי) ─────────────┐
│                                                      │
│  $ claude -p "run daily observe-propose for Aiweon" │
│                                                      │
│  Claude reads:                                       │
│    - CAMPAIGNER.md (identity + protocol)            │
│    - prompts/performance-brain.md                   │
│    - prompts/decision-tree.md                       │
│    - prompts/guardrails.md                          │
│    - business_knowledge (via tool)                  │
│                                                      │
│  Claude uses Bash to invoke Python tools:           │
│    tools/fetch_insights.py    → Meta snapshot      │
│    tools/load_baselines.py    → from Supabase      │
│    tools/check_guardrails.py  → validate proposals │
│    tools/propose_task.py      → write approvals    │
│    tools/log_decision.py      → write decisions    │
│                                                      │
│  Claude exits. No persistent state.                 │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
          approvals table (status='pending')
                       │
                       ▼
       User approves (terminal CLI or web UI):
         $ campaigner approve <id>
         → UPDATE approvals SET status='approved' ...
                       │
                       ▼
┌─── Flow 2: Execute (cron כל 15 דק') ────────────────┐
│                                                      │
│  $ claude -p "execute approved tasks for Aiweon"    │
│                                                      │
│  Claude uses Bash:                                   │
│    tools/list_approved.py     → pending approvals   │
│    tools/recheck_guardrails.py → validate again     │
│    tools/execute_task.py      → Meta API call       │
│    tools/log_decision.py      → outcome            │
│                                                      │
│  Claude exits.                                       │
└──────────────────────────────────────────────────────┘
```

| שלב | מי מבצע | פלט |
|---|---|---|
| **Observe** | כלי Python (`fetch_insights.py`) — Claude קורא לו דרך Bash | JSON snapshot |
| **Think** | Claude — קריאה בקבצי `.md` + ה-snapshot, reasoning טבעי | Diagnoses בטקסט חופשי |
| **Propose** | Claude — כותב לטבלה דרך `propose_task.py`, כולל rationale | רשומות `approvals` |
| **Execute** | כלי Python (`execute_task.py`), Claude מפעיל לפי `task_type` | עדכון `approvals.status` + Meta response |

**עיקרון Stateless:** כל invocation של `claude -p` מתחיל מאפס. אין threads, אין checkpoints, אין session state. כל הקונטקסט נטען מחדש בכל ריצה דרך קבצי `.md` ושליפות מה-DB. זה בדיוק מתאים ל-cron.

---

## 5. שכבות הידע

הסוכן נסמך על 4 שכבות ידע - כולן נגישות ב-context של כל החלטה:

### שכבה A: Built-in Knowledge (קבוע — prompt templates)
- חוקי פייסבוק/אינסטגרם, מדיניות פרסום, פורמטים, מידות
- Best practices של Meta (Advantage+, CBO, ABO, Andromeda)
- מבני קמפיין (TOF/MOF/BOF)
- **אחסון:** קבצי markdown ב-`campaigner/prompts/` — נטענים ל-system prompt של ה-LLM

### שכבה B: Business Context (דינמי לעסק)
- **Business Knowledge** — טופס מובנה + תשובות שאלון (סעיף 15)
- **אחסון:** טבלת `business_knowledge` ב-Supabase (JSONB column עם שדות מובנים)
- **שינוי מהאפיון הראשוני:** אין Vector DB / RAG. הידע העסקי קצר מספיק כדי להיטען בשלמותו ל-context של Claude (200K tokens context window — יותר ממספיק)
- מחקר אוטונומי ברשת - **דחוי ל-v2**

### שכבה C: Live Context (בזמן אמת)
- תקציב נוכחי / נותר (מחושב מ-Meta API)
- זמן אספקה של העסק (שדה ב-`business_knowledge`)
- עונות/חגים/מלחמה — **דחוי ל-v2** (חלק מ-Operation Modes)

### שכבה D: Measurement (מדידה)
- KPIs מוגדרים (CPL, CPA, ROAS, CTR, CPC)
- Learning Phase tracking
- Baselines — טבלת `baselines` ב-Supabase

---

## 6. Performance Brain - מה זה "קמפיין טוב"

*(סעיף זה עודכן ע"פ `docs/deep_research/findings-diff.md` (2026-04-16) — מיזוג של 2 מקורות מחקר עדכניים. שינויים מרכזיים: היררכיה שני-שערים במקום היררכיה יחידה, Creative Fatigue flag במקום Frequency>3, volume-based sufficiency במקום time-based, ו-benchmarks ישראליים שמפרקים את הנחת "ישראל = Global × factor".)*

### 6.1 Goal Hierarchy - בחירת KPI ראשי

הסוכן בוחר KPI אוטומטית לפי סוג העסק (מוגדר ב-`business_knowledge.vertical`). **הערכים בטבלה הם reference points גלובליים 2026; החלטות אמיתיות מתבססות על rolling baseline של החשבון (§6.2).**

| סוג עסק | KPI ראשי | משני | reference 2026 (global) |
|---|---|---|---|
| eCommerce | **ROAS** | CPA, AOV | חציון 1.86 (Triple Whale 2025); Adamigo Sales ROAS ~2.79; יעד בריא 2.5x+ |
| לידים B2C | **CPL** | CTR, Lead Quality | חציון גלובלי $27.66; **ישראל $104.72** (ר' §6.2) — baseline של החשבון שולט |
| Awareness | **CPM + CTR** | Reach, Frequency | CTR חציון 2.19% (Triple Whale 2025); סף פעולה > 1.7% (traffic), > 2.1% (sales) |
| אפליקציות | **CPI + Retention** | CTR | תלוי ורטיקל — אין 2026 primary data מאוחד |

**מקורות:** Triple Whale 2025 medians (Apr 2026 update, ~35k brands); Adamigo 2026 by objective. אין נתוני benchmark פומביים לשוק הישראלי — חובה baseline פר-חשבון.

### 6.2 השוואה יחסית - העיקרון הכי חשוב

**"טוב" זה לא מספר אבסולוטי - זה יחסי.**

הסוכן שומר **baseline לכל חשבון** בטבלת `baselines` ומשווה:
- ביצועים היסטוריים של אותו עסק — **windows: 7 / 14 / 30 ימים** (reactivity מהירה יותר מהאפיון הראשוני שהיה 30/60/90)
- ממוצע קמפיינים פעילים באותו חשבון
- benchmarks ענפיים (רק לרמה שנייה, וראו אזהרת ישראל למטה)

**דוגמה:** CPL ממוצע של העסק ₪85. קמפיין חדש ב-₪110 = 29% מעל baseline → סמן כבעייתי.

#### ⚠️ אזהרה חשובה: ישראל ≠ Global × factor

**אל תסתמך על benchmarks גלובליים מוכפלים ב-factor כלשהו עבור ישראל.** נתוני 2025-2026 (מקור: Superads, AdAmigo):

- **CPM ישראל:** ~$8.38 ממוצע — **~40% נמוך** מהגלובל ($20.15)
- **CPL ישראל:** **$104.72 ממוצע — ~2.5× הגלובל** ($41.53)
- **תנודתיות קיצונית:** CPM בטווח $4.85 (יוני) עד $14.90 (נובמבר); CPL קפץ ל-$385 באוגוסט 2025 (אירוע ביטחוני)

**משמעות עבור הסוכן:**
1. אל תקבע סף baseline ראשוני מ-benchmarks גלובליים — השתמש רק ב-30 ימי היסטוריה של החשבון הספציפי.
2. ערכים שנראים "גבוהים" לפי הגלובל עשויים להיות תקינים לישראל (CPL).
3. ערכים שנראים "טובים" לפי הגלובל עשויים להיות חשודים לישראל (CPM).
4. אירועים ביטחוניים יוצרים spikes של 2-4× ב-CPL. זיהויים **דחוי ל-v2** (Operation Modes — ר' §22).

### 6.3 Learning Phase Logic

```python
# Deterministic Python tool - NOT LLM.
def classify_learning_status(campaign):
    if campaign.conversions_7d < 50 and campaign.days_active <= 7:
        return "LEARNING"  # action: DON'T TOUCH

    # Learning Limited: 7+ ימים ו-<50 המרות ואין trend עולה
    if (campaign.conversions_7d < 50
        and campaign.days_active > 7
        and not is_volume_trending_up(campaign)):
        return "LEARNING_LIMITED"
        # options: increase_budget | consolidate_adsets | expand_audience

    return "ACTIVE"  # apply Performance_Rules (§6.5 Gate 2)
```

**שינוי מהאפיון הראשוני:** החלון ל-LEARNING_LIMITED ירד מ-14 ימים ל-7 ימים (פרקטיקה 2026).

**חישוב תקציב מינימלי:**
```
budget_daily_min = (expected_CPA × 50) / 7
```
דוגמה: CPA צפוי ₪100 → תקציב מינימום ₪715/יום.

### 6.4 Data Sufficiency Check (לפני כל החלטה)

לפני שהסוכן חורץ גורלות על קמפיין - בודק אם יש לו מספיק דאטה. **שינוי מהאפיון הראשוני:** עברנו מ-threshold מבוסס-זמן (72h) ל-threshold מבוסס-נפח, שהוא הסטנדרט של מפעילים בכירים ב-2026.

#### Volume-based thresholds (עיקר)

```
ל-Gate 1 (leading signals, creative-level):
  ✅ ≥ 1,000 חשיפות לכל קריאייטיב
  ✅ ≥ 50 clicks לכל קריאייטיב (לאמינות CTR)

ל-Gate 2 (lagging signals, campaign-level):
  ✅ 50+ המרות (יציאה מ-Learning Phase)
  ✅ CPA יציב 5-7 ימים

ל-A/B test declarations:
  ✅ 95% statistical significance (או threshold נפח מקביל)
```

#### Time-based safety floor

```
✅ לפחות 48h מהשינוי המשמעותי האחרון (מניעת תגובה ל-ramp של delivery)
```

#### חריג — emergency kill

```
CPA > 3× יעד
   OR הוצאה ≥ 1× תקציב יומי + 0 המרות למשך 3+ ימים
   → 🚨 "שריפת כסף" — הצעה דחופה (urgency='urgent')
```

**מימוש:** כלי Python טהור `tools/check_data_sufficiency.py` — **לא LLM**. מחזיר JSON עם flags לכל קריטריון.

### 6.5 היררכיית מדדים — מודל שני שערים

**חשוב:** הסוכן מעריך ב-**שני שערים** ולא בהיררכיה יחידה. שער 1 (signals מובילים) משמש להחלטות kill/keep ברמת הקריאייטיב ב-48-168 שעות הראשונות. שער 2 (signals מאוחרים) משמש להחלטות scale/kill ברמת הקמפיין אחרי יציאה מ-Learning. **מעבר מהאפיון הראשוני:** ה-Hook Rate וה-CTR עלו לעדיפות 1 ב-gate 1; Frequency הורד ל-monitoring only.

#### Gate 1 — Leading signals (חלון 48h-7d, החלטות ברמת קריאייטיב)

| עדיפות | מדד | "טוב" | Kill trigger |
|---|---|---|---|
| 1 | **Hook Rate (3s)** | > 35% | < 25% אחרי 48h |
| 2 | **CTR** (מוקדם) | > 2% | < 1% עם ≥1,000 חשיפות |
| 3 | **Thumb-stop rate** | > 30% | < 20% אחרי 48h |

**מקור הספים:** קונצנזוס פרקטיקה 2026 (Grok + Manus; ר' `docs/deep_research/findings-diff.md`).

#### Gate 2 — Lagging signals (post-learning, החלטות ברמת קמפיין/חשבון)

| עדיפות | מדד | "טוב" | Kill trigger |
|---|---|---|---|
| 1 | **CPA** | ≤ יעד | > 1.3× יעד למשך 5+ ימים |
| 2 | **ROAS** | ≥ Break-even | נמוך מרווחיות מינימלית |
| 3 | **Meta Creative Fatigue flag** | לא מסומן | CPR ≥ 2× baseline היסטורי |
| 4 | **Frequency** (monitoring only) | — | **אינו trigger עצמאי** — רק אות לחקירה |

**הסבר על Frequency:** בעידן Andromeda, Meta מתאימה קריאייטיבים לקהלים טוב יותר; Frequency גבוה לא תמיד = שחיקה. הטריגר האמיתי הוא **Meta Creative Fatigue flag** (CPR ≥ 2× baseline), שמופיע ב-Ads Manager. Frequency > 3 נשאר כ-signal לחקירה ידנית, לא ל-action אוטומטי.

### 6.6 חוקי טוב/רע אחרי למידה

```
🟢 Winner: CPA ≤ יעד ליציב 5-7 ימים + hook rate > 35%
   → הצעה: Scale up 20% (default); 30% אם hook > 35% ו-frequency < 2.0

🟡 Average: KPI ב-baseline ±15%
   → הצעה: המשך מעקב; הוספת 3-5 קריאייטיבים חדשים

🔴 Loser: CPA > 1.3× יעד למשך 5+ ימים
          OR Meta Creative Fatigue flag (CPR ≥ 2× היסטורי)
   → הצעה: השהיה / החלפת קריאייטיב / הרחבת מגוון

⚠️ Creative Fatigue (Meta flag): CPR ≥ 2× baseline
   → הצעה: הוספת קריאייטיבים חדשים (לא פאוזה!) + הרחבת מגוון

ℹ️ Frequency > 3 (monitoring only)
   → signal לחקירה — לא trigger אוטומטי. בדוק CPR; אם יציב, אל תיגע.
```

**שינוי משמעותי מהאפיון הראשוני:** Frequency > 3 כבר אינו trigger ל-action. הוא הפך ל-signal לחקירה בלבד. החלטות refresh/pause מסתמכות על Meta Creative Fatigue flag (CPR ≥ 2×).

### 6.7 חוקים Pre-Andromeda שהופקעו (Deprecated Rules)

קריטי לתעד כדי למנוע regression עתידי בפרומפטים / ב-prompts/*.md. **אף אחד מהחוקים הבאים לא יופיע כ-trigger ב-agent_decisions:**

| חוק מוסדר (pre-2024) | סיבת dep | החליף אותו |
|---|---|---|
| "1 ad set = 1 ad" | Andromeda מעדיפה ad sets גדולים עם מגוון קריאייטיבים | ad set אחד עם 10+ ads |
| הפרדה נוקשה TOFU/MOFU/BOFU לקמפיינים נפרדים | Meta AI מזהה שלב funnel פנימית | Advantage+ campaign אחד; Meta מחליטה |
| Manual placement optimization (Feed vs Stories vs Reels) | Andromeda מזהה placement אופטימלי אוטומטית | ספק את כל ה-aspect ratios, תן למטא להחליט |
| Horizontal scaling ע"י duplication | מאפס Learning Phase | Vertical scaling בתוך אותו campaign |
| Narrow interest-based targeting | Andromeda עובד טוב יותר ב-broad targeting | Broad + creative diversity |
| **Frequency > 3 as auto-kill** | Andromeda מתאים טוב יותר; high frequency ≠ fatigue | Meta Creative Fatigue flag (CPR ≥ 2×) |
| Daily edits / pausing ב-1-3 ימי דאטה | מפריע ל-Learning | חלונות 7d / 50-conv "no-touch" |
| הסתמכות על single winning creative | מביא לשחיקה מהירה | 10-50+ creative diversification |
| Hook Rate > 30% פולקלור כ-binary signal | מדד חד-מימדי לא מספיק | banded thresholds: >35% strong / 25-35% solid / <25% kill |
| "אחרי 5-7 ימים — השאר top 3-5 קריאייטיבים" | Andromeda מחלקת תקציב לא-אחיד במכוון | Continuous additions; אל תחתוך ידנית |
| Time-based sufficiency (72h) כ-primary gate | נפח > זמן | ≥1,000 חשיפות + ≥50 clicks |

**כלל זהב:** אם prompt חדש ב-`prompts/*.md` או guardrail ב-`campaigner/guardrails.py` משחזר אחד מהחוקים האלה — עצור וחזור לסעיף זה.

---

## 7. מנוע קריאייטיב

**היעד Andromeda-era:** **10-50+** קריאייטיבים מגוונים פעילים בכל עת. Meta של 2026 מעדיפה מבנה פשוט + הרבה מגוון קריאייטיבי, ומחלקת תקציב באופן לא אחיד בין הקריאייטיבים במכוון. ה-**firehose model**: הסוכן מייצר קריאייטיבים ברצף, לא ב-batches גדולים.

**MVP (Aiweon) — גישה שמרנית:**
- **פתיחה:** 10-12 קריאייטיבים מגוונים (3-4 hooks × 3 aspect ratios)
- **תוספת שבועית:** 3-5 קריאייטיבים חדשים לשבוע
- **כלל זהב:** **לא לחתוך ידנית** — תן ל-Andromeda להרעיב קריאייטיבים חלשים. חיתוך רק כש-hook rate < 25% אחרי 48h (§6.5 Gate 1).

### 7.1 יכולות MVP vs v2

| יכולת | MVP | v2 |
|---|---|---|
| Copy (טקסט מודעה) בעברית | ✅ Claude generation, 10-20 וריאנטים | |
| כותרות/CTA | ✅ Claude generation | |
| יצירת תמונות | ✅ שימוש ב-`image_generator.py` הקיים (Vertex Imagen) | |
| Image expansion | ❌ | ✅ |
| Background swap | ❌ | ✅ |
| Text overlay אוטומטי | ❌ | ✅ |
| שליפה מגלריה | ✅ בחירה חכמה לפי הקמפיין | |
| יצירת וידאו AI | ❌ | ✅ |
| Voice-over AI | ❌ | ✅ |
| Continuous creative generation | ✅ 3-5/week additions | ✅ 10+/week |

### 7.2 Creative Testing Matrix — Firehose Model

**הגישה המעודכנת (2026 post-Andromeda):**

לכל Offer, הסוכן בונה **batch ראשוני של 10-12**:
- **3-4 Hooks** שונים (כאב, פתרון, הצעה, חברתי, דחיפות)
- **3 aspect ratios** לכל hook (1:1, 4:5, 9:16)
- = **~12 קריאייטיבים** פתיחה

אחר כך: **continuous additions** של 3-5 קריאייטיבים חדשים לשבוע, לא פאוזה ידנית של הקיימים אלא אם hook rate < 25% אחרי 48h.

**הסבר הגישה:** Meta ב-Andromeda מעדיפה Advantage+ Shopping / Advantage+ Sales עם variety רחב. חלוקת התקציב הלא-אחידה היא **by design** — הסוכן לא צריך להילחם בה. קריאייטיב שמקבל 5% מהתקציב עם CTR גבוה = Meta בוחנת אותו; לא "לאלץ" יותר תקציב.

**שינוי חד מהאפיון הראשוני:**
- ❌ "9-15 קריאייטיבים, אחרי 5-7 ימים השאר top 3-5" — **deprecated**
- ✅ "10-12 initial + 3-5/שבוע, אל תחתוך ידנית" — **current**

### 7.3 Flow אישור קריאייטיב

```
Agent creates creatives (nodes: generate_image → generate_copy)
        ↓
Insert into approvals table with task_type='new_creative'
        ↓
User approves/rejects via web platform
        ↓
If approved → Graph 2 (Execute) uploads to Meta via meta_ads_manager.py
If rejected → rejection_reason logged; no regeneration in MVP
```

**שינוי מהאפיון הראשוני:** אין regeneration loop ב-MVP. אם נדחה — נגמר. v2 יוסיף feedback loop.

### 7.4 Placement Adaptation - קופי שונה למיקום

**חשוב:** מה שעובד בפיד לא עובד בסטוריז.

| מיקום | מאפייני קופי | דוגמה |
|---|---|---|
| **Feed** | ארוך יותר (עד 3 שורות לפני "קרא עוד"), כותרת חזקה | "זוכרים את בת המצווה שלכם? הגיע תורם..." |
| **Stories/Reels** | קצר, ישיר, Overlay Text | "החלק למעלה להזמנה! 👆" |
| **Right Column** | כותרת בלבד | "קיר צילום לבת מצווה" |

הסוכן מייצר וריאנטים **פר-מיקום** - לא גרסה אחת שמותחים לכל הפורמטים.

### 7.5 Marketing Angles

| זווית | מתי משתמשים | דוגמה |
|---|---|---|
| **רגש/חוויה** | מוצרים רגשיים, הורים, אירועי חיים | "החיוך שלהם שווה הכל" |
| **תועלת ישירה** | שירותים פרקטיים | "קיר צילום שישדרג כל בת מצווה" |
| **דחיפות/מבצע** | עונות, סוף-מלאי | "נשארו מקומות אחרונים למאי!" |
| **רשימת יתרונות** | B2B, טכני | "🌟 עיצוב אישי 🌟 אביזרים 🌟 מזכרת" |
| **חברתי (Social Proof)** | עסקים חדשים | "אלפי הורים כבר בחרו בנו" |
| **השוואה** | שווקים תחרותיים | "למה כולם עוברים אלינו?" |

הסוכן בוחר 3 זוויות שונות לכל קמפיין → Dynamic Creative של Meta בוחר את הזוכה.

### 7.6 Placement Coverage

לכל קמפיין - הסוכן מייצר בכל הפורמטים:
- 1:1 (1080×1080)
- 4:5 (1080×1350) - מומלץ ל-Feed
- 9:16 (1080×1920) - Stories/Reels

---

## 8. מערכת משימות ותדירות

### 8.1 Daily Digest - הסקירה היומית

**שעה:** 09:00 Asia/Jerusalem (מוגדר ע"י המשתמש)
**מנגנון:** cron מפעיל `python -m campaigner.graphs.observe_propose --business-id X`
**פלט:** שורות ב-`approvals` עם `status='pending'`. הפלטפורמה הוובית מציגה אותן.

**דוגמת תצוגה בפלטפורמה:**
```
📊 סקירה יומית - 15/04/2026
עסק: "Aiweon"

📈 סיכום:
  • 47 לידים אתמול
  • עלות ממוצעת ₪89 (↓12% מ-baseline)
  • הוצאה: ₪4,180 / ₪4,500 תקציב יומי

🎯 3 משימות לאישור:
  1. [בינונית] הגדלת תקציב קמפיין A: 50→65₪
     סיבה: ROAS 4.2, יצא מלמידה
  2. [דחופה] השהיית קמפיין B
     סיבה: Frequency 4.2, CTR ירד 35%
  3. [נמוכה] 5 קריאייטיבים חדשים מוכנים לבדיקה

[פתח דשבורד] [אשר הכל המומלץ]
```

### 8.2 Real-time Alerts

**דחוי ל-v2** — דורש webhook מ-Meta. ב-MVP cron יומי בלבד.

חריג אחד: אם ב-cron היומי הסוכן מזהה "שריפת כסף" (CPA × 3 מהיעד) - ייצר הצעה דחופה (`urgency='urgent'`) שהפלטפורמה תציג בראש.

### 8.3 Anti-Flood Rules

| תקציב יומי של העסק | מקס' משימות/יום |
|---|---|
| < ₪50 | 2 |
| ₪50-500 | 5 |
| > ₪500 | 8 |

אם יש יותר הצעות - הסוכן **מתעדף** בעצמו (צומת `prioritize`) לפי impact צפוי ודוחה את הפחות דחופות (נרשם ב-`agent_decisions` כ-`decision_type='rejection'`).

### 8.4 תדירות סריקה (Heartbeat)

| פעולה | תדירות MVP | סיבה |
|---|---|---|
| Graph 1: ObservePropose | 1×/יום ב-09:00 | Daily Digest |
| Graph 2: Execute | כל 15 דקות | לבלוע הצעות מאושרות מהר |
| Graph 3: Onboarding | one-shot ידני לכל עסק חדש | |
| סריקה אסטרטגית שבועית | **דחוי ל-v2** | |
| מחקר שוק אוטונומי | **דחוי ל-v2** | |

---

## 9. ארכיטקטורה

### 9.1 Claude Code Native Architecture

```
┌──────────────────────────────────────────────────────┐
│           פלטפורמת האינטרנט הקיימת (layer דק)        │
│  - תצוגת approvals pending                           │
│  - כפתורי approve/reject (UPDATE approvals)          │
│  - תצוגת agent_decisions לכל approval                │
│  * לא מחייב ל-engine — CLI עצמאי                     │
└──────────────────────────────────────────────────────┘
                        ▲
                        │ Supabase REST / Postgres
                        │
┌──────────────────────────────────────────────────────┐
│              Supabase (Postgres)                      │
│  - businesses / business_knowledge / baselines       │
│  - approvals / agent_decisions / creative_gallery    │
└──────────────────────────────────────────────────────┘
                        ▲
                        │
┌───────────────────────┴────────────────────────────┐
│              Terminal / CLI                         │
│                                                      │
│  User commands:                                      │
│    $ campaigner list --pending                       │
│    $ campaigner approve <id>                         │
│    $ campaigner reject <id> --reason "..."           │
│    $ campaigner inspect <run-id>                     │
│    $ campaigner run daily      (manual trigger)      │
└─────────────────────────────────────────────────────┘
                        ▲
                        │
┌───────────┬───────────┴───────────┬──────────────────┐
│   cron    │                       │                  │
│ 09:00 יומי│  כל 15 דק'            │   one-shot ידני  │
│           │                       │                  │
│   ▼       │        ▼              │         ▼        │
│ Flow 1    │     Flow 2            │   Onboarding     │
│ Observe   │     Execute           │                  │
│ Propose   │                       │                  │
│           │                       │                  │
│ claude -p │  claude -p "..."      │  CLI interactive │
│ "..."     │                       │  questionnaire   │
│ exits     │  exits                │                  │
└───────────┴───────────────────────┴──────────────────┘
         │
         │ Claude Code (headless) does:
         │   1. Reads prompts/*.md for rules & knowledge
         │   2. Calls Python tools via Bash tool
         │   3. Reasons, produces proposals
         │   4. Logs every decision to agent_decisions
         │   5. Exits
         ▼
┌──────────────────────┬─────────────────────────────┐
│  Claude (Anthropic)  │  Meta Marketing API         │
│  via Claude Code CLI │  via facebook-business SDK  │
│  (API key in env)    │  (existing:                 │
│                      │   meta_ads_manager.py)      │
└──────────────────────┴─────────────────────────────┘
         │
         ▼
┌──────────────────────┐
│  Vertex AI Imagen    │
│  (existing:          │
│   image_generator.py)│
└──────────────────────┘
```

### 9.2 Why Claude Code Native (and not LangGraph) for MVP

| קריטריון | Claude Code Native | LangGraph |
|---|---|---|
| זמן פיתוח עד MVP | ימים | שבועות |
| Orchestration code ב-Python | ~0 (Claude הוא ה-orchestrator) | rich |
| Prompts | קבצי `.md` שמשתמש עורך | מחרוזות בקוד |
| Debugging | `claude -p --verbose` + `agent_decisions` | LangSmith |
| Reasoning flexibility | גבוה — Claude מחליט מתי לקרוא לאילו כלים | נמוך — flow מקודד מראש |
| Concurrency של עסקים | פחות יעיל (session per invocation) | יעיל |
| Visual flow diagram | אין | יש |

**המסקנה:** ל-MVP עם עסק אחד — CC Native הוא הבחירה הנכונה. הוא מייצר iteration speed מהיר יותר, מאפשר לכותב ה-prompts (לא בהכרח מפתח) לעדכן לוגיקה עסקית דרך `.md`, ומסלק שכבת orchestration שלמה. המחיר — פחות יעילות ב-scale — לא רלוונטי לעסק אחד.

**כשמוסיפים עסק שני → עוברים ל-LangGraph.** מסמך מעבר נפרד יפרט את התכנית.

### 9.3 Stateless Principle

כל הפעלת `claude -p`:
1. **נולדת** — טוענת `CLAUDE.md` + `CAMPAIGNER.md` + `prompts/*.md` לקונטקסט
2. **רצה** — Claude קורא לכלים, reasoning, כותב ל-DB
3. **מתה** — `claude -p` יוצא, session נהרס

אין checkpointer. אין threads. אין resume across runs. כל run הוא עצמאי.

**יתרונות:**
- פשטות תפעולית — רק cron + Supabase + Anthropic API key
- Debugging קל — כל run מתועד ב-`agent_decisions`
- Cost control — רץ רק כשצריך
- Reproducibility — אותם קבצים + אותו snapshot = אותו reasoning (כמעט)

**מחיר:** אין תקשורת real-time עם המשתמש. כל התקשורת עוברת דרך ה-DB.

### 9.4 Human-in-the-Loop Pattern (Async-via-DB)

```
Flow 1 run (cron 09:00):
  $ claude -p --output-format json "run daily observe-propose for Aiweon"

  Claude:
    1. Reads CAMPAIGNER.md, prompts/*.md
    2. Bash: python tools/fetch_insights.py --business-id aiweon  → JSON
    3. Bash: python tools/load_baselines.py --business-id aiweon  → JSON
    4. Reasons over data using knowledge files
    5. Bash: python tools/propose_task.py --payload '...' (inserts to approvals)
    6. Bash: python tools/log_decision.py (writes to agent_decisions)
    7. Exits.

[time passes — hours to days]

User approves (two equivalent paths):
  Terminal:  $ campaigner approve <id>
  Web:       click "Approve" button
  → both do: UPDATE approvals SET status='approved' WHERE id=<id>

[next cron tick for Flow 2, every 15 min]

Flow 2 run:
  $ claude -p --output-format json "execute approved tasks for Aiweon"

  Claude:
    1. Bash: python tools/list_approved.py --business-id aiweon → JSON
    2. For each approval:
       - Bash: python tools/recheck_guardrails.py
       - Bash: python tools/execute_task.py --approval-id <id>
       - Bash: python tools/log_decision.py
    3. Exits.
```

**Terminal-first principle:** כל דבר שהmanager/מפתח/משתמש עושה — יש CLI לו. ה-web platform לא חובה. בסיטואציה של שרת מרוחק, SSH + CLI מספיק לניהול מלא.

---

## 10. מודל נתונים - Supabase Schema

### 10.1 `businesses`

```sql
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Jerusalem',
  meta_ad_account_id text not null,       -- 'act_1390480923117690'
  meta_page_id text not null,
  meta_access_token_encrypted text not null,
  gcp_project_id text not null default 'bemtech-478413',
  monthly_budget_ils numeric,
  daily_budget_ils numeric,
  primary_kpi text check (primary_kpi in ('cpa','cpl','roas','cpm','cpi')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
```

### 10.2 `business_knowledge`

```sql
create table business_knowledge (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- structured form (§15.1)
  vertical text,                          -- 'ecommerce' | 'leads' | 'awareness' | ...
  website_url text,
  service_regions text[],
  customer_age_min int,
  customer_age_max int,
  products jsonb,                         -- list of {name, description, price_range}
  delivery_time_days int,
  strong_seasons text[],                  -- ['פסח', 'חנוכה']
  weak_seasons text[],
  -- questionnaire (§15.2)
  questionnaire_answers jsonb,            -- {ideal_customer: "...", pain: "...", ...}
  brand_voice jsonb,                      -- {colors: [...], tone: "...", forbidden_words: [...]}
  competitors text[],                     -- URLs
  -- meta
  last_refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index on business_knowledge (business_id);
```

### 10.3 `baselines`

```sql
create table baselines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  scope text not null check (scope in ('account','campaign','adset')),
  scope_id text,                          -- null for account; Meta ID otherwise
  metric text not null,                   -- 'cpa' | 'ctr' | 'roas' | 'cpm' | ...
  value numeric not null,
  window_days int not null,               -- 7 | 14 | 30 (reactive 2026); 60/90 למעקב היסטורי בלבד
  computed_at timestamptz not null default now()
);

create index on baselines (business_id, scope, scope_id, metric);
```

### 10.4 `approvals` — ה-HITL Queue

```sql
create table approvals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by_run_id uuid not null,

  task_type text not null,
  -- 'budget_change' | 'pause_campaign' | 'resume_campaign' |
  -- 'new_creative' | 'new_campaign' | 'scale_up' | 'scale_down' |
  -- 'pause_adset' | 'expand_audience'

  target_kind text check (target_kind in ('campaign','adset','ad','creative','account')),
  target_id text,                         -- Meta object ID
  payload jsonb not null,                 -- e.g. {"new_daily_budget_cents":10000,"old":5000}
  rationale text not null,
  expected_impact jsonb,                  -- {"expected_cpa_change_pct":-12}
  urgency text check (urgency in ('low','medium','high','urgent')) default 'medium',

  status text not null default 'pending' check (status in (
    'pending','approved','rejected','executed','failed','expired'
  )),
  approved_at timestamptz,
  approved_by text,                       -- user email | 'auto' | 'terminal'
  rejection_reason text,

  executed_at timestamptz,
  execution_result jsonb,                 -- Meta API response or error
  expires_at timestamptz                  -- default: 48h after created_at
);

create index on approvals (business_id, status, created_at desc);
create index on approvals (created_by_run_id);
```

### 10.5 `agent_decisions` — מנגנון הדיווח (ר' סעיף 12)

```sql
create table agent_decisions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  run_id uuid not null,                   -- groups all rows from one graph invocation
  graph_name text not null,               -- 'observe_propose' | 'execute' | 'onboarding'
  node_name text not null,                -- 'observe' | 'diagnose' | 'propose_budget' | ...
  created_at timestamptz not null default now(),

  decision_type text not null check (decision_type in (
    'observation',   -- "snapshot captured, 4 campaigns active"
    'diagnosis',     -- "Campaign X: CPA 44% over target + Freq 3.2 → ad fatigue"
    'proposal',      -- generated an approval row (see related_approval_id)
    'rejection',     -- rejected a candidate proposal (guardrail / low-impact / quota)
    'skip',          -- "in learning phase — not touching"
    'execution',     -- executed an approved action
    'error'          -- node failed
  )),

  summary text not null,                  -- one-line human-readable
  rationale text,                         -- multi-line reasoning (LLM output or rule trace)

  inputs jsonb,                           -- what signals fed this decision
  outputs jsonb,                          -- what it produced

  related_approval_id uuid references approvals(id) on delete set null,
  campaign_id text,
  adset_id text,
  ad_id text,

  llm_model text,                         -- null for deterministic nodes
  llm_tokens_in int,
  llm_tokens_out int,
  latency_ms int,

  guardrail_violations text[],            -- ['no_learning_phase_touch', ...]
  confidence real                         -- 0..1 for LLM judgment
);

create index on agent_decisions (business_id, created_at desc);
create index on agent_decisions (run_id);
create index on agent_decisions (related_approval_id) where related_approval_id is not null;
create index on agent_decisions (decision_type);
```

### 10.6 `creative_gallery`

```sql
create table creative_gallery (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('image','video','copy')),
  -- for images/videos:
  storage_url text,                       -- Supabase Storage or Cloudflare R2
  aspect_ratio text,                      -- '1:1' | '4:5' | '9:16'
  dimensions text,                        -- '1080x1350'
  -- for copy:
  headline text,
  primary_text text,
  cta text,
  -- meta
  generated_by text,                      -- 'imagen' | 'gemini' | 'manual_upload'
  generation_prompt text,
  marketing_angle text,                   -- 'emotion' | 'urgency' | 'benefit' | ...
  placement text,                         -- 'feed' | 'stories' | 'right_column'
  meta_creative_id text,                  -- set after uploaded to Meta
  uploaded_to_meta_at timestamptz,
  performance_snapshot jsonb,             -- CTR/spend/conv at last check
  created_at timestamptz not null default now()
);

create index on creative_gallery (business_id, created_at desc);
```

### 10.7 RLS Policies (Row-Level Security)

גם ב-MVP single-tenant — להכין תשתית ל-v2 multi-tenant:

```sql
alter table businesses        enable row level security;
alter table business_knowledge enable row level security;
alter table baselines         enable row level security;
alter table approvals         enable row level security;
alter table agent_decisions   enable row level security;
alter table creative_gallery  enable row level security;

-- example policy (to be refined when multi-tenant):
create policy "users see own businesses" on businesses
  for select using (id in (select business_id from user_business_access where user_id = auth.uid()));
```

ב-MVP הסוכן משתמש ב-`service_role` key שעוקף RLS — לא מפריע.

---

## 11. Claude Code Invocation Pattern

במקום graph של nodes ו-edges, המערכת משתמשת ב-**Claude Code headless mode** כמנוע ה-orchestration. Claude עצמו מחליט מתי ולמה לקרוא לכלים, לפי ההנחיות שב-markdown.

### 11.1 Invocation Command

```bash
claude -p \
  --output-format json \
  --cwd /path/to/meta-ads-automation-ai-fork/campaigner \
  --env ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  "Run the daily observe-propose flow for business Aiweon.
   Follow the protocol in CAMPAIGNER.md."
```

**הסבר דגלים:**
- `-p` — headless / print mode. Claude רץ, עונה, יוצא.
- `--output-format json` — מחזיר JSON שמכיל את ה-reasoning, tool calls ו-final output. נוח ל-cron ול-debugging.
- `--cwd` — directory הטעינה של `CLAUDE.md` + `CAMPAIGNER.md` (ר' §19).

### 11.2 מה Claude טוען בתחילת כל ריצה

**אוטומטי (ע"י Claude Code):**
1. `CLAUDE.md` הגלובלי של המשתמש + של הרפו + של ה-cwd
2. `CAMPAIGNER.md` (אם קיים בתוך cwd — מוכלל אוטומטית)

**בתוך CAMPAIGNER.md Claude מקבל הוראה לקרוא:**
3. `prompts/performance-brain.md` — לוגיקת §6
4. `prompts/decision-tree.md` — §17
5. `prompts/guardrails.md` — §14
6. `prompts/creative-guide.md` — §7

**דרך Bash tool (לפי צורך):**
7. `tools/load_business_knowledge.py` → JSON מ-Supabase
8. `tools/fetch_insights.py` → Meta snapshot
9. `tools/load_baselines.py` → baselines

### 11.3 Flow 1: Observe-Propose — פרוטוקול

ה-CAMPAIGNER.md שמונחה את Claude:

```markdown
# CAMPAIGNER — Agent Protocol

You are a Meta Ads campaign optimizer. Every invocation you:

## Step 1: Load context
Read these files in order:
  - prompts/performance-brain.md
  - prompts/decision-tree.md
  - prompts/guardrails.md

Run these tools and keep results in context:
  - python tools/load_business_knowledge.py --business-id $BUSINESS_ID
  - python tools/fetch_insights.py --business-id $BUSINESS_ID --days 30
  - python tools/load_baselines.py --business-id $BUSINESS_ID

## Step 2: For each campaign, diagnose
Apply §6.4 Data Sufficiency. If insufficient → log skip, move on.
Apply §17 Decision Tree to classify: winner/average/loser/fatigued.

For each diagnosis, call:
  python tools/log_decision.py --type diagnosis --summary "..." --rationale "..." \
    --campaign-id <id> --inputs '{...}' --outputs '{...}'

## Step 3: Propose actions
For each diagnosis that warrants action, draft a proposal:
  - task_type (budget_change | pause_campaign | new_creative | ...)
  - payload (exact changes)
  - rationale (2-4 sentences in Hebrew)
  - expected_impact
  - urgency

## Step 4: Apply guardrails
Before proposing, run: python tools/check_guardrails.py --proposal '<json>'
If violations → log rejection decision, skip this proposal.

## Step 5: Prioritize (§8.3 anti-flood)
Count total proposals for today. If over quota, keep only the top-impact ones.
Log each rejection.

## Step 6: Write to approvals table
For each surviving proposal:
  python tools/propose_task.py --payload '<json>'
This returns approval_id. Log a final 'proposal' decision with related_approval_id.

## Step 7: Exit
Print a one-line summary for the cron log.

## Rules you MUST follow
- Every action produces an agent_decisions row. No exceptions.
- If a guardrail fails, you DO NOT bypass it.
- You NEVER call Meta API directly — only propose. Execution is a different flow.
- All Hebrew text in rationale/summary must be natural and professional.
```

### 11.4 Flow 2: Execute — פרוטוקול

CAMPAIGNER.md ממשיך:

```markdown
# CAMPAIGNER — Execution Flow

When invoked with "execute approved tasks":

## Step 1: Load pending
python tools/list_approved.py --business-id $BUSINESS_ID  → JSON list

## Step 2: For each approved row, sequentially
  a. python tools/recheck_guardrails.py --approval-id <id>
     If fails: log rejection, mark approval status='failed' with reason, continue.
  b. python tools/execute_task.py --approval-id <id>
     This dispatches to the right Meta API call based on task_type.
  c. python tools/log_decision.py --type execution --summary "..." \
       --related-approval-id <id> --outputs '<meta_response>'
  d. If execute_task returned error:
     python tools/mark_failed.py --approval-id <id> --error "..."

## Step 3: Exit
Print a summary of executed/failed counts.
```

### 11.5 Flow 3: Onboarding — CLI ידני

```bash
campaigner onboard \
  --name "Aiweon" \
  --meta-account "act_1390480923117690" \
  --meta-page-id "123..." \
  --questionnaire-file onboarding/aiweon.yaml
```

סקריפט עצמאי (לא Claude) שמטפל ב:
1. כתיבה ל-`businesses`
2. questionnaire אינטראקטיבי (או טעינה מ-YAML)
3. כתיבה ל-`business_knowledge`
4. שליפת 30 ימי היסטוריה → חישוב baselines → כתיבה ל-`baselines`

### 11.6 Tool Contract Pattern

כל כלי Python ב-`tools/` חייב לציית לחוזה:

**Input:** CLI args בלבד (לא stdin).
**Output:** JSON ב-stdout בלבד. Logs ב-stderr.
**Exit codes:** 0 = success, 1 = error, 2 = validation error.

דוגמה ל-tool ציית:

```python
# tools/fetch_insights.py
import argparse, json, sys
from campaigner.meta.client import MetaClient

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--business-id', required=True)
    p.add_argument('--days', type=int, default=30)
    args = p.parse_args()

    try:
        client = MetaClient.for_business(args.business_id)
        snapshot = client.fetch_insights(days=args.days)
        json.dump(snapshot, sys.stdout)
        sys.exit(0)
    except Exception as e:
        json.dump({'error': str(e)}, sys.stdout)
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
```

Claude reads the stdout JSON and incorporates it into its reasoning. Clean, composable, testable — every tool is runnable by a human too.

### 11.7 Prompt Storage

קבצי markdown ב-`campaigner/prompts/`:
- `performance-brain.md` — §6
- `guardrails.md` — §14
- `decision-tree.md` — §17
- `creative-guide.md` — §7

**ללא Jinja2 ב-MVP.** Claude קורא את הקבצים בשלמותם. Interpolation דינמי (כמו "עבור עסק X") נעשה ע"י Claude עצמו מהקונטקסט — לא דרך template engine.

### 11.8 Claude Code CLI Invocation — דוגמה מלאה

```bash
#!/usr/bin/env bash
# runners/daily_observe_propose.sh

set -euo pipefail

export ANTHROPIC_API_KEY="$(gcloud secrets versions access latest --secret=anthropic-api-key)"
export SUPABASE_URL="..."
export SUPABASE_SERVICE_ROLE_KEY="$(gcloud secrets versions access latest --secret=supabase-sr)"
export META_ACCESS_TOKEN="$(gcloud secrets versions access latest --secret=meta-token-aiweon)"
export BUSINESS_ID="aiweon-uuid"

cd /app/campaigner

claude -p \
  --output-format json \
  "BUSINESS_ID=$BUSINESS_ID. Run the daily observe-propose flow per CAMPAIGNER.md." \
  > /var/log/campaigner/daily-$(date +%Y%m%d).json

exit $?
```

---

## 12. מנגנון דיווח החלטות

**חדש ב-MVP.** מחליף את LangSmith כמנגנון observability.

### 12.1 עקרון

כל צומת בכל גרף **חייב** לרשום לפחות שורה אחת ב-`agent_decisions`. גם LLM nodes. גם Python nodes דטרמיניסטיים. גם rejections. גם skips.

### 12.2 מטרות

המנגנון משרת **שלוש מטרות** בו-זמנית:

1. **Audit Log** — ממלא את דרישת §14 Guardrail: "חובה לתעד כל החלטה + נימוק"
2. **Debugging Trail** — מחליף LangSmith ל-MVP. DB-native.
3. **UX Feature** — הפלטפורמה הוובית מציגה "למה?" ליד כל הצעה פתוחה

### 12.3 מבנה שורה

(סעיף 10.5 — סכמה מלאה)

**הערה על `node_name` ב-Claude Code Native:** מאחר שאין graph nodes בפועל, השדה משמש כ"logical phase name" — Claude מעביר אותו כarg ל-`log_decision.py` בהתאם למה שהוא עושה כרגע (למשל `observe`, `diagnose`, `propose_budget`, `apply_guardrails`, `execute_on_meta`). הערכים מאוחדים עם מה שיהיה ב-v2 LangGraph — כך שאותם prod queries יעבדו באותו אופן.

### 12.4 דוגמאות לרישומים

**Observation:**
```json
{
  "node_name": "observe",
  "decision_type": "observation",
  "summary": "Loaded 4 active campaigns",
  "inputs": {"account_id": "act_..."},
  "outputs": {
    "campaigns_count": 4,
    "total_spend_7d": 4180,
    "api_calls": 3
  },
  "latency_ms": 1204
}
```

**Diagnosis (LLM):**
```json
{
  "node_name": "diagnose",
  "decision_type": "diagnosis",
  "summary": "Campaign 'Kitchens': winner (ROAS 4.2, out of learning)",
  "rationale": "ROAS של 4.2 מעל baseline של 2.8 (50% מעל), CTR 2.1% (>1.5% threshold), Frequency 1.8 (<2.5). יצא מ-Learning לפני 5 ימים. מתאים ל-scale up.",
  "campaign_id": "1234567890",
  "inputs": {"cpa": 42, "baseline_cpa": 60, "ctr": 2.1, "frequency": 1.8},
  "outputs": {"label": "winner", "suggested_actions": ["scale_up_20pct"]},
  "llm_model": "claude-sonnet-4-6",
  "llm_tokens_in": 8420,
  "llm_tokens_out": 312,
  "latency_ms": 2834,
  "confidence": 0.88
}
```

**Rejection (Guardrail):**
```json
{
  "node_name": "apply_guardrails",
  "decision_type": "rejection",
  "summary": "Rejected budget_change on 123: violates no_learning_phase_touch",
  "rationale": "הקמפיין בשלב Learning (12 ימים, 34 המרות). כלל §14.1 אוסר על מגע בקמפיין בלמידה.",
  "guardrail_violations": ["no_learning_phase_touch"],
  "campaign_id": "123",
  "outputs": {"rejected_proposal": {...}}
}
```

**Execution:**
```json
{
  "node_name": "execute_on_meta",
  "decision_type": "execution",
  "summary": "Updated campaign 456 budget: 50→65 ILS/day",
  "related_approval_id": "...",
  "campaign_id": "456",
  "inputs": {"old_budget": 5000, "new_budget": 6500},
  "outputs": {"meta_response": {"success": true, "campaign_id": "456"}}
}
```

### 12.5 שאילתה מהפלטפורמה

"למה הסוכן הציע את ההצעה הזאת?"

```sql
select node_name, decision_type, summary, rationale, created_at
from agent_decisions
where related_approval_id = $1
   or (run_id = (select created_by_run_id from approvals where id = $1)
       and (campaign_id = (select target_id from approvals where id = $1)
            or campaign_id is null))
order by created_at;
```

מחזיר את שרשרת החשיבה המלאה שהובילה להצעה זו.

### 12.6 Retention & Cost

- שמירה: 90 ימים (ב-MVP). אחרי זה — מחיקה (או archiving ל-cold storage ב-v2).
- עלות אחסון: זניחה — ~50KB לrun × 2 runs/day × 90 days = 9MB/business/90d.
- בעתיד: ייתכן partitioning של `agent_decisions` לפי `created_at` חודשי.

---

## 13. אישורים מ-Meta

*(סעיף זה נשמר מהאפיון הראשוני ללא שינוי.)*

**קריטי: App Review של Meta הוא צוואר בקבוק - עד 4 שבועות. להתחיל מוקדם.**

| # | אישור | זמן | קושי |
|---|---|---|---|
| 1 | Meta Developer App | 5 דקות | טריוויאלי |
| 2 | `ads_management` Advanced Access | 2-4 שבועות | App Review דורש הדגמה |
| 3 | Business Verification | 1-2 שבועות | ח.פ, מסמכים |
| 4 | `ads_read` + `business_management` | חלק מה-App Review | |
| 5 | System User Token | אחרי Business Verification | לחיבורי לקוחות יציבים |
| 6 | Tech Provider / Solutions Partner | בהמשך | מעמד רשמי ל-SaaS |

**הרשאות נדרשות עיקריות:**
- `ads_management` - ניהול קמפיינים
- `ads_read` - קריאת נתונים
- `business_management` - גישה ל-Business Manager
- `pages_show_list`, `pages_read_engagement` - לעמודים
- `instagram_basic` - לחשבונות אינסטגרם מקושרים
- `whatsapp_business_management` - **v2 בלבד** (WhatsApp attribution דחוי)

---

## 14. Guardrails

חוקים קשיחים שהסוכן **לא חורג מהם אף פעם** - גם אם "חושב" שכדאי.

**מימוש:** Python functions ב-`campaigner/guardrails.py`. צומת `apply_guardrails` ב-Graph 1 ו-`guardrail_recheck` ב-Graph 2 מריצים את כולם על כל הצעה.

### 14.1 חוקי מערכת (לא ניתנים לשינוי)

```python
GUARDRAILS = [
    no_delete_campaigns,                  # רק השהיה
    max_tasks_per_day,                     # §8.3
    no_learning_phase_touch,               # לא נוגעים בקמפיין ב-learning
    budget_jump_max_30pct,                 # default 20%, עד 30% רק אם hook>35% + freq<2.0
    no_audience_change_on_active,          # לא משנים קהל בקמפיין פעיל
    no_horizontal_scaling_by_duplication,  # חדש 2026 — duplication מאפס Learning
    meta_api_rate_limit,                   # X calls/minute
    document_every_decision,               # חובה: כל פעולה רושמת ב-agent_decisions
    explicit_approval_over_threshold_ils,  # > ₪500/יום שינוי → אישור מפורש
    no_pause_on_recent_conversion_24h,     # לא לכבות קמפיין שהביא המרה ב-24h
    no_low_res_creative,                   # < 1080p → פסילה
    require_95pct_significance_for_ab,     # חדש 2026 — A/B winner חייב 95% CI
    prefer_add_creative_over_pause,        # חדש 2026 — Creative Fatigue → הוסף, לא תפסיק
    no_manual_creative_pruning_before_48h, # חדש 2026 — אל תחתוך ידנית לפני Gate 1 threshold
    no_frequency_only_kill,                # חדש 2026 — Frequency>3 לא trigger עצמאי
    remarketing_min_budget_ils,            # רימרקטינג > ₪50/יום גם בעונה חלשה (v2)
    external_source_allowlist,             # רק אתרים אמינים (v2)
    no_competitor_hallucinations,          # v2 — דורש מקור לכל טענה
    video_preferred_on_equal_cpa,          # העדפת וידאו כשה-CPA זהה
]
```

**guardrails חדשים (2026) שנוספו מ-findings-diff:**
- `no_horizontal_scaling_by_duplication` — duplication מאפס Learning Phase
- `require_95pct_significance_for_ab` — A/B winner declarations דורשות 95% CI
- `prefer_add_creative_over_pause` — כש-Creative Fatigue flag מופעל, הוסף קריאייטיבים חדשים במקום לעצור
- `no_manual_creative_pruning_before_48h` — Andromeda מחלקת תקציב לא-אחיד במכוון; אל תחתוך ידנית
- `no_frequency_only_kill` — Frequency > 3 אינו trigger עצמאי ל-kill

כל guardrail הוא פונקציה `(proposal, state) -> GuardrailResult`.
שבירה → rejection ב-`apply_guardrails`, לא passthrough.

### 14.2 חוקי משתמש (ניתנים להגדרה — שדות ב-`businesses` / בטבלה חדשה בעתיד)

- תקרת הוצאה יומית כוללת (`businesses.daily_budget_ils`)
- רשימת מילים אסורות בקופי (`business_knowledge.brand_voice.forbidden_words`)
- שעות פעילות — **v2**
- סף auto-approval — **v2** (ר' §16, ב-MVP כולם OFF)

---

## 15. Business Knowledge - טופס+שאלון

**החלטה:** לא PDF חופשי. **טופס מובנה + שאלון מונחה.** מאוחסן ב-Supabase כ-structured JSONB (לא Vector DB).

### 15.1 טופס מובנה (שדות חובה)

מוכנס ישירות ל-`business_knowledge` columns:
- `name` (ב-`businesses`)
- `vertical` (eCommerce/שירותים/לידים/אפליקציה/אחר)
- `website_url`
- `service_regions` (מערך)
- `customer_age_min`, `customer_age_max`
- `products` (JSONB — עד 10)
- `monthly_budget_ils` (ב-`businesses`)
- `daily_budget_ils`
- `delivery_time_days`
- `strong_seasons`, `weak_seasons` (מערכים של שמות)
- `primary_kpi` (ב-`businesses`)

### 15.2 שאלון מונחה

15-20 שאלות, לפי סדר חכם. שמורות ב-`business_knowledge.questionnaire_answers` JSONB:

```json
{
  "ideal_customer": "הורים לילדים 8-13 באזור המרכז עם הכנסה 15K+",
  "main_pain": "לא יודעים איך לעשות בת/בר מצווה מיוחדת",
  "common_objections": "מחיר, זמינות סופ\"שים, מרחק",
  "usp": "עיצוב מותאם אישית + הכל תחת קורת גג אחת",
  "testimonials": [...],
  "what_worked_before": "וידאו של ילד נרגש",
  "what_failed_before": "קופי ארוך יותר מ-3 שורות",
  "brand_sensitivities": "אין",
  "brand_colors_tone": {...},
  ...
}
```

**כל התשובות** נטענות בשלמותן ל-context של Claude — אין RAG, אין embeddings. חלון ה-200K tokens של Claude מכיל אותן בקלות, וה-prompt caching חוסך עלויות.

### 15.3 רענון ידע

- פעם ב-90 ימים - הסוכן יוצר משימה ב-`approvals` מסוג `refresh_knowledge` עם urgency=low
- המשתמש יכול לעדכן בכל עת דרך הפלטפורמה

---

## 16. Auto-Approval

**החלטה:** הפיצ'ר בארכיטקטורה, אבל **ב-MVP כל ההגדרות OFF כברירת מחדל**.

### 16.1 עקרון

המשתמש יגדיר **ספים** שמתחתם פעולות מבוצעות אוטומטית ללא אישור. ב-MVP אין UI לכך — השדות קיימים ב-DB אך תמיד false.

### 16.2 Table (v2 — placeholder ב-MVP)

```sql
-- v2 — לא מיושם ב-MVP
create table auto_approval_rules (
  business_id uuid references businesses(id),
  budget_changes_under_ils numeric default 0,        -- 0 = off
  auto_pause_losers boolean default false,
  auto_upload_new_creatives boolean default false,
  auto_create_campaigns boolean default false,       -- highly dangerous
  auto_audience_changes boolean default false        -- highly dangerous
);
```

### 16.3 Safety Net

גם כשיופעל (v2):
- כל פעולה מתועדת ב-`agent_decisions` עם `approved_by='auto'`
- תקרה יומית על פעולות אוטומטיות
- Rollback מהיר — הפלטפורמה תציג "Undo" ל-24h
- שבוע ראשון של עסק חדש — הכל נשאר OFF (trust-building)

---

## 17. עץ החלטות לדיאגנוזה

*(עודכן ע"פ findings-diff 2026-04-16 — נוסף §17.0 Early Creative Evaluation (Gate 1) שרץ לפני שאר הענפים. המימוש: prompt ב-`prompts/decision-tree.md` שClaude קורא.)*

**מבנה שני שערים (ר' §6.5):** הסוכן מריץ תחילה את §17.0 (Gate 1 — leading signals, creative-level) על כל קריאייטיב. אם קריאייטיב עובר את Gate 1, הוא זכאי להערכה ב-§17.1-17.3 (Gate 2 — lagging signals, campaign-level).

### 17.0 תרחיש: Early Creative Evaluation (Gate 1)

**חלון זמן:** 48h - 7d מהעלאת הקריאייטיב.

```
FOR EACH active creative:
  ├─ יש ≥1,000 חשיפות ו-≥50 clicks? (data sufficiency, §6.4)
  │  └─ לא → SKIP (log 'skip' decision, חכה ל-volume)
  │
  ├─ Hook rate < 25% אחרי 48h?
  │  └─ מסקנה: קריאייטיב לא עוצר גלילה
  │     פעולה: KILL creative (pause), הוסף וריאנט חדש עם hook שונה
  │
  ├─ CTR < 1% עם ≥1,000 חשיפות?
  │  └─ מסקנה: הנעה לפעולה חלשה / אי-התאמה לקהל
  │     פעולה: KILL creative, נסה angle שונה (ר' §7.5)
  │
  ├─ Hook rate 25-35% + CTR תקין?
  │  └─ מסקנה: solid performer — תן זמן
  │     פעולה: המשך, הסוכן לא נוגע
  │
  └─ Hook rate > 35% + CTR > 2%?
     └─ מסקנה: winner potential
        פעולה: צור 2-3 וריאנטים דומים (iterate על הזווית המנצחת)
```

**עיקרון קריטי:** ב-Gate 1 לא מסתכלים על CPA/ROAS כלל. אלה lagging indicators ש-48h אחרי העלאה לא אמינים. רק leading signals.

### 17.1 תרחיש: CPA יקר מדי (Gate 2)

```
CPA > יעד × 1.3 למשך 5+ ימים (post-learning)
  │
  ├─ CTR נמוך? (< 1%)
  │  └─ מסקנה: המודעה לא מעניינת / הקהל לא נכון
  │     פעולה: הוספת קריאייטיבים חדשים (לא פאוזה!) + diversity
  │
  ├─ CTR גבוה, אין המרות?
  │  └─ מסקנה: בעיה בדף נחיתה / Offer
  │     פעולה: התראה למשתמש "המודעה מעולה, אבל נטישה בדף הנחיתה"
  │
  ├─ Meta Creative Fatigue flag (CPR ≥ 2× היסטורי)?
  │  └─ מסקנה: שחיקת קריאייטיב — Meta עצמה מזהה
  │     פעולה: הוספת 3-5 קריאייטיבים חדשים (diversity), לא פאוזה אוטומטית
  │
  └─ Frequency > 3.0?
     └─ monitoring signal בלבד — אם CPR יציב, אל תיגע.
        אם CPR לא יציב — ר' ענף ה-Fatigue flag למעלה.
```

### 17.2 תרחיש: קמפיין מעולה (CPA נמוך + יציב)

```
CPA < יעד × 0.8 למשך 5-7 ימים יציב + hook rate > 35%
  │
  ├─ התקציב נוצל במלואו?
  │  └─ פעולה: Scale Up 20% (default)
  │     או 30% אם hook > 35% ו-frequency < 2.0
  │
  ├─ קמפיין Advantage+?
  │  └─ בדיקת Cannibalization — v2
  │
  └─ אל תבצע horizontal scaling (duplication):
     זה מאפס Learning Phase. תמיד vertical scaling.
```

### 17.3 תרחיש: ירידה רוחבית בכל החשבון

```
כל הקמפיינים ירדו בבת אחת
  │
  ├─ יום בשבוע חריג? → אין אקשן
  ├─ חג/מועד? → התאמה מראש (v2)
  ├─ חדשות חריגות (מלחמה/אירוע)? → Operation Mode "Storm" (v2)
  └─ שום אחד מהנ"ל? → התראה "ייתכן תקלה טכנית — בדוק Pixel/Events"
```

### 17.4 כרטיס משימה - דוגמה (`approvals` row + `agent_decisions` trail)

```
🔔 הצעה: קמפיין "מבצע אביב - Aiweon"

הסטטוס הנוכחי:
  CPA: ₪72 (חריגה של 44% מהיעד ₪50, 5 ימים)
  CPR יחסי: 2.1× baseline (Meta Creative Fatigue flag — TRIGGERED)
  Hook rate של Video_01: ירד מ-38% ל-22%

הדיאגנוזה:
  Meta Creative Fatigue flag פעיל על Video_01.
  Hook rate מתחת ל-25% threshold → Gate 1 kill criterion.
  CPR גבוה פי 2 מ-baseline היסטורי.

הפעולות המוצעות:
  1. השהיית Video_01 (עונה על Gate 1 kill — hook rate < 25%)
  2. הוספת 3 קריאייטיבים חדשים מהגלריה (continuous firehose)
  3. לא להשהות את הקמפיין — תן ל-Andromeda להחליף

תוצאה צפויה:
  ירידת CPR תוך 3-5 ימים ככל שהקריאייטיבים החדשים יזכו בהעדפה
  חזרה ל-CPA baseline (~₪50) תוך שבוע

[✅ אשר הכל] [❌ דחה] [✏️ ערוך]
```

---

## 18. Cron Schedule

### 18.1 לוח זמנים MVP

| Cron expression | שם משימה | פקודה | משך משוער |
|---|---|---|---|
| `0 9 * * *` (Asia/Jerusalem) | daily-observe-propose | `bash runners/daily_observe_propose.sh` | 2-5min |
| `*/15 * * * *` | execute-approvals | `bash runners/execute_approvals.sh` | 10-60s |
| `0 10 * * 1` (Mon 10:00 IL) | weekly-creative-firehose | `bash runners/weekly_creative_firehose.sh` | 3-8min |
| `0 3 1 * *` | monthly-baseline-refresh | `python -m campaigner.scripts.refresh_baselines --business-id aiweon` | 1-2min |

`runners/*.sh` קוראים ל-`claude -p "..."` עם משתני סביבה (ר' §11.8).

#### Weekly Creative Firehose — מה זה עושה

מימוש ה-firehose model של §7.2 (Andromeda מעדיפה diversity מתמשכת — 10-50+ קריאייטיבים פעילים). Claude רץ שבועית ומייצר 3-5 קריאייטיבים חדשים לקמפיינים הפעילים:

```bash
# runners/weekly_creative_firehose.sh (outline)
claude -p --output-format json \
  --max-turns 20 \
  "BUSINESS_ID=$BUSINESS_ID. Run the weekly-creative-firehose flow per CAMPAIGNER.md."
```

**Flow בתוך CAMPAIGNER.md:**
1. שלוף קמפיינים פעילים + קריאייטיבים קיימים (דרך `tools/list_active_creatives.py`)
2. לכל קמפיין — בחר 3 marketing angles שעוד לא נוסו מספיק (§7.5) לפי הביצועים
3. לכל angle — צור 1 קריאייטיב דרך `tools/generate_creative.py` (עוטף `image_generator.py` + Claude copy generation)
4. פתח approval לכל קריאייטיב חדש (task_type='new_creative')
5. לוג ל-`agent_decisions` עם rationale על הבחירה

**עיקרון:** אף פעם לא פאוזה ידנית של קריאייטיבים קיימים ב-flow הזה — זה רק מוסיף. פאוזה מתבצעת דרך §17.0 Gate 1 ב-flow היומי.

**Cost estimation (תוספת ל-§21):**
- Claude: ~3K input + 2K output tokens × 5 creatives = ~$0.05/שבוע
- Imagen: 5 תמונות × 3 aspect ratios × $0.02 = $0.30/שבוע
- **~$1.40/חודש** נוספים. כלול ב-§21.4.

### 18.2 Cron Runner

**שתי אופציות:**

1. **Supabase pg_cron** — עבודות SQL טהורות (נוחות ל-refresh_baselines), אבל לא יכול להפעיל את Claude CLI.
2. **crontab על שרת (GCE / Cloud Run Jobs) שמכיל את Claude CLI** — ⭐ **מועדף**.

**מימוש מומלץ:** Cloud Run Job עם Docker image שמכיל:
- Claude CLI (מ-`npm i -g @anthropic-ai/claude-code`)
- Python 3.11 + requirements.txt
- הקוד של `campaigner/`

Cloud Scheduler קורא ל-Job עם args שונים לכל cron slot.

### 18.3 Concurrency Protection

- Flow 2 (Execute) לא ירוץ פעמיים במקביל — **Postgres advisory lock** על `business_id`:
  ```sql
  SELECT pg_try_advisory_lock(hashtext('execute_' || :business_id));
  ```
- אם lock נכשל → צא בשקט (run אחר בעבודה).
- הlock נלקח מתוך `runners/execute_approvals.sh` לפני הקריאה ל-`claude -p`.

### 18.4 Error Handling

- `claude -p --output-format json` מחזיר exit code:
  - `0` — הצלחה
  - `1` — כשל (שגיאת LLM / כלי)
- כל כלי Python שClaude קורא לו כותב ב-fail ל-`agent_decisions` עם `decision_type='error'`.
- 3 failures רצופים → התראה (email/Slack — v2; MVP רק log file).

### 18.5 Claude Headless Timeouts

- Default timeout ל-`claude -p` הוא ארוך מאוד. הגדר `--max-turns 30` (או דומה) כדי למנוע loops.
- Log output ל-`/var/log/campaigner/` עם rotation יומי.

---

## 19. מבנה פרויקט Python

```
meta-ads-automation-ai-fork/
├── campaigner/                         # ← חדש: החבילה הראשית
│   ├── CAMPAIGNER.md                   # ← Protocol שClaude Code טוען בתחילת ריצה
│   ├── CLAUDE.md                       # ← הוראות ל-CC ברמת ה-cwd
│   │
│   ├── prompts/                        # markdown files — ידע וכללים (Claude קורא ישירות)
│   │   ├── performance-brain.md        # §6
│   │   ├── decision-tree.md            # §17
│   │   ├── guardrails.md               # §14
│   │   ├── creative-guide.md           # §7
│   │   └── hebrew-copy-style.md        # טון/רגיסטר/איסורים בקופי
│   │
│   ├── tools/                          # Python CLI scripts (Claude קורא להם דרך Bash)
│   │   ├── fetch_insights.py           # Meta snapshot → JSON
│   │   ├── load_baselines.py           # Supabase → JSON
│   │   ├── load_business_knowledge.py  # Supabase → JSON
│   │   ├── check_data_sufficiency.py   # volume/time thresholds per §6.4
│   │   ├── check_guardrails.py         # validate proposal → JSON
│   │   ├── recheck_guardrails.py       # re-check before execute
│   │   ├── propose_task.py             # insert approval → approval_id
│   │   ├── log_decision.py             # insert agent_decisions row
│   │   ├── list_approved.py            # fetch approved rows
│   │   ├── list_active_creatives.py    # creative firehose — active + their performance
│   │   ├── execute_task.py             # dispatch to meta_ads_manager.py
│   │   ├── mark_failed.py              # update approval status=failed
│   │   └── generate_creative.py        # wraps image_generator.py + copy gen (firehose)
│   │
│   ├── cli/                            # User-facing CLI (terminal-first)
│   │   ├── __init__.py
│   │   ├── __main__.py                 # `campaigner <subcommand>`
│   │   ├── approve.py                  # campaigner approve <id>
│   │   ├── reject.py                   # campaigner reject <id> --reason "..."
│   │   ├── list.py                     # campaigner list [--pending|--approved|--all]
│   │   ├── inspect.py                  # campaigner inspect <run-id|approval-id>
│   │   ├── run.py                      # campaigner run daily|execute (manual trigger)
│   │   └── onboard.py                  # campaigner onboard ...
│   │
│   ├── lib/                            # shared library code (not invoked by Claude directly)
│   │   ├── __init__.py
│   │   ├── supabase_client.py          # typed helpers
│   │   ├── meta_client.py              # wraps existing meta_ads_manager.py
│   │   ├── creative.py                 # wraps existing image_generator.py
│   │   ├── baselines.py                # baseline computation
│   │   └── config.py                   # env loading
│   │
│   └── scripts/
│       ├── refresh_baselines.py
│       └── seed_test_data.py
│
├── runners/                            # ← Bash entrypoints for cron
│   ├── daily_observe_propose.sh        # invokes `claude -p "..."` (09:00 יומי)
│   ├── execute_approvals.sh            # invokes `claude -p "..."` (כל 15 דק')
│   └── weekly_creative_firehose.sh     # invokes `claude -p "..."` (שני 10:00)
│
├── docs/
│   └── plans/
│       ├── campaigner-spec.md          # ← מסמך זה
│       ├── CAMPAIGNER_AGENT_SPEC.md    # האפיון הראשוני (reference)
│       └── langgraph-v2-migration.md   # ← ייכתב ב-v2 (עדיין לא קיים)
│
├── migrations/                         # ← חדש: Supabase SQL migrations
│   ├── 001_businesses.sql
│   ├── 002_business_knowledge.sql
│   ├── 003_baselines.sql
│   ├── 004_approvals.sql
│   ├── 005_agent_decisions.sql
│   └── 006_creative_gallery.sql
│
├── meta_ads_manager.py                 # ← קיים, נשאר
├── image_generator.py                  # ← קיים, נשאר
├── automation_main.py                  # ← קיים (legacy)
├── run_automation.py                   # ← קיים (legacy)
├── create_simple_ad.py                 # ← קיים
├── test_credentials.py                 # ← קיים, שימושי
├── diagnose_page_permissions.py        # ← קיים, שימושי
│
├── requirements.txt                    # ← מעודכן
├── .env.example                        # ← מעודכן
├── CLAUDE.md                           # ← קיים
├── Dockerfile                          # ← חדש (Claude CLI + Python + קוד)
└── README.md                           # ← קיים
```

**הערות:**
- **`campaigner/tools/*.py` = הכלים של Claude.** כל אחד CLI עצמאי, input/output JSON, exit codes נקיים (§11.6).
- **`campaigner/cli/*.py` = הכלים של המשתמש.** גם Python, אבל נקודת הכניסה היא `campaigner` בינארי.
- **`campaigner/lib/*.py` = קוד משותף.** גם tools/ וגם cli/ מייבאים ממנו.
- **הקוד הקיים (`automation_main.py` וכו')** משמש כ-reference ונעטף תוך `campaigner/lib/meta_client.py`.
- **`CAMPAIGNER.md` הוא הקובץ המרכזי** שClaude קורא כדי לדעת מה לעשות — שם מתועד הפרוטוקול של §11.3-§11.4.

---

## 20. Tech Stack

| שכבה | טכנולוגיה | הערות |
|---|---|---|
| שפה | Python 3.11+ + Bash | Bash ל-runners |
| **Agent engine** | **Claude Code CLI (headless)** | `@anthropic-ai/claude-code` (npm) |
| LLM | **Claude** (Sonnet 4.6 / Opus 4.6) | משרת ע"י Claude Code, דרך Anthropic API |
| DB | **Supabase** (Postgres + Auth + Storage) | |
| Python DB client | `supabase-py` | |
| Meta SDK | `facebook-business` | כבר מותקן ברפו |
| Image gen | `google-genai` (Vertex AI Imagen) | כבר מותקן ברפו |
| CLI framework | `typer` או `click` | ל-`campaigner` binary |
| Scheduling | **Cloud Run Jobs + Cloud Scheduler** | GCP native, קיים ב-project |
| Secrets | Google Secret Manager | `ANTHROPIC_API_KEY`, `META_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` |
| Observability | טבלת `agent_decisions` + stdout logs | MVP; LangSmith נדחה ל-v2 |
| Testing | pytest + supabase-py mocks | |
| Deployment | Docker → Artifact Registry → Cloud Run Job | Dockerfile כולל Claude CLI + Python |

**הסרו מ-MVP (שמור ל-v2 LangGraph):**
- `langgraph`, `langchain-google-vertexai`, `jinja2`

**חבילות חדשות להוסיף ל-`requirements.txt`:**
```
supabase>=2.0
pydantic>=2.0
typer>=0.12
```

**חבילות קיימות (נשארות):**
```
google-genai       # Imagen
facebook-business  # Meta API
python-dotenv
requests
pillow
```

**Dockerfile outline:**
```Dockerfile
FROM python:3.11-slim

# Install Node.js + Claude CLI
RUN apt-get update && apt-get install -y curl \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y nodejs \
  && npm install -g @anthropic-ai/claude-code

# Install Python deps
COPY requirements.txt /app/
WORKDIR /app
RUN pip install --no-cache-dir -r requirements.txt

# Install our package (for `campaigner` CLI binary)
COPY . /app
RUN pip install -e .

# Cloud Run Job entrypoint — which runner to invoke is passed as args
ENTRYPOINT ["bash"]
CMD ["runners/daily_observe_propose.sh"]
```

---

## 21. הערכת עלויות LLM

### 21.1 מחירון Claude (Anthropic API)

**Claude Sonnet 4.6** (מומלץ ברירת מחדל):
- Input: $3 / 1M tokens
- Output: $15 / 1M tokens
- עם prompt caching: cache reads $0.30 / 1M (-90%) ← משמעותי כי CAMPAIGNER.md + prompts/*.md קבועים

**Claude Opus 4.6** (אופציונלי לhard cases):
- Input: $15 / 1M tokens
- Output: $75 / 1M tokens

### 21.2 הערכה לעסק אחד (MVP) — Flow 1 (Observe-Propose, 1×/יום)

session של Claude Code headless טיפוסי מכיל:
- `CLAUDE.md` + `CAMPAIGNER.md` + כל `prompts/*.md` — **cacheable** (~15K tokens)
- תוצרי כלים (fetch_insights, load_baselines, business_knowledge) — ~8K tokens
- Claude reasoning output + tool calls — ~5K tokens output

**Estimate per daily run:**
- Input (first turn, uncached): 23K × $3/1M = **$0.069**
- Input (subsequent turns, cached): 15K × $0.30/1M + 8K × $3/1M = **$0.028**
- בהנחה של 5 turns בעל session (Claude קורא לכלים מספר פעמים):
  - Run 1: $0.069
  - Runs 2-5 (cache hits): 4 × $0.028 = $0.112
  - Output (cumulative): 5 × 1K × $15/1M = $0.075
- **סה"כ per daily run: ~$0.26**

### 21.3 Flow 2 (Execute, 96×/יום)

רוב הריצות ריקות (אין approvals ממתינים). ב-no-op:
- 1 turn, 15K cached input → ~$0.005
- ממוצע 3 approvals בפועל/יום → 3 × $0.05 = $0.15

~$0.50/יום (כולל no-ops ו-real executions).

### 21.4 סיכום חודשי

```
Flow 1 (daily observe-propose): $0.26/run × 30 runs  = $7.80
Flow 2 (execute approvals):     $0.50/day × 30 days  = $15.00
Flow 3 (weekly creative):       $0.05/run × 4 runs   = $0.20
──────────────────────────────────────────────────────────
Claude total:                                          ~$23.00/חודש/עסק
```

**הוספה — Imagen:**
- Imagen Fast: $0.02/תמונה
- Flow יומי: ad-hoc (לפי הצעות) — ~20 תמונות/חודש = **$0.40**
- Flow שבועי (creative firehose): 5 קריאייטיבים × 3 aspect ratios × 4 שבועות = 60 תמונות = **$1.20**
- **סה"כ Imagen: ~$1.60/חודש**

**סה"כ AI costs per business MVP: ~$25/חודש.** עדיין זניח ל-SaaS.

**הערות:**
- עם caching יעיל (cache hits >90%) המספר ירד משמעותית.
- Flow 2 רוב הריצות no-op — במימוש מנוהל אפשר לסגור את claude session מוקדם אם אין approvals.
- ב-v2 LangGraph עם Gemini — עלויות נמוכות יותר (~$4/חודש), אבל מפסידים את איכות ה-reasoning והעברית של Claude.

---

## 22. מחוץ ל-MVP - דחיות ל-v2

להלן דברים שנחתכו במפורש, עם סיבה לכל אחד. חשוב לתעד כדי שיחזרו לאחר MVP.

| נושא | סיבת דחייה | טריגר לשחזור |
|---|---|---|
| **LangGraph orchestration** | Claude Code Native מספיק לעסק אחד; LangGraph מורכב יותר | **חשבון מודעות שני** נוסף למערכת |
| **Gemini 2.5 Pro** (LLM זול יותר) | נצמד ל-LangGraph כדי לנצל יתרונות של structured output + פחות context overhead | ביחד עם LangGraph |
| Multi-tenant | דורש RLS מלא + auth flow + billing per tenant | לקוח שני |
| Operation Modes (Storm/Off-Season/Peak) | דורש Context Engine + מקורות חיצוניים | אחרי 60 ימי Normal יציב |
| Annual Budget War Chest | דורש ≥12 חודשי דאטה | שנה אחרי go-live |
| RLHF feedback loop | דורש Vector DB + preference learning | >20 דחיות חוזרות מאותו משתמש |
| Master View dashboard | רלוונטי רק ב-multi-tenant | עם multi-tenant |
| Context Engine (news/season scanning) | מורכבות גבוהה, ROI לא ברור ב-MVP | lead מלקוח בעל עונתיות חזקה |
| WhatsApp attribution | דורש WhatsApp Business API + Pixel integration | קיום WhatsApp בעסק פעיל |
| Advantage+ Multi-campaign Testing | תקציב מינימלי $100/day לא תמיד יש | תקציב יומי > ₪500 |
| Auto audience building | מורכב; risk גבוה | אחרי 30 ימי HITL stable |
| Real-time alerts (webhook) | דורש endpoint ציבורי ב-Meta | |
| Video/Voice-over AI generation | עלות גבוהה, איכות בעברית עדיין חלשה | איכות Veo/ElevenLabs בעברית > סף |
| Regeneration loop על דחיית קריאייטיב | UX מורכב | feedback מלקוחות |
| Cross-business intelligence | רלוונטי רק ב-multi-tenant | עם multi-tenant |
| LangSmith / Langfuse | `agent_decisions` מספיק ל-MVP | debugging מסובך שהטבלה לא מכסה |

### 22.1 תכנית מעבר ל-LangGraph (v2)

מסמך נפרד ייכתב: `docs/plans/langgraph-v2-migration.md`. להלן ראשי הפרקים שהוא יכלול:

1. **Triggers לשינוי** — מתי ההחלטה בשלה (>1 ad account)
2. **Architecture diff** — מה משתנה מול CC Native
3. **Graph topology** — 3 graphs (ObservePropose, Execute, Onboarding) עם nodes ו-state schema
4. **LLM swap** — Claude → Gemini 2.5 Pro via `langchain-google-vertexai`
5. **Concurrency model** — multi-business בו-זמנית, advisory locks, queue
6. **Migration plan** — איך עוברים בלי downtime (CC runs במקביל ל-LangGraph בשלב מעבר)
7. **Observability upgrade** — הוספת LangSmith/Langfuse
8. **Re-use של MVP** — הקוד של `tools/`, `lib/`, טבלאות Supabase — נשמר כמעט כמו שהוא; רק השכבה של ה-orchestration מוחלפת
9. **Prompts migration** — `prompts/*.md` → Jinja2 templates עם variable interpolation
10. **Cost comparison** — לפני/אחרי

**עיקרון מרכזי:** הארכיטקטורה של MVP תוכננה כך שהמעבר יהיה יחסית טריוויאלי. ה-Python tools, ה-Supabase schema, וה-business logic (§6, §7, §14, §17) — כולם יישמרו. רק שכבת ה-orchestration מוחלפת.

---

## 23. שאלות פתוחות / TODO

### 23.1 לפני פיתוח

- [ ] **Supabase project** — ליצור project ב-Supabase (או להשתמש בקיים). אזור: `eu-west-1` (קרוב ל-Israel).
- [ ] **Meta App Review** — להתחיל תהליך **היום**. הרשאה `ads_management` היא bottleneck של 2-4 שבועות.
- [ ] **Anthropic API key** — ליצור key ב-console.anthropic.com ולשמור ב-Google Secret Manager.
- [ ] **GCP quotas** — לוודא quotas של Vertex AI ב-`bemtech-478413` עבור Imagen (יצירת תמונות).
- [ ] **Claude CLI** — לוודא שהוא נכלל ב-Dockerfile של Cloud Run Job (`npm i -g @anthropic-ai/claude-code`).
- [ ] **Aiweon Business Knowledge** — להריץ את השאלון סעיף 15 מול הצוות של Aiweon. לתעד ב-`business_knowledge`.
- [ ] **Baselines ראשוניים** — לשלוף 30-90 ימי היסטוריה מ-Meta API וליצור רשומות `baselines` ראשוניות.

### 23.2 אחרי פיתוח, לפני go-live

- [ ] **Prompt tuning** ב-`CAMPAIGNER.md` + `prompts/*.md` — 2-3 סבבי iteration עד שClaude מקבל החלטות טובות.
- [ ] **Dry-run mode** — flag שClaude קורא והופך את הכלים ל-no-op (לא כותב ל-`approvals`, לא קורא ל-Meta write API). לטסטים.
- [ ] **Monitoring** — איך יודעים שהcron רץ? Simple healthcheck בקוד של `runners/*.sh` שכותב ל-`heartbeat` table.
- [ ] **Token refresh** — `META_ACCESS_TOKEN` פג כל ~60 ימים. להחליט: System User Token (אחרי Business Verification) או התראה ידנית?
- [ ] **Max turns limit** — לוודא ש-`claude -p` מוגבל ב-`--max-turns` שלא יוצר infinite loops.

### 23.3 החלטות שלא הוכרעו (נפוצות על כלל המוצר)

- [ ] **מודל עסקי של ה-SaaS** — דחוי ל-v2 (MVP = Aiweon בלבד, אין monetization)
- [ ] **Data retention** — 90 ימים ל-`agent_decisions`, ∞ ל-`approvals`/`baselines`. לאשר.
- [ ] **GDPR** — לא רלוונטי ב-MVP (עסק ישראלי אחד). נושא ב-v2.

### 23.4 שאלות פתוחות מ-Deep Research (Business Knowledge inputs)

שאלות שהמחקר של 2026 לא פתר — הסוכן יידרש לנתוני החשבון או לקלט מהמשתמש (ר' `docs/deep_research/findings-diff.md` §10):

- [ ] **Vertical-specific kill/scale thresholds לישראל** — אין primary data; Aiweon חייב 30-60 ימי baseline לפני שיקבעו ספים. לתכנן **30-day calibration window** לפני הפעלה מלאה של kill decisions.
- [ ] **Confidence interval math ל-CPA movement** — אין מספר רשמי; הסוכן משתמש ב-volume heuristics (≥1,000 חשיפות + ≥50 clicks). אם לא בטוח — יבקש אישור מפורש.
- [ ] **ניהול מספר winners בו-זמנית ב-ad set** — אין פרקטיקה מוסכמת. ל-MVP: יצירת proposal עם 3 אפשרויות (pause losers / scale winners in place / move winners out), המשתמש בוחר.
- [ ] **סובלנות Andromeda לקפיצות תקציב > 20%** — practitioners עדיין שמרניים. ל-MVP נשאר 20%. נוכל לנסות 30% בהרשאה ידנית.
- [ ] **שחיקה ארוכת-טווח של GenAI creatives** — אין 2026 data. ל-MVP: מעקב צמוד על CPR של קריאייטיבים AI-generated; אם יש trend שחיקה מהיר יותר — flag ל-`docs/research/`.
- [ ] **Awareness/warming vs direct conversion לנישות שירות ישראליות** — debate פרקטיקה. ל-Aiweon: התחלה ב-direct conversion (trust Meta); אם נכשל — הוספת שכבת warming v2.

---

## 24. מקורות

### מקורות פנימיים

- **`CAMPAIGNER_AGENT_SPEC.md`** — האפיון הראשוני (15/04/2026), בסיס למסמך זה
- **`CLAUDE.md`** ברפו — מתעד state נוכחי של הקוד הקיים
- שיחות אפיון טכני (15/04/2026) — שהובילו לדחיית LangSmith/Vector DB, מעבר ל-Claude Code Native, מעבר ל-stateless cron, טבלת `agent_decisions`, ודחיית LangGraph+Gemini ל-v2
- **`docs/deep_research/findings-diff.md`** — (16/04/2026) דיף מובנה בין האפיון ל-2 מקורות מחקר 2026; בסיס לעדכונים המרכזיים של §3, §6, §7, §14, §17
- **`docs/deep_research/grok-meta-evaluation-andromeda-2026-04-15.md`** — מקור מחקר #1 (Grok)
- **`docs/deep_research/manus-meta-evaluation-andromeda-2026-04-16.md`** — מקור מחקר #2 (Manus) — הוסיף נתוני ישראל CPM/CPL קריטיים

### מקורות חיצוניים (נשמרו מהאפיון הראשוני)

**Meta Andromeda:**
- [Meta Andromeda Engineering Blog](https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/)
- [Inside Meta's Andromeda and GEM (Search Engine Land)](https://searchengineland.com/meta-ai-driven-advertising-system-andromeda-gem-468020)
- [Mastering Meta Andromeda (Logical Position 2026)](https://www.logicalposition.com/blog/the-2026-paid-social-playbook)

**Advantage+ / Campaign Structure 2026:**
- [Meta Ads Best Practices 2026 (OptiFOX)](https://optifox.in/blog/meta-ads-best-practices-2026/)
- [CBO vs ABO 2026 (Adligator)](https://adligator.com/blog/facebook-ads-budget-optimization-cbo-vs-abo-guide)
- [Advantage+ Campaign Budget (Meta)](https://www.facebook.com/business/help/2177212182495139)

**Learning Phase:**
- [Learning Phase (Meta Business)](https://www.facebook.com/business/help/112167992830700)
- [Significant Edits and Learning Phase (Meta)](https://www.facebook.com/business/help/316478108955072)
- [Jon Loomer - Learning Phase](https://www.jonloomer.com/facebook-ads-learning-phase/)

**Benchmarks 2026:**
- [Facebook Ads Benchmarks 2026 (Visible Factors)](https://visiblefactors.com/facebook-ads-benchmarks/)
- [Meta Ads Benchmarks 2026 (AdAmigo)](https://www.adamigo.ai/blog/meta-ads-benchmarks-2026-by-objective-and-placement)

**Creative & Specs:**
- [Meta Ads Size Guide 2026](https://adsuploader.com/blog/meta-ads-size)
- [Facebook Ad Sizes & Specs (Shopify)](https://www.shopify.com/blog/facebook-ad-sizes)

**Agent Architecture (MVP):**
- [Claude Code Overview](https://docs.claude.com/en/docs/claude-code/overview)
- [Claude Code Headless Mode (`claude -p`)](https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless)
- [Claude Code Settings](https://docs.claude.com/en/docs/claude-code/settings)
- [Anthropic API — Prompt Caching](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)

**Agent Architecture (v2 — reference, לא ב-MVP):**
- [LangGraph Human-in-the-Loop Docs](https://docs.langchain.com/oss/python/deepagents/human-in-the-loop)
- [LangChain Google Vertex AI](https://python.langchain.com/docs/integrations/chat/google_vertex_ai_palm/)

**Supabase:**
- [Supabase Python Client](https://supabase.com/docs/reference/python/introduction)
- [Supabase Row-Level Security](https://supabase.com/docs/guides/auth/row-level-security)

**GCP:**
- [Cloud Run Jobs](https://cloud.google.com/run/docs/create-jobs)
- [Cloud Scheduler](https://cloud.google.com/scheduler/docs)

---

**סוף אפיון MVP.**

> הצעד הבא המומלץ:
> 1. הרצת סעיף 23.1 (pre-dev checklist) — במיוחד Meta App Review + Anthropic API key
> 2. יצירת migrations (`migrations/001-006.sql`) והרצה מול Supabase
> 3. בניית `campaigner/lib/meta_client.py` (עיטוף הקוד הקיים) + `campaigner/lib/supabase_client.py`
> 4. בניית הכלים הבסיסיים ב-`campaigner/tools/` — fetch_insights, load_baselines, log_decision, propose_task
> 5. כתיבת `CAMPAIGNER.md` + `prompts/*.md` בעברית
> 6. הרצת `claude -p` ידנית מול עסק טסט — לבדוק שClaude מבין את הפרוטוקול
> 7. בניית `campaigner/cli/` (approve/reject/list/inspect) — Terminal-first
> 8. `runners/*.sh` ו-Dockerfile
> 9. Onboarding של Aiweon
> 10. Dry-run של שבוע — observe בלי execute
> 11. go-live עם cron אמיתיים
