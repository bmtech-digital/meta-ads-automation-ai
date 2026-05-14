import "server-only";
import { devCookieAuth, DEV_COOKIE_NAME } from "./dev-cookie";
import { supabaseAuth } from "./supabase";
import type { AuthAdapter, AuthMode } from "./types";

function resolveMode(): AuthMode {
  const raw = process.env.WEB_AUTH_MODE?.trim();
  if (raw === "supabase") return "supabase";
  if (raw === "dev-cookie" || !raw) return "dev-cookie";
  throw new Error(
    `Invalid WEB_AUTH_MODE="${raw}". Use "dev-cookie" or "supabase".`,
  );
}

export function getAuth(): AuthAdapter {
  return resolveMode() === "supabase" ? supabaseAuth : devCookieAuth;
}

export { DEV_COOKIE_NAME };
export type { AuthAdapter, AuthMode, Session } from "./types";
