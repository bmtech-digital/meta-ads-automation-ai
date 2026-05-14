-- 003_baselines.sql
-- Rolling metrics baselines per scope x window (7/14/30-day reactive per spec §6.2).
-- Source: spec §10.3.

CREATE TABLE baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('account','campaign','adset')),
  scope_id text,
  metric text NOT NULL,
  value numeric NOT NULL,
  window_days int NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX baselines_lookup_idx
  ON baselines (business_id, scope, scope_id, metric);

ALTER TABLE baselines ENABLE ROW LEVEL SECURITY;
