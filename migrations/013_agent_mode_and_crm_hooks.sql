-- 013_agent_mode_and_crm_hooks.sql
-- Per decisions-log §1.12 — three small additions.
--
-- 1. businesses.agent_mode — three-mode state machine (insight|draft|action).
--    Default 'draft' because that's the HITL invariant per root CLAUDE.md
--    ("agent proposes, human approves"). Transitions enforced at the app
--    layer in web/src/lib/agent-mode.ts (separate change).
--
-- 2. approvals.external_crm_ref jsonb — hook for external CRM (decision #1).
--    Lets a future CRM module attach without altering Campaigner's schema.
--
-- 3. creative_gallery.external_crm_ref jsonb — same hook on gallery rows.
--    A gallery asset is the kind of object a CRM might want to reference
--    ("attached this image to deal X" / "approved this video for client Y").

BEGIN;

-- 1. agent_mode state machine on businesses.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS agent_mode text NOT NULL DEFAULT 'draft'
    CHECK (agent_mode IN ('insight','draft','action'));

COMMENT ON COLUMN businesses.agent_mode IS
  'Three-mode agent state machine (decisions-log §1.12). insight=read+suggest only, draft=writes to approvals, action=executes after approval. Default draft preserves HITL invariant. Transitions enforced at app layer (insight→draft auto after 7d, draft→action requires ≥3 approved proposals in last 30d).';

-- 2. CRM hook on approvals.
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS external_crm_ref jsonb;

COMMENT ON COLUMN approvals.external_crm_ref IS
  'CRM attachment hook (decisions-log §1.12 #1). Shape TBD by downstream CRM. Null until a CRM module is wired. Lets an approval reference a deal, contact, or campaign in an external system without schema churn.';

-- 3. CRM hook on creative gallery.
ALTER TABLE creative_gallery
  ADD COLUMN IF NOT EXISTS external_crm_ref jsonb;

COMMENT ON COLUMN creative_gallery.external_crm_ref IS
  'CRM attachment hook (decisions-log §1.12 #1). Same shape and purpose as approvals.external_crm_ref. Lets gallery assets be referenced from an external CRM.';

COMMIT;
