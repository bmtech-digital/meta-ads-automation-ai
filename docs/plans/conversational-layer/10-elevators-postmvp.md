# 10 · Strategic Elevators (post-MVP)

> **Conversational Layer PRD** · split 31.5.2026 · [↩ index](README.md) · source §§17.1–17.3, 17.5–17.9
> **Each elevator is independently shippable.** Ordered by leverage. (§17.4 Calibrator and §17.10 rigidity audit live in [05-calibration-budget.md](05-calibration-budget.md).)

## 17.1 🔥 Closed-loop eval & learning — rule-based → learning-based
**Gap:** outcomes are measured (`load_recent_actions_outcomes.py`) but nothing self-scores or tunes from them.
**How:** Anthropic's **Planner → Generator → Evaluator** pattern. An **Evaluator subagent** scores every proposal vs its real outcome → writes `decision_type='proposal_review'` → nudges threshold *confidence* within guardrails (⚙️ never overrides). After N reviews, reports per-action-class success rates.
**Reuse:** Agent SDK subagents + memory tool + online eval hooks. New tool: `evaluate_proposal_quality.py` (~200 lines).
**Why:** moves Campaigner from a template engine to a **learning optimizer**.

## 17.2 🔥 Multi-client → SaaS evolution
Two phases, same architecture (build once, pays twice):
- **Phase A — Aiweon-internal multi-client (MVP):** RLS on every business-scoped table + business switcher in `/integrations`. For the agency team to safely run multiple client accounts.
- **Phase B — open self-registration (future):** users sign up independently; the agent replaces their existing campaign manager. Lift `generic_agent`'s billing/auth/subscription/quota stack as-is. Conversation, draft composer, calibrator, CRM loop already operate per-business — no rearchitecture.
- **Why same elevator unlocks both:** RLS + per-business context (A) is exactly the isolation B requires.
**Reuse:** multi-tenant pattern from `generic_agent` (User → Business → Agent) as reference. A skips billing/widget; B lifts it.

## 17.3 🔥 Cross-user learning — the strategic moat
**Operator question:** *"Can we learn from other users?"* — yes, and it compounds with every registered user.
**How:** anonymized aggregation layer — materialized view `cross_client_benchmarks` (migration `040`) computes across all accounts: winning creative angles by vertical/geo, CPL/CPA bands per sub-vertical, audience archetypes that close vs don't, seasonal patterns, calibrator validation data. Orchestrator reads as **context**: *"across 14 carpenters in central Israel at similar budget, boost_post-heavy on family-warm angles outperforms paid-only 3:1."*
**Privacy:** Phase A min 3 accounts/cohort; **Phase B min 5 + no cross-vertical leak + differential noise on tail metrics.** Never row-level, only aggregates. Respects RLS (§17.2).
**Reuse:** existing tables (`agent_decisions` · `leads` · `lead_outcomes` · `creative_intelligence`). New: 1 matview + `recall_cross_client_benchmarks` tool + Phase-B privacy guard.
**Value curve:** marginal at 1 account · real at 5 · **transformative at 50+** — the asset competitors can't shortcut.

## 17.5 Creative closed-loop (winner → next brief)
**Gap:** `evaluate_ab_test` picks winners; nothing feeds back into `generate_creative`.
**How:** `compose_creative_brief_from_winner.py` distils winning angle/tone/visuals from `ab_tests.decision_snapshot` → `--prior_winners` to `generate_creative`. After 3–4 cycles creatives tune vertically. Aligns to Meta Advantage+ Creative incentives.
**Reuse:** A/B infra is complete; only the bridge tool is new.

## 17.6 Proactive notifications (WhatsApp)
**Gap:** no push channel — failures discovered hours later; cron/token issues silent.
**How:** notifications gateway pushes critical alerts (cron failure · token expiring · CPL spike · creative fatigue · ledger escalations) to operator WhatsApp/email.
**Reuse:** `generic_agent`'s Maytapi WhatsApp client (`backend/services/whatsapp/`) — adopt as a tool. (Also powers [08 §8.8.1](08-leads-crm-whatsapp.md) transport.)

## 17.7 Agent SDK 2026 features (architectural)
- **Subagents** — parallelize per-campaign diagnosis (today sequential) → faster Workspace responses.
- **Memory tool** — native persistent memory (complements `strategic_memory`).
- **Online eval hooks** — catch drift / prompt-injection / hallucinated tool use in production. **Wire from day one — cheap now, expensive later.**
- ⚠️ **Cost note:** from **2026-06-15** Agent SDK usage on subscription plans draws from a **separate monthly Agent SDK credit** — model into the [01 §15](01-architecture.md) token budget.

## 17.8 Reuse-from-`generic_agent` (process savings)
- **ARQ + APScheduler** (background queue + cron) → powers the deep first scan ([03](03-onboarding-scan.md)) + nightly syncs. Don't build a job runner from scratch.
- **Firecrawl + extraction pipeline** → powers [§8.0.1 onboarding](03-onboarding-scan.md). Swap prompts, keep plumbing.
- **PromptLoader + LLM abstraction** → version-controlled prompts, runtime substitution.
- **MCP framework** → can host a Meta MCP provider (wraps Meta API as MCP tools — future-proof).
- **Design system + i18n** → Workspace UI baseline (Hebrew RTL already solved).

## 17.9 Finish deferred features (low effort, high ROI)
- **`kpis_per_objective` (migration 026)** — read+use it. Fixes the silent failure where engagement campaigns score against the wrong KPI (~100 lines).
- **`approval_mcq` (migration 027)** — agent asks *"1/2/3?"* inline; operator picks instead of rejecting+retyping. **Direct fix for the "feedback channel is bad" pain.**
- **Token rotation + alert** — single 60-day Meta token = SPOF. Alert at T-7 days + auto-rotate path.
- **Idempotency lock** — unique constraint on `(run_id, node_name)` in `agent_decisions` to prevent duplicate decisions on cron retries.

---

### Appendix — sources for creative/video analysis ([07](07-creative-intelligence.md))
- Google — [Gemini 2.5 video understanding](https://ai.google.dev/gemini-api/docs/video-understanding) · [blog](https://developers.googleblog.com/en/gemini-2-5-video-understanding/)
- Industry tool surveys (2026): [Segwise](https://segwise.ai/blog/best-ad-creative-analysis-tools-2026) · [GetCrux hook tools](https://www.getcrux.ai/blog/video-ad-hook-analysis-tools) · [Meta video view fields](https://www.get-ryze.ai/blog/meta-marketing-api-ads-insights-video-3-second-views-5-second-views-field)
