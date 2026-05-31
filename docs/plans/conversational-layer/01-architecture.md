# 01 · Architecture & Build Principles

> **Conversational Layer PRD** · split 31.5.2026 · [↩ index](README.md) · source §§4–6, 10, 12, 15, 16(partial), 18, 20

## Decision (locked): build the brain natively
Option A — build natively in this repo, on our stack, using the **Claude Agent SDK**.

### The `generic_agent` relationship — copy the BLUEPRINT, not the ENGINE
| `generic_agent` | Campaigner (us) |
|---|---|
| FastAPI + LangGraph | Claude Agent SDK |
| MongoDB + Qdrant | Postgres only |
| Grok + Gemini | Anthropic Claude |
| website-visitor Q&A | campaign management |
| 18 hardcoded website CTAs | our existing ~60 campaign tools |

**Take (patterns):** intent-classifier pattern · parallel context-gathering · conversation/memory schema shape · external-prompt discipline.
**Drop:** its code · its datastores · its LLMs · its Abilities/CTA system.

**Why not import its code:** drags Mongo + Qdrant + a 2nd LLM provider into a Postgres + Claude system, and its brain is tuned for the wrong domain. Net cost ≫ net value.

**Why native + Agent SDK:** repo is already "Claude Code Native" → SDK gives multi-turn, tool-use, streaming, context compaction out of the box. The ~60 CLI tools emit clean JSON → wrap trivially. Shared Postgres, shared Claude creds, one deployment.

## ⚠️ Transport decision (blocks Phase 1)
Next.js (Node) must reach the Python orchestrator (Claude) for streaming chat:
- **(a) Thin in-repo ASGI endpoint over SSE — recommended.** Small Python app packaged with the campaigner backend, sharing Postgres/Claude/tools. One extra container, not a separate product.
- **(b) Per-turn subprocess.** Next.js invokes the orchestrator per turn (like cron's `claude -p`), rehydrating state from Postgres. Simpler, no streaming, cold-start latency.

> PRD assumes **(a)**; all specs are transport-agnostic. **Eng-lead must decide before Phase 1.**

## Build principles (non-negotiable) ⚙️🧠
1. **⚙️ Deterministic stays deterministic.** LLM reasons + communicates; never *decides* a hard limit. Guardrails, `thresholds.yaml`, two-gate evaluation, and `check_guardrails` remain code-enforced. A proposal the agent "feels good about" still dies if `check_guardrails` fails.
2. **🚫 No resurrected rules.** Nothing from [CAMPAIGN_EVALUATION.md §8](../../CAMPAIGN_EVALUATION.md) (deprecated pre-Andromeda rules) may reappear — in prompts, drafts, or advice. Persona imports this list as a hard "never."
3. **🪙 Token efficiency:** model tiering (**Haiku** for intent/classification; **Opus** only for strategic reasoning + draft composition) · context compaction (rolling summary) + memory-relevance filtering · prompt caching for stable system prompt + knowledge files · lazy tool calls.
4. **🎯 Answer quality:** grounded in live tool output — no hallucinated metrics (`check_data_sufficiency`); guardrail §27 (no unsourced competitive claims) holds; artifacts validated against schemas before render.
5. **🔒 HITL is absolute.** The conversation may *propose*; it never *executes*. Execution stays in Flow B.

## Target architecture
```
Next.js Web (existing) — NEW: /workspace conversation UI
        │ SSE  POST /conversation/turn
Conversation Endpoint (NEW · thin ASGI · in-repo)
   1. load history + relevant strategic memory (Postgres)
   2. parallel: Intent Engine (Haiku) ∥ business-context fetch ∥ recommendation ledger
   3. 🧠 Orchestrator (Claude Agent SDK · Opus)
        tools = wrappers over existing campaigner/tools/*
        + Creative Intelligence · Draft Composer · dedup/novelty
        → propose_task → writes to `approvals`  (proposal ONLY)
   4. persist turn + artifacts + memory/ledger updates (Postgres)
        │  proposals only — NEVER direct Meta writes
EXISTING · UNCHANGED:
   approvals → Flow B execute_task → ⚙️ guardrails recheck → MetaClient → agent_decisions log
```

### The four layers (mental model)
**Operator surface** (Workspace, action cards, drafts, sidebar, timeline, approvals, push) → **Conversational Layer** (NEW, this PRD) → **The Brain** (existing CAMPAIGNER protocol, guardrails, two-gate, ~60 tools, cron Flows A–H) → **Execution** (existing, unchanged: approvals → Flow B → MetaClient).

> Brain = engine · cron = autopilot · conversational layer = operator's seat in the cockpit · execution = wheels. Chat and cron coexist — chat doesn't replace cron. **An operator can use Campaigner with no chat at all and get full value from the proposals queue.** Chat is opt-in depth.

**Single most important property:** every new layer **reads from and writes to existing structures**. Nothing in the existing brain is rewritten.

### One turn (5–10s)
Operator types → **Intent Engine (Haiku)** classifies → **parallel context fetch** (~500ms: recent decisions, strategic memory, ledger, live insights, pattern recognizer) → **Orchestrator (Opus)** reasons, calls extra tools if needed, composes Hebrew response + action card → optional **draft/proposal** to `approvals` (cleared by `check_guardrails`, linked via `related_approval_ids`) → **stream response (SSE)** + log decision + update memory/ledger.

## Existing tools as agent tools (§10)
Orchestrator **calls existing tools**; never reimplements domain logic. Wrap each as an Agent SDK tool (shell out, or import `main()` in-process for speed) returning the tool's JSON. Contract preserved per [campaigner/tools/CLAUDE.md](../../../campaigner/tools/CLAUDE.md).

- **Phase 1 (read/diagnose only — no execution exposed to chat):** `load_business_knowledge · load_baselines · fetch_insights · fetch_meta_state · fetch_lead_quality_summary · compute_quality_adjusted_kpi · compute_monthly_pace · route_pacing_action · list_active_creatives · list_audiences · list_ab_tests · load_feedback_history · load_recent_actions_outcomes · check_data_sufficiency · check_account_health · check_creative_fatigue`
- **Phase 2+:** `compose_campaign_draft · propose_task / propose_audience (proposal only) · generate_creative · analyze_creative`

## Patterns borrowed from `generic_agent` (§12)
| Pattern | ✔ Take | ✖ Change/drop |
|---|---|---|
| Intent classifier | LLM-based, conversation-aware, external prompt, fast model | Haiku (not Gemini); campaign intents |
| Conversation/message schema | shape + rolling summary | Postgres (not Mongo); business-scoped; artifacts column |
| Parallel context gathering | fetch intent + memory + context concurrently | our tools/memory (not Qdrant) |
| External prompt discipline | all prompts in markdown | under `campaigner/prompts/conversation/` |
| User memory | persistent preference profile | reframed as **operator** memory, evidence-linked |
| Orchestration order | guardrails → context → generate → post-process | Agent SDK session (not LangGraph) |
| Abilities/CTA system | — | ✖ dropped (wrong domain) |
| Datastores / LLMs | — | ✖ no Mongo, no Qdrant, no Grok/Gemini-for-chat |

## Observability & safety (§15 — reuse, don't rebuild)
- **Every turn** → ≥1 `agent_decisions` row (`graph_name='conversation'`, `node_name` ∈ intent|orchestrate|draft|propose) via `log_decision.py`.
- **Proposals** → same `check_guardrails` as today; chat cannot bypass.
- **No Meta writes** from the layer — only `approvals`; Flow B re-checks before any Meta call.
- **Cost:** Opus orchestration is the main new cost driver — track `token_usage`/turn, set per-conversation/day budget, degrade to Haiku for non-reasoning turns. Model the delta vs the ~$25/mo/business baseline before launch.
- **Semantic recall** deliberately omitted (no vector DB). If needed later, add **`pgvector` to Postgres** — never reintroduce Qdrant.

## Risks & open questions ⚠️ (§18)
1. **Transport (a vs b)** — eng-lead decision before Phase 1.
2. **Tool latency** — ~60 CLI tools per turn could be slow; consider in-process `main()` or a long-lived tool worker. Benchmark in P1.
3. **Dedup placement** — recommend pulling into P1.
4. **Context/cost** — long conversations + memory + tool outputs can blow budget → compaction + relevance filtering required.
5. **Chat vs cron collisions** — shared ledger is the mitigation; wire by P3 at latest.
6. **Video analysis cost** — cache analyses; re-run only on changed assets.
7. **Persona vs guardrails tension** — persona must subordinate to guardrails; adversarial-test.

## First concrete steps for the implementer (§20)
1. ⚠️ Decide transport.
2. Write migrations `033`–`037` ([02](02-data-model.md)).
3. Scaffold `campaigner/conversation/` + `campaigner/prompts/conversation/`.
4. Wrap Phase-1 read tools as Agent SDK tools; benchmark latency.
5. Build `/workspace` chat against the SSE endpoint; log every turn.
6. Ship Phase 1 behind a feature flag; dogfood on the **test ad account** before enabling any draft/proposal capability.
