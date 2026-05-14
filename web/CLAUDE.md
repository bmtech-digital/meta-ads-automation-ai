# Claude-at-`web/` — Next.js dashboard

> Loaded automatically when cwd is here. Active alongside [root CLAUDE.md](../CLAUDE.md). The user-facing setup guide is [`README.md`](README.md) — this file is the agent-facing companion.

## What this folder is

The Next.js 15 + Tailwind + shadcn/ui dashboard. RTL Hebrew-first. Built into the `campaigner-web` Docker image via [`../dockerfiles/web.dockerfile`](../dockerfiles/web.dockerfile) and deployed via [`../kubefiles/web_deployment.yaml`](../kubefiles/web_deployment.yaml).

| | |
|---|---|
| Framework | Next.js 15 (App Router, server components by default) |
| Styling | Tailwind + shadcn/ui (`web/src/components/ui/`) |
| Auth | dual-mode adapter — `dev-cookie` (current) or `supabase` (post-decision) |
| DB | dual-mode adapter — `local-postgres` via `pg` (current) or `supabase` (post-decision) |
| Tests | Vitest (unit, Zod schemas) + Playwright (e2e) |
| Package manager | **pnpm** (not npm or yarn) |

## Dual-mode rule (binding)

The web app does not assume Supabase yet. Every code path that talks to data or auth goes through an adapter:

```
src/lib/db/index.ts     → reads WEB_DB_MODE=local-postgres|supabase
src/lib/auth/index.ts   → reads WEB_AUTH_MODE=dev-cookie|supabase
```

Per [`../docs/plans/decisions-log.md`](../docs/plans/decisions-log.md) §1.4, Supabase as the remote is decided but not yet wired. The supabase adapter throws `notImplemented` on purpose — flipping the mode flag prematurely fails loudly.

**Rule for new code:** never `import { Pool } from 'pg'` or `createServerClient` from `@supabase/ssr` outside [`src/lib/db/`](src/lib/db/) / [`src/lib/auth/`](src/lib/auth/). Reach data through the adapter. See [`src/lib/CLAUDE.md`](src/lib/CLAUDE.md).

## How to run

```bash
# Recommended — Docker, matches production stack
docker compose --profile web up web         # http://localhost:3100

# Host (debugging only)
cd web && pnpm install && pnpm dev          # requires DATABASE_URL reachable
```

Per [memory: "Run everything via Docker"](../CLAUDE.md), the host path is for fast iteration only.

## How to test

```bash
cd web
pnpm test                  # Vitest — schemas + pure helpers
pnpm test:e2e:install      # one-time chromium install
pnpm test:e2e              # Playwright — runs `pnpm build && pnpm start` first
```

E2E lives in [`e2e/`](e2e/). Unit tests are colocated as `<file>.test.ts` next to the file under test.

## Folder roles

| Folder | Role | Sub-CLAUDE.md |
|---|---|---|
| [`src/app/`](src/app/) | App Router — routes, pages, API handlers | [yes](src/app/CLAUDE.md) |
| [`src/components/`](src/components/) | UI components (shadcn primitives + features) | [yes](src/components/CLAUDE.md) |
| [`src/lib/`](src/lib/) | Data/auth adapters, Zod schemas, helpers | [yes](src/lib/CLAUDE.md) |
| `src/middleware.ts` | Auth gate — redirects unauthenticated → `/login` | — |
| [`e2e/`](e2e/) | Playwright specs | — |
| [`public/`](public/) | Static assets (brand, icons) | — |

## Conventions

1. **Hebrew + RTL by default.** `<html lang="he" dir="rtl">` in [`src/app/layout.tsx`](src/app/layout.tsx). Don't add `dir="ltr"` to component containers unless it's a code block or a number-only display.
2. **Server components by default.** Add `"use client"` only when the component genuinely needs state, effects, or browser APIs. Components without `"use client"` can fetch directly from `src/lib/db/`.
3. **Heebo as the brand font.** Loaded once in `layout.tsx`. Don't import other fonts ad-hoc.
4. **No CSS files outside `globals.css`.** Tailwind for everything. Custom CSS goes into `globals.css` with a comment explaining why a utility class wasn't enough.
5. **Image uploads** go to `web/uploads/` in dev (gitignored) or to the gallery GCS bucket in prod. The same dual-mode pattern applies — see [`src/lib/storage.ts`](src/lib/storage.ts).
6. **API routes are thin.** [`src/app/api/`](src/app/api/) handlers should validate with Zod, call into `src/lib/db/`, and return JSON. Business logic doesn't belong in route handlers.
7. **No direct Meta *write* calls from the web.** Meta writes (publish post, create/update campaign) stay the agent's territory and only fire after an approved `approvals` row. Meta *reads* — OAuth bootstrap, asset discovery, capability readiness — are allowed from web routes under [`src/app/api/meta/`](src/app/api/meta/) via the capability layer at [`src/lib/meta-capabilities.ts`](src/lib/meta-capabilities.ts). Updated by [`decisions-log.md §1.12`](../docs/plans/decisions-log.md) — see [`meta-integration-readiness.md`](../docs/plans/meta-integration-readiness.md) for the dual-path token model.

## What NOT to do here

- **Don't write features that bypass approval flow.** A "edit campaign directly" button breaks the HITL invariant. If a use case demands one, that's a spec change, not a UI change.
- **Don't hand-roll auth.** Use the adapter at [`src/lib/auth/`](src/lib/auth/). Even for dev.
- **Don't add a state-management library.** React Server Components + URL state + small `useState` cover everything we need. Adding Redux/Zustand is a decision, not a refactor.
- **Don't translate Hebrew copy to English "for the team".** The product is Hebrew-first. English-only screens drift out of sync immediately.

## Where truth lives

| Question | Read |
|---|---|
| Frontend PRD | [`../docs/plans/campaigner-frontend-prd.md`](../docs/plans/campaigner-frontend-prd.md) |
| Backend PRD (the data this UI reads) | [`../docs/plans/campaigner-backend-prd.md`](../docs/plans/campaigner-backend-prd.md) |
| Why dual-mode adapters | [`../docs/plans/decisions-log.md`](../docs/plans/decisions-log.md) §1.4 |
| Meta integration plan (OAuth, capability layer, App Review) | [`../docs/plans/meta-integration-readiness.md`](../docs/plans/meta-integration-readiness.md) + [`decisions-log.md §1.12`](../docs/plans/decisions-log.md) |
| The deployment manifest | [`../kubefiles/web_deployment.yaml`](../kubefiles/web_deployment.yaml) |
| Setup + Docker commands | [`README.md`](README.md) |
