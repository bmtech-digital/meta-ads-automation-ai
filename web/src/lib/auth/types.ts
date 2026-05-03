export type AuthMode = "dev-cookie" | "supabase";

export interface Session {
  email: string;
  mode: AuthMode;
}

export interface AuthAdapter {
  mode: AuthMode;
  /** Read the caller's session from cookies; null if not signed in. */
  getSession(): Promise<Session | null>;
  /** Sign in by email. In dev-cookie mode: writes cookie. In supabase mode: signInWithOtp. */
  signIn(email: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Clear the session. */
  signOut(): Promise<void>;
}
