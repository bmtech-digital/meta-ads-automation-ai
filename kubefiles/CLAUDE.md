# Claude-at-`kubefiles/` — Kubernetes manifests

> Loaded automatically when cwd is here. Active alongside [root CLAUDE.md](../CLAUDE.md).

## What this folder is

Plain k8s manifests (YAML), applied via `kubectl apply -f`. **No Helm, no Kustomize overlays at this level** — this folder is intentionally low-magic. Per-environment overlays live under [`../web/k8s/`](../web/k8s/) (web only, where Phase 0 needed kustomize for staging vs prod). Everything in this folder is one cluster, one namespace.

## Cluster of record

| | Value | Source |
|---|---|---|
| Project | `bemtech-478413` | [Makefile](../Makefile) `PROJECT_ID` |
| Cluster | `generic-agent-cluster` | shared with `generic_agent` |
| Zone | `us-central1-a` | |
| Namespace | `campaigner` | [`namespace.yaml`](namespace.yaml) |
| Registry | `us-central1-docker.pkg.dev/bemtech-478413/generic-agent-repo` | |

The cluster is shared with the sibling `generic_agent` project — that's why the cluster name is `generic-agent-cluster`, not `campaigner-cluster`. Don't rename it.

## Manifest catalog

| File | Kind | Purpose |
|---|---|---|
| [`namespace.yaml`](namespace.yaml) | Namespace | Creates `campaigner`. Apply once. |
| [`secrets_template.yaml`](secrets_template.yaml) | Secret | Template with `${VAR}` placeholders. Applied via `envsubst` from `make secrets`. **Never edit with real values committed.** |
| [`agent_cronjob_daily_observe.yaml`](agent_cronjob_daily_observe.yaml) | CronJob | Flow A — 09:00 IL daily. |
| [`agent_cronjob_execute_approvals.yaml`](agent_cronjob_execute_approvals.yaml) | CronJob | Flow B — every 15 min. |
| [`agent_cronjob_weekly_creative.yaml`](agent_cronjob_weekly_creative.yaml) | CronJob | Flow C — Mon 10:00 IL. |
| [`agent_cronjob_weekly_competitive_research.yaml`](agent_cronjob_weekly_competitive_research.yaml) | CronJob | Flow D — Mon 11:00 IL. |
| [`web_deployment.yaml`](web_deployment.yaml) | Deployment + Service | Next.js dashboard. |
| [`web_ingress.yaml`](web_ingress.yaml) | Ingress + ManagedCertificate | Public HTTPS at `campaigner.aiweon.co.il`. Apply only after DNS A-record points to the static IP. |
| [`webhook_deployment.yaml`](webhook_deployment.yaml) | Deployment + Service | Flask webhook receiver. |

## How to deploy

Always via the [Makefile](../Makefile), not bare `kubectl`:

```bash
make auth                    # gcloud + cluster credentials
make namespace               # one-time
make secrets                 # one-time, after editing .env
make gcp_credentials_secret  # one-time after gcloud auth application-default login
make agent                   # build + push + apply CronJobs
make web                     # build + push + apply Deployment + rollout
make webhook                 # build + push + apply Deployment + rollout
make web_ingress             # only after DNS is set
```

`make all` does setup + all three services. `make status` shows current cluster state.

## Conventions

1. **Image references must point to the registry**, not local tags. `image: us-central1-docker.pkg.dev/bemtech-478413/generic-agent-repo/campaigner-agent:latest`. The Makefile takes care of build + push; manifests apply afterward.
2. **CronJobs use `concurrencyPolicy: Forbid`** — a slow Flow B run must not stack with the next 15-min trigger. If you need parallelism, that's a spec change.
3. **Resource requests are conservative.** Tune via `kubectl top pods` after observing real usage; don't pre-optimize.
4. **`Secret` references are by name only.** The actual secret values come from [`secrets_template.yaml`](secrets_template.yaml) via `envsubst`. Adding a new secret means: (1) add line to `secrets_template.yaml`, (2) add `envFrom`/`env` reference in the relevant manifest, (3) add the env var to `.env.example`.
5. **`gcp-vertexai-credentials` is a `Secret` mounted as a file** — ADC JSON. Created by `make gcp_credentials_secret` from `~/.config/gcloud/application_default_credentials.json`. Re-run after each `gcloud auth application-default login`.

## What's NOT here

- **CI/CD pipeline definitions** — those live under [`../.github/`](../.github/).
- **Web kustomize overlays** — [`../web/k8s/base/`](../web/k8s/) (base + overlays/staging + overlays/prod). The overlays were Phase-0 scaffold; this folder's `web_deployment.yaml` is the canonical one currently applied.
- **Database manifests** — Postgres is Supabase (managed) for the remote; local dev runs Postgres in `docker-compose.yml`. Neither belongs in k8s.

## Where truth lives

| Question | Read |
|---|---|
| Cluster + project naming | [Makefile](../Makefile) header block |
| Cron schedules | [`../runners/CLAUDE.md`](../runners/CLAUDE.md) + manifest `schedule:` fields (cross-check) |
| Secret variable list | [`secrets_template.yaml`](secrets_template.yaml) + [`../.env.example`](../.env.example) |
| What each Deployment serves | [Makefile](../Makefile) per-service comment block |
