import "server-only";
import { cookies } from "next/headers";
import type { AuthAdapter, Session } from "./types";

const COOKIE_NAME = "campaigner_dev_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function allowedEmails(): string[] {
  const raw = process.env.WEB_DEV_ALLOWED_EMAILS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowed(email: string): boolean {
  const list = allowedEmails();
  if (list.length === 0) return true; // empty list = allow any (dev only)
  return list.includes(email.toLowerCase());
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const devCookieAuth: AuthAdapter = {
  mode: "dev-cookie",

  async getSession(): Promise<Session | null> {
    const jar = await cookies();
    const email = jar.get(COOKIE_NAME)?.value;
    if (!email || !isValidEmail(email)) return null;
    return { email, mode: "dev-cookie" };
  },

  async signIn(email: string) {
    const normalized = email.trim().toLowerCase();
    if (!isValidEmail(normalized)) return { ok: false as const, error: "כתובת אימייל לא תקינה" };
    if (!isAllowed(normalized)) return { ok: false as const, error: "אימייל לא מורשה לסביבת dev" };
    const jar = await cookies();
    jar.set({
      name: COOKIE_NAME,
      value: normalized,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    });
    return { ok: true as const };
  },

  async signOut() {
    const jar = await cookies();
    jar.delete(COOKIE_NAME);
  },
};

export const DEV_COOKIE_NAME = COOKIE_NAME;
