-- 023_leads_quality.sql
-- Phase 2 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
-- §5). Lead-quality feedback loop: every Meta Lead Form submission lands here,
-- the operator grades it 1-5, and the agent factors quality into Gate 2.
--
-- The 16.4 lesson (mastery plan §1): cheap-on-Meta CTR/CPM/CPL does NOT mean
-- the campaign produced valuable business. Without this loop the agent picks
-- "winners" by Meta-internal metrics alone — exactly what the 16.4 campaign
-- looked like before Roi paused it for poor lead quality.
--
-- Two tables. `leads` mirrors what Meta knows about each lead. `lead_quality_grades`
-- is the operator-attested overlay. We keep them separate so a re-sync from Meta
-- never overwrites human grading, and so multiple grades over time (e.g. "rated
-- bad at intake, became good customer in month 3") are retained for audit.

BEGIN;

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Meta-side IDs. We carry both lead_id (unique on Meta) AND form_id +
  -- ad_id + adset_id + campaign_id so the per-campaign quality summary
  -- joins fast without re-reading Meta.
  meta_lead_id text NOT NULL,
  meta_form_id text,
  meta_ad_id text,
  meta_adset_id text,
  meta_campaign_id text,
  meta_page_id text,

  -- Lead source kind. Phase 2a populates 'form_lead' only.
  -- Phase 2b (deferred) adds 'message_conversation' for Messenger / IG DM /
  -- WhatsApp threads that started from a click-to-message ad. Schema is
  -- shared so /leads UI shows them in one queue.
  kind text NOT NULL CHECK (kind IN ('form_lead', 'message_conversation')),

  -- Structured Meta fields the operator sees when grading.
  -- `field_data` is Meta's raw question→answer pairs (jsonb of
  -- [{name, values}] arrays). We pull a few common keys out for fast
  -- display + indexing.
  full_name text,
  email text,
  phone text,
  city text,
  field_data jsonb,
  custom_disclaimer_responses jsonb,
  is_organic boolean,
  ad_creative_id text,

  -- Meta-side timestamps.
  meta_created_at timestamptz,

  -- Full Meta export — last-write-wins on each sync.
  meta_raw jsonb,

  -- Local timestamps.
  synced_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,

  UNIQUE (business_id, meta_lead_id)
);

CREATE INDEX IF NOT EXISTS leads_by_campaign
  ON leads(business_id, meta_campaign_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS leads_by_ad
  ON leads(business_id, meta_ad_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS leads_by_created
  ON leads(business_id, meta_created_at DESC);

COMMENT ON TABLE leads IS
  'Mirror of Meta Lead Form submissions per business (Phase 2a). '
  'Phase 2b will also hold message_conversation rows from click-to-message ads. '
  'Synced by sync_leads.py + webhook/app.py once that emits into Postgres.';


CREATE TABLE IF NOT EXISTS lead_quality_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- 1-5 scale. Convention (Hebrew labels in UI):
  --   1 = ספאם / לא רלוונטי בכלל
  --   2 = לא איכותי — לא יסגור
  --   3 = ממוצע — צריך עוד עבודה
  --   4 = איכותי — סבירות סגירה גבוהה
  --   5 = איכותי מאוד — כמעט וודאי יסגור / כבר סגר
  grade smallint NOT NULL CHECK (grade BETWEEN 1 AND 5),

  -- Optional free-text Hebrew explanation. Read by Flow A when surfacing
  -- "why was this lead poor" in alerts.
  note text,

  -- Whether the lead converted to a closed deal / paying customer.
  -- Operator can mark this anytime; it's the strongest signal for
  -- quality-adjusted CPL ratios.
  converted boolean,
  converted_value_ils numeric(12, 2),
  conversion_marked_at timestamptz,

  -- Operator email (from auth session) for accountability + multi-operator
  -- workflows. NULL allowed for backfills / system-marked grades.
  graded_by text,
  graded_at timestamptz NOT NULL DEFAULT now(),

  -- Multiple grades per lead allowed — latest by `graded_at` wins for
  -- quality-adjusted KPI math, but the history is preserved.
  UNIQUE (lead_id, graded_at)
);

CREATE INDEX IF NOT EXISTS lead_quality_by_business_time
  ON lead_quality_grades(business_id, graded_at DESC);

COMMENT ON TABLE lead_quality_grades IS
  'Operator-attested quality grading of leads (Phase 2). Drives the '
  'quality_adjusted_cpl that Gate 2 winners must meet (guardrail §39). '
  'History-preserving: multiple grades per lead allowed.';


-- View: latest grade per lead. Quality summaries read from this view so
-- they don't need to do window-function gymnastics each time.
CREATE OR REPLACE VIEW lead_latest_grade AS
SELECT DISTINCT ON (lead_id)
  lead_id,
  business_id,
  grade,
  note,
  converted,
  converted_value_ils,
  graded_by,
  graded_at
FROM lead_quality_grades
ORDER BY lead_id, graded_at DESC;

COMMENT ON VIEW lead_latest_grade IS
  'Latest quality grade per lead. Inputs into compute_quality_adjusted_kpi.';

COMMIT;
