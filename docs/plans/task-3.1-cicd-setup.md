# Task 3.1 — CI/CD setup (WIF + repo variables)

> **Status:** deliverable for decisions-log §3.1. One-time setup Roi performs when ready to enable `main`-branch image pushes to Artifact Registry. Until enabled, only the `test` job runs — `build-push` is skipped by the `vars.AR_PUSH_ENABLED` gate.

---

## What's already wired

[.github/workflows/backend.yml](../../.github/workflows/backend.yml) — runs on PR + push to `main` with path filters (per [decisions-log §1.6](decisions-log.md#16-webfrontend--repo-topology)).

- `test` job: spins up the compose stack (mongo + redis), runs `scripts/validate_local_env.py`. **No setup required — works today on any fresh clone.**
- `build-push` job: builds backend image, pushes to `generic-agent-repo/campaigner` in Artifact Registry. **Gated behind `vars.AR_PUSH_ENABLED == 'true'`** — skipped until you complete the WIF setup below.

**Frontend workflow (`.github/workflows/frontend.yml`) intentionally not written yet** — `web/` doesn't exist. Will be added as part of task 4.7 (Frontend Phase 0) mirroring the backend structure.

---

## One-time WIF setup

Workload Identity Federation lets GitHub Actions authenticate to GCP without a long-lived service-account key. Chosen over SA-key-in-secret for rotation ergonomics (same principle as [decisions-log §1.1](decisions-log.md#11-secret-management--google-secret-manager)).

### 1. Create Artifact Registry repo (if not already)

```bash
gcloud artifacts repositories create generic-agent-repo \
  --repository-format=docker \
  --location=us-central1 \
  --project=bemtech-478413 \
  --description="Backend + frontend images for Campaigner and generic_agent"
```

> If the repo already exists from a previous setup, skip. Verify with:
> `gcloud artifacts repositories list --project=bemtech-478413`.

### 2. Create WIF pool + provider

```bash
PROJECT_ID=bemtech-478413
POOL_ID=github-pool
PROVIDER_ID=github-provider
REPO=roihala/meta-ads-automation-ai

# Pool
gcloud iam workload-identity-pools create "$POOL_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --display-name="GitHub Actions pool"

# Provider (restricted to this repo only — don't leave it open to all GitHub)
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub Actions provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == '$REPO'" \
  --issuer-uri="https://token.actions.githubusercontent.com"
```

### 3. Create a dedicated service account for CI

```bash
gcloud iam service-accounts create campaigner-ci \
  --project="$PROJECT_ID" \
  --display-name="Campaigner CI (GitHub Actions → AR push)"

SA_EMAIL=campaigner-ci@${PROJECT_ID}.iam.gserviceaccount.com

# AR writer only — principle of least privilege
gcloud artifacts repositories add-iam-policy-binding generic-agent-repo \
  --project="$PROJECT_ID" \
  --location=us-central1 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/artifactregistry.writer"
```

### 4. Bind the WIF principal to the SA

```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository/$REPO"
```

### 5. Set GitHub repo variables + secrets

Go to `https://github.com/roihala/meta-ads-automation-ai/settings/variables/actions`:

**Variables** (not secret, visible in logs):

| Name              | Value                                          |
| ----------------- | ---------------------------------------------- |
| `GCP_PROJECT_ID`  | `bemtech-478413`                               |
| `AR_LOCATION`     | `us-central1`                                  |
| `AR_REPOSITORY`   | `generic-agent-repo`                           |
| `AR_PUSH_ENABLED` | `true` ← flip this last, acts as master switch |

**Secrets** (masked in logs):

| Name                  | Value                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `WIF_PROVIDER`        | `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `WIF_SERVICE_ACCOUNT` | `campaigner-ci@bemtech-478413.iam.gserviceaccount.com`                                                   |

> Get `PROJECT_NUMBER` from step 4 above.

### 6. Verify

Push any change under `campaigner/**` or `migrations/**` to `main`. The workflow should run `test` → `build-push`, and you should see the image appear in AR:

```bash
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/bemtech-478413/generic-agent-repo/campaigner \
  --project=bemtech-478413
```

---

## What's NOT in this setup (by design)

- **No deploy step.** Decided in [decisions-log §3.1](decisions-log.md#31-cicd-pipeline). Deploy to Cloud Run Jobs / GKE is added when [decisions-log §1.4](decisions-log.md#14-stagingprod-schema-sync--dual-write--ci-diff) re-decision settles. AR is decoupled from that choice — images are safe to push independently.
- **No tag-based releases.** Solo-dev MVP uses main-branch images. Release tag workflows deferred to Phase 6 if they prove useful.
- **No linting/formatting gate.** Added when `campaigner/` code lands (task 4.2+) with a linter choice that matches the codebase's maturity. Premature now.
- **No frontend workflow.** `web/` doesn't exist yet; workflow follows in task 4.7.
