-- 005_agent_decisions.sql
-- Observability substrate. Every agent phase writes >=1 row. Retention: 90 days.
-- Source: spec §10.5 + §12.

CREATE TABLE agent_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  graph_name text NOT NULL,
  node_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  decision_type text NOT NULL CHECK (decision_type IN (
    'observation',
    'diagnosis',
    'proposal',
    'rejection',
    'skip',
    'execution',
    'error'
  )),

  summary text NOT NULL,
  rationale text,

  inputs jsonb,
  outputs jsonb,

  related_approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
  campaign_id text,
  adset_id text,
  ad_id text,

  llm_model text,
  llm_tokens_in int,
  llm_tokens_out int,
  latency_ms int,

  guardrail_violations text[],
  confidence real
);

CREATE INDEX agent_decisions_time_idx
  ON agent_decisions (business_id, created_at DESC);

CREATE INDEX agent_decisions_run_idx
  ON agent_decisions (run_id);

CREATE INDEX agent_decisions_approval_idx
  ON agent_decisions (related_approval_id)
  WHERE related_approval_id IS NOT NULL;

CREATE INDEX agent_decisions_type_idx
  ON agent_decisions (decision_type);

ALTER TABLE agent_decisions ENABLE ROW LEVEL SECURITY;
