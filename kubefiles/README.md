# kubefiles/

**This directory no longer ships deployment manifests.**

Production runs on Hetzner k3s. The canonical manifests live in the operator's private infra repo at:

```
~/projects/bemtech/setup/hetzner/manifests/campaigner/
```

That directory contains 12 manifests + `apply.sh` + `README.md`:
- `00-namespace.yaml`
- `01-postgres.yaml` (in-cluster Postgres StatefulSet, 10 Gi PV)
- `02-web.yaml`, `03-webhook.yaml`
- `04-cronjob-…` through `10-cronjob-…` (the 7 agent CronJobs)
- `11-ingress.yaml` (ingress-nginx + cert-manager + Let's Encrypt)

Secrets are SOPS-encrypted under `~/projects/bemtech/setup/hetzner/secrets/campaigner/`.

## Why two-repo split

The campaigner application source (this repo) and the cluster's structural state (Deployments, Services, Ingress, Secrets, StorageClass choices) live in different repos so:

- Cluster-wide operator concerns (Hetzner Cloud Volume sizing, ingress-nginx, cert-manager, SOPS keys, GHCR pull secret, in-cluster GH runners) stay in one place across all migrated namespaces (`generic-agent`, `aiweon-demo`, `aiweon-website`, `campaigner`).
- Application devs working in this repo never need to think about cluster shape — `git push origin main` → CI does the rest (see [`docs/CI_CD.md`](../docs/CI_CD.md)).
- Secrets stay close to the operator (encrypted-at-rest in the infra repo) and never leak into the application repo.

## What CI does touch

CI (`.github/workflows/deploy.yml`) only mutates **image tags + applies migrations**:
- `kubectl set image deployment/web …`
- `kubectl set image deployment/webhook …`
- `kubectl set image cronjob/<each>…` × 7
- `psql -f migrations/*.sql` × N (idempotent)

CI never `kubectl apply`s a manifest — structural changes go through the operator running `apply.sh` in the infra repo. This split is intentional; see [`docs/CI_CD.md`](../docs/CI_CD.md) § "kubectl set image, not kubectl apply".

## Why the dir still exists

Some scripts (e.g. `scripts/generate_from_flows.py`) historically wrote here. The dir is kept as the canonical anchor for that history; future scripts should not write here.
