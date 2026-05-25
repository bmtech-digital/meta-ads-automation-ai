# CI/CD Pipeline Documentation

Production deploys are driven by [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). The workflow follows the locked Hetzner pattern described in [`~/projects/bemtech/setup/hetzner/docs/cicd-pattern.md`](../../setup/hetzner/docs/cicd-pattern.md): build on GitHub-hosted runners, push to GHCR, then roll the in-cluster workloads from a **self-hosted GitHub Actions runner that lives inside the k3s cluster**.

| Trigger | Cluster | Namespace |
|---|---|---|
| Push to `main` (only) | Hetzner k3s (`bemtech-hetzner-k3s`) | `campaigner` |

A "full deployment" runs every time — all 3 images rebuilt, web rolled, webhook image bumped (replicas stays at 0 so there's no rollout to wait for), all 7 CronJob images bumped, DB migrations re-applied idempotently, smoke test asserts `/api/health` returns 200. No `workflow_dispatch`, no PR builds, no per-path filters yet. Push to main = ship.

## PREREQUISITE — in-cluster runner

The deploy job runs on a self-hosted runner labeled `[self-hosted, linux, hetzner, campaigner]`. **That runner must be provisioned in the operator's Hetzner infra repo** at `setup/hetzner/manifests/gh-runners/04-runner-campaigner.yaml` (clone `03-runner-generic-agent.yaml` and adapt: ServiceAccount `gh-runner-campaigner`, RoleBinding to the `campaigner` namespace, runner labels include `campaigner`).

Until the runner exists, the `deploy` job will queue indefinitely. The `build-*` jobs run on GitHub-hosted runners and will still complete successfully — the images land in GHCR — but nothing rolls into the cluster. Operator hand-deploy (`make build deploy` from a laptop with cluster context) is the workaround.

## Deployment flow

```
Push to main
    │
    ├─► build-agent       (GH-hosted)
    │       └─► push ghcr.io/roihala/campaigner-agent:<sha> + :latest
    │
    ├─► build-web         (GH-hosted)
    │       └─► push ghcr.io/roihala/campaigner-web:<sha> + :latest
    │
    ├─► build-webhook     (GH-hosted)
    │       └─► push ghcr.io/roihala/campaigner-webhook:<sha> + :latest
    │
    ├─► deploy            (in-cluster, runs-on: [self-hosted, linux, hetzner, campaigner])
    │       ├─► apply migrations (idempotent — duplicates tolerated)
    │       ├─► kubectl set image deployment/web      web=...:<sha>          + rollout status
    │       ├─► kubectl set image deployment/webhook  webhook=...:<sha>      (replicas: 0, no rollout)
    │       └─► kubectl set image cronjob/<each>      agent=...:<sha>        × 7
    │
    └─► smoke-test        (GH-hosted)
            └─► curl https://campaigner.aiweon.co.il/api/health  → 200 (5 retries × 10s)
```

The migrations step is checked out from the same git SHA being deployed — schema and code stay in lockstep. The idempotency handling tolerates `already exists` and `duplicate` errors so re-runs don't fail; anything else aborts the deploy. CronJob image bumps take effect on the **next scheduled run** — active Jobs (already running) keep their existing image.

The webhook Deployment is currently scaled to 0 (Meta webhooks aren't wired yet). Bumping its image even at replicas: 0 means a future scale-up automatically picks up the latest SHA — no second deploy needed.

## Secrets

Only **one** GitHub Actions secret is required:

| Secret | Purpose |
|---|---|
| `GHCR_PAT` | PAT owned by `roihala` with `write:packages`. Used by the three build jobs to push images. The same token is mounted into the in-cluster runner via the SOPS-encrypted `gh-runners/gh-runner-pat` Secret on the Hetzner side. |

**Application secrets are NOT managed by CI.** They live as SOPS-encrypted YAMLs at `~/projects/bemtech/setup/hetzner/secrets/campaigner/` and are applied out-of-band by the operator via `setup/hetzner/manifests/campaigner/apply.sh`. In particular, the following are **not** in GitHub Actions secrets:

- `GCP_SA_KEY` (Vertex AI service-account JSON — mounted via the `gcp-vertexai-credentials` k8s Secret, cross-namespace-copied from `generic-agent` by the operator)
- `ANTHROPIC_API_KEY`
- `META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `BUSINESS_ID`

This is deliberate — see the "kubectl set image, not kubectl apply" split in the [Hetzner CI/CD pattern](../../setup/hetzner/docs/cicd-pattern.md). CI can roll a new image tag but cannot read, write, or delete secrets, ingress, or any structural state. A compromised runner can only roll an image back or forward, not exfiltrate or restructure.

## RBAC scope (in-cluster runner)

The `gh-runner-campaigner` ServiceAccount in `gh-runners` will be cross-bound to a `deploy-rollout` Role in the `campaigner` namespace. Verbs limited to:

- `apps/deployments`, `apps/statefulsets`, `batch/cronjobs`: `get, list, patch, watch`
- `pods/exec` (for `kubectl exec -i postgres-0 -- psql ...` during the migrations step)
- `pods`, `events`, `pods/log`: read-only

That's it. No `secrets`, no `create`, no `delete`, no `apply`. A stolen runner token can swap image tags, watch rollouts, and run migrations — nothing more.

## Image tagging

Two tags pushed per build:

- `<sha>` — immutable. Deploy step uses this. Rollback is `kubectl set image deployment/X X=ghcr.io/.../X:<previous-sha>`.
- `latest` — convenience. The operator's `apply.sh` references `:latest` so a fresh apply always picks up the most recent image.

## Rollback

Per-workload, by git SHA — every successful build pushes a `:<sha>` tag that's immutable:

```bash
# From the operator's laptop, with kubectl context on bemtech-hetzner-k3s

kubectl -n campaigner set image deployment/web \
  web=ghcr.io/roihala/campaigner-web:<previous-sha>

kubectl -n campaigner set image deployment/webhook \
  webhook=ghcr.io/roihala/campaigner-webhook:<previous-sha>

for cj in agent-daily-observe agent-execute-approvals agent-daily-ab-decisions \
          agent-midday-health-check agent-weekly-creative \
          agent-weekly-competitive-research agent-weekly-self-audit; do
  kubectl -n campaigner set image cronjob/$cj \
    agent=ghcr.io/roihala/campaigner-agent:<previous-sha>
done
```

Find the previous SHA via `git log` on `main` or in the GitHub Actions UI under "Deploy to Hetzner".

## Local hotfix path (CI down)

When GitHub is unreachable or the runner is offline, the operator can do a full build+deploy from their laptop:

```bash
# Authenticate to GHCR (one time per session)
echo "$GITHUB_PAT" | docker login ghcr.io -u roihala --password-stdin

# Build + push all 3 images, then roll all workloads
make build deploy
```

`make build` uses `docker buildx --platform=linux/amd64 --push` and tags `:manual-<timestamp>` + `:latest`. `make deploy` does the same `kubectl set image` dance as CI. Identical operationally — just bypasses GitHub. The same kubectl context that the operator uses for everything else (`bemtech-hetzner-k3s`) applies.

## What CI does NOT do

- No `kubectl apply -f manifests/*.yaml` (structural manifests live in the operator's Hetzner infra repo)
- No secret rotation (operator's job; SOPS workflow)
- No DNS changes
- No SSL cert management (cert-manager + Let's Encrypt, automatic)
- No Hetzner Cloud resource provisioning (`hcloud` CLI, operator-only)

## Monitoring

```bash
# GitHub Actions UI
https://github.com/<owner>/<this-repo>/actions

# In-cluster runner pod (once provisioned)
kubectl -n gh-runners get pods
kubectl -n gh-runners logs deployment/gh-runner-campaigner

# Cluster state for the workload
kubectl -n campaigner get pods
kubectl -n campaigner rollout history deployment/web
kubectl -n campaigner get cronjobs
```

## Troubleshooting

**Job stuck "Queued" against a `self-hosted` runner**
The in-cluster runner pod is not online — or hasn't been provisioned yet. See § PREREQUISITE above. If the pod is `CrashLoopBackOff`, check the registration token (`gh-runner-pat` Secret) hasn't expired.

**Image pull errors on roll**
The cluster needs a `ghcr-pull` ImagePullSecret in the `campaigner` namespace. This is provisioned out-of-band by the operator, not by CI. Verify with `kubectl -n campaigner get secret ghcr-pull`.

**Migrations step fails**
The SQL printed in the failure is the one that broke. Check `migrations/<NN>_*.sql`. If the failure is a transient connection issue, re-run the workflow (the `already exists` tolerance handles re-application of completed migrations).

**Smoke test fails on `/api/health`**
Most likely the web Deployment didn't roll cleanly (check `kubectl -n campaigner rollout status deployment/web`) or the new image has a bug (check pod logs). Less commonly, the LB IP changed and DNS hasn't caught up — `dig campaigner.aiweon.co.il` should resolve to `46.225.44.64`.

## See also

- [`~/projects/bemtech/setup/hetzner/docs/cicd-pattern.md`](../../setup/hetzner/docs/cicd-pattern.md) — the locked pattern shared across all migrated namespaces
- [`~/projects/bemtech/setup/hetzner/manifests/gh-runners/README.md`](../../setup/hetzner/manifests/gh-runners/README.md) — in-cluster runner setup
- [`kubefiles/README.md`](../kubefiles/README.md) — where structural cluster manifests actually live
- [`../Makefile`](../Makefile) — `make build deploy` for emergency hand-deploys
