-- 002_business_knowledge.sql
-- 1-to-1 with businesses. Structured fields + JSONB for flexibility.
-- Source: spec §10.2.

CREATE TABLE business_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  vertical text,
  website_url text,
  service_regions text[],
  customer_age_min int,
  customer_age_max int,
  products jsonb,
  delivery_time_days int,
  strong_seasons text[],
  weak_seasons text[],

  questionnaire_answers jsonb,
  brand_voice jsonb,
  competitors text[],

  last_refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX business_knowledge_business_id_uidx
  ON business_knowledge (business_id);

ALTER TABLE business_knowledge ENABLE ROW LEVEL SECURITY;
