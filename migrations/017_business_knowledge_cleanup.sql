-- 017_business_knowledge_cleanup.sql
-- Documents the UX restructuring of /settings and /business-knowledge:
--
--   1. `businesses.name` and `businesses.monthly_budget_ils` are now edited
--      from /business-knowledge (the "My Business" page) instead of /settings.
--      No schema change — the columns stay on `businesses` because the Python
--      agent reads them via lib/db.py.
--
--   2. `business_knowledge.strong_seasons` and `business_knowledge.weak_seasons`
--      are deprecated. The structured `businesses.seasonal_hints.windows`
--      array (added in migration 010) replaces them — same intent ("when is
--      this business strong/weak") with the added precision of date ranges
--      and multipliers. The columns are kept so existing rows don't lose
--      data, and the Python agent that reads them today keeps working — the
--      web UI just stops collecting them.
--
--   3. `businesses.meta_ad_account_id` and `meta_page_id` are no longer
--      free-text editable from /settings. They're populated from OAuth-
--      discovered assets via /integrations.
--
-- Nothing schema-level changes here — this migration exists to (a) keep the
-- migration ledger honest after a wave of UI restructuring, and (b) document
-- the deprecations in column comments where the Python agent can see them.

BEGIN;

COMMENT ON COLUMN business_knowledge.strong_seasons IS
  'DEPRECATED (migration 017). UI no longer collects this — use businesses.seasonal_hints.windows with multiplier > 1.0 for structured strong-season windows. Column kept for historical data and backward compat with any Python tool that still reads it.';

COMMENT ON COLUMN business_knowledge.weak_seasons IS
  'DEPRECATED (migration 017). UI no longer collects this — use businesses.seasonal_hints.windows with multiplier < 1.0 for structured weak-season windows. Column kept for historical data.';

COMMENT ON COLUMN businesses.name IS
  'Operator-facing display name of the business (appears in the nav switcher + page titles). Edited from /business-knowledge as of migration 017 — used to be on /settings.';

COMMENT ON COLUMN businesses.monthly_budget_ils IS
  'Monthly ad budget ceiling in ILS. Read by the agent''s pace monitor. Edited from /business-knowledge as of migration 017 — used to be on /settings.';

COMMIT;
