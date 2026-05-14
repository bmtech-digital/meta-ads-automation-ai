-- 024_meta_audiences_service_tag.sql
-- Block 13 follow-up (2026-05-13): per-service audience attribution.
--
-- Flow E (CAMPAIGNER.md) proposes audiences from /business-knowledge service
-- cards. Each proposal carries `payload.service_tag` (= the service name from
-- business_knowledge.products). When execute_task creates the audience on
-- Meta, we stamp `service_tag` onto the meta_audiences row so:
--   (1) `list_audiences --service-tag <name>` returns audiences scoped to
--       that service — feeds §T_AUD's "for this service" filter,
--   (2) /audiences UI shows which service each audience belongs to,
--   (3) future "redeploy creative for service X" lanes can pick the right
--       audience without name-matching heuristics.
--
-- Synced audiences (created manually in Meta Ads Manager) have service_tag
-- NULL — we don't try to back-infer from the audience name. Operator can
-- assign manually via the UI (deferred to Phase 2).

BEGIN;

ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS service_tag text;

CREATE INDEX IF NOT EXISTS meta_audiences_service_tag
  ON meta_audiences(business_id, service_tag)
  WHERE archived_at IS NULL AND service_tag IS NOT NULL;

COMMENT ON COLUMN meta_audiences.service_tag IS
  'The business_knowledge.products[].name this audience was created for. '
  'Set by execute_task when an audience approval carries payload.service_tag. '
  'NULL for audiences synced from Meta (created manually). Preserved across '
  're-syncs — sync_audiences.py never overwrites it.';

COMMIT;
