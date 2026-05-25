import type { GeoTargeting } from "@/lib/schemas/business-knowledge";

export type DbMode = "local-postgres" | "supabase";

export type Vertical =
  | "ecommerce"
  | "leads"
  | "b2b_saas"
  | "awareness"
  | "app"
  | "other";
export type PrimaryKpi = "cpa" | "cpl" | "roas" | "cpm" | "cpi";

/**
 * Seasonal window — per decisions-log §1.10. `confidence='learned'` is v2 (War Chest);
 * MVP writes `user_stated` only and the editor refuses to modify learned rows.
 */
export interface SeasonalHint {
  name: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  multiplier: number;
  confidence: "user_stated" | "learned";
}

export interface SeasonalHints {
  windows?: SeasonalHint[];
}

export type AgentMode = "insight" | "draft" | "action";

/**
 * Monthly Brief — operator-set context that shapes every structural proposal
 * the agent makes that month. Added migration 020 (M2 in decision-map.md).
 *
 * Stored as jsonb on `businesses.monthly_brief`. All fields optional;
 * `month` is auto-set on save to current YYYY-MM. Agent treats the brief as
 * stale when `month != current_month` and flags it in rationale.
 */
export interface MonthlyBrief {
  month?: string | null;
  active_offer?: string | null;
  deadline_date?: string | null;
  hands_off_campaign_ids?: string[] | null;
  notes?: string | null;
}

export type OnboardingStatus =
  | "not_started"
  | "brief_pending"
  | "audience_brief_pending"
  | "scanning"
  | "first_proposal_pending"
  | "completed";

export interface Business {
  id: string;
  name: string;
  timezone: string;
  meta_ad_account_id: string;
  /** Nullable since migration 016 — auto-provisioned businesses don't have a Page picked yet. */
  meta_page_id: string | null;
  meta_auth_mode: "user_token" | "system_user_token";
  meta_access_token_expires_at: string | null;
  monthly_budget_ils: number | null;
  daily_budget_ils: number | null;
  seasonal_hints: SeasonalHints;
  primary_kpi: string | null;
  /** Phase A (Mastery v2, Migration 028, 2026-05-17). Pre-v2 businesses default to 'completed'. */
  onboarding_status: OnboardingStatus;
  /** When the onboarding chain began. NULL = pre-v2 business. Drives cold-start front-load math (Phase F). */
  onboarding_started_at: string | null;
  /** Target value for the business's primary KPI. Added migration 019. NULL = not set; agent emits alert + skips kpi_vs_target branches in decision-tree §T0r. */
  target_cpa_ils: number | null;
  target_cpl_ils: number | null;
  target_roas: number | null;
  /** Operator-set monthly context — active offer, hands-off campaigns, notes. Added migration 020. NULL = not set. Agent treats as stale when `month != current_month`. */
  monthly_brief: MonthlyBrief | null;
  active: boolean;
  /** Three-mode HITL state machine — see migration 013 + decisions-log §1.12. */
  agent_mode: AgentMode;
  created_at: string;
}

export interface CreateBusinessForAdAccountInput {
  ad_account_id: string;
  /** Display name for this business — usually the ad account name. */
  name: string;
  /** From the ad account's timezone_name field; falls back to Asia/Jerusalem. */
  timezone: string | null;
}

export interface BusinessSettingsUpdate {
  name: string;
  meta_ad_account_id: string;
  meta_page_id: string;
  monthly_budget_ils: number | null;
}

/**
 * Subset of business fields edited from /business-knowledge — display name,
 * the operator-facing monthly budget, and the KPI target values added in
 * migration 019. Kept as a separate update path so the business-knowledge
 * form doesn't accidentally clobber Meta IDs that are now managed in
 * /integrations.
 *
 * All three target_* fields are stored simultaneously — the operator can set
 * "if I switch primary_kpi from cpl to cpa later, my target is already there."
 * The agent reads only the one that matches the current primary_kpi via
 * load_business_knowledge.kpi_target.target_value.
 */
export interface BusinessProfileUpdate {
  name: string;
  monthly_budget_ils: number | null;
  target_cpa_ils: number | null;
  target_cpl_ils: number | null;
  target_roas: number | null;
}

/**
 * Per-service research, written by the "חקור שירות זה" button on
 * /business-knowledge or by the agent's first Flow-A run that observes
 * a campaign using this product. Persists between sessions so each
 * service can carry its own market benchmark independent of other services.
 *
 * Shape mirrors the `research_block` returned by `estimate_cpl.py` —
 * caller can drop this into `propose_task --research` to satisfy
 * guardrail §26 with zero recomputation.
 */
export interface ProductResearch {
  market_average_ils: number;
  band_low_ils: number;
  band_high_ils: number;
  /** SubVertical key from cpl-infrastructure (e.g. "ai_chatbot_services"). */
  sub_vertical: string;
  matched_terms: string[];
  confidence: "high" | "medium" | "low";
  sources: Array<{ title: string; url: string; extracted: string }>;
  context_used: string[];
  source_of_estimate:
    | "static_cpl_infrastructure"
    | "live_websearch"
    | "manual_override";
  researched_at: string;
}

/**
 * Per-service KPI target — added 2026-05-13 (G1). Replaces the single
 * `businesses.target_cpl_ils` for multi-product businesses. The agent uses
 * the matched service's target when running against a specific campaign;
 * the business-level target remains as a fallback when no service is
 * matched. Stored in product.kpi_target (jsonb, no migration).
 */
export interface ProductKpiTarget {
  /** Target value in ILS for cpa/cpl, multiplier for roas. */
  value: number;
  kind: "cpa" | "cpl" | "roas";
  /** When the operator (or agent) set this target. */
  set_at: string;
  /** "manual" = operator typed; "derived_from_research" = pulled from product.research.market_average. */
  source: "manual" | "derived_from_research";
}

export interface Product {
  name: string;
  description?: string;
  price_range?: string;
  /**
   * Optional per-service research block. When present, dashboards + agent
   * use this for benchmarks against THIS service specifically (overrides
   * the per-sub-vertical static band). Operator runs research from the
   * /business-knowledge per-service "חקור" button. See decision-tree §T-2.
   */
  research?: ProductResearch;
  /**
   * Optional per-service KPI target — added 2026-05-13 (G1). Takes
   * precedence over the business-level `target_cpl_ils` for campaigns
   * that match this service via §T-2 per-campaign anchoring.
   */
  kpi_target?: ProductKpiTarget;
}

export interface BusinessKnowledge {
  id: string;
  business_id: string;
  vertical: Vertical | null;
  website_url: string | null;
  service_regions: string[] | null;
  /** Per-business geo (include + exclude). Migration 025. Mirror of Meta targeting.geo_locations + excluded_geo_locations. Source of truth for new_campaign + create_saved_audience proposals; service_regions is the legacy fallback. */
  geo_targeting: GeoTargeting | null;
  customer_age_min: number | null;
  customer_age_max: number | null;
  products: Product[] | null;
  delivery_time_days: number | null;
  strong_seasons: string[] | null;
  weak_seasons: string[] | null;
  questionnaire_answers: Record<string, unknown> | null;
  brand_voice: Record<string, unknown> | null;
  competitors: string[] | null;
  /** Day-Zero guardrail per migration 008 §2. Gates createOrUpdateMetaCampaign + publishInstagramContent. */
  tracking_verified: boolean;
  last_refreshed_at: string;
  created_at: string;
}

export interface BusinessKnowledgeUpsert {
  business_id: string;
  vertical: Vertical | null;
  website_url: string | null;
  service_regions: string[] | null;
  /** Per-business geo (include + exclude). Migration 025. Mirror of Meta targeting.geo_locations + excluded_geo_locations. Source of truth for new_campaign + create_saved_audience proposals; service_regions is the legacy fallback. Optional on upsert — partial-update callers that don't touch geo can omit it (upsertBusinessKnowledge passes null through unchanged). */
  geo_targeting?: GeoTargeting | null;
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
  /** When the publish should fire (organic posts). NULL = execute immediately on approve. */
  scheduled_for: string | null;
  /** Meta-side post/media id, written after a successful publish. */
  external_post_id: string | null;
  /** When the publish actually went live. NULL until Meta confirms. */
  published_at: string | null;
  /**
   * Phase 0 (Migration 027, 2026-05-17) — inline MCQ questions the agent posed
   * to the operator. Array of {id, prompt_he, options, multi?, required?}.
   * NULL/empty = no questions, normal approve/reject flow.
   */
  operator_questions:
    | Array<{
        id: string;
        prompt_he: string;
        options: Array<{ value: string; label_he: string }>;
        multi?: boolean;
        required?: boolean;
      }>
    | null;
  /** Operator answers to operator_questions. {<id>: value | [value, ...]}. */
  operator_response: Record<string, string | string[]> | null;
  /** When operator submitted MCQ answers. NULL until response is recorded. */
  answered_at: string | null;
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
 * Aggregate snapshot of a single agent run — one row per distinct
 * `agent_decisions.run_id`. Used by the /runs index and the home-page
 * "last scan" card to summarize a scan without dragging in every decision.
 * The detail page (`/runs/[run_id]`) still loads the full decision trail
 * via `listDecisionsForRun`.
 */
export interface RunSummaryRow {
  run_id: string;
  graph_name: string;
  started_at: string;
  ended_at: string;
  decision_count: number;
  proposal_count: number;
  skip_count: number;
  rejection_count: number;
  error_count: number;
  /** Distinct campaigns the run touched (via `agent_decisions.campaign_id`). */
  campaigns_touched: number;
}

// ---- Meta integration (Path B — OAuth) ---------------------------------
// Shapes mirror migration 011_meta_connections.sql. See
// `docs/plans/meta-integration-readiness.md` §2 + schemas/meta-connection.ts
// for the full Zod-validated wire shape.

export type ConnectionStatus = "active" | "partial" | "expired" | "revoked";

export interface GranularScope {
  scope: string;
  target_ids?: string[];
}

export interface MetaConnectionRow {
  id: string;
  business_id: string;
  meta_user_id: string;
  meta_user_name: string | null;
  long_lived_token_encrypted: string;
  token_expires_at: string | null;
  granted_scopes: string[];
  granular_scopes: GranularScope[];
  status: ConnectionStatus;
  last_health_check_at: string | null;
  connected_by_user_id: string | null;
  external_crm_ref: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface MetaPageRow {
  id: string;
  connection_id: string;
  page_id: string;
  page_name: string;
  page_access_token_encrypted: string;
  category: string | null;
  tasks: string[];
  /** BM id that owns the Page. Null for legacy connections (pre-migration 014) or personal Pages. */
  business_id_meta: string | null;
  selected: boolean;
}

export interface MetaIgAccountRow {
  id: string;
  connection_id: string;
  ig_user_id: string;
  username: string | null;
  /** Null when the IG is BM-owned and not linked to any Page our user accesses. */
  linked_page_id: string | null;
  /** BM id that owns this IG (per migration 015). Filtering by Ad Account uses this. */
  business_id_meta: string | null;
  selected: boolean;
}

export interface MetaAdAccountRow {
  id: string;
  connection_id: string;
  ad_account_id: string;
  account_name: string | null;
  currency: string | null;
  timezone_name: string | null;
  user_role: number | null;
  business_id_meta: string | null;
  selected: boolean;
}

/** Bundle a connection with its discovered assets — what the UI typically needs. */
export interface ConnectionWithAssets {
  connection: MetaConnectionRow;
  pages: MetaPageRow[];
  igAccounts: MetaIgAccountRow[];
  adAccounts: MetaAdAccountRow[];
}

export interface UpsertConnectionInput {
  business_id: string;
  meta_user_id: string;
  meta_user_name: string | null;
  long_lived_token_encrypted: string;
  token_expires_at: string | null;
  granted_scopes: string[];
  granular_scopes: GranularScope[];
  status: ConnectionStatus;
  connected_by_user_id: string | null;
}

export interface UpsertPageInput {
  connection_id: string;
  page_id: string;
  page_name: string;
  page_access_token_encrypted: string;
  category: string | null;
  tasks: string[];
  business_id_meta: string | null;
}

export interface UpsertIgAccountInput {
  connection_id: string;
  ig_user_id: string;
  username: string | null;
  linked_page_id: string | null;
  business_id_meta: string | null;
}

export interface UpsertAdAccountInput {
  connection_id: string;
  ad_account_id: string;
  account_name: string | null;
  currency: string | null;
  timezone_name: string | null;
  user_role: number | null;
  business_id_meta: string | null;
}

export interface RecordApiCallInput {
  business_id: string;
  connection_id: string | null;
  capability: string;
  mode: AgentMode;
  meta_endpoint: string;
  http_method: string;
  request_summary: Record<string, unknown> | null;
  response_status: number | null;
  response_error: Record<string, unknown> | null;
  duration_ms: number | null;
  approval_id: string | null;
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
  /** Every active business, ordered by name. Drives the business switcher in the nav. */
  listBusinesses(): Promise<Business[]>;
  /** Lookup by Meta ad_account_id (`act_...`). Returns null if no business yet. */
  findBusinessByAdAccountId(adAccountId: string): Promise<Business | null>;
  /**
   * Create a business row for a freshly-discovered Meta ad account. Returns
   * the existing row if one already exists for the same ad_account_id (race
   * safety on the OAuth-callback auto-provision path).
   */
  createBusinessForAdAccount(
    input: CreateBusinessForAdAccountInput,
  ): Promise<Business>;
  /**
   * Resolve a Meta connection via the ad_account_id rather than business_id.
   * Multiple businesses can share one connection (one OAuth handshake, many
   * client ad accounts), so the connection isn't owned by a single business.
   */
  getConnectionByAdAccountId(adAccountId: string): Promise<MetaConnectionRow | null>;
  updateBusinessSettings(
    id: string,
    patch: BusinessSettingsUpdate,
  ): Promise<Business | null>;
  updateBusinessProfile(
    id: string,
    patch: BusinessProfileUpdate,
  ): Promise<Business | null>;
  updateSeasonalHints(
    id: string,
    hints: SeasonalHints,
  ): Promise<Business | null>;
  getLatestBudgetHealthDecision(
    businessId: string,
  ): Promise<AgentDecision | null>;
  /**
   * Insert a fresh `budget_health` observation row sourced from a web-side
   * live Meta fetch (not from the agent's morning runner). Used by the
   * dashboard's SpendHero to keep the displayed spend in sync with Meta on
   * every page load.
   *
   * Caller has already pulled `spend_this_month` from Meta and recomputed
   * pace/projection in JS — this method just persists the row. Append-only,
   * same shape the agent writes.
   */
  recordBudgetHealthSnapshot(input: {
    business_id: string;
    summary: string;
    outputs: Record<string, unknown>;
  }): Promise<AgentDecision>;

  getBusinessKnowledge(businessId: string): Promise<BusinessKnowledge | null>;
  upsertBusinessKnowledge(
    data: BusinessKnowledgeUpsert,
  ): Promise<BusinessKnowledge>;
  setPrimaryKpi(businessId: string, kpi: PrimaryKpi | null): Promise<void>;

  getLatestHeartbeats(businessId: string): Promise<Heartbeat[]>;

  listPendingApprovals(businessId: string): Promise<Approval[]>;
  getApprovalById(id: string): Promise<Approval | null>;
  /**
   * Create a "promote creative to campaign" approval row from the gallery
   * priority queue. Sets task_type='new_creative' and stashes the asset id +
   * score/reasons in payload. The agent's execute_task currently flags
   * new_creative as UNSUPPORTED_MVP — that's expected: the row sits as a
   * human-visible pending approval until execute_task is extended to
   * dispatch it.
   */
  createPromotionApproval(input: {
    business_id: string;
    asset_id: string;
    score: number;
    reasons: string[];
    rationale: string;
    created_by_run_id: string;
  }): Promise<{ id: string; created_at: string }>;
  /**
   * Stage one `new_creative` approval per target campaign that asks the
   * operator to confirm propagating a winning Meta creative (by
   * meta_creative_id) to other active campaigns. Used by the gallery hero
   * "שכפל ל-N קמפיינים" CTA. Each row carries the source creative + source
   * campaign + target campaign in payload so the agent's execute_task can
   * dispatch them individually once new_creative is supported beyond the
   * gallery-upload path.
   *
   * Returns the inserted rows. Caller is responsible for picking the target
   * campaign list (typically: all active campaigns that don't already carry
   * this creative).
   */
  createMetaCreativeDuplicateApprovals(input: {
    business_id: string;
    source_meta_creative_id: string;
    source_campaign_id: string;
    source_campaign_name: string | null;
    source_metrics: {
      ctr: number | null;
      hook_rate: number | null;
      spend: number | null;
      impressions: number | null;
    };
    target_campaigns: Array<{ id: string; name: string }>;
    rationale: string;
    created_by_run_id: string;
  }): Promise<Array<{ id: string; created_at: string; target_campaign_id: string }>>;
  /**
   * Stage a `verify_pixel_capi` approval with pixel findings from Graph. The
   * human reviewer is the verification step — they confirm Pixel + CAPI + AEM
   * + domain are all green before approving. On approve, the approve action
   * calls `markTrackingVerified` to flip the Day-Zero guardrail.
   *
   * Idempotency: if a pending `verify_pixel_capi` row already exists for the
   * business, returns it instead of inserting a duplicate. Re-running the
   * check with no schema change is a no-op from the queue's perspective.
   */
  createPixelVerificationApproval(input: {
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
  }): Promise<{ id: string; created_at: string }>;
  /**
   * Persist a successful Pixel/CAPI verification result. UPSERTs into
   * `business_knowledge`:
   *   - tracking_verified = true
   *   - tracking_pixel_id = patch.pixel_id (when provided)
   *   - tracking_capi_configured = patch.capi_configured (when provided)
   *
   * Called from the approve action when the user approves a
   * `verify_pixel_capi` approval. Insert-or-update — the row may not exist
   * yet on a fresh business.
   */
  markTrackingVerified(
    businessId: string,
    patch: {
      pixel_id: string | null;
      capi_configured: boolean;
    },
  ): Promise<void>;
  /**
   * Write the target value for one KPI on a business. Called from the approve
   * action when the operator approves a `set_kpi_target` approval — the agent
   * recommended a value (with rationale + plan), the operator confirmed it.
   *
   * `kpi` decides which column to write:
   *   - 'cpa'  → target_cpa_ils
   *   - 'cpl'  → target_cpl_ils
   *   - 'roas' → target_roas
   *
   * Validation against the migration 019 CHECK constraints lives in the DB —
   * negative/zero CPA/CPL or ROAS < 1.0 will raise. Callers should validate
   * before calling for a friendlier error path.
   */
  /**
   * Write the monthly brief for a business. Called from the /business-knowledge
   * "תכנון חודשי" card on save. Replaces the entire brief — partial updates
   * are deliberately not supported (the brief is small enough that "patch
   * semantics" creates confusion: did the operator clear a field or just not
   * touch it?). Setting an empty/zero-key object clears the brief.
   *
   * `month` is auto-set on save by the route handler to current YYYY-MM in
   * the business's timezone — don't rely on operator to type it.
   */
  setMonthlyBrief(
    businessId: string,
    brief: MonthlyBrief | null,
  ): Promise<void>;
  setKpiTarget(
    businessId: string,
    kpi: "cpa" | "cpl" | "roas",
    value: number,
  ): Promise<void>;
  /**
   * Latest `set_kpi_target` approval for a (business, kpi) — used by the
   * dashboard to surface the agent's *researched* market average (the
   * business-specific value, not the generic per-vertical band from
   * `kpi-benchmarks.ts`). Returns null when the agent hasn't researched yet;
   * the UI falls back to the static band and labels the value honestly
   * ("ממוצע ענפי כללי" vs "ממוצע שהסוכן חקר לעסק שלך").
   *
   * Includes pending + approved + executed rows — research is informational
   * even before the operator approves the proposed target value. Rejected
   * rows are excluded (research was overruled).
   */
  getLatestKpiResearch(
    businessId: string,
    kpi: "cpa" | "cpl" | "roas",
  ): Promise<{
    market_average: number;
    range_low: number | null;
    range_high: number | null;
    sources_count: number;
    researched_at: string | null;
    approval_id: string;
  } | null>;
  listDecisionsForApproval(approvalId: string): Promise<AgentDecision[]>;
  listDecisionsForRun(
    businessId: string,
    runId: string,
  ): Promise<AgentDecision[]>;
  /**
   * One row per distinct `run_id` for a business, newest first. Drives the
   * /runs index and the home-page "last scan" card per
   * `docs/todos/surface-runs-detail.md`. `graphName` filters to a single graph
   * (typically `observe_propose`) so weekly creative / research runs don't
   * crowd out the daily-scan summary.
   */
  listRunsForBusiness(
    businessId: string,
    opts: { graphName?: string; limit?: number },
  ): Promise<RunSummaryRow[]>;
  approveApproval(id: string, approvedBy: string): Promise<void>;
  rejectApproval(id: string, reason: string): Promise<void>;
  unapproveApproval(id: string): Promise<{ reverted: boolean }>;
  /**
   * Phase 0 (Migration 027, 2026-05-17) — record operator's MCQ answers.
   * Flips status pending → answered + persists operator_response + answered_at.
   * Caller is responsible for validating the response shape against the
   * approval's operator_questions via `buildAnswerRequestSchema` BEFORE calling.
   * Returns `{ recorded: false }` if the row wasn't in 'pending' (concurrent
   * approve/reject/answer raced us); UI shows a stale-state notice.
   */
  answerApproval(
    id: string,
    response: Record<string, string | string[]>,
  ): Promise<{ recorded: boolean }>;
  /**
   * Phase A (Migration 028, 2026-05-17) — get the current onboarding step
   * snapshot for the /onboarding UI. Returns the business's status plus the
   * pending approval (if any) that the operator should act on next.
   */
  getOnboardingSnapshot(businessId: string): Promise<{
    status: OnboardingStatus;
    started_at: string | null;
    pending_approval: {
      id: string;
      task_type: string;
      rationale: string;
      created_at: string;
    } | null;
  }>;
  /**
   * Phase A (Migration 028, 2026-05-17) — flip a pre-v2 business
   * (status='completed' AND started_at IS NULL) to 'not_started' + record
   * onboarding_started_at=now(). Idempotent — businesses already in the
   * chain are unchanged. Called by /api/runners/trigger?flow=onboarding_chain
   * so the runner has something to advance.
   */
  beginOnboardingIfNeeded(
    businessId: string,
  ): Promise<{ started: boolean; status: OnboardingStatus }>;
  listHistory(businessId: string, days: number): Promise<Approval[]>;
  /**
   * Surface the agent's "transparent activity" — skip / rejection / route
   * diagnosis rows from `agent_decisions`. Added 2026-05-12 for /history Block
   * 3: lets the operator see "the agent checked X and decided not to act
   * because Y" or "the agent wanted to propose Z but a guardrail blocked it",
   * neither of which appear in the approvals feed.
   */
  listAgentActivity(businessId: string, days: number): Promise<AgentDecision[]>;

  listGalleryAssets(businessId: string): Promise<CreativeAsset[]>;
  getGalleryAssetById(id: string): Promise<CreativeAsset | null>;
  createGalleryAsset(data: CreativeAssetCreate): Promise<CreativeAsset>;
  softDeleteGalleryAsset(
    id: string,
    businessId: string,
  ): Promise<{ deleted: boolean }>;

  // ---- Meta connections (Path B) -----------------------------------------
  /** The active connection for a business, or null if none. */
  getActiveConnectionForBusiness(
    businessId: string,
  ): Promise<MetaConnectionRow | null>;
  /**
   * All connections owned by a given Meta user. Used by webhooks
   * (deauthorize, data-deletion) which receive `user_id` in the
   * `signed_request` payload and need to mark every connection that user
   * owns. Multiple businesses can share the same Meta user.
   */
  findConnectionsByMetaUserId(
    metaUserId: string,
  ): Promise<MetaConnectionRow[]>;
  getConnectionWithAssets(
    connectionId: string,
  ): Promise<ConnectionWithAssets | null>;
  upsertConnection(input: UpsertConnectionInput): Promise<MetaConnectionRow>;
  markConnectionRevoked(connectionId: string): Promise<void>;
  /**
   * Replace the encrypted token + new expiry on an existing connection (after
   * a successful `fb_exchange_token` refresh). Mirrors the new expiry to every
   * `businesses` row whose ad account is under this connection, so the
   * dashboard token banners stay accurate across all linked businesses.
   * Returns the count of mirrored business rows.
   */
  refreshConnectionToken(
    connectionId: string,
    patch: {
      long_lived_token_encrypted: string;
      token_expires_at: string | null;
    },
  ): Promise<{ mirrored_businesses: number }>;
  upsertPage(input: UpsertPageInput): Promise<MetaPageRow>;
  upsertIgAccount(input: UpsertIgAccountInput): Promise<MetaIgAccountRow>;
  upsertAdAccount(input: UpsertAdAccountInput): Promise<MetaAdAccountRow>;
  setSelectedPage(connectionId: string, pageId: string): Promise<void>;
  /**
   * Set the `selected` flag for a single IG account independently. Multi-select
   * by design — the agent can operate on any IG marked selected; the per-task
   * target is picked at proposal time. Differs from Page/Ad Account, which are
   * mutually exclusive because they mirror to `businesses.meta_page_id` /
   * `meta_ad_account_id` (single-valued).
   */
  setIgAccountSelected(
    connectionId: string,
    igUserId: string,
    selected: boolean,
  ): Promise<void>;
  setSelectedAdAccount(
    connectionId: string,
    adAccountId: string,
  ): Promise<void>;
  /**
   * Mirror an asset-picker selection to `businesses.meta_ad_account_id` /
   * `meta_page_id`. The rest of the app (dashboard, history, campaigns,
   * gallery) reads from `businesses.*` — keeping these in sync with the
   * `meta_*_accounts.selected` flag means a single pick in /integrations
   * propagates everywhere without refactoring every read site.
   */
  setBusinessMetaIds(
    businessId: string,
    patch: { ad_account_id?: string; page_id?: string },
  ): Promise<void>;
  /**
   * Update auth-mode + token expiry after an OAuth handshake completes. Path
   * B writes `mode='user_token'` and the long-lived token's expiry (~60d).
   * Path A writes `mode='system_user_token'` + `expiresAt=null`. Keeps the
   * dashboard token banner and the readiness check honest after a Connect.
   */
  setBusinessAuthInfo(
    businessId: string,
    patch: {
      auth_mode: "user_token" | "system_user_token";
      access_token_expires_at: string | null;
    },
  ): Promise<void>;
  /**
   * Soft auto-fill of business_knowledge from external sources (Meta Page
   * profile, etc.). Inserts a row if one doesn't exist for the business;
   * for existing rows, only fills fields that are currently NULL. Never
   * overwrites operator-set values — onboarding convenience, not a sync.
   */
  autofillBusinessKnowledge(
    businessId: string,
    patch: {
      website_url?: string | null;
      service_regions?: string[] | null;
    },
  ): Promise<void>;

  // ---- OAuth state -------------------------------------------------------
  /**
   * Persist a one-time OAuth state row with TTL. Returns true on insert,
   * false if `state` already exists (replay attempt).
   */
  insertOAuthState(input: {
    state: string;
    app_user_id: string;
    business_id: string;
    expires_at: string;
  }): Promise<boolean>;
  /**
   * Consume a state row atomically. Returns the row if it existed, was not
   * yet consumed, and has not expired. Returns null otherwise — caller treats
   * this as CSRF failure.
   */
  consumeOAuthState(state: string): Promise<{
    app_user_id: string;
    business_id: string;
  } | null>;

  // ---- Audit (Phase 1 wiring; full Graph integration in Phase 3) ----------
  recordMetaApiCall(input: RecordApiCallInput): Promise<void>;

  // ---- Agent mode --------------------------------------------------------
  setAgentMode(businessId: string, mode: AgentMode): Promise<void>;

  // ---- A/B test orchestration (Block 11, 2026-05-13) ----------------------
  /**
   * List A/B tests for a business. `mode` filters:
   *   - 'running'         — status='running'
   *   - 'ready_to_decide' — running AND planned_end_at <= now
   *   - 'decided'         — decided OR cancelled in last 30 days
   *   - 'all'             — running + decided/cancelled in last 90d
   */
  listAbTests(
    businessId: string,
    mode: "running" | "ready_to_decide" | "decided" | "all",
  ): Promise<AbTestRow[]>;
  /** Single A/B test with its variant list (for /ab-tests/[id] detail). */
  getAbTestById(id: string, businessId: string): Promise<AbTestRow | null>;

  // ---- Audiences (Phase 1 — Campaigner Mastery Plan §4.2, 2026-05-13) ------
  /**
   * Audiences from the local `meta_audiences` mirror. Synced from Meta by
   * the Python `sync_audiences.py` tool. Use `kind` to filter to a single
   * kind tab (custom / saved / lookalike / special_ad); `'all'` returns
   * non-archived rows across all kinds.
   */
  listAudiences(
    businessId: string,
    kind: "all" | "custom" | "saved" | "lookalike" | "special_ad",
  ): Promise<AudienceRow[]>;

  /**
   * Block 13 follow-up (2026-05-13) — manual service_tag assignment from /audiences.
   *
   * Synced audiences (those created manually in Meta Ads Manager and pulled
   * by sync_audiences.py) have `service_tag = NULL` by default. The operator
   * uses this method via the per-row dropdown on `/audiences` to attribute
   * an existing audience to a specific service. Pass `serviceTag = null` to
   * clear an assignment.
   *
   * Validates audience exists for this business — does NOT validate the
   * service_tag against products (the caller in the API route does that
   * with access to `business_knowledge`).
   *
   * Returns the updated row so the UI can re-render without a separate read.
   */
  setAudienceServiceTag(
    businessId: string,
    audienceId: string,
    serviceTag: string | null,
  ): Promise<AudienceRow | null>;

  /**
   * Block 13 follow-up (2026-05-13) — UX truthiness for ServiceAudienceButton.
   *
   * Returns the current state of Flow E for a given business + optional
   * service. Reads from `heartbeats` (start/end/error timestamps) and from
   * `approvals` (count of pending audience proposals for the service tag).
   *
   * Used by:
   *   1. `/api/business-knowledge/audience-flow-status` — polled by the
   *      ServiceAudienceButton every ~2s while the operator waits.
   *   2. `/api/business-knowledge/propose-audiences` — checks `running`
   *      before spawning to return 409 on a duplicate trigger.
   */
  getAudienceFlowStatus(
    businessId: string,
    serviceName: string | null,
  ): Promise<{
    running: boolean;
    last_start_at: string | null;
    last_end_at: string | null;
    last_error_at: string | null;
    last_status: "idle" | "running" | "completed" | "errored";
    pending_audience_count: number;
  }>;

  // ---- Leads + quality grading (Phase 2 — mastery plan §5, 2026-05-13) -----
  /**
   * List leads for the business with the latest quality grade (if any).
   * `filter='ungraded'` returns only leads without any grade yet (the
   * operator's grading queue). `'all'` returns everything.
   */
  listLeads(
    businessId: string,
    filter: "all" | "ungraded" | "graded",
  ): Promise<LeadRow[]>;
  /**
   * Insert a new grade row. Multiple grades per lead are allowed; the
   * `lead_latest_grade` view returns the newest.
   */
  gradeLead(input: GradeLeadInput): Promise<{ grade_id: string }>;

  // ---- Monthly client-facing report (Block 10, 2026-05-13) ----------------
  /**
   * Aggregated month-in-review data for a business. Reads agent_decisions +
   * approvals + creative_gallery for the month window. Spend/conversions
   * aren't stored historically (would require Meta API), so they're best-
   * effort from the latest budget_health decision in the window.
   *
   * `month` is YYYY-MM in business timezone. End of window is min(month_end,
   * now()) so a mid-month call returns data through today.
   */
  getMonthlyReport(
    businessId: string,
    month: string,
  ): Promise<MonthlyReport>;
  /**
   * The most recent months that have at least one agent_decisions row for
   * this business. Used by /reports index to populate the month list without
   * showing empty months. Returns YYYY-MM strings, newest first.
   */
  listReportableMonths(businessId: string, limit: number): Promise<string[]>;

  /**
   * List currently-pending forward-plan commitments (`plans_carryover` rows
   * where status='pending' AND expires_at > now()). Migration 023, 2026-05-13 PM.
   * Drives the `/plans` UI page so the operator sees what the agent committed
   * to in prior approvals before reviewing new proposals.
   */
  listActivePlans(businessId: string): Promise<PlanCarryoverRow[]>;

  ping(): Promise<{ ok: true; mode: DbMode }>;
}

/**
 * A/B test row — Block 11 (2026-05-13). Mirrors `ab_tests` + a nested
 * `variants[]` array sourced from `ab_test_creatives`. Reused by /ab-tests
 * index and /ab-tests/[id] detail.
 */
export type AbTestStatus = "running" | "decided" | "cancelled" | "expired";
export type AbTestWinnerMetric =
  | "hook_rate"
  | "ctr"
  | "cpa"
  | "cpl"
  | "conversions";

export interface AbTestVariant {
  creative_id: string;
  variant_label: string; // 'A' | 'B' | 'C' | 'D'
  creative_gallery_id: string | null;
  added_at: string;
}

/**
 * Audience row — Phase 1 (2026-05-13). Mirrors `meta_audiences` (migration 022).
 * Sized fields are stored as bigint in PG; we use `number | null` since the
 * counts fit comfortably in JS Number range (max audience size on Meta is
 * ~2 billion).
 */
export type AudienceKind = "custom" | "saved" | "lookalike" | "special_ad";

/**
 * Geo envelope written by the Python parser (`audience_targeting.parse_targeting`).
 * Mirrors Meta's `targeting.geo_locations` / `targeting.excluded_geo_locations`
 * shape after light normalization. Every sub-array is optional — Meta returns
 * only the keys the operator selected.
 */
export interface AudienceGeoEnvelope {
  countries?: Array<{ key?: string; name?: string } | string>;
  country_groups?: Array<{ key?: string; name?: string }>;
  regions?: Array<{ key?: string; name?: string; country?: string }>;
  cities?: Array<{
    key?: string;
    name?: string;
    country?: string;
    region?: string;
    radius?: number;
    distance_unit?: "kilometer" | "mile" | string;
  }>;
  zips?: Array<{ key?: string; name?: string; primary_city_id?: string }>;
  geo_markets?: Array<{ key?: string; name?: string }>;
  electoral_districts?: Array<{ key?: string; name?: string }>;
  neighborhoods?: Array<{ key?: string; name?: string }>;
  subcities?: Array<{ key?: string; name?: string }>;
  subneighborhoods?: Array<{ key?: string; name?: string }>;
  custom_locations?: Array<{
    name?: string;
    address_string?: string;
    latitude?: number;
    longitude?: number;
    radius?: number;
    distance_unit?: "kilometer" | "mile" | string;
    primary_city_id?: string;
    country?: string;
  }>;
  location_types?: string[];
}

/**
 * Single Meta targeting entry — interests / behaviors / industries / etc.
 * Meta returns {id, name} at minimum; behaviors sometimes add a `category`.
 */
export interface AudienceTargetingEntry {
  id?: string | number;
  name?: string;
  category?: string;
  audience_size_lower_bound?: number;
  audience_size_upper_bound?: number;
}

/** Custom-audience reference (included / excluded). */
export interface AudienceCustomRef {
  id?: string;
  name?: string;
}

export interface AudienceRow {
  id: string;
  business_id: string;
  meta_audience_id: string;
  kind: AudienceKind;
  subtype: string | null;
  name: string;
  description: string | null;
  approximate_count_lower_bound: number | null;
  approximate_count_upper_bound: number | null;
  retention_days: number | null;
  origin_audience_id: string | null;
  operation_status: Record<string, unknown> | null;
  delivery_status: Record<string, unknown> | null;
  data_source: Record<string, unknown> | null;
  rule: Record<string, unknown> | null;
  lookalike_spec: Record<string, unknown> | null;
  /**
   * Block 13 (2026-05-13, migration 024): the business_knowledge.products[].name
   * this audience was created for. NULL when synced from Meta without going
   * through Flow E (i.e. created manually in Ads Manager).
   */
  service_tag: string | null;
  time_created: string | null;
  time_updated: string | null;
  synced_at: string;
  archived_at: string | null;

  // --- Migration 030 (2026-05-17) — full saved-audience targeting -----------
  // Populated only for `kind = 'saved'`; custom + lookalike rows have NULLs.
  /** Hebrew one-line summary built by the parser. Operator-readable, no jargon. */
  targeting_summary: string | null;
  /**
   * Meta's own human-readable breakdown of the targeting spec. NOT a flat
   * string array — Meta returns each line as `{content, children}` where
   * `content` is the label ("מיקום:", "גיל:", "אנשים תואמים:") and
   * `children` is an array of strings carrying the actual values. Meta
   * pre-localizes this to the account's language (Hebrew for IL accounts)
   * which makes it our best "what does this audience actually do?" view.
   */
  sentence_lines: Array<{ content?: string; children?: string[] }> | null;
  /** TRUE = parsed cleanly, FALSE = parse hit unexpected shape, NULL = no targeting. */
  targeting_parsed: boolean | null;

  // Demographics
  age_min: number | null;
  age_max: number | null;
  /** Normalized to {male, female}. NULL = all genders. */
  genders: Array<"male" | "female"> | null;
  /** Meta locale IDs/names — kept opaque, rarely rendered. */
  locales: unknown | null;

  // Geo
  geo_locations: AudienceGeoEnvelope | null;
  excluded_geo_locations: AudienceGeoEnvelope | null;

  // Detailed targeting (the "what they're into / who they are" axis)
  interests: AudienceTargetingEntry[] | null;
  behaviors: AudienceTargetingEntry[] | null;
  life_events: AudienceTargetingEntry[] | null;
  industries: AudienceTargetingEntry[] | null;
  work_employers: AudienceTargetingEntry[] | null;
  work_positions: AudienceTargetingEntry[] | null;
  education_schools: AudienceTargetingEntry[] | null;
  education_majors: AudienceTargetingEntry[] | null;
  family_statuses: AudienceTargetingEntry[] | null;
  relationship_statuses: AudienceTargetingEntry[] | null;
  income: AudienceTargetingEntry[] | null;
  net_worth: AudienceTargetingEntry[] | null;
  home_ownership: AudienceTargetingEntry[] | null;
  home_type: AudienceTargetingEntry[] | null;
  home_value: AudienceTargetingEntry[] | null;
  ethnic_affinity: AudienceTargetingEntry[] | null;
  generation: AudienceTargetingEntry[] | null;
  politics: AudienceTargetingEntry[] | null;
  /** `interested_in` is Meta's "interested in [men/women]" demographic. */
  interested_in: number[] | null;

  // Custom-audience refs + OR-clauses + non-geo exclusions
  custom_audiences_included: AudienceCustomRef[] | null;
  custom_audiences_excluded: AudienceCustomRef[] | null;
  flexible_spec: Array<Record<string, unknown>> | null;
  exclusions: Record<string, unknown> | null;

  // Placements
  publisher_platforms: string[] | null;
  facebook_positions: string[] | null;
  instagram_positions: string[] | null;
  audience_network_positions: string[] | null;
  messenger_positions: string[] | null;
  device_platforms: string[] | null;
}

/**
 * Lead row — Phase 2 (2026-05-13). Mirrors `leads` (migration 023) + the
 * latest grade from `lead_latest_grade` view.
 */
export interface LeadRow {
  id: string;
  business_id: string;
  meta_lead_id: string;
  meta_form_id: string | null;
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  meta_page_id: string | null;
  kind: "form_lead" | "message_conversation";
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  field_data: Array<{ name: string; values: string[] }> | null;
  is_organic: boolean | null;
  meta_created_at: string | null;
  synced_at: string;
  archived_at: string | null;

  /** Latest grade — null if ungraded. */
  latest_grade: number | null;
  latest_grade_note: string | null;
  latest_grade_converted: boolean | null;
  latest_grade_converted_value_ils: number | null;
  latest_grade_by: string | null;
  latest_graded_at: string | null;
}

export interface GradeLeadInput {
  lead_id: string;
  business_id: string;
  grade: 1 | 2 | 3 | 4 | 5;
  note?: string | null;
  converted?: boolean | null;
  converted_value_ils?: number | null;
  graded_by?: string | null;
}

export interface AbTestRow {
  id: string;
  business_id: string;
  campaign_id: string;
  adset_id: string;
  test_name: string;
  winner_metric: AbTestWinnerMetric;
  status: AbTestStatus;
  started_at: string;
  planned_end_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  winner_creative_id: string | null;
  decision_snapshot: Record<string, unknown> | null;
  variants: AbTestVariant[];
}

/**
 * Monthly client-facing report shape — Block 10 (2026-05-13).
 *
 * Three layers, in this order of trust:
 *   1. agent activity — proposals, executions, rejections counted from
 *      agent_decisions + approvals. Fully reliable.
 *   2. creative output — count of new_creative + redeploy_creative +
 *      boost_post executed in the window. Reliable.
 *   3. spend/conversions — sourced from the latest budget_health agent_decisions
 *      row in the window. Reliable as of that snapshot, may be 0-24h stale.
 *      `spend_source: 'budget_health_snapshot' | 'unavailable'` makes the
 *      provenance explicit so the operator can read it honestly.
 */
export interface MonthlyReport {
  business_id: string;
  business_name: string;
  month: string; // YYYY-MM
  generated_at: string; // ISO
  window_start: string; // ISO — first day of month, business TZ
  window_end: string; // ISO — last day or now, whichever earlier
  agent_activity: {
    total_decisions: number;
    by_type: Record<string, number>; // decision_type -> count
  };
  approvals: {
    proposed: number;
    executed: number;
    rejected: number;
    expired: number;
    pending: number;
    by_task_type: Record<string, number>; // task_type -> executed count
    highlights: Array<{
      id: string;
      task_type: string;
      rationale: string;
      executed_at: string | null;
      urgency: string;
    }>;
  };
  creative_output: {
    new_creatives: number;
    redeployed: number;
    boosted_posts: number;
    organic_published: number;
  };
  budget: {
    spend_source: "budget_health_snapshot" | "unavailable";
    spend_ils: number | null;
    monthly_budget_ils: number | null;
    pace_pct: number | null;
    projected_monthly_ils: number | null;
    snapshot_at: string | null;
  };
  open_alerts: Array<{
    id: string;
    alert_type: string | null;
    message: string | null;
    created_at: string;
  }>;
  /**
   * A/B tests resolved this month — wired 2026-05-13 (extends Block 10 with
   * Block 11 data). Tests still running are intentionally NOT in here; the
   * report is "what happened this month", not "what's pending".
   *
   * `count_decided` / `count_cancelled` are clean integer counts;
   * `decided[]` contains the row-level detail for the section render.
   */
  ab_tests: {
    count_decided: number;
    count_cancelled: number;
    decided: Array<{
      id: string;
      test_name: string;
      winner_metric: string;
      status: "decided" | "cancelled";
      winner_variant_label: string | null;
      decided_at: string;
      decision_reason: string | null;
      confidence: string | null;
    }>;
  };
  /**
   * Portfolio rebalance pairs executed this month. §T11 emits paired
   * scale_up + scale_down with linked_to_* references; we join on those to
   * reconstruct the pair. Wired 2026-05-13 (extends Block 10 with Block 9).
   */
  portfolio: {
    rebalance_pairs: number; // count of executed pairs
    moved_ils_total: number | null; // sum of |delta| across executed pairs (best-effort)
  };
  /**
   * Phase 8 (Campaigner Mastery Plan §11, 2026-05-13) — lead quality summary
   * for the month. The 16.4 lesson surfaced in the monthly report: a campaign
   * with cheap raw CPL can have terrible adjusted CPL, and the operator deserves
   * to see both columns side-by-side. Empty if no leads landed this month.
   */
  lead_quality: {
    total_leads: number;
    graded_leads: number;
    ungraded_leads: number;
    avg_grade: number | null;
    band: "high" | "mixed" | "low" | "insufficient_data" | "no_leads";
    grade_distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  };
}

export interface PlanCarryoverRow {
  id: string;
  source_approval_id: string | null;
  target_kind: "campaign" | "adset" | "ad" | "creative" | "account" | null;
  target_id: string | null;
  step_order: number;
  action_text: string;
  trigger_condition: string | null;
  committed_at: string;
  expires_at: string;
  // joined source-approval context (best-effort)
  source_task_type: string | null;
}
