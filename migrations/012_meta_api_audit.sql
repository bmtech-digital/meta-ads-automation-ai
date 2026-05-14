-- 012_meta_api_audit.sql
-- Per decisions-log §1.12 — every Meta Graph call writes one row here.
--
-- Three reasons this table exists:
--   1. Debugging — when a capability says "ready" but the call fails, the
--      request_summary + response_error tell us exactly what Graph rejected.
--   2. GDPR — the data-deletion callback needs to enumerate what data we
--      pulled from Meta for a given user. Without an audit log we can only
--      say "everything" and hope.
--   3. Rate-limit accounting — Meta's per-app, per-business, per-account
--      quotas tick on every call. The audit table is where we'd attach a
--      materialized view for live rate-limit observability.
--
-- Intentionally separate from agent_decisions (high-level reasoning) so the
-- volume difference (1 Graph call per insight × N campaigns × M ads) doesn't
-- pollute the agent decision history.

BEGIN;

CREATE TABLE IF NOT EXISTS meta_api_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  -- Nullable: Path A (Aiweon System User Token) has no connection row.
  connection_id uuid REFERENCES meta_connections(id) ON DELETE SET NULL,
  capability text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('insight','draft','action')),
  meta_endpoint text NOT NULL,
  http_method text NOT NULL DEFAULT 'GET',
  -- request_summary is a redacted shape — never the raw payload (token in URL,
  -- creative copy, PII). Example: { "endpoint": "/{ig-user}/media", "params":
  -- {"media_type": "VIDEO"}, "asset_id_hash": "..." }
  request_summary jsonb,
  response_status int,
  -- response_error captures Meta error envelope on 4xx/5xx: { "code", "type",
  -- "message", "fbtrace_id", "error_subcode" }. Null on success.
  response_error jsonb,
  duration_ms int,
  -- For action-mode calls, the approval row that justified this write.
  -- Hard requirement: action-mode rows MUST have approval_id NOT NULL (enforced
  -- at the application layer, not via constraint, because insert order matters
  -- and we want the audit row to land even if approval_id is wrong — the
  -- failure mode should be visible, not silenced).
  approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Audit viewer ("show me the last N calls for this business").
CREATE INDEX IF NOT EXISTS meta_api_calls_business_recent_idx
  ON meta_api_calls (business_id, created_at DESC);

-- Failure dashboard ("what's been erroring in the last 24h").
CREATE INDEX IF NOT EXISTS meta_api_calls_failures_idx
  ON meta_api_calls (business_id, created_at DESC)
  WHERE response_status >= 400;

-- Action-mode trail ("every Meta write the agent performed").
CREATE INDEX IF NOT EXISTS meta_api_calls_action_idx
  ON meta_api_calls (business_id, approval_id, created_at)
  WHERE mode = 'action';

COMMENT ON TABLE meta_api_calls IS
  'Per-call audit of every Meta Graph API call. Required for debugging, GDPR enumeration, and rate-limit accounting. Volume is bounded by cron cadence × campaigns × ads.';
COMMENT ON COLUMN meta_api_calls.request_summary IS
  'REDACTED request shape: endpoint path, sanitized params, asset id hashes. Never the raw token, raw creative text, or PII. Token never appears here — pulled at call time from connection store.';
COMMENT ON COLUMN meta_api_calls.approval_id IS
  'Required for mode=action calls (every Meta write must trace back to an approved approvals row). Enforced at application layer.';

COMMIT;
