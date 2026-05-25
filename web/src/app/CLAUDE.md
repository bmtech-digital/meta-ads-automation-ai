# Claude-at-`web/src/app/` — App Router routes

> Loaded automatically when cwd is here. Active alongside [`../../CLAUDE.md`](../../CLAUDE.md) and [root CLAUDE.md](../../../CLAUDE.md).

## What this folder is

Next.js 15 **App Router** routes. One folder per route segment, each with `page.tsx` (UI) and/or `route.ts` (API). Server components by default; client components opt in with `"use client"`.

## Route map

| Path | Purpose | Auth |
|---|---|---|
| `/` ([`page.tsx`](page.tsx)) | Authenticated home — businesses overview, KPI snapshot, last-scan card (latest `observe_propose` run → `/runs/[run_id]`) | required |
| `/login` ([`login/page.tsx`](login/page.tsx)) | Dual-mode login form (cookie OR magic link) | none |
| `/approvals` ([`approvals/`](approvals/)) | Pending approvals queue + detail view (`[id]/`) | required |
| `/business-knowledge` ([`business-knowledge/`](business-knowledge/)) | Edit `business_knowledge` row | required |
| `/campaigns` ([`campaigns/`](campaigns/)) | Active campaigns view (read-only mirror of Meta state) | required |
| `/gallery` ([`gallery/`](gallery/)) | Creative gallery (generated assets, with live-campaign overlays) | required |
| `/history` ([`history/`](history/)) | Decision history (`agent_decisions` rows) | required |
| `/reports` ([`reports/`](reports/)) | Monthly client-facing reports — index + `[month]/` detail (Block 10, 2026-05-13) | required |
| `/ab-tests` ([`ab-tests/`](ab-tests/)) | A/B test orchestration — index + `[id]/` detail with variants + winner snapshot (Block 11, 2026-05-13) | required |
| `/runs` ([`runs/page.tsx`](runs/page.tsx)) | Runs index — paginated list of distinct `agent_decisions.run_id` (newest first) with per-row counts (proposals/skips/rejections/errors). Added 2026-05-25 per [`../../../docs/todos/surface-runs-detail.md`](../../../docs/todos/surface-runs-detail.md). | required |
| `/runs/[run_id]/` ([`runs/[run_id]/`](runs/%5Brun_id%5D/)) | Single-run trail viewer (gates, related approvals/campaigns, full decision list) | required |
| `/settings` ([`settings/`](settings/)) | Per-business settings (token expiry, baselines confidence) | required |
| `/api/health/` ([`api/health/`](api/health/)) | Readiness probe for k8s | none |
| `/api/gallery/` ([`api/gallery/`](api/gallery/)) | Upload + serve creative assets | required |
| `/api/runners/trigger/` ([`api/runners/trigger/`](api/runners/trigger/)) | UI button → triggers a runner | required |

## Auth gate

[`../middleware.ts`](../middleware.ts) redirects unauthenticated visitors to `/login`. Routes here don't re-check auth — the middleware is the single chokepoint. If you ever bypass middleware (e.g. for a public landing page), add it to the middleware matcher exclusion list explicitly.

## Layout + globals

- [`layout.tsx`](layout.tsx) — RTL, Heebo font, theme provider, top-level `<Shell>` (nav). Don't add layouts at sub-route level unless you need an actually different shell.
- [`globals.css`](globals.css) — Tailwind base + shadcn tokens. Custom CSS lives here only if Tailwind can't express it; comment why.
- [`page.tsx`](page.tsx) at root — authenticated home. Reads businesses via `lib/db`.

## Conventions

1. **Server components fetch data; client components handle interaction.** A page that lists approvals: server component fetches, hands data to a `"use client"` filtered list child for sorting/searching.
2. **Mutation routes are POST `route.ts` handlers**, not server actions, until [`docs/plans/decisions-log.md`](../../../docs/plans/decisions-log.md) commits to actions explicitly. Validate input with Zod from [`../lib/schemas/`](../lib/schemas/).
3. **Loading + error UI** — use Next.js conventions (`loading.tsx`, `error.tsx`) for any route that fetches data taking longer than ~200ms.
4. **No client-side `fetch` to Postgres URLs.** Browser → API route → `lib/db`. Direct DB calls happen only in server components and API handlers.
5. **`params` is async in Next 15.** `const { id } = await params;` — don't destructure synchronously.
6. **Route handlers return `NextResponse.json(...)` with explicit status codes.** No leaving status implicit on error paths.

## Adding a new route

1. Create the folder + `page.tsx` (or `route.ts` for API).
2. If the route needs auth (almost always: yes), do nothing — middleware handles it. If it needs to be public, update the matcher in `middleware.ts`.
3. If the route mutates data, add a Zod schema under [`../lib/schemas/`](../lib/schemas/) and validate in the handler.
4. If the route is part of a feature with multiple pages, group them under one folder (`approvals/`, `runs/`) — don't flatten.
5. Add a row to the route map table above.

## Where truth lives

| Question | Read |
|---|---|
| Frontend PRD (which routes are speced) | [`../../../docs/plans/campaigner-frontend-prd.md`](../../../docs/plans/campaigner-frontend-prd.md) |
| Auth flow + dev-cookie format | [`../lib/auth/CLAUDE.md`](../lib/CLAUDE.md) (see auth subsection) |
| What data each page reads | [`../lib/db/types.ts`](../lib/db/types.ts) — adapter contract |
| RTL conventions | [`../../CLAUDE.md`](../../CLAUDE.md) |
