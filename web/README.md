# Campaigner Web — Phase 0

Thin Next.js 15 UI over Campaigner's Postgres. **Phase 0 ships scaffold only** — data-layer
abstraction, auth stub, RTL, Docker, k8s manifests. Pending phases add approvals queue,
rationale viewer, business knowledge form.

- **Spec:** [../docs/plans/campaigner-frontend-prd.md](../docs/plans/campaigner-frontend-prd.md)
- **Backend companion:** [../docs/plans/campaigner-backend-prd.md](../docs/plans/campaigner-backend-prd.md)
- **Repo topology:** monorepo (`web/` sibling of `campaigner/`) — [decisions-log §1.6](../docs/plans/decisions-log.md)

## Dual-mode infrastructure

| Mode                            | DB                    | Auth                           | When to use                                                                                           |
| ------------------------------- | --------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `local-postgres` + `dev-cookie` | `pg` → local Postgres | email cookie (no verification) | **active** today; matches local backend stack                                                         |
| `supabase` + `supabase`         | `@supabase/ssr` + RLS | Supabase Auth magic link       | stub today; lights up after [decisions-log §1.4](../docs/plans/decisions-log.md) resolves on Supabase |

Toggle via env:

```
WEB_DB_MODE=local-postgres | supabase
WEB_AUTH_MODE=dev-cookie  | supabase
```

The supabase adapters throw a clear `notImplemented` error — intentional, so flipping
the flag before wiring Supabase fails loudly.

## Run locally (Docker — the recommended path)

```bash
cp web/.env.example web/.env.local   # optional; compose also injects defaults
docker compose --profile web up web  # http://localhost:3100
```

The `web` service is behind the `web` compose profile so `docker compose up` (backend-only
workflows) doesn't start it. Use `--profile web` when you want the UI too.

First run installs deps via `pnpm install` inside the container (~2 min). Subsequent runs
reuse the `web_node_modules` volume.

## Run locally (host, for debugging)

```bash
cd web
pnpm install
pnpm dev
```

Requires `DATABASE_URL` reachable from the host (point at `localhost:5432` if Postgres
is exposed by compose, which it is).

## Test

```bash
cd web

# Unit (Zod schemas)
pnpm test

# E2E (starts Next via `pnpm build && pnpm start`)
pnpm test:e2e:install   # one-time: installs chromium
pnpm test:e2e
```

## Build the image

```bash
docker build -f web/Dockerfile.k8s -t campaigner-web:local web
```

## Deploy (NOT executed in Phase 0)

Phase 0 ships the manifests, not the deploy. When backend Phase 5 is live and
Supabase is chosen:

```bash
kustomize build web/k8s/overlays/staging  # dry-render, verify
kubectl apply -k web/k8s/overlays/staging # push to GKE
```

- Cluster: `generic-agent-cluster` in `bemtech-478413`
- Namespace: `campaigner` (prod) / `campaigner-staging` (staging)
- Registry: `us-central1-docker.pkg.dev/bemtech-478413/generic-agent-repo/campaigner-web`

## Directory map

```
web/
├── src/
│   ├── app/
│   │   ├── layout.tsx          RTL + Heebo
│   │   ├── globals.css         Tailwind + shadcn tokens
│   │   ├── page.tsx            authenticated home (reads businesses)
│   │   ├── login/page.tsx      dev-cookie OR magic-link form
│   │   └── api/health/route.ts readiness probe
│   ├── components/ui/          shadcn starter (Button, Card, Input, Label, Badge, Dialog)
│   ├── lib/
│   │   ├── db/                 dual-mode data adapter
│   │   ├── auth/               dual-mode auth adapter
│   │   ├── schemas/            Zod schemas shared client+server
│   │   └── utils.ts            cn() helper
│   └── middleware.ts           redirect unauthenticated → /login
├── e2e/                        Playwright
├── k8s/base + overlays/        kustomize
├── Dockerfile.k8s              multi-stage, output=standalone
├── playwright.config.ts
├── vitest.config.ts
└── tailwind.config.ts
```

## What Phase 0 does NOT include

- Approvals list / detail / approve-reject flows (Phase 1-2)
- Business knowledge form (Phase 3)
- Decision history (Phase 4)
- RLS policies (enabled in migrations but no multi-tenant policies — Phase 2, after Supabase)
- CI path filter for `web/**` (task 3.1 extension — added once scaffold is stable)
- GKE deploy (manifests exist; `kubectl apply` not executed)
