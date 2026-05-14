-- 020_monthly_brief.sql
-- M2 — Monthly Brief layer (decision-map.md Tier 1).
--
-- Adds the operator-set monthly context that PERSONALITY.md non-negotiable #4
-- requires the agent to read before any structural proposal ("Ask the business
-- intent before recommending an objective, optimization goal, bid strategy,
-- or budget change"). Without it, the agent recommends from technical signals
-- alone — correct-on-paper, business-blind in practice.
--
-- Schema (jsonb):
--   {
--     "month":                  "YYYY-MM",         -- auto on save; agent ignores brief when month != current
--     "active_offer":           "...",             -- what's running this month (sale, launch, campaign theme)
--     "deadline_date":          "YYYY-MM-DD",      -- optional — when the offer / launch / push ends
--     "hands_off_campaign_ids": ["123", "456"],    -- campaigns the operator does NOT want touched
--     "notes":                  "..."              -- free-form context the agent should weave in
--   }
--
-- Reader contract: `load_business_knowledge.py` includes this block in its
-- `business` output. The agent quotes it back in every structural proposal's
-- rationale ("בהתאם לבריף החודשי: [active_offer]...") so the operator can see
-- the agent absorbed the intent.
--
-- Guardrail integration: `respect_hands_off` (guardrails.md §26, added in
-- this same change) blocks any proposal that targets a campaign listed in
-- `hands_off_campaign_ids`.
--
-- Source: decision-map.md M2 + cheeky-seeking-blossom.md §M2 + PERSONALITY.md
-- non-negotiable #4. Researched build: 2026-05-12.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS monthly_brief jsonb;

COMMENT ON COLUMN businesses.monthly_brief IS
  'Operator-set monthly intent. Shape: {month: YYYY-MM, active_offer: text, deadline_date: YYYY-MM-DD?, hands_off_campaign_ids: [text], notes: text}. NULL = not set, agent has no monthly context. Stale (month != current month) = agent flags brief as expired in rationale and asks operator to refresh.';

COMMIT;
