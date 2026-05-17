import "server-only";
import { Pool } from "pg";
import type {
  AgentDecision,
  AgentMode,
  Approval,
  Business,
  BusinessKnowledge,
  BusinessKnowledgeUpsert,
  BusinessProfileUpdate,
  BusinessSettingsUpdate,
  ConnectionWithAssets,
  CreateBusinessForAdAccountInput,
  CreativeAsset,
  CreativeAssetCreate,
  DataClient,
  Heartbeat,
  MetaAdAccountRow,
  MetaConnectionRow,
  MetaIgAccountRow,
  MetaPageRow,
  MonthlyBrief,
  MonthlyReport,
  PrimaryKpi,
  RecordApiCallInput,
  SeasonalHints,
  UpsertAdAccountInput,
  UpsertConnectionInput,
  UpsertIgAccountInput,
  UpsertPageInput,
} from "./types";

declare global {
  // eslint-disable-next-line no-var
  var __campaignerPgPool: Pool | undefined;
}

function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL is required for WEB_DB_MODE=local-postgres");
  if (!globalThis.__campaignerPgPool) {
    globalThis.__campaignerPgPool = new Pool({ connectionString: url, max: 5 });
  }
  return globalThis.__campaignerPgPool;
}

/**
 * Phase 8 helper — aggregate lead quality grades for a month window.
 * Lives outside the adapter object to keep the getMonthlyReport method
 * readable; matches the same band logic used by Python `fetch_lead_quality_summary`.
 */
async function _leadQualitySummary(
  businessId: string,
  windowStart: Date,
  windowEnd: Date,
) {
  const { rows } = await getPool().query(
    `
    WITH window_leads AS (
      SELECT l.id
        FROM leads l
       WHERE l.business_id = $1
         AND l.archived_at IS NULL
         AND COALESCE(l.meta_created_at, l.synced_at) >= $2
         AND COALESCE(l.meta_created_at, l.synced_at) < $3
    )
    SELECT
      (SELECT COUNT(*)::int FROM window_leads) AS total_leads,
      (SELECT COUNT(*)::int FROM window_leads wl
         JOIN lead_latest_grade g ON g.lead_id = wl.id) AS graded_leads,
      (SELECT AVG(g.grade)::float FROM window_leads wl
         JOIN lead_latest_grade g ON g.lead_id = wl.id) AS avg_grade,
      (SELECT COUNT(*)::int FROM window_leads wl
         JOIN lead_latest_grade g ON g.lead_id = wl.id WHERE g.grade = 1) AS g1,
      (SELECT COUNT(*)::int FROM window_leads wl
         JOIN lead_latest_grade g ON g.lead_id = wl.id WHERE g.grade = 2) AS g2,
      (SELECT COUNT(*)::int FROM window_leads wl
         JOIN lead_latest_grade g ON g.lead_id = wl.id WHERE g.grade = 3) AS g3,
      (SELECT COUNT(*)::int FROM window_leads wl
         JOIN lead_latest_grade g ON g.lead_id = wl.id WHERE g.grade = 4) AS g4,
      (SELECT COUNT(*)::int FROM window_leads wl
         JOIN lead_latest_grade g ON g.lead_id = wl.id WHERE g.grade = 5) AS g5
    `,
    [businessId, windowStart, windowEnd],
  );
  const r = rows[0] ?? {};
  const total = Number(r.total_leads ?? 0);
  const graded = Number(r.graded_leads ?? 0);
  const avg = r.avg_grade == null ? null : Number(r.avg_grade);
  const ungraded = total - graded;

  let band: "high" | "mixed" | "low" | "insufficient_data" | "no_leads";
  if (total === 0) band = "no_leads";
  else if (graded < 5) band = "insufficient_data";
  else if (avg != null && avg >= 3.5) band = "high";
  else if (avg != null && avg >= 2.5) band = "mixed";
  else band = "low";

  return {
    total_leads: total,
    graded_leads: graded,
    ungraded_leads: ungraded,
    avg_grade: avg,
    band,
    grade_distribution: {
      "1": Number(r.g1 ?? 0),
      "2": Number(r.g2 ?? 0),
      "3": Number(r.g3 ?? 0),
      "4": Number(r.g4 ?? 0),
      "5": Number(r.g5 ?? 0),
    },
  } as const;
}

const SELECT_BUSINESS = `
  SELECT id::text, name, timezone,
         meta_ad_account_id, meta_page_id, meta_auth_mode,
         meta_access_token_expires_at::text,
         monthly_budget_ils, daily_budget_ils,
         COALESCE(seasonal_hints, '{}'::jsonb) AS seasonal_hints,
         primary_kpi,
         target_cpa_ils, target_cpl_ils, target_roas,
         monthly_brief,
         active,
         COALESCE(agent_mode, 'draft') AS agent_mode,
         COALESCE(onboarding_status, 'completed') AS onboarding_status,
         onboarding_started_at::text,
         created_at::text
    FROM businesses
`;

const BUSINESS_RETURNING = `
  id::text, name, timezone,
  meta_ad_account_id, meta_page_id, meta_auth_mode,
  meta_access_token_expires_at::text,
  monthly_budget_ils, daily_budget_ils,
  COALESCE(seasonal_hints, '{}'::jsonb) AS seasonal_hints,
  primary_kpi,
  target_cpa_ils, target_cpl_ils, target_roas,
  monthly_brief,
  active,
  COALESCE(agent_mode, 'draft') AS agent_mode,
  created_at::text
`;

const SELECT_CONNECTION = `
  SELECT id::text, business_id::text, meta_user_id, meta_user_name,
         long_lived_token_encrypted, token_expires_at::text,
         granted_scopes, granular_scopes,
         status, last_health_check_at::text, connected_by_user_id,
         external_crm_ref,
         created_at::text, updated_at::text
    FROM meta_connections
`;

const SELECT_KNOWLEDGE = `
  SELECT id::text, business_id::text, vertical, website_url,
         service_regions, geo_targeting, customer_age_min, customer_age_max,
         products, delivery_time_days, strong_seasons, weak_seasons,
         questionnaire_answers, brand_voice, competitors,
         COALESCE(tracking_verified, false) AS tracking_verified,
         last_refreshed_at::text, created_at::text
    FROM business_knowledge
`;

const SELECT_APPROVAL = `
  SELECT id::text, business_id::text, created_at::text, created_by_run_id::text,
         task_type, target_kind, target_id, payload, rationale, expected_impact,
         urgency, status, approved_at::text, approved_by, rejection_reason,
         executed_at::text, execution_result, expires_at::text,
         scheduled_for::text, external_post_id, published_at::text,
         operator_questions, operator_response, answered_at::text
    FROM approvals
`;

const SELECT_GALLERY = `
  SELECT id::text, business_id::text, kind, storage_url, aspect_ratio, dimensions,
         headline, primary_text, cta, generated_by, marketing_angle, service_tag,
         mime_type, size_bytes, original_filename, duration_seconds,
         meta_creative_id, performance_snapshot, created_at::text, deleted_at::text
    FROM creative_gallery
`;

const SELECT_DECISION = `
  SELECT id::text, business_id::text, run_id::text, graph_name, node_name,
         created_at::text, decision_type, summary, rationale, inputs, outputs,
         related_approval_id::text, campaign_id, adset_id, ad_id,
         llm_model, llm_tokens_in, llm_tokens_out, latency_ms,
         guardrail_violations, confidence
    FROM agent_decisions
`;

export const localPostgresClient: DataClient = {
  mode: "local-postgres",

  async getBusinessById(id: string): Promise<Business | null> {
    const { rows } = await getPool().query<Business>(
      `${SELECT_BUSINESS} WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async getFirstBusiness(): Promise<Business | null> {
    const { rows } = await getPool().query<Business>(
      `${SELECT_BUSINESS} WHERE active = true ORDER BY created_at ASC LIMIT 1`,
    );
    return rows[0] ?? null;
  },

  async listBusinesses(): Promise<Business[]> {
    const { rows } = await getPool().query<Business>(
      `${SELECT_BUSINESS} WHERE active = true ORDER BY name ASC, created_at ASC`,
    );
    return rows;
  },

  async findBusinessByAdAccountId(adAccountId: string): Promise<Business | null> {
    const { rows } = await getPool().query<Business>(
      `${SELECT_BUSINESS} WHERE meta_ad_account_id = $1 LIMIT 1`,
      [adAccountId],
    );
    return rows[0] ?? null;
  },

  async createBusinessForAdAccount(
    input: CreateBusinessForAdAccountInput,
  ): Promise<Business> {
    // Idempotent: if a business already exists for the ad account (race on
    // the OAuth callback path), return the existing row instead of failing
    // the UNIQUE constraint. ON CONFLICT DO UPDATE with a no-op SET lets us
    // RETURN the row whether it was inserted or already existed.
    const { rows } = await getPool().query<Business>(
      `INSERT INTO businesses (
         name, timezone, meta_ad_account_id, meta_page_id, meta_auth_mode
       ) VALUES (
         $1, $2, $3, NULL, 'user_token'
       )
       ON CONFLICT (meta_ad_account_id) DO UPDATE SET
         name = COALESCE(businesses.name, EXCLUDED.name)
       RETURNING ${BUSINESS_RETURNING}`,
      [input.name, input.timezone ?? "Asia/Jerusalem", input.ad_account_id],
    );
    return rows[0];
  },

  async getConnectionByAdAccountId(
    adAccountId: string,
  ): Promise<MetaConnectionRow | null> {
    const { rows } = await getPool().query<MetaConnectionRow>(
      `SELECT c.id::text, c.business_id::text, c.meta_user_id, c.meta_user_name,
              c.long_lived_token_encrypted, c.token_expires_at::text,
              c.granted_scopes, c.granular_scopes,
              c.status, c.last_health_check_at::text, c.connected_by_user_id,
              c.external_crm_ref,
              c.created_at::text, c.updated_at::text
         FROM meta_connections c
         INNER JOIN meta_ad_accounts a ON a.connection_id = c.id
        WHERE a.ad_account_id = $1
          AND c.status IN ('active', 'partial')
        ORDER BY c.updated_at DESC
        LIMIT 1`,
      [adAccountId],
    );
    return rows[0] ?? null;
  },

  async updateBusinessSettings(
    id: string,
    patch: BusinessSettingsUpdate,
  ): Promise<Business | null> {
    const { rows } = await getPool().query<Business>(
      `UPDATE businesses
          SET name = $2,
              meta_ad_account_id = $3,
              meta_page_id = $4,
              monthly_budget_ils = $5
        WHERE id = $1
        RETURNING ${BUSINESS_RETURNING}`,
      [
        id,
        patch.name,
        patch.meta_ad_account_id,
        patch.meta_page_id,
        patch.monthly_budget_ils,
      ],
    );
    return rows[0] ?? null;
  },

  async updateBusinessProfile(
    id: string,
    patch: BusinessProfileUpdate,
  ): Promise<Business | null> {
    const { rows } = await getPool().query<Business>(
      `UPDATE businesses
          SET name = $2,
              monthly_budget_ils = $3,
              target_cpa_ils = $4,
              target_cpl_ils = $5,
              target_roas    = $6
        WHERE id = $1
        RETURNING ${BUSINESS_RETURNING}`,
      [
        id,
        patch.name,
        patch.monthly_budget_ils,
        patch.target_cpa_ils,
        patch.target_cpl_ils,
        patch.target_roas,
      ],
    );
    return rows[0] ?? null;
  },

  async updateSeasonalHints(
    id: string,
    hints: SeasonalHints,
  ): Promise<Business | null> {
    const { rows } = await getPool().query<Business>(
      `UPDATE businesses
          SET seasonal_hints = $2::jsonb
        WHERE id = $1
        RETURNING ${BUSINESS_RETURNING}`,
      [id, JSON.stringify(hints ?? {})],
    );
    return rows[0] ?? null;
  },

  async getLatestBudgetHealthDecision(
    businessId: string,
  ): Promise<AgentDecision | null> {
    const { rows } = await getPool().query<AgentDecision>(
      `${SELECT_DECISION}
        WHERE business_id = $1
          AND node_name = 'budget_health'
          AND decision_type = 'observation'
        ORDER BY created_at DESC
        LIMIT 1`,
      [businessId],
    );
    return rows[0] ?? null;
  },

  async recordBudgetHealthSnapshot(input: {
    business_id: string;
    summary: string;
    outputs: Record<string, unknown>;
  }): Promise<AgentDecision> {
    // graph_name='observe_propose' + node_name='budget_health' matches what
    // `compute_monthly_pace.py` writes from the agent side. `run_id` is a
    // fresh UUID per snapshot — each web-side fetch is its own observation
    // and inherits the same append-only contract as agent rows.
    const { rows } = await getPool().query<AgentDecision>(
      `INSERT INTO agent_decisions (
         business_id, run_id, graph_name, node_name, decision_type,
         summary, outputs
       )
       VALUES (
         $1, gen_random_uuid(), 'observe_propose', 'budget_health',
         'observation', $2, $3::jsonb
       )
       RETURNING id::text, business_id::text, run_id::text, graph_name,
                 node_name, created_at::text, decision_type, summary, rationale,
                 inputs, outputs, related_approval_id::text, campaign_id,
                 adset_id, ad_id, llm_model, llm_tokens_in, llm_tokens_out,
                 latency_ms, guardrail_violations, confidence`,
      [input.business_id, input.summary, JSON.stringify(input.outputs)],
    );
    return rows[0];
  },

  async getBusinessKnowledge(
    businessId: string,
  ): Promise<BusinessKnowledge | null> {
    const { rows } = await getPool().query<BusinessKnowledge>(
      `${SELECT_KNOWLEDGE} WHERE business_id = $1 LIMIT 1`,
      [businessId],
    );
    return rows[0] ?? null;
  },

  async upsertBusinessKnowledge(
    data: BusinessKnowledgeUpsert,
  ): Promise<BusinessKnowledge> {
    const { rows } = await getPool().query<BusinessKnowledge>(
      `INSERT INTO business_knowledge
         (business_id, vertical, website_url, service_regions, geo_targeting,
          customer_age_min, customer_age_max, products, delivery_time_days,
          strong_seasons, weak_seasons, questionnaire_answers, brand_voice,
          competitors, last_refreshed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
       ON CONFLICT (business_id) DO UPDATE SET
         vertical = EXCLUDED.vertical,
         website_url = EXCLUDED.website_url,
         service_regions = EXCLUDED.service_regions,
         geo_targeting = EXCLUDED.geo_targeting,
         customer_age_min = EXCLUDED.customer_age_min,
         customer_age_max = EXCLUDED.customer_age_max,
         products = EXCLUDED.products,
         delivery_time_days = EXCLUDED.delivery_time_days,
         strong_seasons = EXCLUDED.strong_seasons,
         weak_seasons = EXCLUDED.weak_seasons,
         questionnaire_answers = EXCLUDED.questionnaire_answers,
         brand_voice = EXCLUDED.brand_voice,
         competitors = EXCLUDED.competitors,
         last_refreshed_at = now()
       RETURNING id::text, business_id::text, vertical, website_url,
                 service_regions, geo_targeting, customer_age_min, customer_age_max,
                 products, delivery_time_days, strong_seasons, weak_seasons,
                 questionnaire_answers, brand_voice, competitors,
                 COALESCE(tracking_verified, false) AS tracking_verified,
                 last_refreshed_at::text, created_at::text`,
      [
        data.business_id,
        data.vertical,
        data.website_url,
        data.service_regions,
        data.geo_targeting ? JSON.stringify(data.geo_targeting) : null,
        data.customer_age_min,
        data.customer_age_max,
        data.products ? JSON.stringify(data.products) : null,
        data.delivery_time_days,
        data.strong_seasons,
        data.weak_seasons,
        data.questionnaire_answers
          ? JSON.stringify(data.questionnaire_answers)
          : null,
        data.brand_voice ? JSON.stringify(data.brand_voice) : null,
        data.competitors,
      ],
    );
    return rows[0];
  },

  async setPrimaryKpi(
    businessId: string,
    kpi: PrimaryKpi | null,
  ): Promise<void> {
    await getPool().query(
      `UPDATE businesses SET primary_kpi = $2 WHERE id = $1`,
      [businessId, kpi],
    );
  },

  async getLatestHeartbeats(businessId: string): Promise<Heartbeat[]> {
    const { rows } = await getPool().query<Heartbeat>(
      `SELECT DISTINCT ON (flow)
              id::text, business_id::text, flow, phase,
              ran_at::text, duration_ms, exit_code, error_message
         FROM heartbeats
        WHERE business_id = $1
        ORDER BY flow, ran_at DESC`,
      [businessId],
    );
    return rows;
  },

  async listPendingApprovals(businessId: string): Promise<Approval[]> {
    const { rows } = await getPool().query<Approval>(
      `${SELECT_APPROVAL}
        WHERE business_id = $1
          AND status = 'pending'
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY CASE urgency
                   WHEN 'urgent' THEN 0
                   WHEN 'high' THEN 1
                   WHEN 'medium' THEN 2
                   WHEN 'low' THEN 3
                 END,
                 created_at DESC`,
      [businessId],
    );
    return rows;
  },

  async getApprovalById(id: string): Promise<Approval | null> {
    const { rows } = await getPool().query<Approval>(
      `${SELECT_APPROVAL} WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async createPixelVerificationApproval(input: {
    business_id: string;
    pixels: Array<{
      pixel_id: string;
      name: string | null;
      last_fired_time: string | null;
      hours_since_last_fired: number | null;
      data_use_setting: string | null;
      owner_business_id: string | null;
      owner_business_name: string | null;
      is_unavailable: boolean;
    }>;
    rationale: string;
    created_by_run_id: string;
  }): Promise<{ id: string; created_at: string }> {
    // Idempotency: collapse to existing pending row if one exists. The user
    // can re-trigger the check freely without piling up duplicates.
    const existing = await getPool().query<{
      id: string;
      created_at: string;
    }>(
      `SELECT id::text, created_at::text
         FROM approvals
        WHERE business_id = $1
          AND task_type = 'verify_pixel_capi'
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1`,
      [input.business_id],
    );
    if (existing.rows.length > 0) return existing.rows[0];
    const payload = {
      source: "user_triggered_pixel_check",
      pixels: input.pixels,
      capi_attested: false,
    };
    const { rows } = await getPool().query<{ id: string; created_at: string }>(
      `INSERT INTO approvals (
         business_id, created_by_run_id, task_type,
         target_kind, target_id,
         payload, rationale, expected_impact,
         urgency, expires_at
       ) VALUES (
         $1, $2, 'verify_pixel_capi',
         'account', NULL,
         $3::jsonb, $4, NULL,
         'high', now() + interval '72 hours'
       )
       RETURNING id::text, created_at::text`,
      [
        input.business_id,
        input.created_by_run_id,
        JSON.stringify(payload),
        input.rationale,
      ],
    );
    return rows[0];
  },

  async markTrackingVerified(
    businessId: string,
    patch: { pixel_id: string | null; capi_configured: boolean },
  ): Promise<void> {
    // Insert-or-update — fresh businesses may not have a business_knowledge
    // row yet. We deliberately don't touch other tracking_* columns
    // (aem_priority_events, domain_verified) because we don't auto-discover
    // them; the human's approval is the source of truth that they're set up.
    await getPool().query(
      `INSERT INTO business_knowledge (
         business_id, tracking_verified, tracking_pixel_id, tracking_capi_configured
       )
       VALUES ($1, true, $2, $3)
       ON CONFLICT (business_id) DO UPDATE SET
         tracking_verified = true,
         tracking_pixel_id = COALESCE(EXCLUDED.tracking_pixel_id, business_knowledge.tracking_pixel_id),
         tracking_capi_configured = EXCLUDED.tracking_capi_configured,
         last_refreshed_at = now()`,
      [businessId, patch.pixel_id, patch.capi_configured],
    );
  },

  async setKpiTarget(
    businessId: string,
    kpi: "cpa" | "cpl" | "roas",
    value: number,
  ): Promise<void> {
    const column =
      kpi === "cpa"
        ? "target_cpa_ils"
        : kpi === "cpl"
          ? "target_cpl_ils"
          : "target_roas";
    // Column name is from a closed enum, not user input — safe to interpolate.
    await getPool().query(
      `UPDATE businesses SET ${column} = $2 WHERE id = $1`,
      [businessId, value],
    );
  },

  async getLatestKpiResearch(
    businessId: string,
    kpi: "cpa" | "cpl" | "roas",
  ): Promise<{
    market_average: number;
    range_low: number | null;
    range_high: number | null;
    sources_count: number;
    researched_at: string | null;
    approval_id: string;
  } | null> {
    // Latest set_kpi_target approval for this (business, kpi) where the
    // payload.research block is populated. We use jsonb arrow accessors so
    // the filter happens server-side and we get NULL when the structure
    // doesn't match. Status filter excludes 'rejected' / 'expired' / 'failed'
    // — research from those rows is stale or overruled.
    const { rows } = await getPool().query<{
      id: string;
      market_average: string | null;
      range_low: string | null;
      range_high: string | null;
      sources_count: string;
      researched_at: string | null;
    }>(
      `SELECT id::text,
              (payload->'research'->>'market_average')::text AS market_average,
              (payload->'research'->>'range_low')::text AS range_low,
              (payload->'research'->>'range_high')::text AS range_high,
              COALESCE(jsonb_array_length(payload->'research'->'sources'), 0)::text AS sources_count,
              (payload->'research'->>'researched_at') AS researched_at
         FROM approvals
        WHERE business_id = $1
          AND task_type = 'set_kpi_target'
          AND payload->>'kpi' = $2
          AND payload->'research'->>'market_average' IS NOT NULL
          AND status IN ('pending','approved','executed')
        ORDER BY created_at DESC
        LIMIT 1`,
      [businessId, kpi],
    );
    const row = rows[0];
    if (!row || row.market_average === null) return null;
    const num = (s: string | null) =>
      s === null || s === "" ? null : Number(s);
    const m = num(row.market_average);
    if (m === null || !Number.isFinite(m)) return null;
    return {
      market_average: m,
      range_low: num(row.range_low),
      range_high: num(row.range_high),
      sources_count: Number(row.sources_count) || 0,
      researched_at: row.researched_at,
      approval_id: row.id,
    };
  },

  async setMonthlyBrief(
    businessId: string,
    brief: MonthlyBrief | null,
  ): Promise<void> {
    // Pass-through replace. Empty/keyless object → store as NULL so SQL
    // `monthly_brief IS NULL` checks behave sensibly. Caller has already
    // normalized + auto-set the `month` field.
    const isEmpty =
      brief === null ||
      (typeof brief === "object" && Object.keys(brief).length === 0);
    await getPool().query(
      `UPDATE businesses SET monthly_brief = $2::jsonb WHERE id = $1`,
      [businessId, isEmpty ? null : JSON.stringify(brief)],
    );
  },

  async createPromotionApproval(input: {
    business_id: string;
    asset_id: string;
    score: number;
    reasons: string[];
    rationale: string;
    created_by_run_id: string;
  }): Promise<{ id: string; created_at: string }> {
    // 48h expiry mirrors propose_task.py default.
    const payload = {
      asset_id: input.asset_id,
      source: "user_promote_from_gallery",
      score: input.score,
      reasons: input.reasons,
    };
    const { rows } = await getPool().query<{ id: string; created_at: string }>(
      `INSERT INTO approvals (
         business_id, created_by_run_id, task_type,
         target_kind, target_id,
         payload, rationale, expected_impact,
         urgency, expires_at
       ) VALUES (
         $1, $2, 'new_creative',
         NULL, NULL,
         $3::jsonb, $4, NULL,
         'medium', now() + interval '48 hours'
       )
       RETURNING id::text, created_at::text`,
      [
        input.business_id,
        input.created_by_run_id,
        JSON.stringify(payload),
        input.rationale,
      ],
    );
    return rows[0];
  },

  async listDecisionsForApproval(approvalId: string): Promise<AgentDecision[]> {
    const { rows } = await getPool().query<AgentDecision>(
      `${SELECT_DECISION}
        WHERE related_approval_id = $1
        ORDER BY created_at ASC`,
      [approvalId],
    );
    return rows;
  },

  async listDecisionsForRun(
    businessId: string,
    runId: string,
  ): Promise<AgentDecision[]> {
    const { rows } = await getPool().query<AgentDecision>(
      `${SELECT_DECISION}
        WHERE business_id = $1 AND run_id = $2
        ORDER BY created_at ASC`,
      [businessId, runId],
    );
    return rows;
  },

  async approveApproval(id: string, approvedBy: string): Promise<void> {
    await getPool().query(
      `UPDATE approvals
          SET status = 'approved', approved_at = now(), approved_by = $2
        WHERE id = $1 AND status = 'pending'`,
      [id, approvedBy],
    );
  },

  async rejectApproval(id: string, reason: string): Promise<void> {
    await getPool().query(
      `UPDATE approvals
          SET status = 'rejected', rejection_reason = $2, approved_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [id, reason],
    );
  },

  async unapproveApproval(id: string): Promise<{ reverted: boolean }> {
    const { rowCount } = await getPool().query(
      `UPDATE approvals
          SET status = 'pending', approved_at = NULL, approved_by = NULL
        WHERE id = $1 AND status = 'approved' AND executed_at IS NULL`,
      [id],
    );
    return { reverted: (rowCount ?? 0) > 0 };
  },

  async beginOnboardingIfNeeded(businessId: string) {
    // Only flip when the business is in the "pre-v2 completed default" state
    // (status='completed' AND started_at IS NULL). Anything else (already
    // in the chain OR a fresh business the OAuth handler already initialized)
    // we leave untouched — idempotent.
    const { rows } = await getPool().query<{
      status: string;
    }>(
      `UPDATE businesses
          SET onboarding_status = 'not_started',
              onboarding_started_at = now()
        WHERE id = $1
          AND onboarding_status = 'completed'
          AND onboarding_started_at IS NULL
        RETURNING onboarding_status AS status`,
      [businessId],
    );
    if (rows.length > 0) {
      return {
        started: true,
        status: rows[0].status as
          | "not_started"
          | "brief_pending"
          | "audience_brief_pending"
          | "scanning"
          | "first_proposal_pending"
          | "completed",
      };
    }
    // Otherwise read current status
    const { rows: cur } = await getPool().query<{
      onboarding_status: string;
    }>(
      `SELECT COALESCE(onboarding_status, 'completed') AS onboarding_status
         FROM businesses WHERE id = $1`,
      [businessId],
    );
    if (cur.length === 0) {
      throw new Error(`business ${businessId} not found`);
    }
    return {
      started: false,
      status: cur[0].onboarding_status as
        | "not_started"
        | "brief_pending"
        | "audience_brief_pending"
        | "scanning"
        | "first_proposal_pending"
        | "completed",
    };
  },

  async getOnboardingSnapshot(businessId: string) {
    // One round-trip — fetch status + the task_type that's open for the
    // current step. Map: not_started → no approval (chain hasn't run);
    // brief_pending → fill_business_brief; audience_brief_pending →
    // audience_brief; scanning → no approval (background); first_proposal_pending →
    // first_campaign; completed → no approval.
    const { rows: bizRows } = await getPool().query<{
      onboarding_status: string;
      onboarding_started_at: string | null;
    }>(
      `SELECT COALESCE(onboarding_status, 'completed') AS onboarding_status,
              onboarding_started_at::text
         FROM businesses WHERE id = $1`,
      [businessId],
    );
    if (bizRows.length === 0) {
      throw new Error(`business ${businessId} not found`);
    }
    const status = bizRows[0].onboarding_status as
      | "not_started"
      | "brief_pending"
      | "audience_brief_pending"
      | "scanning"
      | "first_proposal_pending"
      | "completed";
    const stepToTaskType: Record<string, string | null> = {
      not_started: null,
      brief_pending: "fill_business_brief",
      audience_brief_pending: "audience_brief",
      scanning: null,
      first_proposal_pending: "first_campaign",
      completed: null,
    };
    const taskType = stepToTaskType[status];
    let pending: {
      id: string;
      task_type: string;
      rationale: string;
      created_at: string;
    } | null = null;
    if (taskType) {
      const { rows } = await getPool().query<{
        id: string;
        task_type: string;
        rationale: string;
        created_at: string;
      }>(
        `SELECT id::text, task_type, rationale, created_at::text
           FROM approvals
          WHERE business_id = $1
            AND task_type = $2
            AND status IN ('pending', 'answered')
          ORDER BY created_at DESC
          LIMIT 1`,
        [businessId, taskType],
      );
      pending = rows[0] ?? null;
    }
    return {
      status,
      started_at: bizRows[0].onboarding_started_at,
      pending_approval: pending,
    };
  },

  async answerApproval(
    id: string,
    response: Record<string, string | string[]>,
  ): Promise<{ recorded: boolean }> {
    // Only valid transition: pending → answered. Don't allow re-answering an
    // already-answered row from the UI — the agent must re-propose first (which
    // creates a fresh row with cleared operator_questions). This keeps the
    // audit trail clean: one approval = one answer cycle.
    const { rowCount } = await getPool().query(
      `UPDATE approvals
          SET status = 'answered',
              operator_response = $2::jsonb,
              answered_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [id, JSON.stringify(response)],
    );
    return { recorded: (rowCount ?? 0) > 0 };
  },

  async listHistory(businessId: string, days: number): Promise<Approval[]> {
    const { rows } = await getPool().query<Approval>(
      `${SELECT_APPROVAL}
        WHERE business_id = $1
          AND created_at >= now() - ($2 || ' days')::interval
          AND status <> 'pending'
        ORDER BY created_at DESC`,
      [businessId, String(days)],
    );
    return rows;
  },

  /**
   * Agent's "transparent activity" — skips, rejections, and routing diagnoses.
   * These are decisions where the agent looked at a campaign and CHOSE NOT to
   * propose (or proposed something that was guardrail-rejected). They live in
   * `agent_decisions`, not `approvals`, so the /history approvals feed misses
   * them. /history Block 3 surfaces them as a sibling tab.
   *
   * Filter: decision_type ∈ {skip, rejection, diagnosis with node_name='route'}.
   * Excludes plain observations (too noisy — every fetch_insights logs one).
   */
  async listAgentActivity(
    businessId: string,
    days: number,
  ): Promise<AgentDecision[]> {
    const { rows } = await getPool().query<AgentDecision>(
      `${SELECT_DECISION}
        WHERE business_id = $1
          AND created_at >= now() - ($2 || ' days')::interval
          AND (
                decision_type IN ('skip','rejection')
             OR (decision_type = 'diagnosis' AND node_name = 'route')
          )
        ORDER BY created_at DESC
        LIMIT 500`,
      [businessId, String(days)],
    );
    return rows;
  },

  async listGalleryAssets(businessId: string): Promise<CreativeAsset[]> {
    const { rows } = await getPool().query<CreativeAsset>(
      `${SELECT_GALLERY}
        WHERE business_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [businessId],
    );
    return rows;
  },

  async getGalleryAssetById(id: string): Promise<CreativeAsset | null> {
    const { rows } = await getPool().query<CreativeAsset>(
      `${SELECT_GALLERY} WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async createGalleryAsset(data: CreativeAssetCreate): Promise<CreativeAsset> {
    const { rows } = await getPool().query<CreativeAsset>(
      `INSERT INTO creative_gallery (
         business_id, kind, storage_url, aspect_ratio, dimensions,
         generated_by, marketing_angle, service_tag,
         mime_type, size_bytes, original_filename, duration_seconds
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING
         id::text, business_id::text, kind, storage_url, aspect_ratio, dimensions,
         headline, primary_text, cta, generated_by, marketing_angle, service_tag,
         mime_type, size_bytes, original_filename, duration_seconds,
         meta_creative_id, performance_snapshot, created_at::text, deleted_at::text`,
      [
        data.business_id,
        data.kind,
        data.storage_url,
        data.aspect_ratio,
        data.dimensions,
        data.generated_by,
        data.marketing_angle,
        data.service_tag,
        data.mime_type,
        data.size_bytes,
        data.original_filename,
        data.duration_seconds,
      ],
    );
    return rows[0];
  },

  async softDeleteGalleryAsset(
    id: string,
    businessId: string,
  ): Promise<{ deleted: boolean }> {
    const { rowCount } = await getPool().query(
      `UPDATE creative_gallery
          SET deleted_at = now()
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [id, businessId],
    );
    return { deleted: (rowCount ?? 0) > 0 };
  },

  // ---- Meta connections (Path B) -----------------------------------------

  async getActiveConnectionForBusiness(
    businessId: string,
  ): Promise<MetaConnectionRow | null> {
    const { rows } = await getPool().query<MetaConnectionRow>(
      `${SELECT_CONNECTION}
        WHERE business_id = $1 AND status IN ('active','partial')
        ORDER BY updated_at DESC LIMIT 1`,
      [businessId],
    );
    return rows[0] ?? null;
  },

  async findConnectionsByMetaUserId(
    metaUserId: string,
  ): Promise<MetaConnectionRow[]> {
    const { rows } = await getPool().query<MetaConnectionRow>(
      `${SELECT_CONNECTION} WHERE meta_user_id = $1`,
      [metaUserId],
    );
    return rows;
  },

  async getConnectionWithAssets(
    connectionId: string,
  ): Promise<ConnectionWithAssets | null> {
    const pool = getPool();
    const connRes = await pool.query<MetaConnectionRow>(
      `${SELECT_CONNECTION} WHERE id = $1 LIMIT 1`,
      [connectionId],
    );
    const connection = connRes.rows[0];
    if (!connection) return null;
    const [pagesRes, igRes, adsRes] = await Promise.all([
      pool.query<MetaPageRow>(
        `SELECT id::text, connection_id::text, page_id, page_name,
                page_access_token_encrypted, category, tasks,
                business_id_meta, selected
           FROM meta_pages WHERE connection_id = $1
          ORDER BY page_name`,
        [connectionId],
      ),
      pool.query<MetaIgAccountRow>(
        `SELECT id::text, connection_id::text, ig_user_id, username,
                linked_page_id::text, business_id_meta, selected
           FROM meta_ig_accounts WHERE connection_id = $1
          ORDER BY username NULLS LAST`,
        [connectionId],
      ),
      pool.query<MetaAdAccountRow>(
        `SELECT id::text, connection_id::text, ad_account_id, account_name,
                currency, timezone_name, user_role, business_id_meta, selected
           FROM meta_ad_accounts WHERE connection_id = $1
          ORDER BY account_name NULLS LAST`,
        [connectionId],
      ),
    ]);
    return {
      connection,
      pages: pagesRes.rows,
      igAccounts: igRes.rows,
      adAccounts: adsRes.rows,
    };
  },

  async upsertConnection(
    input: UpsertConnectionInput,
  ): Promise<MetaConnectionRow> {
    const { rows } = await getPool().query<MetaConnectionRow>(
      `INSERT INTO meta_connections
         (business_id, meta_user_id, meta_user_name,
          long_lived_token_encrypted, token_expires_at,
          granted_scopes, granular_scopes, status, connected_by_user_id,
          last_health_check_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7::jsonb,$8,$9, now(), now())
       ON CONFLICT (business_id, meta_user_id) DO UPDATE SET
         meta_user_name = EXCLUDED.meta_user_name,
         long_lived_token_encrypted = EXCLUDED.long_lived_token_encrypted,
         token_expires_at = EXCLUDED.token_expires_at,
         granted_scopes = EXCLUDED.granted_scopes,
         granular_scopes = EXCLUDED.granular_scopes,
         status = EXCLUDED.status,
         connected_by_user_id = EXCLUDED.connected_by_user_id,
         last_health_check_at = now(),
         updated_at = now()
       RETURNING id::text, business_id::text, meta_user_id, meta_user_name,
                 long_lived_token_encrypted, token_expires_at::text,
                 granted_scopes, granular_scopes,
                 status, last_health_check_at::text, connected_by_user_id,
                 external_crm_ref,
                 created_at::text, updated_at::text`,
      [
        input.business_id,
        input.meta_user_id,
        input.meta_user_name,
        input.long_lived_token_encrypted,
        input.token_expires_at,
        input.granted_scopes,
        JSON.stringify(input.granular_scopes),
        input.status,
        input.connected_by_user_id,
      ],
    );
    return rows[0];
  },

  async markConnectionRevoked(connectionId: string): Promise<void> {
    await getPool().query(
      `UPDATE meta_connections
          SET status = 'revoked', updated_at = now()
        WHERE id = $1`,
      [connectionId],
    );
  },

  async refreshConnectionToken(
    connectionId: string,
    patch: {
      long_lived_token_encrypted: string;
      token_expires_at: string | null;
    },
  ): Promise<{ mirrored_businesses: number }> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE meta_connections
            SET long_lived_token_encrypted = $2,
                token_expires_at = $3::timestamptz,
                status = CASE WHEN status = 'revoked' THEN 'active' ELSE status END,
                last_health_check_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [connectionId, patch.long_lived_token_encrypted, patch.token_expires_at],
      );
      // Mirror the new expiry to every business whose ad account is under
      // this connection — keeps `businesses.meta_access_token_expires_at`
      // accurate so the dashboard banners + readiness check don't lag.
      const { rowCount } = await client.query(
        `UPDATE businesses
            SET meta_access_token_expires_at = $1::timestamptz,
                meta_auth_mode = 'user_token'
          WHERE meta_ad_account_id IN (
            SELECT ad_account_id
              FROM meta_ad_accounts
             WHERE connection_id = $2
          )`,
        [patch.token_expires_at, connectionId],
      );
      await client.query("COMMIT");
      return { mirrored_businesses: rowCount ?? 0 };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async upsertPage(input: UpsertPageInput): Promise<MetaPageRow> {
    const { rows } = await getPool().query<MetaPageRow>(
      `INSERT INTO meta_pages
         (connection_id, page_id, page_name, page_access_token_encrypted,
          category, tasks, business_id_meta, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (connection_id, page_id) DO UPDATE SET
         page_name = EXCLUDED.page_name,
         page_access_token_encrypted = EXCLUDED.page_access_token_encrypted,
         category = EXCLUDED.category,
         tasks = EXCLUDED.tasks,
         business_id_meta = EXCLUDED.business_id_meta,
         updated_at = now()
       RETURNING id::text, connection_id::text, page_id, page_name,
                 page_access_token_encrypted, category, tasks,
                 business_id_meta, selected`,
      [
        input.connection_id,
        input.page_id,
        input.page_name,
        input.page_access_token_encrypted,
        input.category,
        input.tasks,
        input.business_id_meta,
      ],
    );
    return rows[0];
  },

  async upsertIgAccount(
    input: UpsertIgAccountInput,
  ): Promise<MetaIgAccountRow> {
    // COALESCE on UPDATE: a later sync that doesn't know the linked_page (e.g.
    // BM-owned IG enumeration) should NOT overwrite a previously discovered
    // linked_page_id. Same for business_id_meta the other direction.
    const { rows } = await getPool().query<MetaIgAccountRow>(
      `INSERT INTO meta_ig_accounts
         (connection_id, ig_user_id, username, linked_page_id, business_id_meta, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (connection_id, ig_user_id) DO UPDATE SET
         username = EXCLUDED.username,
         linked_page_id = COALESCE(EXCLUDED.linked_page_id, meta_ig_accounts.linked_page_id),
         business_id_meta = COALESCE(EXCLUDED.business_id_meta, meta_ig_accounts.business_id_meta),
         updated_at = now()
       RETURNING id::text, connection_id::text, ig_user_id, username,
                 linked_page_id::text, business_id_meta, selected`,
      [
        input.connection_id,
        input.ig_user_id,
        input.username,
        input.linked_page_id,
        input.business_id_meta,
      ],
    );
    return rows[0];
  },

  async upsertAdAccount(
    input: UpsertAdAccountInput,
  ): Promise<MetaAdAccountRow> {
    const { rows } = await getPool().query<MetaAdAccountRow>(
      `INSERT INTO meta_ad_accounts
         (connection_id, ad_account_id, account_name, currency, timezone_name,
          user_role, business_id_meta, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (connection_id, ad_account_id) DO UPDATE SET
         account_name = EXCLUDED.account_name,
         currency = EXCLUDED.currency,
         timezone_name = EXCLUDED.timezone_name,
         user_role = EXCLUDED.user_role,
         business_id_meta = EXCLUDED.business_id_meta,
         updated_at = now()
       RETURNING id::text, connection_id::text, ad_account_id, account_name,
                 currency, timezone_name, user_role, business_id_meta, selected`,
      [
        input.connection_id,
        input.ad_account_id,
        input.account_name,
        input.currency,
        input.timezone_name,
        input.user_role,
        input.business_id_meta,
      ],
    );
    return rows[0];
  },

  async setSelectedPage(connectionId: string, pageId: string): Promise<void> {
    // Exactly one selected page per connection. Done in a transaction so
    // concurrent selections can't both end up true.
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE meta_pages SET selected = false WHERE connection_id = $1`,
        [connectionId],
      );
      await client.query(
        `UPDATE meta_pages SET selected = true
          WHERE connection_id = $1 AND page_id = $2`,
        [connectionId, pageId],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async setIgAccountSelected(
    connectionId: string,
    igUserId: string,
    selected: boolean,
  ): Promise<void> {
    await getPool().query(
      `UPDATE meta_ig_accounts SET selected = $3
        WHERE connection_id = $1 AND ig_user_id = $2`,
      [connectionId, igUserId, selected],
    );
  },

  async setSelectedAdAccount(
    connectionId: string,
    adAccountId: string,
  ): Promise<void> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE meta_ad_accounts SET selected = false WHERE connection_id = $1`,
        [connectionId],
      );
      await client.query(
        `UPDATE meta_ad_accounts SET selected = true
          WHERE connection_id = $1 AND ad_account_id = $2`,
        [connectionId, adAccountId],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async autofillBusinessKnowledge(
    businessId: string,
    patch: {
      website_url?: string | null;
      service_regions?: string[] | null;
    },
  ): Promise<void> {
    // INSERT-or-fill-NULLs: when a row doesn't exist, we create it with
    // whatever fields the caller passed; when it does, only fields that are
    // currently NULL get filled. COALESCE(existing, new) is the per-column
    // gate. Never overwrites operator-set values.
    await getPool().query(
      `INSERT INTO business_knowledge
         (business_id, website_url, service_regions, last_refreshed_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (business_id) DO UPDATE SET
         website_url = COALESCE(business_knowledge.website_url, EXCLUDED.website_url),
         service_regions = COALESCE(business_knowledge.service_regions, EXCLUDED.service_regions),
         last_refreshed_at = now()
       WHERE
         business_knowledge.website_url IS NULL
         OR business_knowledge.service_regions IS NULL`,
      [businessId, patch.website_url ?? null, patch.service_regions ?? null],
    );
  },

  async setBusinessMetaIds(
    businessId: string,
    patch: { ad_account_id?: string; page_id?: string },
  ): Promise<void> {
    const sets: string[] = [];
    const vals: (string | null)[] = [businessId];
    if (patch.ad_account_id !== undefined) {
      sets.push(`meta_ad_account_id = $${vals.length + 1}`);
      vals.push(patch.ad_account_id);
    }
    if (patch.page_id !== undefined) {
      sets.push(`meta_page_id = $${vals.length + 1}`);
      vals.push(patch.page_id);
    }
    if (sets.length === 0) return;
    await getPool().query(
      `UPDATE businesses SET ${sets.join(", ")} WHERE id = $1`,
      vals,
    );
  },

  async setBusinessAuthInfo(
    businessId: string,
    patch: {
      auth_mode: "user_token" | "system_user_token";
      access_token_expires_at: string | null;
    },
  ): Promise<void> {
    await getPool().query(
      `UPDATE businesses
          SET meta_auth_mode = $2,
              meta_access_token_expires_at = $3::timestamptz
        WHERE id = $1`,
      [businessId, patch.auth_mode, patch.access_token_expires_at],
    );
  },

  // ---- OAuth state -------------------------------------------------------

  async insertOAuthState(input): Promise<boolean> {
    try {
      await getPool().query(
        `INSERT INTO meta_oauth_state (state, app_user_id, business_id, expires_at)
         VALUES ($1, $2, $3, $4::timestamptz)`,
        [input.state, input.app_user_id, input.business_id, input.expires_at],
      );
      return true;
    } catch (e) {
      // Unique violation on the PK = replay attempt. Surface as false.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("duplicate key")) return false;
      throw e;
    }
  },

  async consumeOAuthState(state: string) {
    const { rows } = await getPool().query<{
      app_user_id: string;
      business_id: string;
    }>(
      `UPDATE meta_oauth_state
          SET consumed = true
        WHERE state = $1
          AND consumed = false
          AND expires_at > now()
       RETURNING app_user_id, business_id::text`,
      [state],
    );
    return rows[0] ?? null;
  },

  // ---- Audit log ---------------------------------------------------------

  async recordMetaApiCall(input: RecordApiCallInput): Promise<void> {
    await getPool().query(
      `INSERT INTO meta_api_calls
         (business_id, connection_id, capability, mode,
          meta_endpoint, http_method, request_summary,
          response_status, response_error, duration_ms, approval_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11)`,
      [
        input.business_id,
        input.connection_id,
        input.capability,
        input.mode,
        input.meta_endpoint,
        input.http_method,
        input.request_summary ? JSON.stringify(input.request_summary) : null,
        input.response_status,
        input.response_error ? JSON.stringify(input.response_error) : null,
        input.duration_ms,
        input.approval_id,
      ],
    );
  },

  // ---- Agent mode --------------------------------------------------------

  async setAgentMode(businessId: string, mode: AgentMode): Promise<void> {
    await getPool().query(
      `UPDATE businesses SET agent_mode = $2 WHERE id = $1`,
      [businessId, mode],
    );
  },

  // ---- A/B test orchestration (Block 11, 2026-05-13) ----------------------

  async listAbTests(businessId: string, mode) {
    let where: string;
    if (mode === "running") {
      where = "status = 'running'";
    } else if (mode === "ready_to_decide") {
      where = "status = 'running' AND planned_end_at <= now()";
    } else if (mode === "decided") {
      where =
        "status IN ('decided','cancelled') AND decided_at >= now() - interval '30 days'";
    } else {
      where =
        "(status = 'running' OR (decided_at IS NOT NULL AND decided_at >= now() - interval '90 days'))";
    }
    const rows = (
      await getPool().query(
        `
        SELECT t.id::text AS id,
               t.business_id::text AS business_id,
               t.campaign_id, t.adset_id, t.test_name,
               t.winner_metric, t.status,
               t.started_at::text AS started_at,
               t.planned_end_at::text AS planned_end_at,
               t.decided_at::text AS decided_at,
               t.decision_reason, t.winner_creative_id,
               t.decision_snapshot,
               (
                 SELECT json_agg(
                   json_build_object(
                     'creative_id', c.creative_id,
                     'variant_label', c.variant_label,
                     'creative_gallery_id', c.creative_gallery_id::text,
                     'added_at', c.added_at::text
                   )
                   ORDER BY c.variant_label
                 )
                   FROM ab_test_creatives c
                  WHERE c.test_id = t.id
               ) AS variants
          FROM ab_tests t
         WHERE t.business_id = $1 AND ${where}
         ORDER BY
           CASE WHEN t.status = 'running' AND t.planned_end_at <= now()
                THEN 0 ELSE 1 END,
           t.planned_end_at DESC NULLS LAST,
           t.created_at DESC
         LIMIT 100
      `,
        [businessId],
      )
    ).rows;
    return rows.map((r: Record<string, unknown>) => ({
      ...r,
      variants: (r.variants as unknown[] | null) ?? [],
    })) as unknown as Awaited<ReturnType<DataClient["listAbTests"]>>;
  },

  // ---- Audiences (Phase 1 — Campaigner Mastery Plan §4.2, 2026-05-13) -----

  async listAudiences(businessId: string, kind) {
    const where =
      kind === "all"
        ? "archived_at IS NULL"
        : "archived_at IS NULL AND kind = $2";
    const params: unknown[] = [businessId];
    if (kind !== "all") params.push(kind);

    const rows = (
      await getPool().query(
        `
        SELECT id::text AS id,
               business_id::text AS business_id,
               meta_audience_id, kind, subtype, name, description,
               approximate_count_lower_bound::bigint AS approximate_count_lower_bound,
               approximate_count_upper_bound::bigint AS approximate_count_upper_bound,
               retention_days,
               origin_audience_id,
               operation_status, delivery_status, data_source, rule,
               lookalike_spec,
               service_tag,
               time_created::text AS time_created,
               time_updated::text AS time_updated,
               synced_at::text AS synced_at,
               archived_at::text AS archived_at,
               -- Migration 030 (2026-05-17) — full saved-audience targeting.
               -- NULL for custom + lookalike rows (no targeting spec on those).
               targeting_summary, sentence_lines, targeting_parsed,
               age_min, age_max, genders, locales,
               geo_locations, excluded_geo_locations,
               interests, behaviors, life_events, industries,
               work_employers, work_positions,
               education_schools, education_majors,
               family_statuses, relationship_statuses,
               income, net_worth, home_ownership, home_type, home_value,
               ethnic_affinity, generation, politics, interested_in,
               custom_audiences_included, custom_audiences_excluded,
               flexible_spec, exclusions,
               publisher_platforms, facebook_positions, instagram_positions,
               audience_network_positions, messenger_positions, device_platforms
          FROM meta_audiences
         WHERE business_id = $1 AND ${where}
         ORDER BY kind, name
         LIMIT 500
        `,
        params,
      )
    ).rows;
    // pg returns bigint as string — convert to number (size ≤ 2B fits safely).
    return rows.map((r: Record<string, unknown>) => ({
      ...r,
      approximate_count_lower_bound:
        r.approximate_count_lower_bound == null
          ? null
          : Number(r.approximate_count_lower_bound),
      approximate_count_upper_bound:
        r.approximate_count_upper_bound == null
          ? null
          : Number(r.approximate_count_upper_bound),
    })) as unknown as Awaited<ReturnType<DataClient["listAudiences"]>>;
  },

  async setAudienceServiceTag(
    businessId: string,
    audienceId: string,
    serviceTag: string | null,
  ) {
    // Block 13 follow-up (2026-05-13) — manual override from /audiences UI.
    // Scope by both id AND business_id so a leaked audience-id from another
    // business can't be retagged via API misuse.
    const { rows } = await getPool().query(
      `UPDATE meta_audiences
          SET service_tag = $3
        WHERE id = $1 AND business_id = $2 AND archived_at IS NULL
        RETURNING id::text AS id,
                  business_id::text AS business_id,
                  meta_audience_id, kind, subtype, name, description,
                  approximate_count_lower_bound::bigint AS approximate_count_lower_bound,
                  approximate_count_upper_bound::bigint AS approximate_count_upper_bound,
                  retention_days,
                  origin_audience_id,
                  operation_status, delivery_status, data_source, rule,
                  lookalike_spec,
                  service_tag,
                  time_created::text AS time_created,
                  time_updated::text AS time_updated,
                  synced_at::text AS synced_at,
                  archived_at::text AS archived_at,
                  targeting_summary, sentence_lines, targeting_parsed,
                  age_min, age_max, genders, locales,
                  geo_locations, excluded_geo_locations,
                  interests, behaviors, life_events, industries,
                  work_employers, work_positions,
                  education_schools, education_majors,
                  family_statuses, relationship_statuses,
                  income, net_worth, home_ownership, home_type, home_value,
                  ethnic_affinity, generation, politics, interested_in,
                  custom_audiences_included, custom_audiences_excluded,
                  flexible_spec, exclusions,
                  publisher_platforms, facebook_positions, instagram_positions,
                  audience_network_positions, messenger_positions, device_platforms`,
      [audienceId, businessId, serviceTag],
    );
    if (rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    return {
      ...r,
      approximate_count_lower_bound:
        r.approximate_count_lower_bound == null
          ? null
          : Number(r.approximate_count_lower_bound),
      approximate_count_upper_bound:
        r.approximate_count_upper_bound == null
          ? null
          : Number(r.approximate_count_upper_bound),
    } as unknown as Awaited<ReturnType<DataClient["setAudienceServiceTag"]>>;
  },

  async getAudienceFlowStatus(businessId: string, serviceName: string | null) {
    // Block 13 follow-up (2026-05-13) — Flow E liveness for ServiceAudienceButton.
    // The runner stamps `details->>'service_name'` on every heartbeat, which
    // lets us scope to a single service. No service_name → business-level
    // status (any Flow-E run for this business).
    const FLOW = "propose_audiences_for_service";
    const RUNNING_STALE_MS = 5 * 60 * 1000;
    const params: unknown[] = [businessId, FLOW];
    let serviceClause = "";
    if (serviceName) {
      params.push(serviceName);
      serviceClause = " AND (details->>'service_name') = $3";
    }

    const baseWhere = `business_id = $1 AND flow = $2${serviceClause}`;
    const [startRow, endRow, errorRow] = await Promise.all([
      getPool().query(
        `SELECT ran_at::text AS ran_at FROM heartbeats
          WHERE ${baseWhere} AND phase = 'start'
          ORDER BY ran_at DESC LIMIT 1`,
        params,
      ),
      getPool().query(
        `SELECT ran_at::text AS ran_at FROM heartbeats
          WHERE ${baseWhere} AND phase = 'end'
          ORDER BY ran_at DESC LIMIT 1`,
        params,
      ),
      getPool().query(
        `SELECT ran_at::text AS ran_at FROM heartbeats
          WHERE ${baseWhere} AND phase = 'error'
          ORDER BY ran_at DESC LIMIT 1`,
        params,
      ),
    ]);
    const lastStart = (startRow.rows[0]?.ran_at as string | undefined) ?? null;
    const lastEnd = (endRow.rows[0]?.ran_at as string | undefined) ?? null;
    const lastError =
      (errorRow.rows[0]?.ran_at as string | undefined) ?? null;

    const startTs = lastStart ? Date.parse(lastStart) : 0;
    const endTs = lastEnd ? Date.parse(lastEnd) : 0;
    const errorTs = lastError ? Date.parse(lastError) : 0;
    const latestTerminal = Math.max(endTs, errorTs);
    const isFresh = startTs > 0 && Date.now() - startTs < RUNNING_STALE_MS;
    const running = startTs > latestTerminal && isFresh;

    let lastStatus: "idle" | "running" | "completed" | "errored" = "idle";
    if (running) lastStatus = "running";
    else if (errorTs > endTs && errorTs > 0) lastStatus = "errored";
    else if (endTs > 0) lastStatus = "completed";

    let pendingAudienceCount = 0;
    if (serviceName) {
      const r = await getPool().query(
        `SELECT COUNT(*)::int AS n FROM approvals
          WHERE business_id = $1
            AND status = 'pending'
            AND task_type IN ('create_custom_audience','create_saved_audience','create_lookalike')
            AND payload->>'service_tag' = $2
            AND created_at > now() - interval '24 hours'`,
        [businessId, serviceName],
      );
      pendingAudienceCount = (r.rows[0]?.n as number | undefined) ?? 0;
    }

    return {
      running,
      last_start_at: lastStart,
      last_end_at: lastEnd,
      last_error_at: lastError,
      last_status: lastStatus,
      pending_audience_count: pendingAudienceCount,
    };
  },

  // ---- Leads + quality grading (Phase 2, 2026-05-13) ----------------------

  async listLeads(businessId: string, filter) {
    let extra = "";
    if (filter === "ungraded") extra = "AND g.lead_id IS NULL";
    if (filter === "graded") extra = "AND g.lead_id IS NOT NULL";

    const rows = (
      await getPool().query(
        `
        SELECT l.id::text AS id,
               l.business_id::text AS business_id,
               l.meta_lead_id, l.meta_form_id,
               l.meta_ad_id, l.meta_adset_id, l.meta_campaign_id, l.meta_page_id,
               l.kind, l.full_name, l.email, l.phone, l.city,
               l.field_data, l.is_organic,
               l.meta_created_at::text AS meta_created_at,
               l.synced_at::text AS synced_at,
               l.archived_at::text AS archived_at,
               g.grade AS latest_grade,
               g.note AS latest_grade_note,
               g.converted AS latest_grade_converted,
               g.converted_value_ils AS latest_grade_converted_value_ils,
               g.graded_by AS latest_grade_by,
               g.graded_at::text AS latest_graded_at
          FROM leads l
          LEFT JOIN lead_latest_grade g ON g.lead_id = l.id
         WHERE l.business_id = $1
           AND l.archived_at IS NULL
           ${extra}
         ORDER BY l.meta_created_at DESC NULLS LAST
         LIMIT 500
        `,
        [businessId],
      )
    ).rows;
    return rows.map((r: Record<string, unknown>) => ({
      ...r,
      latest_grade_converted_value_ils:
        r.latest_grade_converted_value_ils == null
          ? null
          : Number(r.latest_grade_converted_value_ils),
    })) as unknown as Awaited<ReturnType<DataClient["listLeads"]>>;
  },

  async gradeLead(input) {
    const row = (
      await getPool().query(
        `
        INSERT INTO lead_quality_grades (
          lead_id, business_id, grade, note,
          converted, converted_value_ils, conversion_marked_at,
          graded_by, graded_at
        )
        VALUES (
          $1, $2, $3, $4,
          $5, $6,
          CASE WHEN $5 IS NOT NULL THEN now() ELSE NULL END,
          $7, now()
        )
        RETURNING id::text AS id
        `,
        [
          input.lead_id,
          input.business_id,
          input.grade,
          input.note ?? null,
          input.converted ?? null,
          input.converted_value_ils ?? null,
          input.graded_by ?? null,
        ],
      )
    ).rows[0];
    return { grade_id: row.id as string };
  },

  async getAbTestById(id: string, businessId: string) {
    const r = (
      await getPool().query(
        `
        SELECT t.id::text AS id,
               t.business_id::text AS business_id,
               t.campaign_id, t.adset_id, t.test_name,
               t.winner_metric, t.status,
               t.started_at::text AS started_at,
               t.planned_end_at::text AS planned_end_at,
               t.decided_at::text AS decided_at,
               t.decision_reason, t.winner_creative_id,
               t.decision_snapshot,
               (
                 SELECT json_agg(
                   json_build_object(
                     'creative_id', c.creative_id,
                     'variant_label', c.variant_label,
                     'creative_gallery_id', c.creative_gallery_id::text,
                     'added_at', c.added_at::text
                   )
                   ORDER BY c.variant_label
                 )
                   FROM ab_test_creatives c
                  WHERE c.test_id = t.id
               ) AS variants
          FROM ab_tests t
         WHERE t.id = $1 AND t.business_id = $2
         LIMIT 1
      `,
        [id, businessId],
      )
    ).rows[0];
    if (!r) return null;
    return {
      ...r,
      variants: r.variants ?? [],
    } as unknown as Awaited<ReturnType<DataClient["getAbTestById"]>>;
  },

  // ---- Monthly client-facing report (Block 10, 2026-05-13) ----------------

  async getMonthlyReport(businessId: string, month: string) {
    const pool = getPool();
    // Resolve window in business timezone.
    const biz = (
      await pool.query(
        `SELECT name, timezone, monthly_budget_ils
           FROM businesses WHERE id = $1`,
        [businessId],
      )
    ).rows[0];
    if (!biz) {
      throw new Error(`business not found: ${businessId}`);
    }

    const tz = biz.timezone || "Asia/Jerusalem";
    // Window: [first of month, min(last of month, now)) in business TZ.
    const windowRow = (
      await pool.query(
        `SELECT
           (($1 || '-01')::timestamp AT TIME ZONE $2) AS window_start,
           LEAST(
             ((date_trunc('month', ($1 || '-01')::timestamp) + interval '1 month') AT TIME ZONE $2),
             now()
           ) AS window_end`,
        [month, tz],
      )
    ).rows[0];
    const windowStart: Date = windowRow.window_start;
    const windowEnd: Date = windowRow.window_end;

    // 1. Agent activity — counts of decisions by type
    const decisionsRows = (
      await pool.query(
        `SELECT decision_type, COUNT(*)::int AS n
           FROM agent_decisions
          WHERE business_id = $1
            AND created_at >= $2
            AND created_at <  $3
          GROUP BY decision_type`,
        [businessId, windowStart, windowEnd],
      )
    ).rows;
    const byType: Record<string, number> = {};
    let totalDecisions = 0;
    for (const r of decisionsRows) {
      byType[r.decision_type] = r.n;
      totalDecisions += r.n;
    }

    // 2. Approvals — status counts + task_type executed counts
    const approvalsRows = (
      await pool.query(
        `SELECT status, COUNT(*)::int AS n
           FROM approvals
          WHERE business_id = $1
            AND created_at >= $2
            AND created_at <  $3
          GROUP BY status`,
        [businessId, windowStart, windowEnd],
      )
    ).rows;
    let proposed = 0;
    let executed = 0;
    let rejected = 0;
    let expired = 0;
    let pending = 0;
    for (const r of approvalsRows) {
      proposed += r.n;
      if (r.status === "executed") executed = r.n;
      else if (r.status === "rejected") rejected = r.n;
      else if (r.status === "expired") expired = r.n;
      else if (r.status === "pending") pending = r.n;
    }

    const byTaskTypeRows = (
      await pool.query(
        `SELECT task_type, COUNT(*)::int AS n
           FROM approvals
          WHERE business_id = $1
            AND status = 'executed'
            AND executed_at >= $2
            AND executed_at <  $3
          GROUP BY task_type`,
        [businessId, windowStart, windowEnd],
      )
    ).rows;
    const byTaskType: Record<string, number> = {};
    for (const r of byTaskTypeRows) byTaskType[r.task_type] = r.n;

    // 3. Highlights — top high-urgency executed approvals (max 6)
    const highlightRows = (
      await pool.query(
        `SELECT id::text, task_type, rationale, executed_at::text, urgency
           FROM approvals
          WHERE business_id = $1
            AND status = 'executed'
            AND executed_at >= $2
            AND executed_at <  $3
          ORDER BY
            CASE urgency
              WHEN 'urgent' THEN 4
              WHEN 'high'   THEN 3
              WHEN 'medium' THEN 2
              ELSE 1
            END DESC,
            executed_at DESC
          LIMIT 6`,
        [businessId, windowStart, windowEnd],
      )
    ).rows;

    // 4. Creative output — task-type buckets sliced from byTaskType
    const creativeOutput = {
      new_creatives: byTaskType["new_creative"] ?? 0,
      redeployed: byTaskType["redeploy_creative"] ?? 0,
      boosted_posts: byTaskType["boost_post"] ?? 0,
      organic_published:
        (byTaskType["publish_fb_post"] ?? 0) +
        (byTaskType["publish_ig_post"] ?? 0) +
        (byTaskType["publish_ig_story"] ?? 0) +
        (byTaskType["publish_ig_reel"] ?? 0),
    };

    // 5. Budget — pull the most recent budget_health decision in window
    const budgetRow = (
      await pool.query(
        `SELECT outputs, created_at::text
           FROM agent_decisions
          WHERE business_id = $1
            AND node_name = 'budget_health'
            AND created_at >= $2
            AND created_at <  $3
          ORDER BY created_at DESC
          LIMIT 1`,
        [businessId, windowStart, windowEnd],
      )
    ).rows[0];
    let budget: {
      spend_source: "budget_health_snapshot" | "unavailable";
      spend_ils: number | null;
      monthly_budget_ils: number | null;
      pace_pct: number | null;
      projected_monthly_ils: number | null;
      snapshot_at: string | null;
    };
    if (budgetRow && budgetRow.outputs) {
      const o = budgetRow.outputs as Record<string, unknown>;
      budget = {
        spend_source: "budget_health_snapshot",
        spend_ils: typeof o.spend_this_month === "number" ? o.spend_this_month : null,
        monthly_budget_ils:
          typeof o.effective_monthly_budget === "number"
            ? o.effective_monthly_budget
            : (biz.monthly_budget_ils ?? null),
        pace_pct: typeof o.pace === "number" ? o.pace * 100 : null,
        projected_monthly_ils:
          typeof o.projected_monthly_spend === "number"
            ? o.projected_monthly_spend
            : null,
        snapshot_at: budgetRow.created_at,
      };
    } else {
      budget = {
        spend_source: "unavailable",
        spend_ils: null,
        monthly_budget_ils: biz.monthly_budget_ils ?? null,
        pace_pct: null,
        projected_monthly_ils: null,
        snapshot_at: null,
      };
    }

    // 6. Open alerts — pending alert proposals (any age, not just window;
    // these are forward-looking flags the operator should see)
    const alertRows = (
      await pool.query(
        `SELECT id::text, payload, created_at::text
           FROM approvals
          WHERE business_id = $1
            AND task_type = 'alert'
            AND status = 'pending'
          ORDER BY created_at DESC
          LIMIT 10`,
        [businessId],
      )
    ).rows;

    // 7. A/B tests decided/cancelled in window. (Block 11 + 10 cross-link)
    const abDecidedRows = (
      await pool.query(
        `SELECT id::text AS id,
                test_name,
                winner_metric,
                status,
                decided_at::text AS decided_at,
                decision_reason,
                winner_creative_id,
                decision_snapshot
           FROM ab_tests
          WHERE business_id = $1
            AND status IN ('decided','cancelled')
            AND decided_at >= $2
            AND decided_at <  $3
          ORDER BY decided_at DESC
          LIMIT 20`,
        [businessId, windowStart, windowEnd],
      )
    ).rows;
    let countDecided = 0;
    let countCancelled = 0;
    const decidedOut: MonthlyReport["ab_tests"]["decided"] = [];
    for (const r of abDecidedRows) {
      if (r.status === "decided") countDecided += 1;
      else if (r.status === "cancelled") countCancelled += 1;
      const snap = (r.decision_snapshot ?? {}) as Record<string, unknown>;
      const winnerBlock = snap.winner as
        | { variant_label?: string }
        | undefined;
      decidedOut.push({
        id: r.id,
        test_name: r.test_name,
        winner_metric: r.winner_metric,
        status: r.status,
        winner_variant_label: winnerBlock?.variant_label ?? null,
        decided_at: r.decided_at,
        decision_reason: r.decision_reason ?? null,
        confidence: (snap.confidence as string | undefined) ?? null,
      });
    }

    // 8. Portfolio rebalance pairs. §T11 executes scale_up + scale_down
    // with `expected_impact.linked_to_*` pointing at the partner approval.
    // A "pair" is counted as one executed scale_up that references a
    // linked scale_down id (or vice versa, but counting on one side avoids
    // doubling). Best-effort sum of |delta| from payload's old/new budgets.
    const pairRows = (
      await pool.query(
        `SELECT id::text,
                payload,
                expected_impact
           FROM approvals
          WHERE business_id = $1
            AND task_type = 'scale_up'
            AND status = 'executed'
            AND executed_at >= $2
            AND executed_at <  $3
            AND expected_impact ? 'linked_to_scale_down_on'`,
        [businessId, windowStart, windowEnd],
      )
    ).rows;
    let movedTotal = 0;
    let movedFound = false;
    for (const p of pairRows) {
      const pl = (p.payload ?? {}) as Record<string, unknown>;
      const oldB = pl.old_daily_budget_ils;
      const newB = pl.new_daily_budget_ils;
      if (typeof oldB === "number" && typeof newB === "number") {
        movedTotal += Math.abs(newB - oldB);
        movedFound = true;
      }
    }

    return {
      business_id: businessId,
      business_name: biz.name,
      month,
      generated_at: new Date().toISOString(),
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      agent_activity: {
        total_decisions: totalDecisions,
        by_type: byType,
      },
      approvals: {
        proposed,
        executed,
        rejected,
        expired,
        pending,
        by_task_type: byTaskType,
        highlights: highlightRows.map((r) => ({
          id: r.id,
          task_type: r.task_type,
          rationale: r.rationale ?? "",
          executed_at: r.executed_at,
          urgency: r.urgency,
        })),
      },
      creative_output: creativeOutput,
      budget,
      open_alerts: alertRows.map((r) => {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          alert_type: typeof p.alert_type === "string" ? p.alert_type : null,
          message: typeof p.message === "string" ? p.message : null,
          created_at: r.created_at,
        };
      }),
      ab_tests: {
        count_decided: countDecided,
        count_cancelled: countCancelled,
        decided: decidedOut,
      },
      portfolio: {
        rebalance_pairs: pairRows.length,
        moved_ils_total: movedFound ? movedTotal : null,
      },
      lead_quality: await _leadQualitySummary(businessId, windowStart, windowEnd),
    };
  },

  async listReportableMonths(
    businessId: string,
    limit: number,
  ): Promise<string[]> {
    const rows = (
      await getPool().query(
        `SELECT DISTINCT to_char(created_at, 'YYYY-MM') AS month
           FROM agent_decisions
          WHERE business_id = $1
          ORDER BY month DESC
          LIMIT $2`,
        [businessId, limit],
      )
    ).rows;
    return rows.map((r: { month: string }) => r.month);
  },

  async listActivePlans(businessId: string) {
    const { rows } = await getPool().query(
      `SELECT pc.id::text AS id,
              pc.source_approval_id::text AS source_approval_id,
              pc.target_kind,
              pc.target_id,
              pc.step_order,
              pc.action_text,
              pc.trigger_condition,
              pc.committed_at::text AS committed_at,
              pc.expires_at::text AS expires_at,
              a.task_type AS source_task_type
         FROM plans_carryover pc
    LEFT JOIN approvals a ON a.id = pc.source_approval_id
        WHERE pc.business_id = $1
          AND pc.status = 'pending'
          AND pc.expires_at > now()
        ORDER BY pc.committed_at DESC, pc.step_order ASC`,
      [businessId],
    );
    return rows;
  },

  async ping() {
    await getPool().query("SELECT 1");
    return { ok: true as const, mode: "local-postgres" as const };
  },
};
