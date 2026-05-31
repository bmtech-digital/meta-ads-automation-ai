# 04 · Conversation Engine — Orchestrator, Intent, Memory, Dedup, Persona

> **Conversational Layer PRD** · split 31.5.2026 · [↩ index](README.md) · source §§8.1–8.4, 14 · **Phase 1 + 3**

## 8.1 🧠 Conversation Orchestrator — *Phase 1*
`campaigner/conversation/orchestrator.py`
- Multi-turn Claude Agent SDK session (**Opus**).
- System prompt = operator persona (§14 below) + obligations to guardrails/evaluation docs.
- Per-turn context: rolling summary + last N turns · classified intent · business context · relevant `strategic_memory` · open `recommendation_ledger`.
- Tools = existing CLI tools ([01 §10](01-architecture.md)) + new (`compose_campaign_draft`, `record_strategic_memory`, `check_recommendation_novelty`, `analyze_creative`).
- Output = assistant text **+** structured `artifacts` (action cards, draft refs), persisted on the message.
- **Boundary:** may write `approvals`; ⚙️ never calls `MetaClient`.

## 8.2 🧠 Intent Engine — *Phase 1*
`campaigner/conversation/intent.py` + prompt `campaigner/prompts/conversation/intent-classification.md`
- **Haiku**, runs before orchestration. Output: `{primary_intent, secondary_intent?, confidence, reasoning, needs_clarification}`.
- Taxonomy lives in the prompt file (easy to extend):
  `low_leads · low_quality_leads · expensive_leads · weak_offer · weak_creative · no_bookings · new_service_launch · geo_expansion · seasonal_campaign · whatsapp_push · retargeting_needed · local_visibility_problem · trust_problem · premium_positioning · emergency_fill_calendar · increase_average_order_value` + `smalltalk · status_query · unknown`.
- Intent **routes** which tools the orchestrator reaches for first (e.g. `low_quality_leads` → `fetch_lead_quality_summary` + `compute_quality_adjusted_kpi`).

## 8.3 🧠 Strategic (operator) Memory — *Phase 3 (schema in P1)*
`campaigner/conversation/memory.py` + tools `record_strategic_memory.py`, `recall_strategic_memory.py`. Table: `035 strategic_memory` ([02](02-data-model.md)).
- **Write:** orchestrator records durable facts; upsert by `(kind,key)` → reinforce (count++/confidence↑), never duplicate.
- **Read:** return most relevant/confident facts for the current intent.
- **Decay:** `expires_at` for seasonal/transient; Flow F prunes + decays stale confidence.
- Flows A/F may **read** it to enrich proposals; only the conversation + explicit operator actions **write** it (clean provenance).

## 8.4 ⭐ Recommendation Dedup / Novelty — *Phase 3 (recommend pull to P1)*
`campaigner/conversation/dedup.py` + tool `check_recommendation_novelty.py`. Table: `036 recommendation_ledger` ([02](02-data-model.md)).
> **This is the direct fix for "it keeps repeating itself" — the operator's #1 pain.**
- Fingerprint = stable hash of `(intent, action_class, target_kind, target_id)`; look up the ledger:
  - **New** → record + surface.
  - **Seen, in cooldown** → don't repeat verbatim → **escalate** ("I've raised this twice; here's the cost of waiting…"), stay silent, or re-justify only on new evidence.
  - **Seen, rejected** → respect prior rejection (mirror guardrail §37); re-raise only if materially different — and say how.
- **The cron Flows write to the same ledger** so chat and cron never repeat each other. (Wire by P3 at latest — see [01 §18](01-architecture.md) risk #5.)

## 14 · Operator persona & prompt design
`campaigner/prompts/conversation/operator-persona.md` (system) + `intent-classification.md`
- **Voice:** proactive · strategic · commercially aware · confident · initiative-driven — a senior campaign manager, not a metrics reporter.
- ⭐ **Per-business parameterization:** the [§8.0.1 deep scan](03-onboarding-scan.md) derives this business's voice register / formality / positioning / assertiveness and injects them — the persona **adapts its character to each business** (a premium wedding brand and a budget local service should not sound identical) while staying subordinate to guardrails.
- ❌ *"CTR dropped below threshold."*
- ✅ *"הקמפיין עדיין מושך תשומת לב, אבל אנשים כבר לא מתחברים רגשית להצעה. עדיף לרענן את הזווית הקריאטיבית במקום להגדיל תקציב."*
- ⚙️ **Subordinate to guardrails:** a "confident operator" must **never** talk the operator past a gate. Obeys `hebrew-copy-style.md`, guardrails §34/§41, the two-gate model, and the [§8 deprecated-rules "never" list](../../CAMPAIGN_EVALUATION.md). **Test with adversarial prompts** (see [01 §18](01-architecture.md) risk #7).
- **Honesty contract** ("don't sell illusions"; every CPL quoted with band + confidence) is codified here and specified in [05 §8.0.2 / §17.10](05-calibration-budget.md).
