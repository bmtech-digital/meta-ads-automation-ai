export type DbMode = "local-postgres" | "supabase";

export type Vertical = "ecommerce" | "leads" | "awareness" | "app" | "other";
export type PrimaryKpi = "cpa" | "cpl" | "roas" | "cpm" | "cpi";

/**
 * Seasonal window — per decisions-log §1.10. `confidence='learned'` is v2 (War Chest);
 * MVP writes `user_stated` only and the editor refuses to modify learned rows.
 */
export interface SeasonalHint {
  name: string;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  multiplier: number;
  confidence: "user_stated" | "learned";
}

export interface SeasonalHints {
  windows?: SeasonalHint[];
}

export interface Business {
  id: string;
  name: string;
  timezone: string;
  meta_ad_account_id: string;
  meta_page_id: string;
  meta_auth_mode: "user_token" | "system_user_token";
  meta_access_token_expires_at: string | null;
  monthly_budget_ils: number | null;
  daily_budget_ils: number | null;
  seasonal_hints: SeasonalHints;
  primary_kpi: string | null;
  active: boolean;
  created_at: string;
}

export interface BusinessSettingsUpdate {
  name: string;
  meta_ad_account_id: string;
  meta_page_id: string;
  monthly_budget_ils: number | null;
}

export interface Product {
  name: string;
  description?: string;
  price_range?: string;
}

export interface BusinessKnowledge {
  id: string;
  business_id: string;
  vertical: Vertical | null;
  website_url: string | null;
  service_regions: string[] | null;
  customer_age_min: number | null;
  customer_age_max: number | null;
  products: Product[] | null;
  delivery_time_days: number | null;
  strong_seasons: string[] | null;
  weak_seasons: string[] | null;
  questionnaire_answers: Record<string, unknown> | null;
  brand_voice: Record<string, unknown> | null;
  competitors: string[] | null;
  last_refreshed_at: string;
  created_at: string;
}

export interface BusinessKnowledgeUpsert {
  business_id: string;
  vertical: Vertical | null;
  website_url: string | null;
  service_regions: string[] | null;
  customer_age_min: number | null;
  customer_age_max: number | null;
  products: Product[] | null;
  delivery_time_days: number | null;
  strong_seasons: string[] | null;
  weak_seasons: string[] | null;
  questionnaire_answers: Record<string, unknown> | null;
  brand_voice: Record<string, unknown> | null;
  competitors: string[] | null;
}

export type Urgency = "low" | "medium" | "high" | "urgent";
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "expired"
  | "dry_run";
export type TargetKind = "campaign" | "adset" | "ad" | "creative" | "account";

export interface Approval {
  id: string;
  business_id: string;
  created_at: string;
  created_by_run_id: string;
  task_type: string;
  target_kind: TargetKind | null;
  target_id: string | null;
  payload: Record<string, unknown>;
  rationale: string;
  expected_impact: Record<string, unknown> | null;
  urgency: Urgency;
  status: ApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  executed_at: string | null;
  execution_result: Record<string, unknown> | null;
  expires_at: string | null;
}

export type HeartbeatFlow =
  | "daily_observe_propose"
  | "execute_approvals"
  | "weekly_creative_firehose"
  | (string & {});
export type HeartbeatPhase = "start" | "end" | "error";

export interface Heartbeat {
  id: string;
  business_id: string | null;
  flow: HeartbeatFlow;
  phase: HeartbeatPhase;
  ran_at: string;
  duration_ms: number | null;
  exit_code: number | null;
  error_message: string | null;
}

export type CreativeAssetKind = "image" | "video" | "copy";
export type CreativeAssetSource = "imagen" | "gemini" | "manual_upload";

export interface CreativeAsset {
  id: string;
  business_id: string;
  kind: CreativeAssetKind;
  storage_url: string | null;
  aspect_ratio: string | null;
  dimensions: string | null;
  headline: string | null;
  primary_text: string | null;
  cta: string | null;
  generated_by: CreativeAssetSource | null;
  marketing_angle: string | null;
  service_tag: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  original_filename: string | null;
  duration_seconds: number | null;
  meta_creative_id: string | null;
  performance_snapshot: Record<string, unknown> | null;
  created_at: string;
  deleted_at: string | null;
}

export interface CreativeAssetCreate {
  business_id: string;
  kind: CreativeAssetKind;
  storage_url: string;
  aspect_ratio: string | null;
  dimensions: string | null;
  generated_by: CreativeAssetSource;
  marketing_angle: string | null;
  service_tag: string | null;
  mime_type: string;
  size_bytes: number;
  original_filename: string;
  duration_seconds: number | null;
}

export type DecisionType =
  | "observation"
  | "diagnosis"
  | "proposal"
  | "rejection"
  | "skip"
  | "execution"
  | "error";

export interface AgentDecision {
  id: string;
  business_id: string;
  run_id: string;
  graph_name: string;
  node_name: string;
  created_at: string;
  decision_type: DecisionType;
  summary: string;
  rationale: string | null;
  inputs: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  related_approval_id: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  llm_model: string | null;
  llm_tokens_in: number | null;
  llm_tokens_out: number | null;
  latency_ms: number | null;
  guardrail_violations: string[] | null;
  confidence: number | null;
}

/**
 * Contract every data-layer adapter must implement. Adding a query here means
 * both `local-postgres` and `supabase` implementations must grow in lockstep —
 * intentional friction to keep the surface area small.
 */
export interface DataClient {
  mode: DbMode;
  getBusinessById(id: string): Promise<Business | null>;
  getFirstBusiness(): Promise<Business | null>;
  updateBusinessSettings(id: string, patch: BusinessSettingsUpdate): Promise<Business | null>;
  updateSeasonalHints(id: string, hints: SeasonalHints): Promise<Business | null>;
  getLatestBudgetHealthDecision(businessId: string): Promise<AgentDecision | null>;

  getBusinessKnowledge(businessId: string): Promise<BusinessKnowledge | null>;
  upsertBusinessKnowledge(data: BusinessKnowledgeUpsert): Promise<BusinessKnowledge>;
  setPrimaryKpi(businessId: string, kpi: PrimaryKpi | null): Promise<void>;

  getLatestHeartbeats(businessId: string): Promise<Heartbeat[]>;

  listPendingApprovals(businessId: string): Promise<Approval[]>;
  getApprovalById(id: string): Promise<Approval | null>;
  listDecisionsForApproval(approvalId: string): Promise<AgentDecision[]>;
  listDecisionsForRun(businessId: string, runId: string): Promise<AgentDecision[]>;
  approveApproval(id: string, approvedBy: string): Promise<void>;
  rejectApproval(id: string, reason: string): Promise<void>;
  unapproveApproval(id: string): Promise<{ reverted: boolean }>;
  listHistory(businessId: string, days: number): Promise<Approval[]>;

  listGalleryAssets(businessId: string): Promise<CreativeAsset[]>;
  getGalleryAssetById(id: string): Promise<CreativeAsset | null>;
  createGalleryAsset(data: CreativeAssetCreate): Promise<CreativeAsset>;
  softDeleteGalleryAsset(id: string, businessId: string): Promise<{ deleted: boolean }>;

  ping(): Promise<{ ok: true; mode: DbMode }>;
}
