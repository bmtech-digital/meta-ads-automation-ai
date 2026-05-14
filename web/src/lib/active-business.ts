import "server-only";
import { cookies } from "next/headers";
import { getDataClient } from "./db";
import type { Business } from "./db/types";

/**
 * Active-business resolver — multi-business support.
 *
 * Each Meta ad account corresponds to its own `businesses` row. The operator
 * picks which business is "active" via the dropdown in the nav; the choice
 * lands in this cookie. Every page that used to read
 * `process.env.BUSINESS_ID ? getBusinessById : getFirstBusiness` should now
 * call `getActiveBusiness()` instead.
 *
 * Fallback order:
 *   1. Cookie `campaigner_business_id` (set by /api/businesses/select).
 *   2. `process.env.BUSINESS_ID` (legacy single-business mode).
 *   3. The first active business in the DB.
 *
 * Returns null when there is no business in the DB at all — pages render
 * the empty-state in that case.
 */

const COOKIE_NAME = "campaigner_business_id";

export const ACTIVE_BUSINESS_COOKIE = COOKIE_NAME;

export async function getActiveBusiness(): Promise<Business | null> {
  const db = getDataClient();
  const store = await cookies();
  const cookieVal = store.get(COOKIE_NAME)?.value;
  if (cookieVal) {
    const b = await db.getBusinessById(cookieVal);
    if (b) return b;
    // Stale cookie (business deleted / cookie set in a different DB) — fall
    // through to the other resolution paths instead of returning null.
  }
  if (process.env.BUSINESS_ID) {
    const b = await db.getBusinessById(process.env.BUSINESS_ID);
    if (b) return b;
  }
  return db.getFirstBusiness();
}

/**
 * Cookie attributes used both when reading and writing the active-business
 * cookie. Shared so /api/businesses/select and the reader stay in lockstep.
 *
 * `httpOnly: false` is deliberate — a future client-only switcher (e.g. via
 * `document.cookie`) needs to read it. The cookie holds an opaque UUID, not a
 * credential.
 */
export const ACTIVE_BUSINESS_COOKIE_OPTIONS = {
  httpOnly: false as const,
  sameSite: "lax" as const,
  path: "/",
  // 365 days — the choice persists across sessions; pages re-validate against
  // the DB on every read so a stale cookie just falls back gracefully.
  maxAge: 60 * 60 * 24 * 365,
};
