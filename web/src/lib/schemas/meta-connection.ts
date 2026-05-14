import { z } from "zod";

/**
 * Schemas for Path B (OAuth) Meta connections. Path A (system_user_token)
 * doesn't use these — it stays on the existing `businesses.meta_access_token_encrypted`
 * column with `meta_auth_mode='system_user_token'`.
 *
 * Three concentric shapes:
 *   1. Raw Graph response (what Meta sends back)
 *   2. Persisted row (what's in `meta_connections` and siblings)
 *   3. UI projection (what `/integrations` renders)
 */

// ---- 1. Raw Graph responses (validation at the network boundary) -------

/** GET /me?fields=id,name */
export const metaMeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type MetaMe = z.infer<typeof metaMeSchema>;

/** GET /me/permissions — flat granted/declined list. */
export const metaPermissionSchema = z.object({
  permission: z.string(),
  status: z.enum(["granted", "declined", "expired"]),
});
export const metaPermissionsResponseSchema = z.object({
  data: z.array(metaPermissionSchema),
});

/**
 * GET /me?fields=granular_scopes — per-asset grants. `target_ids` is absent
 * when the scope is granted unrestricted; present (possibly empty) when the
 * user limited it.
 */
export const granularScopeSchema = z.object({
  scope: z.string(),
  target_ids: z.array(z.string()).optional(),
});
export type GranularScope = z.infer<typeof granularScopeSchema>;

/** GET /me/accounts?fields=id,name,access_token,tasks,category */
export const metaPageRawSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  access_token: z.string().min(1),
  tasks: z.array(z.string()).optional().default([]),
  category: z.string().optional(),
});

/** GET /{page-id}?fields=instagram_business_account{id,username} */
export const metaIgBusinessAccountRawSchema = z.object({
  id: z.string().min(1),
  username: z.string().optional(),
});

/**
 * GET /me/adaccounts?fields=id,name,currency,timezone_name,user_role,business
 * `account_status` from Meta is an int; we keep it but don't use it for gating.
 */
export const metaAdAccountRawSchema = z.object({
  id: z.string().regex(/^act_\d+$/, "expected act_<digits>"),
  name: z.string().optional(),
  currency: z.string().optional(),
  timezone_name: z.string().optional(),
  user_role: z.number().int().min(0).max(10).optional(),
  business: z.object({ id: z.string() }).optional(),
});

/**
 * GET /debug_token?input_token=<token> response shape. We only validate the
 * fields we use; Meta returns more.
 */
export const debugTokenResponseSchema = z.object({
  data: z.object({
    app_id: z.string(),
    is_valid: z.boolean(),
    expires_at: z.number().int(),
    data_access_expires_at: z.number().int().optional(),
    scopes: z.array(z.string()).optional().default([]),
    user_id: z.string().optional(),
  }),
});

// ---- 2. Persisted row shape (what the DB adapter returns) --------------

export const connectionStatusSchema = z.enum([
  "active",
  "partial",
  "expired",
  "revoked",
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const metaConnectionSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  meta_user_id: z.string(),
  meta_user_name: z.string().nullable(),
  // The encrypted blob is intentionally returned to the adapter; route
  // handlers must call `decryptToken(...)` before using it.
  long_lived_token_encrypted: z.string(),
  token_expires_at: z.string().nullable(),
  granted_scopes: z.array(z.string()),
  granular_scopes: z.array(granularScopeSchema),
  status: connectionStatusSchema,
  last_health_check_at: z.string().nullable(),
  connected_by_user_id: z.string().nullable(),
  external_crm_ref: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MetaConnection = z.infer<typeof metaConnectionSchema>;

export const metaPageRowSchema = z.object({
  id: z.string().uuid(),
  connection_id: z.string().uuid(),
  page_id: z.string(),
  page_name: z.string(),
  page_access_token_encrypted: z.string(),
  category: z.string().nullable(),
  tasks: z.array(z.string()),
  selected: z.boolean(),
  external_crm_ref: z.unknown().nullable(),
});
export type MetaPageRow = z.infer<typeof metaPageRowSchema>;

export const metaIgAccountRowSchema = z.object({
  id: z.string().uuid(),
  connection_id: z.string().uuid(),
  ig_user_id: z.string(),
  username: z.string().nullable(),
  linked_page_id: z.string().uuid(),
  selected: z.boolean(),
  external_crm_ref: z.unknown().nullable(),
});
export type MetaIgAccountRow = z.infer<typeof metaIgAccountRowSchema>;

export const metaAdAccountRowSchema = z.object({
  id: z.string().uuid(),
  connection_id: z.string().uuid(),
  ad_account_id: z.string().regex(/^act_\d+$/),
  account_name: z.string().nullable(),
  currency: z.string().nullable(),
  timezone_name: z.string().nullable(),
  user_role: z.number().int().nullable(),
  business_id_meta: z.string().nullable(),
  selected: z.boolean(),
  external_crm_ref: z.unknown().nullable(),
});
export type MetaAdAccountRow = z.infer<typeof metaAdAccountRowSchema>;

// ---- 3. OAuth state token (CSRF) ---------------------------------------

/**
 * The payload encoded inside the HMAC-signed state parameter. Stays opaque to
 * Meta — bounced back verbatim in the callback. The DB row in
 * `meta_oauth_state` enforces single-use by primary key on the full token.
 */
export const oauthStatePayloadSchema = z.object({
  app_user_id: z.string().min(1),
  business_id: z.string().uuid(),
  nonce: z.string().min(16),
  ts: z.number().int().positive(),
});
export type OAuthStatePayload = z.infer<typeof oauthStatePayloadSchema>;

// ---- 4. Asset selection (UI → API) -------------------------------------

/**
 * POST /api/meta/sync/select — operator picks which Page / IG / AdAccount the
 * agent should operate against for this business.
 */
export const assetSelectionSchema = z.object({
  business_id: z.string().uuid(),
  page_id: z.string().min(1).optional(),
  ig_user_id: z.string().min(1).optional(),
  ad_account_id: z
    .string()
    .regex(/^act_\d+$/)
    .optional(),
});
export type AssetSelection = z.infer<typeof assetSelectionSchema>;

// ---- 5. Agent mode --------------------------------------------------------

export const agentModeSchema = z.enum(["insight", "draft", "action"]);
export type AgentMode = z.infer<typeof agentModeSchema>;

export const agentModeChangeSchema = z.object({
  business_id: z.string().uuid(),
  to_mode: agentModeSchema,
});
export type AgentModeChange = z.infer<typeof agentModeChangeSchema>;
