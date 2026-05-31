# 🧠 Conversational Layer PRD — Campaigner V2

> **Status:** Draft for review → approval by 2nd developer → build
> **Created:** 2026-05-27 · **Owner:** _(assign)_
> **Source brief:** "Campaigner V2 — Focused Delta Spec" + operator notes (2026-05-27)
> **Family:** companion to [campaigner-backend-prd.md](campaigner-backend-prd.md) · [campaigner-frontend-prd.md](campaigner-frontend-prd.md) · [campaigner-migration-prd.md](campaigner-migration-prd.md)
> **Must obey:** [campaigner-spec.md](campaigner-spec.md) · [../CAMPAIGN_EVALUATION.md](../CAMPAIGN_EVALUATION.md) · [../CAMPAIGN_BUILDING_RECOMMENDATIONS.md](../CAMPAIGN_BUILDING_RECOMMENDATIONS.md)
>
> 📂 **Split for review/approval (31.5.2026):** this document is broken into focused, per-domain files under [`conversational-layer/`](conversational-layer/README.md) so work can be scoped, approved, and divided. This file is the full source of truth and stays intact.

---

## 📖 How to read this doc

| Icon | Meaning |
|---|---|
| ✅ | Already exists in the codebase |
| ❌ | Missing today — this PRD adds it |
| ⭐ | Direct answer to an operator pain-point |
| ⚙️ | Deterministic / code-enforced (never an LLM judgment call) |
| 🧠 | LLM / agentic reasoning |
| ⚠️ | Decision or risk the developer must resolve |

---

## 0. TL;DR

> Campaigner today is a **stateless, cron-driven recommendation engine**. It observes Meta, proposes, and exits — it never *talks*, never *remembers*, and its proposals are **generic and passive** (it rarely suggests boosting a post even when good content already exists, and it doesn't really drive action).
>
> This PRD adds a **conversational intelligence layer on top of the existing system**, turning it into a real **AI campaign manager** an operator can converse with:
> **`talk → diagnose → strategize → draft → approve → execute → learn`**
>
> **How we build it (locked decisions):**
> - **Architecture:** native, in this repo, on **Postgres + Anthropic Claude + Claude Agent SDK**. We copy the *blueprint* (patterns) from `generic_agent`, **not its code/stack** (§4, §12).
> - **The existing system is NOT rewritten.** Flows A–H, guardrails, the `approvals` HITL queue, `execute_task`, and Meta integration stay exactly as-is. The new layer sits *above* them and feeds the **same** approval/execution path.
> - **Deterministic stays deterministic** (§5). The LLM reasons and communicates; ⚙️ guardrails/thresholds/evaluation math still decide hard limits. No deprecated pre-Andromeda rule ever comes back.
> - **New brain capability:** image **and video** creative analysis (§8.7) — built in-stack on Gemini (Vertex) + Claude vision, not a new SaaS vendor.

---

## 1. The Problem (today) ⭐

The backend foundation is unusually strong — but the *output* disappoints. Operator observations, mapped to root cause:

| Operator pain | Root cause | Fixed by |
|---|---|---|
| "Suggestions are too **generic**" | Stateless single-shot; no memory of context/intent | Conversation + intent + strategic memory (§8.1–8.3) |
| "**Rarely suggests boosting a post**, even with good content" | `boost_post` exists ✅ but is *underused* — no agent actively scanning existing content for opportunities | Behavioral upgrade (§9) + Creative Intelligence (§8.7) |
| "**Doesn't drive action**" | Reports metrics instead of recommending decisively | Operator persona (§14) + action cards (§11) |
| "**Communication isn't good enough to give feedback**" | No conversational channel; feedback only via reject button | Conversation Workspace + feedback captured into proposals layer (§8.6) |
| "Want it to **add / improve / remove** and really understand my need" | No multi-turn understanding; proposals aren't a coherent managed plan | Full proposal lifecycle in the approvals layer (§8.6) |
| "Can't analyze our **creatives / videos**" | ❌ No creative-content analysis exists today | Creative & Video Intelligence (§8.7) |

---

## 2. Vision — what "AI campaigner" means here

```
   TODAY                              TARGET
   ─────                              ──────
   Metrics → Recommendation           Conversation → Diagnosis → Strategy
   (passive, generic, one-shot)            → Draft → Approval → Execution → Learning
                                           (proactive, specific, remembers, drives action)
```

The operator should be able to say *"אני צריך יותר לידים איכותיים באשדוד"* and get a **strategist's answer** grounded in live data — not a dashboard reading.

---

## 3. What exists today (grounded)

> The conversation layer **builds on** these; it must not duplicate or replace them.

| Capability | | Key files |
|---|:--:|---|
| 8 cron Flows (A–H) | ✅ | [runners/](../../runners/) · [campaigner/CAMPAIGNER.md](../../campaigner/CAMPAIGNER.md) |
| HITL approvals (`pending→approved→executed`) | ✅ | `approvals` table · [propose_task.py](../../campaigner/tools/propose_task.py) · [execute_task.py](../../campaigner/tools/execute_task.py) |
| Guardrails (36 ⚙️ deterministic rules) | ✅ | [guardrails.md](../../campaigner/prompts/guardrails.md) · [check_guardrails.py](../../campaigner/tools/check_guardrails.py) |
| Meta integration | ✅ | [meta_client.py](../../campaigner/lib/meta_client.py) |
| Creative generation (Imagen) + Gallery | ✅ | [creative.py](../../campaigner/lib/creative.py) · `creative_gallery` table |
| **Boost post** (`boost_post`) | ✅ | `/api/gallery/promote` → proposal · CAMPAIGNER decision-tree §T9.1 |
| Lead quality grading | ✅ | `leads` / `lead_quality_grades` · [grade_lead.py](../../campaigner/tools/grade_lead.py) |
| A/B + pacing router | ✅ | `ab_tests` · [route_pacing_action.py](../../campaigner/tools/route_pacing_action.py) |
| Decision logging (observability) | ✅ | `agent_decisions` · [log_decision.py](../../campaigner/tools/log_decision.py) |
| Web frontend (Next.js 15, ~20 routes) | ✅ | [web/src/app/](../../web/src/app/) |
| ~60 CLI tools, uniform JSON contract | ✅ | [campaigner/tools/](../../campaigner/tools/) |
| **Conversation / messages** | ❌ | — entirely stateless |
| **Intent engine** | ❌ | — |
| **Strategic / operator memory** | ❌ | — (only *operational* memory: rejections, `plans_carryover`, `monthly_brief`) |
| **Multi-turn loop + agent "voice"** | ❌ | — |
| **Recommendation novelty / dedup** | ❌ | — → repetition |
| **Creative content (image/video) analysis** | ❌ | — only *performance* signals exist |

> 🔁 Cross-run memory that **does** exist and must be reused (not rebuilt): [load_feedback_history.py](../../campaigner/tools/load_feedback_history.py), [load_recent_actions_outcomes.py](../../campaigner/tools/load_recent_actions_outcomes.py), [load_active_plans.py](../../campaigner/tools/load_active_plans.py), `business_knowledge.monthly_brief`.

---

## 4. Architecture decision — and the `generic_agent` question

**Decision (locked): Option A — build the brain natively in this repo, on our stack, using the Claude Agent SDK.**

### 4.1 The `generic_agent` relationship, made explicit ⭐

> **We copy the BLUEPRINT, not the ENGINE.**

```
generic_agent (the other project)            Campaigner (us)
─────────────────────────────────            ───────────────
FastAPI + LangGraph                          Claude Agent SDK
MongoDB + Qdrant                             Postgres (only)
Grok + Gemini                                Anthropic Claude
Domain: website-visitor Q&A                  Domain: campaign management
Abilities = 18 hardcoded website CTAs        Our existing ~60 campaign tools

        │  take the PATTERNS  ▼            │  rebuild natively  ▼
        └──────────────────────────────────┘
   ✔ intent-classifier pattern      ✔ conversation/memory schema shape
   ✔ parallel context-gathering     ✔ external-prompt discipline
   ✖ its code  ✖ its datastores  ✖ its LLMs  ✖ its Abilities/CTA system
```

**Why not import its code (rejected):** it would drag MongoDB + Qdrant + a 2nd LLM provider into a Postgres + Claude system, and its "brain" is tuned for the wrong domain. Net cost ≫ net value.

### 4.2 Why native + Claude Agent SDK
- The repo is already **"Claude Code Native"** → the SDK gives multi-turn, tool-use, streaming, and context compaction out of the box (no hand-rolled state machine).
- The ~60 CLI tools already emit clean JSON → they wrap trivially as agent tools (§10).
- Shared Postgres, shared Claude creds, one deployment. Proposals flow through the **existing** `propose_task` path.

### 4.3 ⚠️ The one thing Option A still needs: a thin transport
Next.js (Node) must reach the Python orchestrator (Claude). For streaming chat UX:
- **(a) Thin in-repo ASGI endpoint over SSE (recommended)** — a small Python app packaged with the campaigner backend, sharing Postgres/Claude/tools. *Not* a separate product; one extra container.
- **(b) Per-turn subprocess** — Next.js invokes the orchestrator per turn (like cron's `claude -p`), rehydrating state from Postgres. Simpler, no streaming, cold-start latency.

> **Decision required before Phase 1.** PRD assumes **(a)**; all specs below are transport-agnostic.

---

## 5. Build Principles (non-negotiable) ⚙️🧠

> The operator's explicit instruction: *build it the same disciplined way — keep what's deterministic deterministic, never resurrect killed rules, protect token efficiency and answer quality.*

1. **⚙️ Deterministic stays deterministic.** The LLM **reasons and communicates**; it never *decides* a hard limit. Guardrails, thresholds ([thresholds.yaml]), the two-gate evaluation model, and `check_guardrails` remain code-enforced. A proposal the agent "feels good about" still dies if `check_guardrails` fails. The agent cannot bypass any gate.
2. **🚫 No resurrected rules.** Nothing from [CAMPAIGN_EVALUATION.md §8](../CAMPAIGN_EVALUATION.md) (deprecated pre-Andromeda rules) may reappear — not in prompts, not in drafts, not in advice. The persona prompt imports this list as a hard "never say / never do."
3. **🪙 Token efficiency by design:**
   - Model tiering: **Haiku** for intent/classification/lightweight steps; **Opus** only for strategic reasoning + draft composition.
   - **Context compaction** (rolling conversation summary) + **memory-relevance filtering** (inject only the strategic facts that matter to the current intent).
   - **Prompt caching** for the stable system prompt + knowledge files (same discipline as CAMPAIGNER.md today).
   - **Lazy tool calls** — fetch live data only when the intent needs it.
4. **🎯 Answer quality:**
   - Grounded in live tool output — **no hallucinated metrics**; if data is missing, say so (`check_data_sufficiency`).
   - Guardrail §27 holds: no unsourced competitive claims.
   - Structured artifacts (action cards / drafts) are validated against schemas before rendering.
5. **🔒 HITL is absolute.** The conversation may *propose*; it never *executes*. Execution stays in Flow B.

---

## 6. Target architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Next.js Web (existing) — NEW: /workspace conversation UI           │
└───────────────┬────────────────────────────────────────────────────┘
                │ SSE  POST /conversation/turn
┌───────────────▼────────────────────────────────────────────────────┐
│ Conversation Endpoint (NEW · thin ASGI · in-repo)                   │
│   1. load history + relevant strategic memory (Postgres)            │
│   2. ┌─ Intent Engine (Haiku) ───┐                                  │
│      ├─ business context fetch   ├─ run in parallel (borrowed       │
│      └─ recommendation ledger ───┘   pattern from generic_agent)    │
│   3. 🧠 Orchestrator (Claude Agent SDK · Opus)                      │
│        tools = wrappers over existing campaigner/tools/*            │
│        ├─ Creative & Video Intelligence (§8.7)                      │
│        ├─ Campaign Draft Composer (§8.5)                            │
│        ├─ dedup/novelty check (§8.4)                                │
│        └─ propose_task → writes to `approvals`  (proposal only)     │
│   4. persist turn + artifacts + memory/ledger updates (Postgres)    │
└───────────────┬────────────────────────────────────────────────────┘
                │  proposals only — NEVER direct Meta writes
┌───────────────▼────────────────────────────────────────────────────┐
│ EXISTING · UNCHANGED:                                               │
│   approvals → Flow B execute_task → ⚙️ guardrails recheck →         │
│   MetaClient → agent_decisions log                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 6.1 ⭐ How the agent actually works in practice — *operator-facing walkthrough*
> Operator question: *"How is the agent going to work in practice — it sits on top of our brain with conversation layers that fit it; how does this work?"*
>
> This section is the **mental model** for the operator and the implementer. It explains where chat sits vs cron sits vs guardrails sit, and walks through a real operator's day.

#### 6.1.1 The four layers (visual)

```
┌─ Operator surface ─────────────────────────────────────────────────┐
│  Workspace (chat) · Action Cards · Draft Preview · Sidebar ·       │
│  Learning Timeline · Approvals queue · WhatsApp/email push          │
└────────────────────┬───────────────────────────────────────────────┘
                     │   (what the operator sees and does)
┌────────────────────▼───────────────────────────────────────────────┐
│  Conversational Layer (NEW · this PRD)                              │
│  • Conversation Orchestrator (Claude Agent SDK, Opus)               │
│  • Intent Engine (Haiku) · Strategic Memory · Dedup Ledger          │
│  • Budget-Reality Calibrator · Audience-Fit Pre-Check               │
│  • Campaign-age Monitor · Pattern Recognizer · Draft Composer       │
│  • Creative & Video Intelligence · WhatsApp Conversation Analyzer   │
└────────────────────┬───────────────────────────────────────────────┘
                     │   (uses, never replaces)
┌────────────────────▼───────────────────────────────────────────────┐
│  The Brain (existing · CAMPAIGNER)                                  │
│  • CAMPAIGNER.md protocol · prompts/* knowledge · 36 guardrails     │
│  • Two-gate evaluation · ~60 CLI tools · agent_decisions logging    │
│  • 8 cron Flows A–H (observe / execute / creative / audit / …)      │
└────────────────────┬───────────────────────────────────────────────┘
                     │   (proposals only — never direct Meta writes)
┌────────────────────▼───────────────────────────────────────────────┐
│  Execution (existing · unchanged)                                   │
│  approvals table → Flow B execute_task → ⚙️ guardrails recheck →    │
│  MetaClient → Meta Ads API                                          │
└────────────────────────────────────────────────────────────────────┘
```

**The mental model:** the brain is the **engine**, the cron flows are the **autopilot**, the conversational layer is the **operator's seat in the cockpit**, and execution is the **wheels**. Chat and cron coexist — chat doesn't replace cron, it gives the operator a *voice* into the brain's reasoning and an interactive surface to drive strategy. The brain keeps running its automatic background work.

#### 6.1.2 First contact — what a new operator experiences (T+0 to T+1 hour)

| Step | What the operator sees / does | What happens behind the scenes |
|---|---|---|
| 1 | Connects Meta ad account (OAuth) | `/api/meta/oauth/callback` stores token; `business_id` provisioned |
| 2 | Workspace opens to a friendly *"אני חוקר את החשבון שלך כדי להבין מי אתה. ייקח כמה דקות — בינתיים, ספר לי על העסק"* | Deep First Scan (§8.0) launches as background job — structural sync, asset backfill, baselines, business-knowledge enrichment, competitor research, creative-content analysis |
| 3 | Operator chats freely about the business (services, goals, budget capability) | Intent Engine classifies; Calibrator (§17.4) starts forming the **2-options** view based on the partial data already in |
| 4 | Background scan finishes (3–15 min) → chat receives an **opening diagnosis** | *"Here's what I see in your account: [structural summary]. Compared to 14 other carpenters in similar geo, your CPL is in the 30th percentile. Top 3 opportunities: …"* — anchored to **real account history**, not generic |
| 5 | Operator picks an opportunity to discuss → Calibrator runs the **2-options output** | Option A (market-recommended for stated goal) + Option B (current budget yields) + gap + 3 honest paths |
| 6 | Operator approves one option → it becomes a proposal in the approvals queue | `propose_task` writes to `approvals` exactly as today; Flow B will execute on approval |

**Onboarding never asks cold questions.** The brain pulls everything available from Meta first, drafts the profile, and asks the operator only to confirm/correct/enrich (§8.0 pull-first principle).

#### 6.1.3 Day-to-day — how chat and cron coexist

| Channel | What it does | Frequency |
|---|---|---|
| **Cron flows A–H** (existing) | Daily observe-propose · A/B decisions · weekly creative firehose · weekly competitive research · weekly self-audit · etc. **Silent background work.** | Per existing schedule |
| **Calibrator + Pattern Recognizer** | Runs alongside cron flows; updates calibration + pattern state on `agent_decisions` | Per cron run |
| **WhatsApp Conversation Analyzer** (§8.8.1) | Scores new WhatsApp leads as they come in; auto-suggests grade | Real-time per lead |
| **Notification push** (§17.6) | Pushes critical alerts (CPL spike · token expiring · streak detected · audience-fit fail · dry period detected) to operator WhatsApp/email | Event-driven |
| **Workspace chat** (NEW) | Operator opens when they want to *think* — strategize, ask questions, plan a launch, react to an alert, review proposals | On-demand |
| **Approvals queue** (existing UI, enriched) | Operator reviews proposals (now packaged with strategic context per §8.6) and approves/rejects | On-demand |

**Critical:** the operator does **not** need to use chat for the system to work. Cron + approvals queue alone keeps it running. Chat is the *augmentation* — for thinking, learning, and strategic conversation. **An operator can use Campaigner with no chat at all and get full value from the proposals queue.** Chat is opt-in depth.

#### 6.1.4 A single turn — what happens in 5–10 seconds when the operator types

```
Operator types: "אני מרגיש שהקמפיין של הכלות חלש השבוע, מה לעשות?"
                                    │
       1. ───────────────────────────▼─────────────────────────────────
          Intent Engine (Haiku) classifies → primary_intent='weak_creative'
                                              secondary='low_leads'
                                              campaign_referent='כלות'
       2. ─── Parallel context fetch (all at once, ~500ms) ────────────
          • Recent agent_decisions for the bridal campaign
          • Strategic memory facts about this business + 'weakness' pattern
          • Recommendation ledger — did we raise this recently?
          • Live fetch_insights (last 7d vs prior 7d) for the campaign
          • Pattern Recognizer classifies — dry period? winning ending?
                                              audience-fit suspect?
                                              seasonal pulse?
       3. ─── Orchestrator (Opus) reasons ─────────────────────────────
          • Reads injected context
          • Decides: is this a creative issue (per §9 #5 default), a
            targeting issue (audience-fit pre-check §8.0.4), a dry
            period that needs patience (§8.0.5), or genuinely needs
            scale changes?
          • If a strategic answer requires more data, calls additional
            tools (check_creative_fatigue, check_audience_fit, etc.)
          • Composes the Hebrew response + an action card if actionable
       4. ─── Optional: drafts a proposal ─────────────────────────────
          • If actionable → calls compose_campaign_draft / propose_task
          • Proposal written to approvals (cleared by check_guardrails)
          • Linked back to this conversation turn (related_approval_ids)
       5. ─── Stream response (SSE) ───────────────────────────────────
          • Hebrew strategist answer + action card + (if any) proposal link
          • New decision row logged to agent_decisions
          • Memory + ledger updated
                                    │
          ▼ Operator sees ~3–7 seconds after typing.
```

#### 6.1.5 Where each new section "sits" on the existing brain

| New capability | Sits on top of which existing tool | Effect |
|---|---|---|
| Calibrator (§17.4) | `estimate_cpl.py` · `load_baselines.py` · `fetch_insights.py` | Adds calibration layer; existing tools become inputs, not answers |
| Audience-Fit Pre-Check (§8.0.4) | `audience_targeting.py` · `propose_audience.py` · `list_audiences.py` | New pre-step before evaluation — replaces "we assumed targeting was right" |
| Pattern Recognizer (§8.0.5) | `fetch_insights.py` · `seasonal_hints` · `check_creative_fatigue.py` | Classifies the *kind* of fluctuation before recommending action |
| Strategic Memory (§8.3) | `agent_decisions` (still the substrate) | Layer of *interpreted* facts on top of raw decisions |
| Dedup Ledger (§8.4) | `load_feedback_history.py` (rejections) + `propose_task` | Prevents repetition without changing the proposal pipeline |
| Draft Composer (§8.5) | `draft_new_campaign_payload.py` · `compose_copy_brief.py` | Wraps these into a single conversation-driven flow |
| Creative & Video Intelligence (§8.7) | `list_active_creatives.py` · `creative_gallery` | Adds *content* analysis on top of existing performance signals |
| WhatsApp Intelligence (§8.8.1) | `lead_quality_grades` · `lead_outcomes` | Pre-CRM quality signal feeds the existing grading + outcome tables |
| Workspace UI | reads existing tables; writes proposals through existing `approvals` | Pure presentation layer — the brain doesn't know it exists |

**The single most important property:** every new layer **reads from and writes to existing structures**. Nothing in the existing brain has to be rewritten. Cron keeps working. Approvals keep working. Meta integration keeps working. The conversational layer is *additive*.

---

## 7. Data model (new Postgres migrations · next = `033`)

> All tables `business_id`-scoped, RLS enabled, `created_at timestamptz default now()`, FK to `businesses`.

| Migration | Table | Purpose |
|---|---|---|
| `033` | `conversations` | session header + rolling summary + last intent |
| `034` | `conversation_messages` | turns; `artifacts` jsonb; `related_approval_ids` |
| `035` | `strategic_memory` | the **operator brain** — preferences, what failed/converts, seasonal, rejected strategies |
| `036` | `recommendation_ledger` | ⭐ anti-repetition: fingerprint, cooldown, novelty |
| `037` | `campaign_drafts` | draft store before promotion to `approvals` |
| `038` *(Phase 4)* | `creative_intelligence` | image/video content tags (§8.7) |
| `039` *(Phase 5)* | `lead_outcomes` | CRM-fed downstream outcomes (won/lost/deal value/no-show) — §8.8 |
| `040` *(Elevator 17.3)* | `cross_client_benchmarks` (matview) | Aggregated cross-client patterns (Aiweon-internal, min 3 accounts per cohort) — §17.3 |

<details><summary>Full DDL (click to expand)</summary>

```sql
-- 033_conversations.sql
create table conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  title text, status text not null default 'active',
  summary text, last_intent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_business_idx on conversations(business_id, updated_at desc);

-- 034_conversation_messages.sql
create table conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  business_id uuid not null references businesses(id),
  role text not null,                       -- operator | agent | system
  content text not null,
  intent text, intent_confidence numeric,
  artifacts jsonb default '[]',             -- action_cards, draft refs, embeds
  related_approval_ids uuid[] default '{}',
  token_usage jsonb,
  created_at timestamptz not null default now()
);
create index conv_msg_idx on conversation_messages(conversation_id, created_at);

-- 035_strategic_memory.sql
create table strategic_memory (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  kind text not null,   -- preference|dislike|what_failed|what_converts|seasonal_pattern|
                        -- rejected_strategy|positioning_insight|audience_insight|offer_insight
  key text not null,                        -- canonical handle e.g. "tone:warm_family"
  value jsonb not null,
  confidence numeric not null default 0.5,
  source text not null,                     -- conversation|flow|operator_explicit|outcome
  source_conversation_id uuid references conversations(id),
  evidence_refs jsonb default '[]',
  reinforced_count int not null default 1,
  last_reinforced_at timestamptz not null default now(),
  expires_at timestamptz,                   -- null=durable; set for seasonal/transient
  created_at timestamptz not null default now()
);
create unique index strategic_memory_key_idx on strategic_memory(business_id, kind, key);

-- 036_recommendation_ledger.sql
create table recommendation_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  fingerprint text not null,                -- hash(intent, target_kind, target_id, action_class)
  intent text, action_class text not null,
  target_kind text, target_id text,
  human_summary text not null,
  times_proposed int not null default 1,
  first_proposed_at timestamptz not null default now(),
  last_proposed_at timestamptz not null default now(),
  status text not null default 'open',      -- open|accepted|rejected|superseded|acted
  cooldown_until timestamptz, novelty_score numeric, outcome jsonb,
  created_at timestamptz not null default now()
);
create unique index rec_ledger_fp_idx on recommendation_ledger(business_id, fingerprint);
create index rec_ledger_cooldown_idx on recommendation_ledger(business_id, status, cooldown_until);

-- 037_campaign_drafts.sql
create table campaign_drafts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  conversation_id uuid references conversations(id),
  status text not null default 'draft',     -- draft|proposed|discarded|promoted
  structure jsonb not null,
  promoted_approval_id uuid references approvals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaign_drafts_idx on campaign_drafts(business_id, status, updated_at desc);
```
</details>

---

## 8. Components

### 8.0 ⭐ Account Onboarding — Deep First Scan — *Phase 1 (foundational)*
> Operator's observation: connecting an existing account today does a **piecemeal** sync (gallery / audiences / leads separately) — there's no cohesive, high-quality first pass, so the agent never *feels* like it understands the account. This adds it.

When a new business connects an **existing** Meta ad account, run a one-time orchestrated **deep scan** that builds the baseline the strategist needs *before* the first conversation. **Pull first, then enrich, then benchmark:**

| # | Step | Reuses |
|:--:|---|---|
| 1 | **Structural sync** — all campaigns/ad sets/ads + status/budgets + **whatever historical insights exist** (target: 90d, but works with 30d / 60d — confidence scales with what's available; see §8.0.2) | `/api/meta/sync` · [fetch_insights.py](../../campaigner/tools/fetch_insights.py) |
| 2 | **Asset backfill** — creatives → gallery, audiences, leads | [backfill_gallery_from_meta.py](../../campaigner/tools/backfill_gallery_from_meta.py) · `sync_audiences.py` · `sync_leads.py` |
| 3 | **Baselines + health** — rolling baselines, account health, pacing snapshot | `baselines` table · [check_account_health.py](../../campaigner/tools/check_account_health.py) · `compute_monthly_pace.py` |
| 4 | ⭐ **Business-knowledge enrichment** — the agent *pulls* existing Meta data first, then **fills `business_knowledge`** (vertical, products/services, geo, brand voice, KPI targets) from Meta + **any operator-provided sources** (website, brand deck, social, prior campaigns). **Quality scales with sources** (see below). | `business_knowledge` table · `load_business_knowledge.py` · `/api/business-knowledge/research-service` · `import-aiweon` |
| 5 | ⭐ **Competitor & market research (automatic)** — runs the same competitive research as Flow D, **automatically on first scan** (not just weekly): market **CPL/CPA benchmarks**, **audience types** in the vertical, competitor creative angles & offers, for the business's sub-vertical × geo. **Cited only** (guardrail §27 blocks unsourced claims). | Flow D ([weekly_competitive_research.sh](../../runners/weekly_competitive_research.sh)) · `competitive-research.md` · [estimate_cpl.py](../../campaigner/tools/estimate_cpl.py) · `kpi-benchmarks.md` · WebSearch |
| 6 | **Creative intelligence pass** *(progressive)* — structural in P1; full image/video content analysis of the **whole gallery** when §8.7 lands (P4) | `creative_intelligence` table |
| 7 | **Seed strategic memory** — distil initial observations (what converts, what failed, seasonal patterns visible in history, gaps) | `strategic_memory` (§8.3) |
| 8 | **Opening diagnosis** — first Workspace message: grounded *"here's what I see in your account"* **+ market positioning vs. benchmark CPL + audience map** + top 2–3 opportunities (incl. boost candidates) — **not a blank chat box** | Workspace (§11) |

- ⭐ **Quality scales with sources (first-class onboarding action):** the agent's understanding is only as deep as what it's fed. The more the operator provides — **website URL, brand deck, social handles, service list, past campaign exports** — the richer and more accurate the scan, the business-knowledge profile, and the competitor benchmarks. Onboarding UI should actively prompt for these sources and show how each one improves the scan.
- **Pull-first principle:** the agent never interrogates the operator cold — it pulls everything available from Meta first, drafts the `business_knowledge` profile, and asks the operator only to *confirm/correct/enrich* it.
- **Quality-first, not fast-first:** prefer a slower, thorough first scan (deeper history, full gallery analysis, live competitor research) over a shallow one — a one-time cost that pays off in every later conversation.
- **Reuses + orchestrates (doesn't duplicate):** `onboarding_status` table + [/onboarding](../../web/src/app/onboarding/page.tsx) + the sync/research tools above. The *new* value = the **orchestration + strategic seeding + opening diagnosis**.
- **Runs as a background job** (don't block the UI); show progress via `heartbeats` / `onboarding_status`.

#### 8.0.1 How the first scan reaches *quality* (not generic) — the deep-scan technique
> `generic_agent` makes onboarding deep by **crawling the whole website (Firecrawl), running it through several focused LLM extraction passes (entities, Q&A), building a structured business profile + a per-business persona — all as a slow background job (ARQ).** We borrow the **technique**, output to **structured Postgres** (no Qdrant — mapping a business needs structured extraction, not semantic chunk retrieval).

1. **Multi-source crawl & ingest.** Pull *every* page of the business website + operator-provided sources (brand deck, social). **Reuse the team's existing Firecrawl integration** (already operated in `generic_agent`); fallback = sitemap + WebFetch per page. The richest single source of "who is this business."
2. **Multi-pass extraction — not one shallow prompt.** Several deliberate Claude passes: *services & offers* · *brand voice & tone* · *positioning (premium/budget)* · *target audiences / ICP* · *proof & trust signals* · *seasonality*. "Slow" = thorough multi-pass — this is what makes the output **specific, not generic**.
3. **Cross-source fusion.** Reconcile website claims ↔ Meta historical creatives/copy ↔ social ↔ operator input into one coherent `business_knowledge` profile; surface conflicts for confirmation.
4. ⭐ **Persona derivation (adapt the agent's character to the business).** From the brand's *actual* voice + positioning, derive per-business **persona parameters** (voice register, formality, premium-vs-value framing, assertiveness) and inject them into the §14 persona prompt — so the strategist **sounds like it belongs to this business**, not a generic bot. Stored on `business_knowledge` (or a `persona_profile` jsonb).
5. **Confidence + gaps.** Every extracted fact carries a confidence; low-confidence / missing items become the operator's confirm-correct-enrich prompts (pull-first loop) and an *"add these sources to improve me"* list.
6. **Background, resumable, observable.** A background job (never blocks the UI); per-pass progress via `onboarding_status` / `heartbeats`; **re-runnable** whenever the operator adds a new source — each source measurably deepens the profile.

#### 8.0.4 ⭐ Audience-Fit Pre-Check — *validate targeting BEFORE evaluating leads (operator's hard rule)*
> Operator's hard rule: *"Before everything in a brand-new campaign, check that the audiences are even relevant. Maybe lots of leads come but targeting is wrong, location is wrong, missing exclusions for nearby-but-irrelevant cohorts."*
>
> **Why this is a pre-check, not a downstream evaluation:** every other signal lies when targeting is wrong. Cheap leads that don't close look like a "creative problem" when they're actually a *who-are-we-talking-to* problem. The brain must rule out audience-fit before it ever recommends creative refresh, budget changes, or strategy pivots.

**The pre-check runs at four moments:**
| When | What it checks | Action if fail |
|---|---|---|
| **Onboarding (T-1)** | proposed audience matches `business_knowledge.service_regions` + ICP + vertical + operational capacity | block launch; propose corrected audience for approval |
| **T+0 (launch)** | exclusions are in place for nearby-but-irrelevant cohorts (see below) | warn operator; offer exclusion proposal |
| **T+3d (first leads)** | do incoming lead attributes look like ICP? (Lead-shape validation) | flag audience-fit problem; **do not** blame creative |
| **Always** | **"too good to be true" check** — CPL much better than expected AND close_rate unexpectedly low → mis-targeting suspect (cheap clicks from wrong people) | flag for operator review before scaling |

**Exclusion intelligence** (the operator's specific point about "nearby populations you don't want"):
- **Geo-overlap with irrelevant cohorts** — Tel Aviv carpenter → exclude tourists, foreign students, people outside service radius.
- **Existing customers** — don't re-acquire who you already have (use customer list audience as exclusion).
- **Job-seekers** — people clicking ads to find work at the business, not to buy.
- **Industry peers / competitors / press** — overlap with low intent.
- **Past low-quality lead clusters** — once `lead_outcomes` (§8.8) shows certain audience segments never close, auto-suggest exclusion.

**Geo radius sanity** — derived from operational capacity:
- A 1-person carpenter installing in homes shouldn't target a 100km radius (no capacity to serve).
- A national e-commerce can target all-IL.
- Default: business profile classifier (§17.10) → suggests radius band; operator confirms or expands with explicit reasoning.

**Lead-shape validation (T+3d+):**
- Compare incoming lead attributes (when Lead Form fields exist: age, location, intent question) against the ICP defined at onboarding.
- If ≥60% of leads don't match ICP attributes → audience-fit fail flag.
- Output to operator: *"Out of 8 leads this week, 6 are outside your service area / wrong age band / wrong stated intent — this is a targeting fit problem, not a creative problem. Want to tighten targeting before we touch anything else?"*

**Cross-check with the Calibrator (§8.0.2):**
- If `actual_CPL << prior_CPL` AND `close_rate << prior_close_rate` → the cheap leads are the wrong people. **Calibrator must surface this** as audience-fit suspect before recommending budget changes.
- If `actual_CPL << prior_CPL` AND `close_rate ≈ prior` → genuinely good campaign, proceed normally.

**New tools:**
- `check_audience_fit.py` — runs the validation at any of the four moments above.
- `propose_exclusions.py` — generates exclusion candidates from business profile + outcome history.
- `validate_geo_radius.py` — sanity-check radius vs operational capacity.
- `analyze_lead_shape.py` — compare incoming leads to ICP signature.

**Why it elevates:** stops the brain from "fixing" the wrong problem. Today the system would optimize budget/creative on a mis-targeted campaign and never realize the issue is *who Meta is showing the ad to*.

#### 8.0.2 ⭐ Calibration methodology — *how the brain actually computes "is this budget enough?" (operator co-designed)*
> The existing brain has a static CPL grid ([estimate_cpl.py](../../campaigner/tools/estimate_cpl.py), Israel-2026 sub-vertical × geo × stage × offer × channel × season) but **no calibration to the account's reality**. The operator showed concrete cases (YAMBA: ₪40/day → 2 leads/day = ₪20/lead; bridal: ₪30/day → 2/day = ₪15/lead) where his actual CPL is **~70% lower than the grid's "market average."** The grid is a *prior*, not the truth. This section defines how the brain reaches the truth.

**The core formula (Bayesian shrinkage):**
```
CPL_predicted = Prior × (1 − confidence) + Actual × confidence
```
- **Prior** = `estimate_cpl` grid output (deliberately pessimistic — represents typical operator, not best-in-class).
- **Actual** = the account's observed CPL over the available window (from Meta history, pulled in §8.0 step 1).
- **Confidence** is multi-dimensional (see below) — *not just sample size*.

**Confidence is multi-dimensional** (the operator's "זמן תודעה" / awareness-time insight):
```
confidence = f(
   N_conversions          (sample size)
 + temporal_stability     (1 − CoV of weekly CPL — see CoV thresholds below)
 + tenure_days            (continuous-delivery age of the campaign/account)
 + investment_consistency (leads-per-₪ holding steady over time)
 + cross_business_signal  (same operator's other accounts in our system)
)
```
A 30-day-old campaign with 60 stable conversions earns *higher* confidence than a 3-day-old campaign with 100 unstable conversions. **Stability + tenure matter as much as raw N.**

**Volatility gates (operator-calibrated):**
| Weekly CoV of CPL | Meaning | Brain action |
|---|---|---|
| ≤ 20% | Stable | trust observed CPL fully |
| 20–40% | Monitoring zone | use blend; surface variance in rationale |
| ≥ 40% | **Weakness flag** | give 7+ more days, then act if no recovery |

**Cross-business prior (operator's other accounts as soft signal):**
When the same operator (or, in Phase B / §17.3, same vertical+geo+budget-tier cohort) has other accounts in our system with established performance, blend that into the prior for a *new* account. This is how a skilled operator's track record transfers — their next account starts smarter, not from scratch.

**Three modes for a new account:**
| State | Mode | Output |
|---|---|---|
| 0 days history | **No-history** | Grid prior only, **explicit confidence band** ("typical ₪40–80; well-run accounts ₪20–30"), no single number |
| 1–30 days history | **Early-data** | Bayesian blend, low-medium confidence, flagged as preliminary |
| 30–90+ days history | **Calibrated** | Trust observed, monitor for drift, contribute to cross-business pool |
| 90+ days continuous, stable | **"זמן תודעה" — trusted** | Confidence ceiling; campaign earns *protection* (don't pause without strong cause); contributes to cross-business benchmarks (§17.3) |

**Grid recalibration (long-term — option to plan now, harvest later):**
Keep the existing grid as a **pessimistic fallback**, *and* start collecting Aiweon-pooled actuals from day-one to **rebuild the grid from real data** over time. Phase A: grid stays; cross-business prior fills gaps. Phase B (§17.3): pooled actuals replace the grid for any sub-vertical with ≥5 calibrated accounts.

**Operator's "70% lower than market" finding** → resolves naturally: as soon as the calibrator runs against his accounts, his actuals dominate the prior (confidence high) and the agent stops quoting market averages that don't match reality. The grid is the *cold-start safety net*, not the answer.

**Honesty contract (codified in §14 persona):** every CPL the agent quotes carries a **band** and a **confidence label** — never a bare single number. Examples:
- *"Cold start, no history: typical CPL ₪40–80 for this vertical. Skilled operators reach ₪20–30. We'll know your real number by day 7."*
- *"Based on 47 conversions over the last 30 days, CPL is ₪22 ± ₪4 (stable). High confidence."*
- *"Last 7 days CPL is ₪35 — but variance is 45%; I'm not trusting this yet. Giving it another week."*

#### 8.0.3 ⭐ Campaign-age-aware monitoring — *operator's real playbook, encoded*
> The operator's actual evaluation sequence for new campaigns (from his answer): *understand business → market research → launch → watch for first lead → 1-week CPL read → 1-month stability vs investment*. Today the brain reads Gate 1/Gate 2 the same way every day with no notion of campaign age. This encodes age-aware behavior.

| Age | What the brain evaluates | What it does |
|---|---|---|
| **T+0** (launch) | — | Records launch, prior CPL, expected leads/week, target need |
| **T+1–3d** | First lead arrived? | If **no** by T+3d → diagnose delivery (utilization, audience, creative load) **before touching budget**. New metric: `time_to_first_lead` |
| **T+7d** | First CPL read | Compare to prior. If material divergence (≥30% in either direction) → **update the prior** in `strategic_memory`, surface to operator. Don't override guardrails — adjust the model |
| **T+30d** | Stability vs investment | Compute CoV (see §8.0.2). If stable → confidence ↑, recommendations now trust observed CPL. If shaky → continue diagnosis, don't recommend scaling yet |
| **T+90d** continuous | "זמן תודעה" — trusted | Campaign is *protected* (guardrail: no pause without quality_band='low' or explicit operator request); contributes to cross-business benchmarks (§17.3) |

**Reuse:** all metrics already exist via `fetch_insights` + `baselines`. New: `campaign_age_state` column on a campaign-state cache table (or compute on demand), and stage-conditional rules in the orchestrator's reasoning.

**Why it matters:** today a 3-day-old campaign and a 90-day-old one are treated the same. Operator's playbook says they shouldn't be — early campaigns get patience and diagnosis; mature campaigns get protection and trust.

#### 8.0.5 ⭐ Pattern recognition — *dry periods, winning streaks, seasonal pulses*
> Beyond raw age, campaigns go through **patches**. A stable campaign may hit a 3-day dry spell that's not "broken" — it's a normal fluctuation. A winning streak may emerge that the brain shouldn't disturb. A seasonal pulse may inflate or deflate every metric. The brain must recognize *which pattern* it's seeing and react accordingly.

**Five patterns the brain classifies (extends §8.0.3):**

| Pattern | Detection | Action |
|---|---|---|
| **Dry period** | Sudden drop after a stable phase; ≥3 days no leads or CPL spike; **not** matching `seasonal_hints` | **First move:** add-creative to existing campaign (§9 #5). Then diagnose audience saturation (freq ≥ saturation_ceiling). **Don't pause yet.** |
| **Winning streak** | ≥30% better than baseline, sustained 5+ days, CoV low | **Protect.** Mark campaign as `streak_active`; guardrails block destructive proposals during streak. Optional: modest scale_up (15%, not 30%) only after R0 cooldown |
| **Seasonal pulse** | Matches `seasonal_hints` calendar (holiday / wedding peak / event season) | Pre-adjust budget per calendar; expect lift/drop; **don't confuse with creative fatigue or audience saturation** |
| **Algorithm fluctuation** | Volatility within normal CoV (≤20%, §17.10) | Patience. No action. Don't propose anything. |
| **Broken signal** | Hard zero (0 impressions/0 leads) with no obvious cause; or tracking_health degraded | **Diagnose first** — tracking, Meta health, account-level issue — before touching campaign |

**The dry-period vs broken-signal distinction** is the crucial one (today the brain can't tell them apart, so it tends to over-react to dry periods or under-react to broken ones):
- Dry period → metrics still moving, just lower → patience + creative refresh
- Broken signal → metrics flat-zero, tracking suspect → escalate immediately

**Cross-account dry-period learning (ties to §17.3):**
- If 5+ similar businesses (vertical × geo) hit a dry period in the same window → likely a **market-wide event** (algorithm change, news cycle, competitor flood). The brain reports this as context: *"this dry period is hitting other carpenters in the same week — likely not specific to your account; hold steady."*

**Streak protection** (the operator's instinct: *"don't touch what's working"*):
- During an active streak, guardrails *raise* the bar for destructive proposals (pause / scale_down / new_audience).
- The brain explicitly says: *"This campaign is on a 6-day streak. I won't propose changes; if you want to scale, I recommend a 15% increase only — bigger jumps risk resetting Learning."*
- Streak metadata stored on a per-campaign cache; ends when CoV returns to normal or metrics regress to baseline.

**Reuse:** existing `seasonal_hints` table (migration 010) · `fetch_insights` time-series · `check_creative_fatigue.py` · `check_tracking_health.py`. **New:** `classify_campaign_pattern.py` returns the pattern + suggested response lane.

**Why it elevates:** today every dip looks the same to the brain. Operators with experience *know* the difference between a dry spell and a broken campaign — this encodes that intuition.

### 8.1 🧠 Conversation Orchestrator — *Phase 1*
`campaigner/conversation/orchestrator.py`
- Multi-turn Claude Agent SDK session (**Opus**).
- System prompt = operator persona (§14) + obligations to guardrails/evaluation docs.
- Per-turn context: rolling summary + last N turns · classified intent · business context · relevant `strategic_memory` · open `recommendation_ledger`.
- Tools = existing CLI tools (§10) + new (`compose_campaign_draft`, `record_strategic_memory`, `check_recommendation_novelty`, `analyze_creative`).
- Output = assistant text **+** structured `artifacts` (action cards, draft refs), persisted on the message.
- **Boundary:** may write `approvals`; ⚙️ never calls `MetaClient`.

### 8.2 🧠 Intent Engine — *Phase 1*
`campaigner/conversation/intent.py` + prompt `campaigner/prompts/conversation/intent-classification.md`
- **Haiku**, runs before orchestration. Output: `{primary_intent, secondary_intent?, confidence, reasoning, needs_clarification}`.
- Taxonomy (from brief, lives in the prompt file — easy to extend):
  `low_leads · low_quality_leads · expensive_leads · weak_offer · weak_creative · no_bookings · new_service_launch · geo_expansion · seasonal_campaign · whatsapp_push · retargeting_needed · local_visibility_problem · trust_problem · premium_positioning · emergency_fill_calendar · increase_average_order_value` + `smalltalk · status_query · unknown`.
- Intent **routes** which tools the orchestrator reaches for first (e.g. `low_quality_leads` → pull `fetch_lead_quality_summary` + `compute_quality_adjusted_kpi`).

### 8.3 🧠 Strategic (operator) Memory — *Phase 3 (schema in P1)*
`campaigner/conversation/memory.py` + tools `record_strategic_memory.py`, `recall_strategic_memory.py`
- **Write:** orchestrator records durable facts; upsert by `(kind,key)` → reinforce (count++/confidence↑), never duplicate.
- **Read:** return most relevant/confident facts for the current intent.
- **Decay:** `expires_at` for seasonal/transient; Flow F prunes + decays stale confidence.
- Flows A/F may **read** it to enrich proposals; only the conversation + explicit operator actions **write** it (clean provenance).

### 8.4 ⭐ Recommendation Dedup / Novelty — *Phase 3 (pull to P1, see §13)*
`campaigner/conversation/dedup.py` + tool `check_recommendation_novelty.py`
> **This is the direct fix for "it keeps repeating itself."**
- Fingerprint = stable hash of `(intent, action_class, target_kind, target_id)`; look up `recommendation_ledger`:
  - **New** → record + surface.
  - **Seen, in cooldown** → don't repeat verbatim → **escalate** ("I've raised this twice; here's the cost of waiting…"), or stay silent, or re-justify only on new evidence.
  - **Seen, rejected** → respect prior rejection (mirror guardrail §37); re-raise only if materially different — and say how.
- **The cron Flows write to the same ledger** so chat and cron never repeat each other.

### 8.5 🧠 Campaign Draft Composer — *Phase 2*
`campaigner/conversation/draft_composer.py` + tool `compose_campaign_draft.py`
- **Input:** business knowledge · goals · budget · geo · gallery census ([list_active_creatives.py]) · audiences ([list_audiences.py]) · campaign history/outcomes · relevant strategic memory.
- **Output:** `campaign_drafts.structure` jsonb — objective, structure (campaign/ad_sets/ads), targeting (broad + Advantage+), budget split, creative angles, copy directions (Hebrew, obeys [hebrew-copy-style.md]), media selection (gallery vs generate), WhatsApp flow, KPI expectations, risks.
- **⚙️ Hard constraints:** must pass guardrail §38 (payload completeness) + align with [CAMPAIGN_BUILDING_RECOMMENDATIONS.md]; must not reintroduce any §8 deprecated rule.
- **Does NOT publish** — produces a draft → operator reviews (§11) → promote → packaged into existing `approvals` as a `new_campaign` task → normal Flow B.

### 8.6 ⭐ Proposal Lifecycle (add / improve / remove) + Approval Packaging — *Phase 2*
> Operator's ask: *"everything preserved in the proposals layer, and it knows to add / improve / remove, really understanding my need."*

- The conversation drives the **existing `approvals` layer** — every add/improve/remove becomes a proposal, fully traceable, linked back to the conversation turn that spawned it (`related_approval_ids`).
- **Lifecycle verbs map to existing task types:**
  | Operator need | Proposal | Existing task type |
  |---|---|---|
  | **Add** content/campaign | new campaign / new creative / boost post | `new_campaign` · `new_creative` · `boost_post` |
  | **Improve** | scale budget · refresh creative · expand audience | `scale_up` · `redeploy_creative` · audience proposals |
  | **Remove** / reduce | pause · scale down | `scale_down` · status change (⚙️ no delete — guardrail) |
- **Feedback loop:** operator feedback in chat is captured → `strategic_memory` + `recommendation_ledger` → the agent **adjusts** subsequent proposals instead of re-suggesting the rejected thing.
- **Approval Context Packaging:** every proposal carries `strategic_reason · expected_outcome · estimated_risk · estimated_lead_impact · estimated_budget_impact · visual_preview_ref · why_now · problem_it_solves` (in `payload.context`, or a small nullable `context jsonb` column). Rendered by [/approvals/[id]](../../web/src/app/approvals/[id]/page.tsx) as an "AI campaign proposal", §34-clean Hebrew.

### 8.7 ⭐🧠 Creative & Video Intelligence — *Phase 4 (a brain capability the operator explicitly wants)*
> Today only **performance** signals exist (hook rate, thumb-stop via `fetch_insights`). There is **no analysis of the creative's actual content.** This adds it.

**What it produces** (`creative_intelligence` table / tags on `creative_gallery`):
`emotional_tone · positioning(luxury|budget) · trust_signals · aesthetic(family|wedding|youth|event) · conversion_suitability · hook_strength · placement_fit · (video) pacing, scene_cuts, on-screen_text_density, audio/music_tone, first-3s hook description`.

**Recommended toolchain — build in-stack, don't buy (see §16):**

| Need | Recommended tool | In-stack? | Notes |
|---|---|:--:|---|
| **Image** content analysis | **Claude vision** (Opus/Sonnet) | ✅ | native multimodal; already paid for |
| **Video** content analysis | **Gemini 2.5 Pro/Flash via Vertex AI** | ✅ | native video (audio+visual), FPS sampling, SOTA on VideoMME; **reuses our existing GCP/Vertex** (same project as Imagen) |
| **Hook frame (0–3s)** deep-dive | ffmpeg keyframe extract → Claude vision | ✅ | Claude-native, precise on the make-or-break opening |
| **Performance overlay** | Meta insights (3s/5s views, thumb-stop, hook rate) | ✅ | already fetched — combine *content* + *performance* |
| Virality/retention scoring *(optional)* | `higgsfield virality_predictor` (MCP, available) | ⚠️ | external SaaS; good complementary signal, adds vendor/cost |
| Cross-platform creative analytics *(future)* | Segwise / Vidmob / Neurons | ❌ | enterprise, paid, multi-channel — only if scope grows |

**⭐ Gallery-wide creative learning loop (operator's intent):** the brain indexes the **entire gallery — every image, video, and post — directly**, not just one asset on demand:
1. **Batch-analyze** all gallery assets → cache content tags on `creative_intelligence` (re-run only on new/changed assets).
2. **Join** content tags ↔ Meta performance (`fetch_insights`: hook rate, thumb-stop, CTR, CPL) ↔ lead-quality outcomes.
3. **Distil winning patterns** into `strategic_memory` (`kind='what_converts'`) — e.g. *"human-focused warm visuals with on-screen text in the first 2s convert best for the weddings service."*
4. So when something works, the agent **knows *why*** (which content features drove it) and reuses that knowledge in future drafts + boost decisions.

**Feeds into:** Draft Composer (pick best angle/asset) · creative-refresh advice (*"your visuals are premium but emotionally cold; your best converters are human-focused"*) · **`boost_post` candidate selection** (closes the "never suggests boosting good content" gap, §9).

### 8.8 🧠 Lead Quality & Outcome Loop (+ CRM integration) — *Phase 5*
Strategic layer over `leads` / `lead_quality_grades`, **closed by real downstream outcomes from an external CRM**.

**Why:** today the only quality signal is the operator's manual grade (GOOD/OKAY/SPAM). With a CRM connected, the agent learns *what actually closed* and attributes it back to **campaign → creative → audience → offer** — so it knows what to improve based on revenue, not guesses.

**Integration design — generic, not vendor-specific** (the team is building a *general* CRM that "should be able to connect"; this is a contract any CRM implements, incl. yours):
- ⭐ **Identity join key is the crux:** Meta `lead_id` (best), fallback hashed phone/email. Without it, outcomes can't be attributed to a campaign/creative/audience — attribution is the whole point.
- **CRM → Campaigner (inbound):** the CRM pushes outcome events (stage change · won/lost · deal value · no-show · close reason) to an **HMAC-signed webhook `POST /api/crm/webhook`**. Reuses the existing [webhook/](../../webhook/) pattern. Upserts into new `lead_outcomes`, matched to `leads` by the identity key.
- **Campaigner → CRM (outbound, optional):** on each new lead, push the **source attribution** (campaign/creative/audience) so the CRM has closed-loop source data.
- **Config** lives in the existing `crm_integrations` table (provider · base_url · webhook secret · field mapping · identity key · direction · enabled) — provider-agnostic.

**What the agent does with it (closing the loop):**
- Archetype classification (cheap-bad · expensive-good · no-show · price-shopper · premium-buyer · fast-closer · low-intent · seasonal) grounded in **real** outcomes, not guesses.
- Extends [compute_quality_adjusted_kpi.py](../../campaigner/tools/compute_quality_adjusted_kpi.py) from CPL → **cost-per-closed · revenue-per-lead · ROAS-on-closed**.
- Feeds conclusions into targeting / creative angle / offer positioning / WhatsApp flow + `strategic_memory` — where `what_converts` now means **what closes** (e.g. *"audience X is cheap to acquire but never closes — reallocate"*).

**⭐ "One communication":** CRM outcomes surface inside the **Workspace conversation** and the **Learning Timeline** — the operator sees lead quality, closes, deal value, and the resulting strategy shifts in *one place*, not a separate dashboard. That's the single-pane the operator asked for.

**Data model — `039_lead_outcomes.sql`:** `business_id · lead_id (FK leads) · crm_lead_id · stage · status (won|lost|no_show|in_progress) · deal_value_ils · close_reason · occurred_at · raw jsonb`.

#### 8.8.1 ⭐ WhatsApp Conversation Intelligence — *the quality signal layer BEFORE the CRM*
> Operator uses `click_to_whatsapp` heavily (it's the IL B2C default in [estimate_cpl.py](../../campaigner/tools/estimate_cpl.py) for the `leads` vertical). **The conversation itself is data** — long before the CRM marks a deal won/lost, the WhatsApp transcript already reveals lead quality. Today the brain sees `lead_count` only; it never sees the conversation. This adds the layer.

**What the conversation reveals (without waiting for CRM):**
| Signal | What it tells us |
|---|---|
| **Time-to-first-reply from user** | engaged within minutes = warm · responds days later = cold |
| **Conversation depth** (turns × length) | 1-2 short turns = low intent · 6+ substantive turns = qualified |
| **Specific questions asked** | *"how much?"* = price-shopper · *"when can you come?"* = buyer · *"do you have references?"* = trust-stage buyer |
| **Sentiment** | excited / neutral / frustrated / disengaged |
| **Completion vs ghosting** | did the user respond to the final operator message? |
| **Booking/commit language** | *"let's do it"* / *"send me a quote"* / *"I'll think about it"* / silence |
| **Disqualification signals** | *"not in your area"* · *"sister recommended you, just checking"* · *"need this for next year"* |

**Architecture (in-stack):**
- **Transport:** lift `generic_agent`'s Maytapi WhatsApp client (§17.6) — already operates WhatsApp in their stack — OR direct WhatsApp Cloud API. Per-operator phone instance.
- **Storage:** new table `whatsapp_conversations` (one per lead) + `whatsapp_messages` (turns). FK to `leads`. Same identity-join logic as §8.8.
- **Analyzer:** `analyze_whatsapp_conversation.py` — Claude reads the transcript (text only — privacy: no media uploaded to LLM), returns `{quality_score: 0-100, suggested_grade: GOOD|OKAY|SPAM, intent_signals: [...], booking_likelihood: 0-1, disqualification_flags: [...]}`.
- **Auto-grade:** populates a *suggested* grade on `lead_quality_grades`; operator confirms (high confidence = one-click; low = full review). Reduces grading workload massively.
- **Feeds:**
  - `lead_outcomes` (§8.8) — early signal before formal CRM update.
  - `strategic_memory` — patterns of "what conversations precede closes vs ghosts."
  - `creative_intelligence` (§8.7) — back-map: which creatives produced the WhatsApp conversations that converted vs ghosted.

**Cross-account learning (ties to §17.3):**
- *"Across 14 carpenters: leads who ask 'when can you come?' in turn 2 close at 67%; leads who ask 'how much?' close at 18%."*
- This becomes a contextual benchmark the brain uses to score *new* WhatsApp conversations.

**Privacy & operator consent:**
- Operator opt-in per business (WhatsApp content is sensitive).
- Personal details (phone, address) redacted before LLM analysis (regex pass).
- Conversation retention configurable; default 90 days then summarize-only.
- All consistent with Meta's WhatsApp Business Policy.

**New tools:**
- `sync_whatsapp_conversations.py` — pulls from Maytapi/Cloud API per business.
- `analyze_whatsapp_conversation.py` — Claude scoring (Sonnet, not Opus — high volume, fast).
- `suggest_lead_grade_from_chat.py` — auto-populates `lead_quality_grades` with suggestion + confidence.
- New `040_whatsapp.sql` migration (parallel to `040_cross_client_benchmarks`; or merge into one batch).

**Why it elevates:**
- **Quality grading scale-up** — operator no longer needs to read every lead manually; brain pre-scores from the conversation.
- **Faster feedback loop** — quality signal arrives within hours of the chat, not weeks after CRM close.
- **Connects creative → conversation → outcome** — the brain learns *which creatives produce conversations that convert*, not just which produce leads.
- **Differentiator** — no mainstream Meta-automation tool reads the post-click conversation. This is uncommon depth.

---

## 9. ⭐ Behavioral upgrade — fixing "generic & passive" (Phase 1 focus)

The agentic layer must change *how it shows up*, not just add a chat box:

1. **Proactively mine existing content.** Each engagement scans gallery + organic posts (via Creative Intelligence §8.7) and **proposes `boost_post` / `redeploy_creative` when good unused content exists** — instead of defaulting to "generate new" or generic advice.
2. **Drive action, don't report.** Every response ends with a concrete, ranked next step + an action card (§11), not a metric dump.
3. **Specificity over safety.** Translate signals into a decision ("refresh the creative angle, don't scale budget — attention is fine, emotional connection dropped").
4. **Close the feedback loop.** Operator feedback in chat → memory + ledger → adjusted proposals.
5. **One coherent managed plan.** add/improve/remove are tracked together in the proposals layer (§8.6), not scattered one-off tips.
6. ⭐ **Add-creative to existing campaign = default fatigue response** (operator's actual tactic). When a creative dies, the brain's **first move is to propose a near-variant added to the same campaign** (the operator's words: *"adding a new creative to the same campaign suddenly revives it"*) — *before* considering scale_down, pause, or duplication. This preserves Learning state and avoids the reset trap. Pause/scale_down only after add-creative attempts haven't worked.

> ⚙️ All of the above still passes through the same deterministic guardrails — bolder *communication*, identical *safety*.

---

## 10. Existing tools as agent tools

The orchestrator **calls existing tools**; it doesn't reimplement domain logic. Wrap each as an Agent SDK tool (shell out, or import the tool's `main()` in-process for speed) returning the tool's JSON. Contract preserved ([campaigner/tools/CLAUDE.md](../../campaigner/tools/CLAUDE.md)).

**Phase 1 (read/diagnose only — no execution tools exposed to chat):**
`load_business_knowledge · load_baselines · fetch_insights · fetch_meta_state · fetch_lead_quality_summary · compute_quality_adjusted_kpi · compute_monthly_pace · route_pacing_action · list_active_creatives · list_audiences · list_ab_tests · load_feedback_history · load_recent_actions_outcomes · check_data_sufficiency · check_account_health · check_creative_fatigue`

**Phase 2+:** `compose_campaign_draft · propose_task / propose_audience (proposal only) · generate_creative · analyze_creative`.

---

## 11. Frontend (Next.js — new, plugs into existing dual-mode adapters)

> RTL Hebrew · server components by default · `"use client"` only for the chat stream.

| Area | Route / component | Phase |
|---|---|:--:|
| **Conversation Workspace** (primary) | `app/workspace/page.tsx` + `workspace-chat.tsx` (SSE) | 1 |
| **Strategic Action Cards** | `components/action-card.tsx` — Build Campaign / Improve Lead Quality / Fix Fatigue / Fill Calendar / Push WhatsApp / Retargeting / Premium. Each shows *why · expected impact · urgency · confidence · required approvals* | 1–2 |
| **Campaign Draft Preview** | `app/workspace/draft/[id]/page.tsx` — renders `campaign_drafts.structure` as a proposal; "Approve → queue" packages to `approvals` | 2 |
| **Business Context Sidebar** | `components/business-context-sidebar.tsx` — top/weak services · strongest audience · lead-quality trend · seasonal alerts · recent rejected strategies · monthly goals · bottlenecks | 3 |
| **Learning Timeline** | `app/learning/page.tsx` — what the AI learned / changed / improved / failed (reads `strategic_memory` + `recommendation_ledger` + `agent_decisions`) — critical for trust | 3 |

New web API routes (thin proxies): `POST /api/conversation/turn` (SSE) · `GET /api/conversation/[id]` · `GET /api/conversation/list` · `GET /api/drafts/[id]` · `POST /api/drafts/[id]/promote` · `GET /api/strategic-memory` · `GET /api/learning-timeline`.

---

## 12. Patterns borrowed from `generic_agent` (take / don't-take)

| Pattern | ✔ Take | ✖ Change / drop |
|---|---|---|
| Intent classifier | LLM-based, conversation-aware, external prompt, fast model | Claude Haiku (not Gemini); campaign intents (not website Q&A) |
| Conversation/message schema | `conversations` + `messages` shape, rolling summary | Postgres (not Mongo); `business_id`-scoped; artifacts column |
| Parallel context gathering | fetch intent + memory + context concurrently | our tools/memory (not Qdrant chunks) |
| External prompt discipline | all prompts in markdown files | under `campaigner/prompts/conversation/` |
| User memory | persistent profile of preferences | reframed as **operator** memory, evidence-linked |
| Orchestration order | guardrails → context → generate → post-process | Claude Agent SDK session (not LangGraph) |
| **Abilities/CTA system** | — | ✖ dropped (18 hardcoded website CTAs, wrong domain) |
| **Datastores / LLMs** | — | ✖ no Mongo, no Qdrant, no Grok/Gemini-for-chat |

---

## 13. Phased roadmap

| Phase | Delivers | Meta execution? |
|:--:|---|:--:|
| **1** | **Deep first scan (§8.0)** · Conversation Workspace · orchestrator (read tools) · intent engine · `conversations`/`messages` · streaming UI · behavioral upgrade (§9) · logging | ❌ none |
| **2** | Draft Composer · `campaign_drafts` · Draft Preview · promote→approval · approval packaging · proposal lifecycle (§8.6) | via existing Flow B, test account, PAUSED |
| **3** | Strategic memory · **dedup ledger** · Context Sidebar · Learning Timeline · wire cron Flows to ledger | — |
| **4** | **Creative & Video Intelligence** (§8.7) | — |
| **5** | Lead Quality Interpretation | — |

> ⚠️ **Recommendation: pull the dedup ledger (§8.4) forward into Phase 1.** "Stops repeating itself" is the operator's #1 pain and it's cheap to stand up.

**Acceptance criteria (per phase):**
- **P1:** multi-turn Hebrew strategist conversation on *live* data; intents classified + stored; ambiguity → clarifying question; **no Meta writes**; every turn logs a decision row + token usage; responses are specific & action-driving (§9), not generic.
- **P2:** *"more leads for balloon walls in Ashdod"* → complete, **guardrail-valid** draft; promote → identical-shape `approvals` row → executes end-to-end on test account (`act_202495959`) PAUSED; approval reads as an AI proposal.
- **P3:** a fact stated once is recalled in a later separate conversation; agent does **not** repeat within cooldown (escalates/stays silent); timeline + sidebar reflect reality.
- **P4:** agent characterizes image **and video** content and uses it in drafts + boost-post selection.
- **P5:** agent connects lead-quality outcomes to concrete strategy changes.

---

## 14. Operator persona & prompt design
`campaigner/prompts/conversation/operator-persona.md` (system) + `intent-classification.md`
- Voice: proactive · strategic · commercially aware · confident · initiative-driven — a senior campaign manager, not a metrics reporter.
- ⭐ **Per-business parameterization:** the §8.0.1 deep scan derives this business's voice register / formality / positioning (premium vs value) / assertiveness and injects them — the persona **adapts its character to each business** (a premium wedding brand and a budget local service should not sound identical) while staying subordinate to guardrails.
- ❌ *"CTR dropped below threshold."*
- ✅ *"הקמפיין עדיין מושך תשומת לב, אבל אנשים כבר לא מתחברים רגשית להצעה. עדיף לרענן את הזווית הקריאטיבית במקום להגדיל תקציב."*
- ⚙️ Subordinate to guardrails: a "confident operator" must **never** talk the operator past a gate. Obeys [hebrew-copy-style.md], guardrails §34/§41, two-gate model, and the §8 deprecated-rules "never" list. Test with adversarial prompts.

---

## 15. Observability & safety (reuse, don't rebuild)
- **Every turn** → ≥1 `agent_decisions` row (`graph_name='conversation'`, `node_name` ∈ intent|orchestrate|draft|propose) via [log_decision.py].
- **Proposals** → same `check_guardrails` as today; chat cannot bypass.
- **No Meta writes** from the layer — only `approvals`; Flow B re-checks before any Meta call.
- **Cost:** Opus orchestration is the main new cost driver — track `token_usage`/turn, set per-conversation/day budget, degrade to Haiku for non-reasoning turns. (Model the delta vs the ~$25/mo/business baseline before launch.)
- **Semantic recall** deliberately omitted (no vector DB). If needed later, add **`pgvector` to Postgres** — never reintroduce Qdrant.

---

## 16. Creative analysis — build vs buy

**Recommendation: BUILD in-stack (Gemini via Vertex + Claude vision) for MVP.**

| | Build in-stack | Buy SaaS (Segwise/Vidmob/Neurons) |
|---|---|---|
| Cost | reuses existing Claude + GCP; marginal | per-seat / per-analysis subscription |
| Data | stays in our system | leaves to a 3rd party |
| Fit | tailored to our gallery + HITL + Hebrew | generic, cross-platform |
| Effort | moderate (frame sampling + prompts) | low integration, ongoing cost |
| Verdict | ✅ **MVP** | reconsider only if cross-platform creative analytics becomes a core need |

> `higgsfield virality_predictor` (already available via MCP) is a reasonable **complementary** signal to trial during Phase 4 — but it's an external dependency, so treat it as optional, not foundational.

---

## 17. Strategic Elevators — capability upgrades & process savings (post-MVP)

> Based on deep research of both `meta-ads-automation-ai` and `D:\Projects\generic_agent` + 2026 Meta Ads & Claude Agent SDK research. **Each elevator is independently shippable.** For every one: what · how · what to reuse. Ordered by leverage.

### 17.1 🔥 Closed-loop eval & learning — *from rule-based to learning-based*
**Gap:** outcomes are measured ([load_recent_actions_outcomes.py](../../campaigner/tools/load_recent_actions_outcomes.py)) but nothing self-scores or tunes from them.
**How:** Adopt Anthropic's 2026 **Planner → Generator → Evaluator** pattern. An **Evaluator subagent** (Claude Agent SDK) scores every proposal vs its real outcome → writes `decision_type='proposal_review'` → nudges threshold *confidence* within guardrails (⚙️ never overrides them). After N reviews, reports per-action-class success rates (*"scale_up under condition X improved CPL 72% of the time"*).
**Reuse:** Agent SDK native **subagents** + **memory tool** + **online eval hooks**. `load_recent_actions_outcomes.py` already provides measurement. New tool: `evaluate_proposal_quality.py` (~200 lines).
**Why it elevates:** moves Campaigner from a sophisticated template engine to a **learning optimizer** — the perception shift is enormous.

### 17.2 🔥 Multi-client → SaaS evolution (internal now → self-register later)
**Operator clarification (updated):** the trajectory is **two phases** — the same architecture serves both, so building once pays twice.
- **Phase A — Aiweon-internal multi-client (MVP):** RLS on every business-scoped table + business switcher in [/integrations](../../web/src/app/integrations/page.tsx). For Aiweon's agency team to safely run multiple client accounts in one system.
- **Phase B — open self-registration (future product direction):** users sign up independently; the agent **replaces their existing campaign manager** (human consultant or third-party tool). At this point we lift `generic_agent`'s **billing/auth/subscription/quota** stack as-is (it's mature there). Each registered user is their own tenant; the conversation, draft composer, calibrator, and CRM loop all already operate per-business — no rearchitecture needed.
- **Why the same elevator unlocks both:** RLS + per-business context (Phase A) is exactly the isolation Phase B requires. Building Phase A defensively now means Phase B is a feature rollout, not a re-architecture.

**Reuse:** the multi-tenant *pattern* from `generic_agent` (User → Business → Agent models) as the reference design. Phase A skips the billing/widget layer; Phase B lifts it.

### 17.3 🔥 Cross-user learning — *the strategic moat (compounds with every registered user)*
**Operator question:** *"Can we learn from other users to understand what works better?"* — **yes, and it's the strategic moat.** Every user makes every other user's agent smarter — the system gets sharper the more accounts run on it.
**Phase A:** across Aiweon's internal clients.
**Phase B:** across **all self-registered users** — this is where the moat compounds: a competitor who launches a similar tool will need years of data to catch up.
**How:** an **anonymized aggregation layer** — materialized view `cross_client_benchmarks` (migration `040`) — computes across all accounts in the system: winning creative angles by vertical/geo, typical CPL/CPA bands per sub-vertical, audience archetypes that close vs don't, seasonal patterns, calibrator validation data (which strategies *actually* worked for micro-budget businesses in vertical X). The orchestrator reads as **context**: *"across 14 other carpenters in central Israel at similar budget, boost_post-heavy on family-warm angles outperforms paid-only 3:1."*
**Privacy:** Phase A min 3 accounts per cohort; **Phase B raises to min 5 + no cross-vertical leak + differential noise on tail metrics.** Never row-level data, only aggregates. Respects RLS from §17.2.
**Reuse:** existing tables (`agent_decisions` · `leads` · `lead_outcomes` (§8.8) · `creative_intelligence` (§8.7)). New: 1 materialized view + `recall_cross_client_benchmarks` tool + Phase-B privacy guard.
**Value curve:** marginal at 1 account, real at 5, **transformative at 50+** — and that's the strategic asset competitors can't shortcut.

### 17.4 🔥 Budget-Reality Calibrator — *the honest "what's your budget vs what you need" conversation*
> The **methodology** (Bayesian shrinkage, multi-dim confidence, evaluation modes, "זמן תודעה") lives in §8.0.2. This section defines **what the operator sees** — the conversation, the output shape, the principles.

**The differentiating insight (operator's, professional):** Meta's "50 conversions/7d to exit Learning" is a **fixed algorithmic constant** that biases small businesses to overspend. A business that needs 3 leads/day shouldn't spend 10× more just to satisfy Meta's threshold. Most Meta-automation tools just parrot Meta's defaults; they aren't business-aware. **This is where Campaigner differentiates** — through honest budget-reality conversation.

#### Core output: always **2 options, never just one** (operator-mandated)
Whenever the operator brings a budget OR a goal, the agent presents both:

| | Option A — Market-recommended for your goal | Option B — What your stated budget actually delivers |
|---|---|---|
| **Basis** | Live market research: vertical CPL bands + lead-to-sale **close rates** + cross-business actuals (§17.3) + competitive research (Flow D / §8.0 step 5) | Bayesian-calibrated forecast with confidence band (§8.0.2) — uses account's own history when available |
| **Honest framing** | *"To hit X purchases/events per month, the market suggests ~₪Y/day."* | *"At ₪40/day, expect ~2 leads/day ≈ N customers/month given typical close rate Z%."* |
| **Why both** | A anchors the operator to reality; B respects the hard limit they brought |

The agent then explicitly states **the gap** and offers three honest paths: **(a)** increase budget toward A · **(b)** accept reality at B · **(c)** shift the goal.

#### The reverse-from-outcome chain (operator's mental model)
The agent reasons in **end-state terms** (purchases / events / customers), **not just leads**. Leads are intermediate.
```
target_purchases_per_month
  ÷ close_rate                            (market default OR business-actual)
  = leads_needed_per_month
× CPL_predicted                           (per §8.0.2)
  = required_monthly_budget
  ÷ 30 = required_daily_budget            → Option A
```
And in parallel:
```
stated_daily_budget × 30 ÷ CPL_predicted
  = expected_leads_per_month
× close_rate
  = expected_customers_per_month          → Option B
```

#### Close-rate is a first-class variable (today the brain doesn't think about it)
- **Prior:** per-vertical bands from live market research (e.g. carpentry quote → close 10-25%; bridal consult → 30-45%; karaoke event booking → 5-15%). Researched once per business at onboarding, refreshed by Flow D.
- **Actual:** when CRM is wired (§8.8), real close rates per business override the prior — same Bayesian shrinkage logic as CPL (§8.0.2).
- **Without close_rate the budget conversation is incomplete** — a cheap lead worth nothing costs more than an expensive lead that closes.

#### "Always relative to market + business size" (operator's principle)
The calibrator **never quotes absolutes** — only relatives. *"₪40/day is small for marketing-tech but normal for a side-business attractions account; for your size and market it's reasonable."* Business size is derived from inputs (revenue tier · employee count · operational capacity if shared) and contextualizes every recommendation. Recommendations are **always paired with what the market demands at this size**.

#### Onboarding sequence (budget-first, per operator's playbook)
1. **"What's the daily/monthly budget you can invest as a start?"** ← the hard limit.
2. **Live market research:** typical CPL + close-rate bands for the vertical (cached, refreshed via Flow D).
3. **"How many purchases/events/customers do you want per month?"** ← the soft target.
4. Brain presents the **2-options** side-by-side + the gap + three paths. Operator picks.
5. (If yes-but-stretch) **Capability check:** *"Option A is ₪180/day. Is that within capability? If not, we plan around Option B and revisit when results come in."*

This sequence is what the deep scan (§8.0) drives the operator through on first contact — not a static form.

**Reuse:** [estimate_cpl.py](../../campaigner/tools/estimate_cpl.py) (becomes one input among several, not the answer) · `kpi-benchmarks.md` · `business_knowledge.monthly_brief` · Flow D competitive research (close-rate research is a new lane there).
**New tools:** `calibrate_budget_reality.py` (the engine) · `research_market_close_rate.py` · `compute_outcomes_from_leads.py` · `present_two_options.py` · `business_profile_classifier.py` (size tier).
**Why it elevates:** **this is the single most differentiating feature** in the list — domain wisdom most tools don't have + radical honesty about reality-vs-aspiration + reasoning in *outcomes*, not leads.

#### 17.4.1 Worked example — carpentry, ₪40/day, 3 leads/day desired (operator's real case)

**Inputs the operator brings:** budget = ₪40/day · stated goal = 3 leads/day · vertical = carpentry · geo = central IL.

**Brain's market research output:** carpentry IL CPL prior = ₪40–80 (grid, pessimistic; well-run accounts reach ₪20–30 per §8.0.2) · close rate (lead → signed quote) ≈ 15–25% market typical.

**The agent reframes from "leads" to "outcomes" first:**
> *"3 leads/day at carpentry's ~20% close rate ≈ 18 customers/month. Is that the real goal? If so, here are 2 options:"*

| | **Option A — Market-recommended for 18 customers/month** | **Option B — Your stated budget (₪40/day)** |
|---|---|---|
| Budget | **₪180/day** (≈ ₪5,400/month) | **₪40/day** (₪1,200/month) |
| Expected leads | ~3/day (90/month) | ~0.5–1/day (15–30/month) |
| Expected customers (at 20% close) | ~18/month ✓ | ~3–6/month |
| Gap from goal | met | **12–15 customers short** |

**Three honest paths:**
1. **(A) Stretch to ₪180/day** if capability allows — meets the stated goal.
2. **(B) Accept reality at ₪40/day** — 3–6 customers/month is what this budget yields; replan goal.
3. **(C) Shift goal** — perhaps quality over quantity (premium projects, higher close rate, higher value per customer).

**Strategy at ₪40/day** (if operator picks B): consolidated single ad set · optimize for **Lead-form-open** (upper-funnel signal, passes Learning faster) · Advantage+ broad · heavy `boost_post` of best organic posts · 7-day click attribution · 3-5 focused creatives (not 10+).

**Things the brain MUST NOT propose at this tier:** percent-based `scale_up` (a 20% jump = ₪8, meaningless) · `new_creative` when utilization < 0.5 · A/B test (sample too thin) · "chase 50/7d" advice.

**After 30 days of real data:** the Bayesian model recalibrates. If this operator achieves ₪20 CPL (as he does on his other accounts), the new forecast jumps to ~2 leads/day at ₪40 — and the conversation repeats with updated numbers. The operator's actual matters more than the grid the longer the account runs.

#### 17.4.2 Specific calculations the brain must add
1. `forecast_realistic_volume(budget, vertical, geo)` → range of leads/week with confidence band (uses Bayesian §8.0.2 when history exists).
2. `is_50_per_7d_achievable(budget, vertical, geo)` → boolean + headroom (budget needed to reach).
3. `compute_required_budget(target_outcomes, close_rate, vertical, geo)` → honest budget for the **stated outcome goal** (purchases/events/customers, not just leads).
4. `score_meta_fit(business_profile)` → 0–100 (how well the business matches Meta's "optimal user" assumptions; low score → adapt strategy).
5. `recommend_optimization_objective(profile, achievable_volume)` → OUTCOME_LEADS / LANDING_PAGE_VIEWS / CLICKS / ENGAGEMENT with rationale.
6. `lead_economics(business)` → cost-per-closed · revenue-per-lead · true ROAS (uses §8.8 CRM outcomes when available).
7. `compute_min_meaningful_budget_step(daily_budget)` → `max(₪25, 20% × budget)` — floor so trivial proposals don't fire.
8. ⭐ `research_market_close_rate(vertical, geo)` → market close-rate band per vertical (lead → customer / sale / event), refreshed by Flow D. **New first-class variable.**
9. ⭐ `compute_outcomes_from_leads(leads, close_rate)` → expected customers/sales/events from a lead forecast — the bridge to outcome-language conversations.
10. ⭐ `present_two_options(budget_stated, outcome_target, vertical, history)` → renders the Option A / Option B / Gap / 3-paths table the operator sees.
11. ⭐ `business_profile_classifier(business)` → size tier (micro / small / medium / large) — every recommendation is *relative* to this tier + market, never an absolute.

#### 17.4.3 Access to operator's real data — honest answer
I don't have direct access to YAMBA / BEMTCH / MIKIT account performance from this conversation (only repo files). The calibrator is designed to **ingest historical data** from `agent_decisions` / `baselines` / Meta insights once wired per business. The operator's anecdotal cases ("₪40/day, amazing results with light creative") qualitatively validate the model; **quantitative calibration requires the model to actually run against those accounts** — at which point it tunes itself to real CPL / CTR / close rates per business and per vertical. Cross-user learning (§17.3) then turns those real numbers into shared wisdom for similar businesses.

### 17.5 Creative closed-loop (winner → next brief)
**Gap:** `evaluate_ab_test` picks winners; nothing feeds back into `generate_creative`.
**How:** `compose_creative_brief_from_winner.py` distils winning angle/tone/visuals from `ab_tests.decision_snapshot` → passes as `--prior_winners` to `generate_creative`. After 3–4 cycles creatives tune vertically.
**Aligned to 2026:** Meta Advantage+ Creative auto-tests 10–20× more combos and pushes budget to winners — this loop aligns our behavior to the algorithm's incentives.
**Reuse:** A/B infrastructure is complete; only the bridge tool is new.

### 17.6 Proactive notifications (WhatsApp)
**Gap:** no push channel — failures discovered hours later; cron/token issues silent.
**How:** notifications gateway pushes critical alerts (cron failure · token expiring · CPL spike · creative fatigue · ledger escalations) to operator's WhatsApp/email.
**Reuse:** `generic_agent` has a **Maytapi WhatsApp client** (`backend/services/whatsapp/`) — adopt as a tool.

### 17.7 Agent SDK 2026 features (architectural)
- **Subagents** — parallelize per-campaign diagnosis (today sequential) → faster Workspace responses.
- **Memory tool** — native persistent memory (complements `strategic_memory`).
- **Online eval hooks** — catch drift / prompt-injection / hallucinated tool use in production. **Wire from day one — cheap now, expensive later.**
- ⚠️ **Cost note:** from **2026-06-15** Agent SDK usage on subscription plans draws from a **separate monthly Agent SDK credit** — model into the §15 token budget.

### 17.8 Reuse-from-`generic_agent` for process savings
- **ARQ + APScheduler** (background queue + cron) → powers the deep first scan (§8.0) and nightly syncs. Don't build a job runner from scratch.
- **Firecrawl + extraction pipeline** → powers §8.0.1 onboarding. Swap prompts, keep plumbing.
- **PromptLoader + LLM abstraction** → version-controlled prompts, runtime substitution.
- **MCP framework** → can host a **Meta MCP provider** (wraps Meta API as MCP tools — future-proof).
- **Design system + i18n** → Workspace UI baseline (Hebrew RTL already solved).

### 17.9 Finish deferred features (low effort, high ROI)
- **`kpis_per_objective` (migration 026)** — read+use it. Fixes the silent failure where engagement campaigns score against the wrong KPI. (~100 lines)
- **`approval_mcq` (migration 027)** — agent asks *"1/2/3?"* inline; operator picks instead of rejecting+retyping. **Direct fix for the "feedback channel is bad" pain.**
- **Token rotation + alert** — single 60-day Meta token = SPOF. Alert at T-7 days + auto-rotate path.
- **Idempotency lock** — unique constraint on `(run_id, node_name)` in `agent_decisions` to prevent duplicate decisions on cron retries.

### 17.10 🔥 Brain calibration — rigidity audit & micro-tier (companion to §17.4)
> Operator question: *"What else needs to be arranged in the brain, or rigidities loosened, or calculations added?"* — Audit of `config/thresholds.yaml` shows specific places the brain is rigid in ways that penalize small businesses.

**Audit of rigidities (and fixes):**

| Today (rigid) | Why it hurts small businesses | Fix |
|---|---|---|
| `learning.min_conversions_for_exit: 50` (fixed constant) | Treats ₪40/day and ₪40,000/day the same — small businesses "fail" forever | Add `business_aware_min_conversions = min(50, actual_lead_need_per_week × 1.5)`; track "in Learning vs satisfied" — accept satisfied-in-Learning as a valid steady state |
| `learning.budget_daily_min_ils = CPA × 50 / 7` | Orders the business to spend more than it needs | Conditional: apply 50/7d only if business *wants* high volume; otherwise `CPA × actual_need_per_week / 7` |
| `scaling.scale_up_*_pct` (20%, 30%) — percent-only | At ₪40/day a 20% jump = ₪8 — meaningless | Add `scaling.min_absolute_step_ils: 25`; step = `max(pct × budget, min_absolute_step_ils)` |
| `anti_flood` has no tier below `small` (₪50) | No mode for true micro budgets (₪20-50/day) | Add `budget_tier_micro_ils: 80` + `max_proposals_micro: 1` |
| `gate_1.impressions_floor: 1000` | At ₪20/day, 1,000 impressions in 7d may not happen — Gate 1 never fires, no kill signal | Add `gate_1.impressions_floor_micro: 300`; extend `evaluation_window_hours` accordingly |
| `gate_1.clicks_floor: 50` | Same problem | Add `clicks_floor_micro: 15` |
| Implicit: "if Learning, no scale" | Sound in general — but micro is *always* in Learning, so this blocks all action | Replace with: "if Learning AND business profile expects to exit" — micro accepts a steady in-Learning state |
| Implicit: "1 ad set + 10+ creatives" recommendation | At micro the creative-generation cost exceeds the value | At micro tier: 1 ad set + **3-5 focused** creatives |
| `solid_strong.util_floor: 0.95` | Healthy utilization is a winner qualifier — at micro Meta may underdeliver | Already correct (low util → diagnoses problem); Calibrator must *contextualize* ("underdelivery is normal at this budget") instead of treating it as failure |
| ⭐ **No volatility gate today** | Brain treats one stable week the same as one chaotic week; "זמן תודעה" / temporal stability is invisible to it | Add `cpl_volatility.cov_weekly`: ≤20% stable (trust) · 20–40% monitor · **≥40% weakness flag, give 7+ more days then act** (operator's calibration) |
| ⭐ **No close_rate concept anywhere** | Brain optimizes leads; the operator optimizes *customers*. Cheap leads that don't close cost more than expensive leads that do | Add close_rate as first-class variable (§17.4): research-driven prior per vertical, CRM-actual when wired. Every budget conversation reasons in **outcomes**, not just leads |
| ⭐ **No business-size context** | A ₪40/day account is "small" vs SaaS but "normal" vs side-business — same number, opposite meaning | `business_profile_classifier` stamps size tier; every recommendation says *what's typical for this size in this market* — never absolute |

**New / extended tools:**
- `calibrate_budget_reality.py` — the engine (§17.4).
- `forecast_realistic_volume.py` — Bayesian-aware (§8.0.2); called by Calibrator + Draft Composer + diagnosis.
- `business_profile_classifier.py` — derives tier (micro / small / medium / large) from budget × vertical × revenue × employee-count × operational-capacity; stamps `business_knowledge.profile_tier`.
- `research_market_close_rate.py` — per-vertical close-rate prior; refreshed by Flow D.
- `compute_outcomes_from_leads.py` — bridges lead forecasts to customer/event/sale forecasts.
- `present_two_options.py` — renders the A/B/gap/3-paths output (§17.4).
- `check_guardrails.py` becomes **tier-aware** — reads `profile_tier` and applies tier-appropriate thresholds (most guardrails gain a `_micro` variant).

**Onboarding sequence change (codified per operator's playbook):**
The first question is **budget capability** (the hard limit), not lead-need. Then market research (CPL + close-rate). Then **outcome target** ("how many purchases/events/customers per month?"). Then 2-options presentation. Lead-need is *derived*, not asked — it emerges from the conversation about reality vs aspiration. See §17.4 → "Onboarding sequence."

**The honesty principle (operator-stated, codified in the persona prompt §14):** *"Don't sell illusions."* When the operator's stated goal cannot be met at the stated budget, the agent **says so directly** with three honest options: **(a)** accept realistic volume · **(b)** increase budget to ₪X for the stated goal · **(c)** shift the goal (e.g. quality over quantity, premium positioning). It **never** quietly recommends an unattainable strategy, and it never quotes a CPL without a confidence band (§8.0.2).

---

## 18. Risks & open questions ⚠️
1. **Transport (§4.3 a vs b)** — eng-lead decision before Phase 1.
2. **Tool latency** — ~60 CLI tools per turn could be slow; consider in-process `main()` or a long-lived tool worker. Benchmark in P1.
3. **Dedup placement** — recommend pulling §8.4 into P1.
4. **Context/cost** — long conversations + memory + tool outputs can blow the budget → compaction + relevance filtering required (§5).
5. **Chat vs cron collisions** — shared ledger (§8.4) is the mitigation; wire by P3 at latest.
6. **Video analysis cost** — Gemini video tokens add up; cache analyses on `creative_intelligence` and re-run only on new/changed assets.
7. **Persona vs guardrails tension** — persona must subordinate to guardrails; adversarial-test.

---

## 19. Out of scope
Replacing Flows A–H / guardrails / `approvals` / `execute_task` / Meta integration · any new datastore (Mongo/Qdrant) or chat-LLM (Grok/Gemini) · importing `generic_agent` code/services · autonomous execution / removing HITL · multi-business & CRM bridge (remain deferred).

---

## 20. First concrete steps for the implementer
1. ⚠️ Decide transport (§4.3).
2. Write migrations `033`–`037` (§7).
3. Scaffold `campaigner/conversation/` + `campaigner/prompts/conversation/`.
4. Wrap Phase-1 read tools (§10) as Agent SDK tools; benchmark latency.
5. Build `/workspace` chat against the SSE endpoint; log every turn.
6. Ship Phase 1 behind a feature flag; dogfood on the **test ad account** before enabling any draft/proposal capability.

---

### Appendix — sources for creative/video analysis recommendations
- Google — [Gemini 2.5 video understanding](https://ai.google.dev/gemini-api/docs/video-understanding) · [blog](https://developers.googleblog.com/en/gemini-2-5-video-understanding/)
- Industry tool surveys (2026): [Segwise](https://segwise.ai/blog/best-ad-creative-analysis-tools-2026) · [GetCrux hook tools](https://www.getcrux.ai/blog/video-ad-hook-analysis-tools) · [Meta video view fields](https://www.get-ryze.ai/blog/meta-marketing-api-ads-insights-video-3-second-views-5-second-views-field)
