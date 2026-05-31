# 08 · Lead Quality, CRM Outcome Loop & WhatsApp Intelligence

> **Conversational Layer PRD** · split 31.5.2026 · [↩ index](README.md) · source §§8.8, 8.8.1 · **Phase 5**

## 8.8 🧠 Lead Quality & Outcome Loop (+ CRM)
Strategic layer over `leads` / `lead_quality_grades`, **closed by real downstream outcomes from an external CRM**.

**Why:** today the only quality signal is the operator's manual grade (GOOD/OKAY/SPAM). With a CRM connected, the agent learns *what actually closed* and attributes it back to **campaign → creative → audience → offer** — improving on revenue, not guesses.

**Integration — generic, not vendor-specific** (a contract any CRM implements):
- ⭐ **Identity join key is the crux:** Meta `lead_id` (best), fallback hashed phone/email. Without it, outcomes can't attribute to campaign/creative/audience — attribution is the whole point.
- **CRM → Campaigner (inbound):** CRM pushes outcome events (stage change · won/lost · deal value · no-show · close reason) to an **HMAC-signed webhook `POST /api/crm/webhook`** (reuses the existing [webhook/](../../../webhook/) pattern). Upserts into `lead_outcomes`, matched to `leads` by the identity key.
- **Campaigner → CRM (outbound, optional):** on each new lead, push source attribution (campaign/creative/audience) for closed-loop source data.
- **Config** in the existing `crm_integrations` table (provider · base_url · webhook secret · field mapping · identity key · direction · enabled) — provider-agnostic.

**What the agent does with it:**
- Archetype classification (cheap-bad · expensive-good · no-show · price-shopper · premium-buyer · fast-closer · low-intent · seasonal) grounded in **real** outcomes.
- Extends `compute_quality_adjusted_kpi.py` from CPL → **cost-per-closed · revenue-per-lead · ROAS-on-closed**.
- Feeds targeting / creative angle / offer positioning / WhatsApp flow + `strategic_memory` — where `what_converts` now means **what closes** (e.g. *"audience X is cheap to acquire but never closes — reallocate"*).

**⭐ "One communication":** CRM outcomes surface inside the **Workspace conversation** + the **Learning Timeline** — lead quality, closes, deal value, and resulting strategy shifts in *one place*. The single-pane the operator asked for.

**`039_lead_outcomes.sql`:** `business_id · lead_id (FK leads) · crm_lead_id · stage · status (won|lost|no_show|in_progress) · deal_value_ils · close_reason · occurred_at · raw jsonb`.

---

## 8.8.1 ⭐ WhatsApp Conversation Intelligence — quality signal BEFORE the CRM
> Operator uses `click_to_whatsapp` heavily (the IL B2C default). **The conversation itself is data** — the transcript reveals lead quality long before a CRM marks won/lost. Today the brain sees `lead_count` only.

**What the conversation reveals (without waiting for CRM):**
| Signal | Tells us |
|---|---|
| Time-to-first-reply from user | minutes = warm · days = cold |
| Conversation depth (turns × length) | 1–2 short = low intent · 6+ substantive = qualified |
| Specific questions | *"how much?"* = price-shopper · *"when can you come?"* = buyer · *"references?"* = trust-stage buyer |
| Sentiment | excited / neutral / frustrated / disengaged |
| Completion vs ghosting | did the user respond to the final operator message? |
| Booking/commit language | *"let's do it"* / *"send a quote"* / *"I'll think about it"* / silence |
| Disqualification | *"not in your area"* · *"just checking"* · *"need this next year"* |

**Architecture (in-stack):**
- **Transport:** lift `generic_agent`'s Maytapi WhatsApp client (see [10 §17.6](10-elevators-postmvp.md)) — OR direct WhatsApp Cloud API. Per-operator phone instance.
- **Storage:** `whatsapp_conversations` (one per lead) + `whatsapp_messages` (turns), FK to `leads` (migration `040`, parallel to `cross_client_benchmarks`). Same identity-join as §8.8.
- **Analyzer:** `analyze_whatsapp_conversation.py` — Claude reads the transcript (text only; no media to LLM), returns `{quality_score: 0-100, suggested_grade: GOOD|OKAY|SPAM, intent_signals, booking_likelihood: 0-1, disqualification_flags}`.
- **Auto-grade:** populates a *suggested* grade on `lead_quality_grades`; operator confirms (high confidence = one-click; low = full review). Massively reduces grading workload.
- **Feeds:** `lead_outcomes` (early signal) · `strategic_memory` (what conversations precede closes vs ghosts) · `creative_intelligence` ([07](07-creative-intelligence.md)) — back-map which creatives produced converting vs ghosting conversations.

**Cross-account learning** ([10 §17.3](10-elevators-postmvp.md)): *"Across 14 carpenters: leads who ask 'when can you come?' in turn 2 close at 67%; 'how much?' close at 18%."* Becomes a contextual benchmark for scoring new conversations.

**Privacy & consent:** operator opt-in per business · personal details (phone, address) redacted before LLM analysis (regex pass) · retention configurable, default 90 days then summarize-only · consistent with Meta's WhatsApp Business Policy.

**New tools:** `sync_whatsapp_conversations.py` (Maytapi/Cloud API per business) · `analyze_whatsapp_conversation.py` (Sonnet — high volume, fast) · `suggest_lead_grade_from_chat.py`.

**Why it elevates:** scales quality grading (no manual read of every lead) · faster feedback (hours not weeks) · connects creative → conversation → outcome · differentiator (no mainstream tool reads the post-click conversation).
