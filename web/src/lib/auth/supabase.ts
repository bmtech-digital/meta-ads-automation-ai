import "server-only";
import type { AuthAdapter } from "./types";

/**
 * Stub. When decisions-log §1.4 resolves on Supabase as the remote target,
 * replace these throws with @supabase/ssr calls (signInWithOtp, getUser, signOut).
 */
function notImplemented(op: string): never {
  throw new Error(
    `[supabase auth] ${op}() not implemented. ` +
      `Set WEB_AUTH_MODE=dev-cookie, or wire @supabase/ssr once Supabase is chosen.`,
  );
}

export const supabaseAuth: AuthAdapter = {
  mode: "supabase",
  getSession: async () => notImplemented("getSession"),
  signIn: async () => notImplemented("signIn"),
  signOut: async () => notImplemented("signOut"),
};
