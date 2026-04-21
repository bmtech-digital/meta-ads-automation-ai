import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge-runtime middleware. Cannot import Node modules (pg, server-only, cookies())
 * — so we inspect cookies directly. In dev-cookie mode the session is a single
 * named cookie; in supabase mode we'll swap to `sb-access-token` detection.
 */

const DEV_COOKIE_NAME = "campaigner_dev_session";
const SUPABASE_COOKIE_PREFIX = "sb-";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/api/health"];

function hasSession(req: NextRequest): boolean {
  const mode = process.env.WEB_AUTH_MODE ?? "dev-cookie";
  if (mode === "supabase") {
    for (const c of req.cookies.getAll()) {
      if (c.name.startsWith(SUPABASE_COOKIE_PREFIX)) return true;
    }
    return false;
  }
  return Boolean(req.cookies.get(DEV_COOKIE_NAME)?.value);
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();
  if (hasSession(req)) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)"],
};
