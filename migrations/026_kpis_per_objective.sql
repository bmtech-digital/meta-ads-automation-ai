-- 026_kpis_per_objective.sql
-- Phase 5 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md §8).
-- A business can run campaigns under multiple Meta objectives simultaneously
-- (Aiweon today: OUTCOME_LEADS + OUTCOME_ENGAGEMENT messaging). Each objective
-- produces a DIFFERENT KPI signal — CPL for lead forms, cost-per-message for
-- engagement, ROAS for sales. The current `target_cpl_ils` / `target_cpa_ils` /
-- `target_roas` columns model ONE KPI per business, which misses 50% of the
-- spend on messaging campaigns.
--
-- This migration adds a per-objective KPI map as jsonb so the agent can
-- evaluate each campaign against the objective-appropriate target.
--
-- Shape:
--   {
--     "OUTCOME_LEADS": { "primary_kpi": "cpl", "target": 50, "currency": "ILS" },
--     "OUTCOME_ENGAGEMENT": { "primary_kpi": "cost_per_message", "target": 15, "currency": "ILS" },
--     "OUTCOME_SALES": { "primary_kpi": "roas", "target": 3.0, "currency": null }
--   }
--
-- Lookup order at evaluation time (best → fallback):
--   1. product.kpi_target  (if the campaign matches a product per §T-2)
--   2. business.kpis_per_objective[<objective>]  ← THIS migration
--   3. business.target_<kpi>_ils  (legacy)
--   4. cpl-infrastructure band  (vertical-level fallback)

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS kpis_per_objective jsonb;

COMMENT ON COLUMN businesses.kpis_per_objective IS
  'Per-Meta-objective KPI targets. Shape: '
  '{<OBJECTIVE>: {primary_kpi: str, target: number, currency: str|null}, ...}. '
  'See migration 026 + docs/plans/campaigner-mastery-plan.md §8. '
  'Read at evaluation time after product.kpi_target, before business.target_*.';

COMMIT;
