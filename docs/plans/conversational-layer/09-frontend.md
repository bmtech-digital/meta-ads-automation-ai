# 09 · Frontend (Next.js)

> **Conversational Layer PRD** · split 31.5.2026 · [↩ index](README.md) · source §11 · **Phase 1–3**

New, plugs into existing dual-mode adapters. **RTL Hebrew · server components by default · `"use client"` only for the chat stream.** Conventions per [web/src/app/CLAUDE.md](../../../web/src/app/CLAUDE.md) and [web/src/components/CLAUDE.md](../../../web/src/components/CLAUDE.md).

## Surfaces
| Area | Route / component | Phase |
|---|---|:--:|
| **Conversation Workspace** (primary) | `app/workspace/page.tsx` + `workspace-chat.tsx` (SSE) | 1 |
| **Strategic Action Cards** | `components/action-card.tsx` — Build Campaign / Improve Lead Quality / Fix Fatigue / Fill Calendar / Push WhatsApp / Retargeting / Premium. Each shows *why · expected impact · urgency · confidence · required approvals* | 1–2 |
| **Campaign Draft Preview** | `app/workspace/draft/[id]/page.tsx` — renders `campaign_drafts.structure` as a proposal; "Approve → queue" packages to `approvals` | 2 |
| **Business Context Sidebar** | `components/business-context-sidebar.tsx` — top/weak services · strongest audience · lead-quality trend · seasonal alerts · recent rejected strategies · monthly goals · bottlenecks | 3 |
| **Learning Timeline** | `app/learning/page.tsx` — what the AI learned / changed / improved / failed (reads `strategic_memory` + `recommendation_ledger` + `agent_decisions`) — critical for trust | 3 |

## New web API routes (thin proxies)
`POST /api/conversation/turn` (SSE) · `GET /api/conversation/[id]` · `GET /api/conversation/list` · `GET /api/drafts/[id]` · `POST /api/drafts/[id]/promote` · `GET /api/strategic-memory` · `GET /api/learning-timeline`.

> These proxy to the Python conversation endpoint (transport decision, [01 §4.3](01-architecture.md)). The frontend is a **pure presentation layer** — it reads existing tables and writes proposals through the existing `approvals` path; the brain doesn't know it exists.
