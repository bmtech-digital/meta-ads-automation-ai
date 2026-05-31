# Conversational Layer PRD — split index

> **Split: 31.5.2026** · Source of truth: [../conversational-layer-prd.md](../conversational-layer-prd.md) (kept intact)
> **Status:** Draft for review → approval by 2nd developer → build
> **Must obey:** [campaigner-spec.md](../campaigner-spec.md) · [CAMPAIGN_EVALUATION.md](../../CAMPAIGN_EVALUATION.md) · [CAMPAIGN_BUILDING_RECOMMENDATIONS.md](../../CAMPAIGN_BUILDING_RECOMMENDATIONS.md)

The original PRD is one large document. It is split here into focused, per-domain files so work can be **scoped, approved, and divided** independently. Each file maps back to numbered sections in the source.

## The split

| # | File | Domain | Source §§ | Phase |
|---|---|---|---|:--:|
| 00 | [overview.md](00-overview.md) | Problem, vision, what exists today, roadmap, scope | 0–3, 13, 19 | — |
| 01 | [architecture.md](01-architecture.md) | Architecture decision, build principles, target arch, transport, tools-as-tools, observability | 4–6, 10, 12, 15, 18, 20 | — |
| 02 | [data-model.md](02-data-model.md) | Postgres migrations `033`–`040` + DDL | 7 | 1–5 |
| 03 | [onboarding-scan.md](03-onboarding-scan.md) | Deep First Scan, multi-source crawl, persona derivation | 8.0, 8.0.1 | 1 |
| 04 | [conversation-engine.md](04-conversation-engine.md) | Orchestrator, intent engine, strategic memory, dedup, persona | 8.1–8.4, 14 | 1, 3 |
| 05 | [calibration-budget.md](05-calibration-budget.md) | Budget-reality calibrator, age/pattern monitoring, audience-fit, micro-tier | 8.0.2–8.0.5, 17.4, 17.10 | 1–3 |
| 06 | [drafts-proposals.md](06-drafts-proposals.md) | Draft composer, proposal lifecycle, behavioral upgrade | 8.5, 8.6, 9 | 2 |
| 07 | [creative-intelligence.md](07-creative-intelligence.md) | Image/video content analysis, gallery learning loop, build-vs-buy | 8.7, 16 | 4 |
| 08 | [leads-crm-whatsapp.md](08-leads-crm-whatsapp.md) | Lead-outcome loop, CRM webhook, WhatsApp conversation intelligence | 8.8, 8.8.1 | 5 |
| 09 | [frontend.md](09-frontend.md) | Workspace chat, action cards, draft preview, sidebar, timeline, API routes | 11 | 1–3 |
| 10 | [elevators-postmvp.md](10-elevators-postmvp.md) | Closed-loop learning, multi-client SaaS, cross-user learning, notifications, SDK features, deferred wins | 17.1–17.3, 17.5–17.9 | post-MVP |

## How to read

| Icon | Meaning |
|---|---|
| ✅ | Already exists in the codebase |
| ❌ | Missing today — this PRD adds it |
| ⭐ | Direct answer to an operator pain-point |
| ⚙️ | Deterministic / code-enforced (never an LLM judgment call) |
| 🧠 | LLM / agentic reasoning |
| ⚠️ | Decision or risk the developer must resolve |

## Open decisions blocking Phase 1 (see [01-architecture.md](01-architecture.md) §18)
1. ⚠️ **Transport** — thin in-repo ASGI/SSE (recommended) vs per-turn subprocess.
2. ⚠️ **Dedup ledger** — recommend pulling forward into Phase 1 (operator's #1 pain).
3. ⚠️ **Tool latency** — shell-out vs in-process `main()`; benchmark in P1.
