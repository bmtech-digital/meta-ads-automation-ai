import "server-only";

/**
 * Debug-mode flag, read once per server render. Gates the deep-dive
 * sections on `/runs/[run_id]` and the shape badges on `/runs`. See
 * `docs/plans/debug-runs-page.md`.
 *
 * Server-side only — every consumer is a server component, so `DEBUG`
 * stays out of the JS bundle. Switch to `NEXT_PUBLIC_DEBUG` if a client
 * component ever needs it.
 */
export function isDebugMode(): boolean {
  return process.env.DEBUG === "true";
}
