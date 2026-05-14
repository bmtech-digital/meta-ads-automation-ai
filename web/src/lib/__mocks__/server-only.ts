// Stub for vitest — the real `server-only` package throws when imported
// outside a server build. Tests run in node, so a no-op stub lets us still
// validate behavior. Aliased in vitest.config.ts. The prod build sees the
// real package via the regular module resolution.
export {};
