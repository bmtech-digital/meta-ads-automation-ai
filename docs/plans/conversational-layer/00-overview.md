# 00 · Overview — Problem, Vision, Scope

> **Conversational Layer PRD** · split 31.5.2026 · [↩ index](README.md) · source §§0–3, 13, 19

## TL;DR
Campaigner today is a **stateless, cron-driven recommendation engine**: it observes Meta, proposes, exits. It never talks, never remembers, and its proposals are generic and passive.

This PRD adds a **conversational intelligence layer on top of the existing system** — `talk → diagnose → strategize → draft → approve → execute → learn`.

**Locked decisions:**
- Built natively in this repo on **Postgres + Anthropic Claude + Claude Agent SDK**. We copy the *blueprint* (patterns) from `generic_agent`, not its code/stack.
- The existing system is **NOT rewritten**. Flows A–H, guardrails, the `approvals` HITL queue, `execute_task`, and Meta integration stay as-is. The new layer sits *above* them and feeds the **same** approval/execution path.
- **Deterministic stays deterministic.** LLM reasons and communicates; ⚙️ guardrails/thresholds/evaluation math still decide hard limits.
- **New brain capability:** image + video creative analysis, built in-stack (Gemini/Vertex + Claude vision).

## The problem (operator pains → fix)
| Operator pain | Root cause | Fixed in |
|---|---|---|
| Suggestions too **generic** | stateless single-shot, no memory | [04](04-conversation-engine.md) |
| **Rarely suggests boosting a post** | `boost_post` exists ✅ but underused | [06](06-drafts-proposals.md) + [07](07-creative-intelligence.md) |
| **Doesn't drive action** | reports metrics instead of deciding | persona [04](04-conversation-engine.md) + cards [09](09-frontend.md) |
| **Communication too weak for feedback** | no conversational channel | [04](04-conversation-engine.md) + [06](06-drafts-proposals.md) |
| Wants **add/improve/remove** understood | no multi-turn coherent plan | [06](06-drafts-proposals.md) |
| Can't analyze **creatives/videos** | ❌ no content analysis | [07](07-creative-intelligence.md) |

## Vision
From `Metrics → Recommendation` (passive, generic, one-shot) to `Conversation → Diagnosis → Strategy → Draft → Approval → Execution → Learning` (proactive, specific, remembers, drives action). The operator should be able to say *"אני צריך יותר לידים איכותיים באשדוד"* and get a strategist's answer grounded in live data.

## What exists today (build on, don't duplicate)
✅ 8 cron Flows A–H · HITL approvals (`pending→approved→executed`) · 36 ⚙️ guardrails · Meta integration · creative generation (Imagen) + gallery · `boost_post` · lead-quality grading · A/B + pacing router · decision logging · Next.js web (~20 routes) · ~60 CLI tools (uniform JSON).

❌ Missing (this PRD adds): conversation/messages · intent engine · strategic memory · multi-turn loop + agent "voice" · recommendation dedup · creative content analysis.

🔁 **Reuse, don't rebuild** the cross-run memory that already exists: `load_feedback_history`, `load_recent_actions_outcomes`, `load_active_plans`, `business_knowledge.monthly_brief`.

## Phased roadmap (§13)
| Phase | Delivers | Meta execution? |
|:--:|---|:--:|
| **1** | Deep first scan ([03](03-onboarding-scan.md)) · Workspace · orchestrator (read tools) · intent engine · conversations/messages · streaming UI · behavioral upgrade · logging | ❌ none |
| **2** | Draft composer · `campaign_drafts` · draft preview · promote→approval · proposal lifecycle | via existing Flow B, test acct, PAUSED |
| **3** | Strategic memory · dedup ledger · context sidebar · learning timeline · wire cron→ledger | — |
| **4** | Creative & video intelligence | — |
| **5** | Lead-quality / CRM outcome loop | — |

> ⚠️ **Recommendation:** pull the dedup ledger forward into Phase 1 — "stops repeating itself" is the operator's #1 pain and cheap to stand up.

**Per-phase acceptance criteria:**
- **P1:** multi-turn Hebrew strategist on *live* data; intents classified + stored; ambiguity → clarifying question; **no Meta writes**; every turn logs a decision row + token usage; responses specific & action-driving.
- **P2:** *"more leads for balloon walls in Ashdod"* → complete guardrail-valid draft → promote → identical-shape `approvals` row → executes on test account (`act_202495959`) PAUSED.
- **P3:** a fact stated once is recalled in a later separate conversation; agent does not repeat within cooldown; timeline + sidebar reflect reality.
- **P4:** agent characterizes image + video content and uses it in drafts + boost-post selection.
- **P5:** agent connects lead-quality outcomes to concrete strategy changes.

## Out of scope (§19)
Replacing Flows A–H / guardrails / `approvals` / `execute_task` / Meta integration · any new datastore (Mongo/Qdrant) or chat-LLM (Grok/Gemini) · importing `generic_agent` code · autonomous execution / removing HITL.
