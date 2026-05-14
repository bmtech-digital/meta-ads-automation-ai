-- 001_businesses.sql
-- Core business record. One row for MVP: Aiweon.
-- Source: spec §10.1 + decision 1.2 (meta_auth_mode dual-mode infrastructure).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Jerusalem',
  meta_ad_account_id text NOT NULL,
  meta_page_id text NOT NULL,
  meta_access_token_encrypted text NOT NULL,
  meta_auth_mode text NOT NULL DEFAULT 'user_token'
    CHECK (meta_auth_mode IN ('user_token', 'system_user_token')),
  gcp_project_id text NOT NULL DEFAULT 'bemtech-478413',
  monthly_budget_ils numeric,
  daily_budget_ils numeric,
  primary_kpi text CHECK (primary_kpi IN ('cpa','cpl','roas','cpm','cpi')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
