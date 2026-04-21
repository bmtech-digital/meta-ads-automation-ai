-- 010_seasonal_hints_and_pace.sql
-- Budget as first-class managed resource — per decisions-log §1.10 (2026-04-21):
-- adds manual seasonal windows that multiply monthly_budget_ils during pace
-- and demand-driven-raise computations. confidence='user_stated' only in MVP;
-- v2 War Chest will add confidence='learned' rows at the same shape.
--
-- Shape:
--   {
--     "windows": [
--       {"name": "<free text>", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD",
--        "multiplier": <number>, "confidence": "user_stated"}
--     ]
--   }
-- Empty {} means no active windows → multiplier 1.0 year-round.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS seasonal_hints jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Sanity check: top-level must be an object (not array or scalar). Keeps
-- the agent's seasonal.py helper from having to defend against bad shapes.
ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_seasonal_hints_shape_check;
ALTER TABLE businesses
  ADD CONSTRAINT businesses_seasonal_hints_shape_check
  CHECK (jsonb_typeof(seasonal_hints) = 'object');

COMMIT;
