-- 004_approvals.sql
-- HITL queue. State machine: pending -> approved -> executed | rejected | expired | failed.
-- 'dry_run' status added for Phase 4 dry-run mode per PRD §166.
-- Source: spec §10.4 + PRD amendment.

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_run_id uuid NOT NULL,

  task_type text NOT NULL,
  target_kind text CHECK (target_kind IN ('campaign','adset','ad','creative','account')),
  target_id text,
  payload jsonb NOT NULL,
  rationale text NOT NULL,
  expected_impact jsonb,
  urgency text CHECK (urgency IN ('low','medium','high','urgent')) DEFAULT 'medium',

  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','approved','rejected','executed','failed','expired','dry_run'
  )),
  approved_at timestamptz,
  approved_by text,
  rejection_reason text,

  executed_at timestamptz,
  execution_result jsonb,
  expires_at timestamptz
);

CREATE INDEX approvals_queue_idx
  ON approvals (business_id, status, created_at DESC);

CREATE INDEX approvals_run_idx
  ON approvals (created_by_run_id);

ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
