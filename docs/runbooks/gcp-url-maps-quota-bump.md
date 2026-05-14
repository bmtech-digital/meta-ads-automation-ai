# Runbook — Bump GCP `URL_MAPS` Quota

## When to use this

You see one of these symptoms on a GKE Ingress in `bemtech-478413`:

- `kubectl get ingress` shows the ingress for many minutes/hours with an **empty `ADDRESS` column**.
- `kubectl describe ingress <name>` events include:
  ```
  Error syncing to GCP: ... googleapi: Error 403: QUOTA_EXCEEDED -
  Quota 'URL_MAPS' exceeded. Limit: 10.0 globally.
  ```
- New ManagedCertificate stuck in `Provisioning` because the LB never came up.

Confirm with:

```bash
gcloud compute url-maps list --format="value(name)" | wc -l
```

If that returns the same number as the quota limit (default `10`), you are at the cap.

## Why this happens

Each GKE Ingress backed by the GCE controller provisions **at least one URL map** (the routing config in the L7 LB). With `FrontendConfig.redirectToHttps: true` it provisions **two** — one for routing, one solely for issuing the HTTP→HTTPS 301. The default project quota is 10 globally, which a multi-tenant project burns through fast. See [docs/runbooks/gcp-loadbalancer-architecture.md](#further-reading) (write later) for the full chain.

The fix below requests Google raise the cap; nothing in the cluster needs to change.

## Procedure

### 1. Open the quota page in the GCP Console

URL (already pbcopied — paste it in the browser):

```
https://console.cloud.google.com/iam-admin/quotas?project=bemtech-478413
```

### 2. Filter to the right quota

In the **Filter** bar at the top of the table, type `URL maps` (with the space).
You should see a single row:

| Field | Expected value |
|---|---|
| Service | Compute Engine API |
| Quota | URL maps |
| Dimension | (global) |
| Current usage | (close to limit) |
| Limit | `10` (default) |

If the search returns nothing, broaden the filter (e.g. `URL`) — Google occasionally renames quotas in the UI; the underlying metric ID is `compute.googleapis.com/url_maps`.

### 3. Request the increase

1. Tick the checkbox at the start of the row.
2. Click **EDIT QUOTAS** at the top right.
3. In the side panel, set **New limit** to `50`. (50 gives years of headroom and is well within the auto-approval window for this metric — small bumps like 10→20 also auto-approve, but you'll be back here in a few months.)
4. Fill **Request description** with a short justification, e.g.:
   > Multi-tenant GKE project with multiple namespaces each running an HTTPS ingress. Hit the default 10 URL maps cap; need headroom for ongoing project growth.
5. Click **DONE**, then **SUBMIT REQUEST**.

You will see a green confirmation toast and an entry under **Quota requests** with status `Pending` → `Granted`.

### 4. Wait for approval

- Bumps to **≤ 100** are usually auto-approved within **1–10 minutes**.
- You'll get an email at the requester's address when granted.
- You can also watch the limit live with:
  ```bash
  gcloud compute project-info describe --project=bemtech-478413 \
    --format='value(quotas.filter(metric:URL_MAPS).limit)'
  ```

### 5. Unstick the blocked ingress

Once the new limit lands, the GKE controller will retry on its own within ~60s. Force it sooner by re-applying the ingress:

```bash
kubectl rollout restart deployment/web -n campaigner   # optional
kubectl get events -n campaigner --sort-by='.lastTimestamp' | tail -5
kubectl get ingress -n campaigner -w  # ADDRESS column should populate within 1–3 min
```

When the IP appears, confirm:

```bash
gcloud compute url-maps list | grep -E "campaigner|count"  # should now include both um and rm
kubectl get managedcertificate -n campaigner               # status moves Provisioning → Active (after DNS too)
```

## What else to bump while you're here

If you're already in the quota panel, these often hit the same cliff in a multi-tenant GKE project — bump them pre-emptively to avoid future runbook visits:

| Quota | Default | Bump to | Why |
|---|---|---|---|
| URL maps (global) | 10 | 50 | this runbook |
| Backend services (global) | 30 | 100 | one per ingress backend; runs out next |
| Target HTTPS proxies (global) | 30 | 100 | one per ingress |
| Forwarding rules (global) | 75 | 100 | one per ingress |
| In-use IP addresses (global) | 8 | 25 | one per ingress with a static IP |

You only pay for actual resources used — quota is just a ceiling.

## Alternatives if the bump is denied

Rare, but if Google denies the request (usually only when usage is dramatically below limit), see `docs/runbooks/gke-ingress-alternatives.md` (TBD) — covers consolidating ingresses, dropping HTTPS-redirect to save 1 UM per ingress, switching to NGINX Ingress, and Gateway API.

## History

| Date | Bumped by | From → To | Reason |
|---|---|---|---|
| 2026-05-05 | b.m.tech.digital1@gmail.com | 10 → 20 (auto-approved within minutes; we requested 50 but Google's auto-approval window capped at 20) | Campaigner ingress couldn't provision; cosmetics ingress already broken from same cause |

(Append a row each time this runbook is used.)
