-- 033_observation_blocked_and_finding_key.sql
--
-- Capability-gated decision flow (docs/todos/capability-gated-decision-flow.md):
--
--   1. Add a new agent_decisions.decision_type: 'observation_blocked'. Semantics:
--      "I diagnosed something. The capability needed to act is blocked. Here's
--      the finding anyway." Distinct from 'skip' (no work happened) and from
--      'rejection' (an actual proposal was rejected at guardrail time).
--
--   2. Add approvals.finding_key — a stable identifier for the (finding_type,
--      target) pair a proposal addresses. Dedup at propose_task switches from
--      vibe-matching ("any pending alert covers this business") to structural
--      matching ("this exact finding already has a pending approval"). Lets
--      onboarding_incomplete + objective_mismatch + set_monthly_budget +
--      staged_scale_up coexist in the queue instead of colliding.
--
-- Both changes are additive — existing rows backfill cleanly (decision_type
-- is unchanged; finding_key is nullable). No data migration needed.

BEGIN;

-- ---- agent_decisions.decision_type — add 'observation_blocked' --------------
-- The existing CHECK constraint is anonymous; drop it by name from a lookup
-- and recreate with the new value included.
ALTER TABLE agent_decisions
  DROP CONSTRAINT IF EXISTS agent_decisions_decision_type_check;

ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_decision_type_check
  CHECK (decision_type IN (
    'observation',
    'observation_blocked',
    'diagnosis',
    'proposal',
    'rejection',
    'skip',
    'execution',
    'error'
  ));

COMMENT ON COLUMN agent_decisions.decision_type IS
  'Kind of decision. observation_blocked added 2026-05-25 (Migration 033): the agent identified a finding but the capability required to propose an action is blocked. The diagnosis is surfaced; the action is not taken. Carries outputs.finding_type + outputs.blocked_by + outputs.would_propose so the UI can show "ready when you unblock me."';

-- ---- approvals.finding_key --------------------------------------------------
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS finding_key text;

COMMENT ON COLUMN approvals.finding_key IS
  'Stable identifier for the (finding_type, target) pair this proposal addresses. Used by propose_task for structural dedup — a pending row with the same finding_key blocks a duplicate insert. Typical shape: "<finding_type>:<target_id_or_business>". NULL on legacy rows (pre-Migration 033) — dedup falls through to the historical (business_id, task_type, target_id) check when finding_key is absent.';

-- Hot lookup path: "is there already a pending approval for this finding?"
CREATE INDEX IF NOT EXISTS approvals_finding_key_pending_idx
  ON approvals (business_id, finding_key)
  WHERE status = 'pending' AND finding_key IS NOT NULL;

COMMIT;
