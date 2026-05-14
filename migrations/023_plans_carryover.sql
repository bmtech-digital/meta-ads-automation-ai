-- 023_plans_carryover.sql
-- Hard cross-run plan memory (2026-05-13 PM, "junior → consultant" final step).
--
-- Until now, the forward-looking `תוכנית: 2-3 steps` written into every
-- proposal's rationale (per hebrew-copy-style §11 rule 6) survived between
-- runs only by regex over the rationale text. That worked, but it was brittle:
-- if the rationale format drifted, the plan vaporized. There was also no
-- explicit lifecycle — "this step is pending / triggered / superseded" —
-- so the agent couldn't tell live commitments from dead ones.
--
-- This migration adds `plans_carryover` — one row per forward step. When an
-- approval is approved (web action) or executed (Flow B), the agent's helper
-- `lib/plans.persist_from_approval()` extracts the תוכנית block from the
-- approval's rationale and inserts one row per forward step. Future runs
-- query this table directly; the regex fallback in `load_active_plans.py`
-- and the §39 context fetch remain for backwards-compat on pre-migration rows.
--
-- Status lifecycle:
--   pending    — initial state. Trigger condition not yet evaluated this run.
--   triggered  — the agent decided the trigger condition is met (proposed
--                the step). Done — no further action on this row.
--   superseded — the agent decided the plan is no longer relevant (situation
--                changed materially). Done — no further action.
--   expired    — older than `expires_at` without being triggered or
--                superseded. Periodic cleanup marks these (default TTL: 21 days
--                to mirror the load_active_plans look-back).

BEGIN;

CREATE TABLE IF NOT EXISTS plans_carryover (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  -- The proposal whose תוכנית block this step came from. ON DELETE SET NULL
  -- so historical plans survive if their parent approval is purged.
  source_approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
  -- The target the plan applies to. Mirrors approvals.target_kind / target_id
  -- so §39 can look up by target.
  target_kind text CHECK (target_kind IN ('campaign', 'adset', 'ad', 'creative', 'account')),
  target_id text,
  -- The plan step itself.
  step_order int NOT NULL CHECK (step_order >= 2),     -- step 1 is "current action" (already done); only 2+ are forward-looking
  action_text text NOT NULL,                            -- the Hebrew step description (e.g., "אם הניצול עלה ל-80% — להציע scale_up")
  trigger_condition text,                               -- best-effort extract of the "if ..." clause for human reading
  -- Lifecycle.
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'triggered', 'superseded', 'expired')
  ),
  committed_at timestamptz NOT NULL DEFAULT now(),
  triggered_at timestamptz,
  triggered_by_approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
  superseded_at timestamptz,
  superseded_reason text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '21 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Hot query path: "give me pending steps for this campaign that haven't expired."
-- §39 _respect_active_plans + load_active_plans both hit this.
CREATE INDEX IF NOT EXISTS plans_carryover_active_idx
  ON plans_carryover (business_id, target_id, status, expires_at)
  WHERE status = 'pending';

-- Audit path: "show me everything we've ever committed to on this target."
CREATE INDEX IF NOT EXISTS plans_carryover_target_history_idx
  ON plans_carryover (business_id, target_id, committed_at DESC);

-- Mark expired plans without touching the lifecycle of others. Run from a
-- nightly cron (or inline before queries — the WHERE clauses below all use
-- expires_at, so an unexpired-but-old row is auto-treated as pending).
COMMENT ON COLUMN plans_carryover.expires_at IS
  'After this point the row is treated as expired even if status is still pending. '
  'A nightly cron can set status=expired to make the state explicit.';

COMMIT;
