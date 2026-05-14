# Claude-at-`web/src/lib/` — adapters, schemas, helpers

> Loaded automatically when cwd is here. Active alongside [`../../CLAUDE.md`](../../CLAUDE.md) and [root CLAUDE.md](../../../CLAUDE.md).

## What this folder is

The seam between Next.js (the app) and the outside world (Postgres, Supabase, Meta token state, file storage). **Every external dependency is mediated by an adapter or helper here.** No component imports `pg` or `@supabase/ssr` directly.

## Layout

| Path | Role |
|---|---|
| [`db/`](db/) | Dual-mode DB adapter — `local-postgres` (active) + `supabase` (stub) |
| [`auth/`](auth/) | Dual-mode auth adapter — `dev-cookie` (active) + `supabase` (stub) |
| [`schemas/`](schemas/) | Zod schemas shared between server and client |
| [`approvals-display.ts`](approvals-display.ts) + [`approvals-fmt.ts`](approvals-fmt.ts) | Pure formatters for approvals (Hebrew strings, badges, urgency colors) |
| [`token-expiry.ts`](token-expiry.ts) | Meta token expiry math + warnings |
| [`kpi.ts`](kpi.ts) | KPI snapshot formatters |
| [`meta.ts`](meta.ts) | Light Meta API helpers (read-only — list ad accounts, etc.). Heavy lifting is the Python agent's job. |
| [`meta-capabilities.ts`](meta-capabilities.ts) | Capability layer per [`meta-integration-readiness.md §3`](../../../docs/plans/meta-integration-readiness.md) — scope groups, capability spec, readiness check. Pure, no I/O. Single source of truth for "can the agent do X?" |
| [`storage.ts`](storage.ts) | Dual-mode storage (local FS in dev, GCS in prod) for gallery uploads |
| [`utils.ts`](utils.ts) | `cn()` for class composition. That's it. |

## Dual-mode adapters — the rule

Two env vars switch backends:

```
WEB_DB_MODE=local-postgres | supabase
WEB_AUTH_MODE=dev-cookie  | supabase
```

The adapters at [`db/index.ts`](db/index.ts) and [`auth/index.ts`](auth/index.ts) read these and dispatch to the right implementation. Implementations:

- **`local-postgres.ts`** — uses `pg` Pool. Reachable via `DATABASE_URL`. Currently active for development.
- **`supabase.ts`** — wraps `@supabase/ssr`. **Throws `notImplemented` on every method.** Stub on purpose. When the §1.4 decision lands, this is where it gets wired.

**The contract of stubs:** a stub must throw a clear error, never return mock data. Mock data fakes coverage. A loud error is the correct UX of "you flipped the flag too early."

## Schemas

Single source of truth for data shapes shared client/server. Examples:

- [`schemas/approval.ts`](schemas/approval.ts) — what an approval row looks like to the UI
- [`schemas/business-knowledge.ts`](schemas/business-knowledge.ts) — the editable business profile
- [`schemas/business-settings.ts`](schemas/business-settings.ts) — token expiry, baseline confidence, override switches
- [`schemas/seasonal-hints.ts`](schemas/seasonal-hints.ts) — Israel calendar hints

Rule: a route handler that accepts JSON validates with the corresponding schema before any DB call. A server component that reads from DB validates with `.parse(...)` if there's any chance the row's shape might drift from the schema.

## Pure formatters

`approvals-display.ts`, `approvals-fmt.ts`, `token-expiry.ts`, `kpi.ts` — none of them touch I/O. They take data and return display strings / formatted numbers / badge variants. Tested with Vitest (`*.test.ts` colocated).

When you add a formatter:
- No `Date.now()` at module scope. Take time as a parameter so tests can pass a fixed timestamp.
- No `process.env`. Take config as parameters.
- Return strings/objects. Never JSX — JSX belongs in components.

## Conventions

1. **`pg` is imported only in `db/local-postgres.ts`.** Same for `@supabase/ssr` in `db/supabase.ts` / `auth/supabase.ts`. The pattern mirrors [`../../../campaigner/lib/CLAUDE.md`](../../../campaigner/lib/CLAUDE.md).
2. **Connection lifecycle is the adapter's responsibility.** The adapter exposes methods like `getPendingApprovals(businessId)`, not a raw `Pool`. Callers must not see Pool/Client objects.
3. **Server-only files are marked.** Any file that imports `pg` or reads `process.env.DATABASE_URL` should start with `import 'server-only';` to fail loudly if a client component imports it.
4. **No singletons created at module top level.** A `Pool` instance must be lazy (created on first call, cached). Module-top creation breaks Next's module graph between dev and prod builds.
5. **Hebrew strings live in components or formatters here, not in `db/`.** The DB adapter returns data; phrasing happens at the display boundary.

## Adding new data access

- New table to read? Add a method on the DB adapter interface ([`db/types.ts`](db/types.ts)), implement in `local-postgres.ts`, throw `notImplemented` in `supabase.ts`.
- New auth flow? Same pattern in `auth/`.
- New shared shape? Add a schema in `schemas/`, infer the type via `z.infer<typeof X>`, export both.

## Where truth lives

| Question | Read |
|---|---|
| Postgres schema | [`../../../migrations/`](../../../migrations/) |
| Frontend PRD (which adapters are spec'd) | [`../../../docs/plans/campaigner-frontend-prd.md`](../../../docs/plans/campaigner-frontend-prd.md) |
| Why Supabase mode is a stub | [`../../../docs/plans/decisions-log.md`](../../../docs/plans/decisions-log.md) §1.4 |
| Local Postgres URL + setup | [`../../../web/README.md`](../../README.md) "Run locally" |
