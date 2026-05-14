-- 006_creative_gallery.sql
-- Generated creative assets + Meta creative IDs after upload.
-- Source: spec §10.6.

CREATE TABLE creative_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image','video','copy')),

  storage_url text,
  aspect_ratio text,
  dimensions text,

  headline text,
  primary_text text,
  cta text,

  generated_by text,
  generation_prompt text,
  marketing_angle text,
  placement text,
  meta_creative_id text,
  uploaded_to_meta_at timestamptz,
  performance_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX creative_gallery_time_idx
  ON creative_gallery (business_id, created_at DESC);

ALTER TABLE creative_gallery ENABLE ROW LEVEL SECURITY;
