-- 019_business_targets.sql
-- Adds the *target value* for the business's primary KPI.
--
-- Background. `businesses.primary_kpi` (migration 001) names the *type* of KPI
-- the business optimizes for ('cpa' | 'cpl' | 'roas' | 'cpm' | 'cpi'), but
-- nowhere in the schema does it record what the *target value* is — i.e. "we
-- want CPL ≤ ₪80" or "we want ROAS ≥ 2.5". Every comparison the decision
-- tree makes (`cpa_vs_target`, `cpl_vs_target`, ROAS thresholds) needs that
-- target value to function. Until 2026-05-12 the agent was inferring it from
-- baseline medians, which is a different question entirely ("what is normal?"
-- vs "what is good enough?").
--
-- This migration adds:
--   - target_cpa_ils    (used when primary_kpi='cpa')
--   - target_cpl_ils    (used when primary_kpi='cpl')
--   - target_roas       (used when primary_kpi='roas')
--
-- target_cpm and target_cpi are deferred: CPM is rarely a business goal in
-- itself (it's a delivery diagnostic), and CPI is app-install scope that
-- Aiweon doesn't run today.
--
-- Reader contract. `load_business_knowledge.py` reads these columns into the
-- `business` block of its output. The agent selects which one matters based
-- on `primary_kpi`, and §T0r decision-tree branches that need a target
-- (R6, R8, §T2+ Branch C) use it as the denominator of `<kpi>_vs_target`.
-- If the column is NULL for the business's `primary_kpi`, the agent must
-- emit an `alert` proposal asking the operator to set the target, and SKIP
-- any branch that depends on it — never silently fall back to "baseline as
-- target."
--
-- Source: decision-tree.md §T0r (2026-05-12) + PERSONALITY.md non-negotiable
-- #4 ("Ask the business intent before recommending an objective, optimization
-- goal, bid strategy, or budget change") + research synthesis 2026-05-12.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS target_cpa_ils numeric,
  ADD COLUMN IF NOT EXISTS target_cpl_ils numeric,
  ADD COLUMN IF NOT EXISTS target_roas numeric;

COMMENT ON COLUMN businesses.target_cpa_ils IS
  'Target cost-per-acquisition in ILS, used when primary_kpi=''cpa''. NULL = not set; agent emits alert + skips cpa_vs_target branches. Reference: decision-tree.md §T0r R6/R8, §T2+ Branch C.';

COMMENT ON COLUMN businesses.target_cpl_ils IS
  'Target cost-per-lead in ILS, used when primary_kpi=''cpl''. NULL = not set; agent emits alert + skips cpl_vs_target branches.';

COMMENT ON COLUMN businesses.target_roas IS
  'Target ROAS as a multiplier (e.g. 2.5 means ₪2.50 revenue per ₪1 spend), used when primary_kpi=''roas''. NULL = not set; agent emits alert + skips roas branches.';

-- Sanity constraints. Negative or zero targets are meaningless; ROAS targets
-- below 1.0 mean "I expect to lose money" which we refuse to interpret as a
-- valid goal. These are advisory — operators can set 0 via the UI and the
-- agent will treat that as "not set" — but let the DB catch garbage early.
ALTER TABLE businesses
  ADD CONSTRAINT businesses_target_cpa_positive
    CHECK (target_cpa_ils IS NULL OR target_cpa_ils > 0),
  ADD CONSTRAINT businesses_target_cpl_positive
    CHECK (target_cpl_ils IS NULL OR target_cpl_ils > 0),
  ADD CONSTRAINT businesses_target_roas_at_least_one
    CHECK (target_roas IS NULL OR target_roas >= 1.0);

COMMIT;
