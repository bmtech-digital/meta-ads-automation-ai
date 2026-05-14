-- 007_heartbeats.sql
-- Cron liveness. Each runner writes at start and at end/error.
-- Frontend computes "3 consecutive failures" alerts from this.
-- Source: spec §10.8 + frontend PRD §141-156.

CREATE TABLE heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  flow text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('start','end','error')),
  ran_at timestamptz NOT NULL DEFAULT now(),
  duration_ms int,
  exit_code int,
  error_message text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX heartbeats_recent_idx
  ON heartbeats (business_id, flow, ran_at DESC);

ALTER TABLE heartbeats ENABLE ROW LEVEL SECURITY;
