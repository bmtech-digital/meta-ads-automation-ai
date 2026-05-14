-- 008_schema_additions.sql
-- Adds fields that backend + frontend PRDs reference but earlier migrations didn't carry.
-- Each addition is traced to a specific PRD line or guardrail that needs it.
--
-- 1. businesses.meta_access_token_expires_at       -> structured token-expiry tracking
--    (replaces parsing free-text from agent_decisions.summary after `campaigner rotate-token`).
--    Frontend PRD "Token-expiry warning" AC + backend PRD `rotate-token` CLI spec.
-- 2. business_knowledge.tracking_verified + tracking_* fields -> Day-Zero pre-flight guardrail
--    (`verify_tracking_infrastructure`). Frontend PRD "tracking section" AC.
-- 3. baselines.low_confidence                      -> backend PRD Phase 1: baselines seeded
--    with <30d history get low_confidence=true; agent escalates per EVALUATION §9 #1.
-- 4. approvals.approved_by_override                -> soft-guardrail override path
--    (backend PRD AC 'Guardrails split: hard vs soft', frontend 'Approve with override').
-- 5. approvals.guardrail_override_required         -> generated column that mirrors
--    payload.guardrail_override_required=true, so queries/realtime filters don't have to
--    dig into JSONB. Set by propose_task at insert time.

-- 1. token expiry
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS meta_access_token_expires_at timestamptz;

COMMENT ON COLUMN businesses.meta_access_token_expires_at IS
  'When the current meta_access_token expires. NULL for system_user_token mode (no expiry). Set by campaigner rotate-token after debug_token validation.';

-- 2. tracking-infrastructure verification (Day-Zero checklist / CAMPAIGN_BUILDING §7)
ALTER TABLE business_knowledge
  ADD COLUMN IF NOT EXISTS tracking_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracking_pixel_id text,
  ADD COLUMN IF NOT EXISTS tracking_capi_configured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracking_aem_priority_events jsonb,
  ADD COLUMN IF NOT EXISTS tracking_domain_verified text;

COMMENT ON COLUMN business_knowledge.tracking_verified IS
  'True only when Pixel + CAPI (deduplicated) + AEM priority events + domain verification are all green. Day-Zero guardrail verify_tracking_infrastructure reads this; new_campaign proposals are blocked when false.';

-- 3. baseline confidence flag
ALTER TABLE baselines
  ADD COLUMN IF NOT EXISTS low_confidence boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN baselines.low_confidence IS
  'Set true when the baseline is computed from <30 days of history (cold-start per CAMPAIGN_EVALUATION §9 #1). Agent flags proposals derived from low-confidence baselines with requires_human_review=true.';

-- 4 + 5. approvals: override path + generated flag
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS approved_by_override jsonb;

COMMENT ON COLUMN approvals.approved_by_override IS
  'Non-null when the operator approved despite a soft-guardrail violation. Shape: {"rule": "<name>", "reason": "<text>", "overridden_by": "<email>"}. Hard guardrails cannot be overridden and never populate this field.';

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS guardrail_override_required boolean
    GENERATED ALWAYS AS (
      COALESCE((payload->>'guardrail_override_required')::boolean, false)
    ) STORED;

COMMENT ON COLUMN approvals.guardrail_override_required IS
  'Mirrors payload.guardrail_override_required for fast queries + Supabase Realtime filters. Set by propose_task when a soft guardrail is violated; Claude writes the payload flag and names the rule in rationale.';

CREATE INDEX IF NOT EXISTS approvals_override_idx
  ON approvals (business_id, status)
  WHERE guardrail_override_required = true;
