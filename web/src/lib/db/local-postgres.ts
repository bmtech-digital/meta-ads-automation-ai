import "server-only";
import { Pool } from "pg";
import type {
  AgentDecision,
  Approval,
  Business,
  BusinessKnowledge,
  BusinessKnowledgeUpsert,
  BusinessSettingsUpdate,
  CreativeAsset,
  CreativeAssetCreate,
  DataClient,
  Heartbeat,
  PrimaryKpi,
  SeasonalHints,
} from "./types";

declare global {
  // eslint-disable-next-line no-var
  var __campaignerPgPool: Pool | undefined;
}

function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for WEB_DB_MODE=local-postgres");
  if (!globalThis.__campaignerPgPool) {
    globalThis.__campaignerPgPool = new Pool({ connectionString: url, max: 5 });
  }
  return globalThis.__campaignerPgPool;
}

const SELECT_BUSINESS = `
  SELECT id::text, name, timezone,
         meta_ad_account_id, meta_page_id, meta_auth_mode,
         meta_access_token_expires_at::text,
         monthly_budget_ils, daily_budget_ils,
         COALESCE(seasonal_hints, '{}'::jsonb) AS seasonal_hints,
         primary_kpi,
         active, created_at::text
    FROM businesses
`;

const SELECT_KNOWLEDGE = `
  SELECT id::text, business_id::text, vertical, website_url,
         service_regions, customer_age_min, customer_age_max,
         products, delivery_time_days, strong_seasons, weak_seasons,
         questionnaire_answers, brand_voice, competitors,
         last_refreshed_at::text, created_at::text
    FROM business_knowledge
`;

const SELECT_APPROVAL = `
  SELECT id::text, business_id::text, created_at::text, created_by_run_id::text,
         task_type, target_kind, target_id, payload, rationale, expected_impact,
         urgency, status, approved_at::text, approved_by, rejection_reason,
         executed_at::text, execution_result, expires_at::text
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
    const { rows } = await getPool().query<Business>(`${SELECT_BUSINESS} WHERE id = $1 LIMIT 1`, [id]);
    return rows[0] ?? null;
  },

  async getFirstBusiness(): Promise<Business | null> {
    const { rows } = await getPool().query<Business>(
      `${SELECT_BUSINESS} WHERE active = true ORDER BY created_at ASC LIMIT 1`,
    );
    return rows[0] ?? null;
  },

  async updateBusinessSettings(id: string, patch: BusinessSettingsUpdate): Promise<Business | null> {
    const { rows } = await getPool().query<Business>(
      `UPDATE businesses
          SET name = $2,
              meta_ad_account_id = $3,
              meta_page_id = $4,
              monthly_budget_ils = $5
        WHERE id = $1
        RETURNING id::text, name, timezone,
                  meta_ad_account_id, meta_page_id, meta_auth_mode,
                  meta_access_token_expires_at::text,
                  monthly_budget_ils, daily_budget_ils,
                  COALESCE(seasonal_hints, '{}'::jsonb) AS seasonal_hints,
                  primary_kpi,
                  active, created_at::text`,
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

  async updateSeasonalHints(id: string, hints: SeasonalHints): Promise<Business | null> {
    const { rows } = await getPool().query<Business>(
      `UPDATE businesses
          SET seasonal_hints = $2::jsonb
        WHERE id = $1
        RETURNING id::text, name, timezone,
                  meta_ad_account_id, meta_page_id, meta_auth_mode,
                  meta_access_token_expires_at::text,
                  monthly_budget_ils, daily_budget_ils,
                  COALESCE(seasonal_hints, '{}'::jsonb) AS seasonal_hints,
                  primary_kpi,
                  active, created_at::text`,
      [id, JSON.stringify(hints ?? {})],
    );
    return rows[0] ?? null;
  },

  async getLatestBudgetHealthDecision(businessId: string): Promise<AgentDecision | null> {
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

  async getBusinessKnowledge(businessId: string): Promise<BusinessKnowledge | null> {
    const { rows } = await getPool().query<BusinessKnowledge>(
      `${SELECT_KNOWLEDGE} WHERE business_id = $1 LIMIT 1`,
      [businessId],
    );
    return rows[0] ?? null;
  },

  async upsertBusinessKnowledge(data: BusinessKnowledgeUpsert): Promise<BusinessKnowledge> {
    const { rows } = await getPool().query<BusinessKnowledge>(
      `INSERT INTO business_knowledge
         (business_id, vertical, website_url, service_regions,
          customer_age_min, customer_age_max, products, delivery_time_days,
          strong_seasons, weak_seasons, questionnaire_answers, brand_voice,
          competitors, last_refreshed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       ON CONFLICT (business_id) DO UPDATE SET
         vertical = EXCLUDED.vertical,
         website_url = EXCLUDED.website_url,
         service_regions = EXCLUDED.service_regions,
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
                 service_regions, customer_age_min, customer_age_max,
                 products, delivery_time_days, strong_seasons, weak_seasons,
                 questionnaire_answers, brand_voice, competitors,
                 last_refreshed_at::text, created_at::text`,
      [
        data.business_id,
        data.vertical,
        data.website_url,
        data.service_regions,
        data.customer_age_min,
        data.customer_age_max,
        data.products ? JSON.stringify(data.products) : null,
        data.delivery_time_days,
        data.strong_seasons,
        data.weak_seasons,
        data.questionnaire_answers ? JSON.stringify(data.questionnaire_answers) : null,
        data.brand_voice ? JSON.stringify(data.brand_voice) : null,
        data.competitors,
      ],
    );
    return rows[0];
  },

  async setPrimaryKpi(businessId: string, kpi: PrimaryKpi | null): Promise<void> {
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

  async listDecisionsForApproval(approvalId: string): Promise<AgentDecision[]> {
    const { rows } = await getPool().query<AgentDecision>(
      `${SELECT_DECISION}
        WHERE related_approval_id = $1
        ORDER BY created_at ASC`,
      [approvalId],
    );
    return rows;
  },

  async listDecisionsForRun(businessId: string, runId: string): Promise<AgentDecision[]> {
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
        data.business_id, data.kind, data.storage_url, data.aspect_ratio, data.dimensions,
        data.generated_by, data.marketing_angle, data.service_tag,
        data.mime_type, data.size_bytes, data.original_filename, data.duration_seconds,
      ],
    );
    return rows[0];
  },

  async softDeleteGalleryAsset(id: string, businessId: string): Promise<{ deleted: boolean }> {
    const { rowCount } = await getPool().query(
      `UPDATE creative_gallery
          SET deleted_at = now()
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [id, businessId],
    );
    return { deleted: (rowCount ?? 0) > 0 };
  },

  async ping() {
    await getPool().query("SELECT 1");
    return { ok: true as const, mode: "local-postgres" as const };
  },
};
