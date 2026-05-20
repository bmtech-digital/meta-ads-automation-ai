-- 032_plans_structured_trigger.sql
-- Structured trigger fields on plans_carryover (PRD step 5).
--
-- Migration 023 added `plans_carryover` with Hebrew prose fields:
-- `action_text` (the step description in Hebrew) and `trigger_condition`
-- (a best-effort regex extract of the "if X — Y" clause). That works for
-- human readback but it's untestable — the agent can't programmatically
-- evaluate "אם הניצול עלה ל-95%". This migration adds parallel structured
-- columns the agent populates directly via `propose_task --plan`, so a
-- future run can match the trigger against live signals without parsing.
--
-- PRD §5 names the fields: metric, operator, threshold-by-name,
-- sustained-days, proposed_action payload, owning-flow. All NULLable —
-- existing rows from `lib.plans.persist_from_approval()` keep working
-- with their prose-only columns; new rows from `propose_task --plan`
-- populate the structured columns alongside the same Hebrew action_text
-- (which the operator still reads in the UI).
--
-- The `trigger_threshold_name` column references config/thresholds.yaml
-- by dotted name (e.g. `gate_2.winner_ratio`) — Step 3's source of
-- truth. `trigger_threshold_value` is the denormalized snapshot of the
-- literal at commit time; if the YAML name later renames, the snapshot
-- keeps the historical trigger interpretable.
--
-- See lib/plans.py:create_structured_row and tools/propose_task.py:--plan.

BEGIN;

ALTER TABLE plans_carryover
  ADD COLUMN IF NOT EXISTS trigger_metric text,
  ADD COLUMN IF NOT EXISTS trigger_operator text,
  ADD COLUMN IF NOT EXISTS trigger_threshold_name text,
  ADD COLUMN IF NOT EXISTS trigger_threshold_value numeric,
  ADD COLUMN IF NOT EXISTS trigger_sustained_days int,
  ADD COLUMN IF NOT EXISTS proposed_action_payload jsonb,
  ADD COLUMN IF NOT EXISTS proposed_action_task_type text,
  ADD COLUMN IF NOT EXISTS owning_flow text;

-- Operator allow-list. A NULL operator means this row's trigger is
-- prose-only (legacy `persist_from_approval` rows); a non-NULL operator
-- must be one of the comparison forms the agent can evaluate.
ALTER TABLE plans_carryover
  DROP CONSTRAINT IF EXISTS plans_carryover_trigger_operator_check;
ALTER TABLE plans_carryover
  ADD CONSTRAINT plans_carryover_trigger_operator_check
  CHECK (
    trigger_operator IS NULL
    OR trigger_operator IN ('>', '>=', '<', '<=', '==', '!=')
  );

-- A "structured" row is one with both a metric and operator. The agent
-- prefers this surface; load_active_plans.py and §39 fall back to
-- action_text when structured fields are NULL.
COMMENT ON COLUMN plans_carryover.trigger_metric IS
  'Signal the plan watches (e.g. utilization_7d, cpa, cpl). NULL for legacy prose-only rows.';
COMMENT ON COLUMN plans_carryover.trigger_operator IS
  'Comparison operator the agent evaluates against (one of >, >=, <, <=, ==, !=). NULL for prose-only.';
COMMENT ON COLUMN plans_carryover.trigger_threshold_name IS
  'Dotted name into config/thresholds.yaml (e.g. gate_2.winner_ratio). NULL for prose-only or for triggers using an absolute value (e.g. 30-day expiry).';
COMMENT ON COLUMN plans_carryover.trigger_threshold_value IS
  'Snapshot of the literal threshold value at commit time. Survives YAML renames so historical triggers stay interpretable.';
COMMENT ON COLUMN plans_carryover.trigger_sustained_days IS
  'Number of consecutive days the comparison must hold before the trigger fires. NULL means single-day signal.';
COMMENT ON COLUMN plans_carryover.proposed_action_payload IS
  'JSON object {task_type, payload, target_kind, target_id} — the shape the agent would pass to propose_task when this plan fires.';
COMMENT ON COLUMN plans_carryover.proposed_action_task_type IS
  'Denormalized task_type from proposed_action_payload for cheap filtering ("show me all pending scale_up plans"). NULL for prose-only.';
COMMENT ON COLUMN plans_carryover.owning_flow IS
  'Which cron flow committed the plan (e.g. daily_observe_propose). Helps an audit: "Flow A committed N plans last week — how many fired?".';

-- Hot query path for "show me structured plans whose trigger metric is X".
-- Partial index — only pending rows with a structured trigger.
CREATE INDEX IF NOT EXISTS plans_carryover_structured_active_idx
  ON plans_carryover (business_id, trigger_metric, status)
  WHERE status = 'pending' AND trigger_metric IS NOT NULL;

COMMIT;
