-- 024_gallery_meta_backfill.sql
-- Phase 4 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
-- §7). The `backfill_gallery_from_meta` tool registers existing Meta ad
-- creatives into the local `creative_gallery` so the agent's gallery view
-- reflects everything that's running, not just assets it generated. The
-- existing `generated_by` CHECK only allowed imagen / gemini / manual_upload —
-- this widens it to include `meta_backfill` so we can surface where each row
-- came from in the UI.

BEGIN;

ALTER TABLE creative_gallery
  DROP CONSTRAINT IF EXISTS creative_gallery_generated_by_check;

ALTER TABLE creative_gallery
  ADD CONSTRAINT creative_gallery_generated_by_check
  CHECK (
    generated_by = ANY (
      ARRAY['imagen', 'gemini', 'manual_upload', 'meta_backfill']
    )
  );

COMMIT;
