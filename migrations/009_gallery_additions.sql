-- 009_gallery_additions.sql
-- Additions to creative_gallery per decisions-log §1.9 (2026-04-20):
-- user-uploaded assets (manual_upload), service_tag for multi-service
-- portfolio awareness, soft-delete for gallery UI.
-- Also widens approvals enums that the gallery-driven proposals need.

BEGIN;

-- Service tag (e.g. "web-dev", "ai-consult") — optional, for multi-service
-- structure awareness when the agent selects assets for a new_campaign.
ALTER TABLE creative_gallery
  ADD COLUMN IF NOT EXISTS service_tag text;

-- Soft delete: gallery UI hides these; execution paths that still reference
-- an asset live in Meta keep working until explicit hard-delete.
ALTER TABLE creative_gallery
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Tighten generated_by now that manual_upload is a first-class source.
ALTER TABLE creative_gallery
  DROP CONSTRAINT IF EXISTS creative_gallery_generated_by_check;
ALTER TABLE creative_gallery
  ADD CONSTRAINT creative_gallery_generated_by_check
  CHECK (generated_by IN ('imagen', 'gemini', 'manual_upload'));

-- Bytes + mime_type + original filename — needed for UI preview sizing,
-- re-upload to Meta, and audit. Spec §10.6 implies these via "image/video
-- with dimensions"; migration 006 only had dimensions (WxH string).
ALTER TABLE creative_gallery
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS size_bytes bigint,
  ADD COLUMN IF NOT EXISTS original_filename text,
  ADD COLUMN IF NOT EXISTS duration_seconds numeric;

-- Index for the gallery list query (most recent non-deleted first).
CREATE INDEX IF NOT EXISTS creative_gallery_live_idx
  ON creative_gallery (business_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Enum widenings referenced by §1.9 (approvals.task_type 'alert',
-- approvals.status 'acknowledged'). The task_type column is free-form text
-- today; these are no-ops schema-wise but documented here as the contract.
-- If approvals gains a CHECK on task_type/status in a later migration, those
-- CHECKs must include 'alert' / 'acknowledged'.

COMMIT;
