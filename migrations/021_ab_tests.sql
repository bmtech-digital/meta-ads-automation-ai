-- 021_ab_tests.sql
-- A/B test orchestration (Block 11, 2026-05-13).
-- Pure-DB construct: groups N existing Meta creatives by `test_name` with a
-- planned end date and a `winner_metric`. After the window closes, the agent
-- emits an `ab_test_decide` proposal recording the winner. No Meta-side
-- changes — the creatives keep running per Andromeda's normal allocation;
-- the test just adds metadata + a deadline + a decision artifact.
--
-- Two tables to keep the variant list normalized: `ab_test_creatives` is the
-- many-to-many between a test and its participating creatives, with the
-- variant label (A/B/C/D...) preserved for reporting.

BEGIN;

CREATE TABLE IF NOT EXISTS ab_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,        -- Meta campaign id (text in our schema)
  adset_id    text NOT NULL,        -- Meta ad set id (text in our schema)
  test_name   text NOT NULL,        -- operator-readable label, e.g. "אנגלית-vs-עברית-מאי"
  winner_metric text NOT NULL CHECK (
    winner_metric IN ('hook_rate', 'ctr', 'cpa', 'cpl', 'conversions')
  ),
  -- When the test started and when the agent should evaluate it.
  -- Min 7 days enforced at the propose layer (§30 guardrail); migrations
  -- don't constrain so tests can be cancelled early.
  started_at        timestamptz NOT NULL DEFAULT now(),
  planned_end_at    timestamptz NOT NULL,
  -- Lifecycle states.
  status text NOT NULL DEFAULT 'running' CHECK (
    status IN ('running', 'decided', 'cancelled', 'expired')
  ),
  -- Filled when status='decided'. NULL otherwise.
  winner_creative_id text,
  decided_at         timestamptz,
  decision_reason    text,
  -- Aggregated metrics snapshot at decision time (jsonb so we can store
  -- per-creative values without another table). Shape:
  --   {
  --     creatives: [
  --       {variant: 'A', creative_id, hook_rate, ctr, cpa, cpl, conversions,
  --        impressions, spend}
  --     ],
  --     winner: {variant: 'A', metric_value: 0.42, vs_runner_up_pct: 18.3},
  --     confidence: '95pct' | 'directional' | 'insufficient',
  --     evaluated_at: 'ISO'
  --   }
  decision_snapshot jsonb,
  -- Audit fields per other approval-driven tables.
  created_by_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  created_at_audit_placeholder text -- (placeholder, see partial unique index below)
);

-- A single business can have one test per (adset, test_name) running at
-- once; once decided/cancelled/expired a same-named test can re-run.
-- Partial unique index (not EXCLUDE) — avoids needing btree_gist extension.
CREATE UNIQUE INDEX IF NOT EXISTS ab_tests_unique_running_per_adset
  ON ab_tests (business_id, adset_id, test_name)
  WHERE status = 'running';

ALTER TABLE ab_tests DROP COLUMN created_at_audit_placeholder;

CREATE INDEX IF NOT EXISTS ab_tests_business_status_idx
  ON ab_tests (business_id, status, planned_end_at);

CREATE INDEX IF NOT EXISTS ab_tests_ready_to_decide_idx
  ON ab_tests (business_id, planned_end_at)
  WHERE status = 'running';

-- Variant list. Two creatives minimum at the propose layer (§29 guardrail);
-- four is the realistic ceiling for an Andromeda firehose test where
-- per-creative samples need to stay meaningful.
CREATE TABLE IF NOT EXISTS ab_test_creatives (
  test_id     uuid NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  creative_id text NOT NULL,         -- Meta creative id (text)
  variant_label text NOT NULL,       -- 'A', 'B', 'C', 'D'
  -- Gallery row if the creative came through redeploy_creative — lets the
  -- detail page show the source asset without a join through approvals.
  creative_gallery_id uuid REFERENCES creative_gallery(id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (test_id, creative_id),
  CONSTRAINT ab_test_creatives_variant_label_format
    CHECK (variant_label ~ '^[A-Z]$')
);

CREATE INDEX IF NOT EXISTS ab_test_creatives_test_idx
  ON ab_test_creatives (test_id);

ALTER TABLE ab_tests             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_test_creatives    ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ab_tests IS
  'Block 11 (2026-05-13). A/B test metadata. Pure DB construct — does not gate Meta delivery; Meta keeps allocating per Andromeda. The test gives the operator a deadline + a recorded winner.';

COMMIT;
