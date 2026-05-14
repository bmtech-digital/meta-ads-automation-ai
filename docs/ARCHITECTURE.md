# Architecture

> **Living document.** Every meaningful architectural change updates this file. The full technical spec is [`plans/campaigner-spec.md`](plans/campaigner-spec.md) (heavyweight, ~118KB) — this doc is the **map**; the spec is the **terrain**.
>
> When something here drifts from the code, fix the doc — same PR — or it stops being trustworthy.

## The 30-second pitch

Campaigner is a **stateless cron-driven agent** that proposes Meta Ads optimizations and executes only after human approval. It reads campaign performance from Meta, evaluates it against a two-gate model, queues proposals to Postgres, and waits. A human approves; another cron run picks up the approved row and calls Meta.

Three flows. One business (Aiweon, MVP). Hebrew rationale, English ops summaries. ~$25/mo per business.

## The big picture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CLOUD SCHEDULER (GKE CronJobs)                        │
│  daily_observe (09:00 IL) · execute (every 15m) · weekly_creative (Mon 10) │
└──────────────────────┬──────────────────────────────────────────────────────┘
                       │ shells to
                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     runners/*.sh  (the entrypoint contract)                 │
│  - validate env  →  heartbeat start  →  trap on ERR  →  claude -p  →  end  │
└──────────────────────┬──────────────────────────────────────────────────────┘
                       │ invokes Claude headless
                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  Claude Code CLI (claude -p, Anthropic API)                 │
│            Reads: campaigner/CAMPAIGNER.md + prompts/*.md (5 files)         │
│            Calls: campaigner/tools/*.py via Bash                            │
└──────────────────────┬──────────────────────────────────────────────────────┘
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
  ┌──────────────┐ ┌────────┐ ┌──────────────────┐
  │ Observation  │ │ Logic  │ │   Mutations      │
  │ (read-only)  │ │ (pure) │ │ (write to        │
  │              │ │        │ │  Postgres + Meta)│
  │ fetch_       │ │ check_ │ │ propose_task,    │
  │  insights,   │ │  data_ │ │ log_decision,    │
  │ load_        │ │  suff, │ │ heartbeat,       │
  │  baselines,  │ │ check_ │ │ execute_task,    │
  │ list_*       │ │  guard │ │ generate_creative│
  └──────┬───────┘ └────┬───┘ └─────────┬────────┘
         │              │               │
         └──────────────┼───────────────┘
                        ▼
              ┌──────────────────┐         ┌─────────────┐
              │   Postgres       │         │   Meta      │
              │   (Supabase)     │         │ Marketing   │
              │                  │         │    API      │
              │  approvals       │         └─────────────┘
              │  agent_decisions │         ┌─────────────┐
              │  baselines       │         │  Vertex AI  │
              │  business_*      │◄────────│   Imagen    │
              │  creative_       │         │ (creatives) │
              │   gallery        │         └─────────────┘
              │  heartbeats      │
              └────────▲─────────┘
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
  ┌──────────────────┐   ┌────────────────────┐
  │ campaigner CLI   │   │  web/  (Next.js)   │
  │  (terminal)      │   │  Hebrew RTL UI     │
  │                  │   │  - approvals queue │
  │  list, approve,  │   │  - decision viewer │
  │  reject, inspect │   │  - business profile│
  └──────────────────┘   │  - creative gallery│
                         └────────────────────┘
              ▲
              │ approves a row
              │
        Human reviewer (Roi / operators)
```

## Three flows

| | Flow A — Observe-Propose | Flow B — Execute | Flow C — Creative Firehose |
|---|---|---|---|
| **Schedule** | 09:00 IL daily | every 15 min | Mon 10:00 IL |
| **Trigger** | Cron | Cron | Cron |
| **Reads** | Meta insights, baselines, business_knowledge | `approvals` rows where `status='approved'` | Active campaigns + creative gallery |
| **Writes** | `agent_decisions`, `approvals` (pending) | Meta API + `approvals` (executed/failed) | `approvals` (pending: `task_type=new_creative`) |
| **Touches Meta?** | **No.** Read-only Insights API. | **Yes** — the only flow that mutates Meta. | No. Generates locally; queues for human approval. |
| **Human in loop?** | After: human reviews queued proposals | Re-checks guardrails, then executes | After: human reviews creatives + ad copy |

The HITL invariant: **Flow A and Flow C never touch Meta. Flow B is the only door.**

## Two-gate evaluation model

The agent decides "is this campaign good enough?" using two gates, applied in order. Source of truth: [`CAMPAIGN_EVALUATION.md`](CAMPAIGN_EVALUATION.md).

| Gate | Signal | What it tests | When to apply |
|---|---|---|---|
| **Gate 1 — Leading** | hook rate, CTR, ad-level | Is the creative working? | First 7 days of every new ad |
| **Gate 2 — Lagging** | CPA, ROAS, Creative Fatigue flag | Is the campaign producing results? | Only after Learning is done (≥7 days, ≥50 events) |

Gate 1 says "kill the creative." Gate 2 says "scale or pause the campaign." Mixing them is the most common bug; the [`prompts/decision-tree.md`](../campaigner/prompts/decision-tree.md) keeps them separate.

## Data model (key tables)

Full schema: [`migrations/`](../migrations/). Spec: [`plans/campaigner-spec.md` §10](plans/campaigner-spec.md#10).

| Table | Purpose | Written by |
|---|---|---|
| `businesses` | Tenant record (MVP: Aiweon only) | manual seed |
| `business_knowledge` | Profile + questionnaire (objectives, audience, brand voice) | web UI / seed |
| `baselines` | Rolling metric baselines per scope × window | Flow A (observation) |
| `approvals` | **The HITL queue.** Every proposal lands here as `status='pending'`. | Flow A, Flow C |
| `agent_decisions` | Observability. Every agent step writes ≥1 row. | All flows |
| `creative_gallery` | Generated creatives + Meta creative IDs | Flow C, Flow B |
| `heartbeats` | Cron liveness. Failure detector reads this. | All runners |

**RLS (Row-Level Security)** is enabled at table-creation time per [spec §10.7](plans/campaigner-spec.md). The agent uses `service_role` (bypasses RLS); the web UI uses `authenticated` policies (added when Supabase comes online).

## Repository layout

The repo is a **monorepo** with three deployable services:

| Service | Path | Image | Deployment | What it does |
|---|---|---|---|---|
| **agent** | `campaigner/` + `runners/` + `migrations/` + `scripts/` | `campaigner-agent` | 3 GKE CronJobs | The three flows above |
| **web** | `web/` | `campaigner-web` | GKE Deployment + Ingress | Hebrew dashboard for approvals + business profile |
| **webhook** | `webhook/` | `campaigner-webhook` | GKE Deployment | Lead Ads → Trello receiver (narrow-scope, NOT the agent) |

Per-folder agent-facing context lives in `*/CLAUDE.md`. See the [navigation map](../CLAUDE.md#-per-folder-navigation-claudemd-in-every-working-directory) in root `CLAUDE.md`.

## Why each architectural choice

| Choice | Reason |
|---|---|
| **Claude Code Native (no LangGraph)** | MVP simplicity. Three cron entrypoints + headless `claude -p` is enough for one business. v2 (LangGraph + Gemini) is deferred until a second account joins. |
| **Stateless cron, not a daemon** | No process to babysit. Each invocation is independent: read → decide → write → exit. State lives in Postgres + Meta. |
| **Two-stage HITL (propose → approve → execute)** | Andromeda's auto-optimizations are powerful and irreversible. Human approval is the safety net that lets the agent be aggressive without burning money. |
| **Hebrew rationale, English summary** | Operators read rationales (Hebrew = Aiweon team's first language). Cron logs are tailed by ops/CI (English = standard). |
| **Dual-mode adapter (web)** | The remote DB target was undecided when the web scaffold landed. `WEB_DB_MODE=local-postgres\|supabase` lets us flip when the §1.4 decision lands without code rewrite. |
| **Single-SDK ownership in `campaigner/lib/`** | `facebook-business` is imported only in `meta_client.py`; `google-genai` only in `creative.py`; `psycopg` only in `db.py`. Tools call the lib; the lib owns the SDK. Reduces blast radius of SDK bugs/upgrades. |
| **GKE shared with `generic_agent`** | Same cluster (`generic-agent-cluster`), same registry. One bemtech-internal cluster, multi-tenanted by namespace. `campaigner` namespace is ours. |
| **Supabase as remote target** | Decided 2026-04-20 (`fudqwgrdgzteamtnydbt`). Local dev runs Postgres in Docker; remote will run Supabase. Same SQL, different connection string. |

## What's in v2 (deferred)

Triggered when a **second ad account** is added to the system. Separate doc to be written: [`plans/langgraph-v2-migration.md`](plans/langgraph-v2-migration.md) (does not exist yet).

- LangGraph orchestration replacing the headless-Claude cron pattern.
- Gemini + Claude routing per node (cheaper for routine observation).
- Multi-tenant business switching in the agent (today: hardcoded `BUSINESS_ID` env var).
- Cross-business baselines + benchmarks.

The MVP tooling (`campaigner/tools/`, `lib/`, the schema) is reused; only the orchestration layer changes.

## Where to read next

| What you want | Read |
|---|---|
| Onboard as a new contributor | [`ONBOARDING.md`](ONBOARDING.md) |
| Hard rules + non-negotiables | [`../CLAUDE.md`](../CLAUDE.md) |
| Agent personality + diagnostic method | [`PERSONALITY.md`](PERSONALITY.md) |
| Two-gate evaluation philosophy | [`CAMPAIGN_EVALUATION.md`](CAMPAIGN_EVALUATION.md) |
| Campaign-building best practices (2026) | [`CAMPAIGN_BUILDING_RECOMMENDATIONS.md`](CAMPAIGN_BUILDING_RECOMMENDATIONS.md) |
| Full technical spec (heavy) | [`plans/campaigner-spec.md`](plans/campaigner-spec.md) |
| What's actively being built | [`plans/cheeky-seeking-blossom.md`](plans/cheeky-seeking-blossom.md) |
| Decision history | [`plans/decisions-log.md`](plans/decisions-log.md) |
| Per-folder agent context | the `CLAUDE.md` in that folder |

## How to update this file

When you change architecture meaningfully — a new flow, a new table, a service split, a tech-stack swap — update:

1. **The diagram** at the top, if the boxes change.
2. **The flow table**, if a flow's purpose / schedule / inputs / outputs change.
3. **The data model table**, if a table is added/removed/renamed.
4. **The repository layout table**, if a service is added/removed.
5. **"Why each architectural choice"**, if the reasoning behind a load-bearing choice has shifted.

If the change is large, also link to the deeper doc that explains it — don't try to fit a 50-line rationale here. The point of this file is to be a **map**, not the territory.
