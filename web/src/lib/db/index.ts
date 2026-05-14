import "server-only";
import { localPostgresClient } from "./local-postgres";
import { supabaseClient } from "./supabase";
import type { DataClient, DbMode } from "./types";

function resolveMode(): DbMode {
  const raw = process.env.WEB_DB_MODE?.trim();
  if (raw === "supabase") return "supabase";
  if (raw === "local-postgres" || !raw) return "local-postgres";
  throw new Error(
    `Invalid WEB_DB_MODE="${raw}". Use "local-postgres" or "supabase".`,
  );
}

export function getDataClient(): DataClient {
  return resolveMode() === "supabase" ? supabaseClient : localPostgresClient;
}

export type { Business, DataClient, DbMode } from "./types";
