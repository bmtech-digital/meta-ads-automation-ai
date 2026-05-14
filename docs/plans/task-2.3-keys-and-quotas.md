# Task 2.3 — Anthropic API key + GCP Imagen quotas

> **Prereq:** [decisions-log §1.1](decisions-log.md#11-secret-management--google-secret-manager) (Secret Manager for prod; `.env` for dev) — ✅ closed 2026-04-19.
>
> **Scope:** verify dev-local credentials work for Phase 1, and confirm GCP Imagen quotas are sufficient for MVP volume. Production Secret Manager setup happens during Phase 0 execution (separate task, not here).
>
> **Output:** checklist below, executed. Validation script passing. `.env.example` up-to-date.

---

## 1. Checklist for Roi

### 1.1 Anthropic API key (dev)

- [ ] `ANTHROPIC_API_KEY` is set in `.env`. Dev key (not Aiweon's shared production key — those come via Secret Manager during Phase 0 execution of §1.1).
- [ ] **Monthly spend limit set** on the dev key in the Anthropic Console → Settings → Billing → Usage limits. Recommended for Phase 1: **$50/month hard cap** (~2× the $23/month baseline in CLAUDE.md). Trips on runaway tool-call loops before material damage. Revisit for prod.
- [ ] **Usage alert set** at $20 (~80% of baseline) so a drift alert arrives before the hard cap trips.
- [ ] Validate end-to-end: `docker compose run --rm campaigner python scripts/validate_credentials.py` — the Anthropic section should pass.

### 1.2 GCP authentication (Imagen)

- [ ] On the host machine: `gcloud auth application-default login` completed at least once. Creates `~/.config/gcloud/application_default_credentials.json`.
- [ ] The `campaigner` compose service mounts that directory into the container (already wired in [docker-compose.yml](../../docker-compose.yml)).
- [ ] Active GCP project is `bemtech-478413` — check with `gcloud config get-value project`. If not: `gcloud config set project bemtech-478413`.
- [ ] Vertex AI API is **enabled** on `bemtech-478413` — confirm at [console.cloud.google.com/apis/library/aiplatform.googleapis.com](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com?project=bemtech-478413).
- [ ] ADC principal (your gcloud user) has role `roles/aiplatform.user` on `bemtech-478413`. Check: `gcloud projects get-iam-policy bemtech-478413 --flatten='bindings[].members' --filter='bindings.role:aiplatform.user'`.
- [ ] Validation script passes — GCP section.
- [ ] Optional, runs one real generation (~$0.02): `... validate_credentials.py --with-imagen`.

### 1.3 GCP Imagen quotas — capacity check

Default quota on `imagen-3.0-fast-generate-001` is **200 requests per minute** per project. MVP demand is far below that:

| Workload                                              | Frequency                 | Rate                                     |
| ----------------------------------------------------- | ------------------------- | ---------------------------------------- |
| Weekly creative firehose (1 business × 3-5 creatives) | 1× / week                 | 0.00005 RPM                              |
| Phase 1 manual testing                                | ~20-50 generations / week | 0.005 RPM peak                           |
| **Total Phase 1**                                     | —                         | **< 0.01 RPM** — **20,000× under quota** |

**Conclusion: no quota increase needed for MVP.** Revisit when adding multiple businesses (v2) or switching default tier to `standard` (20 RPM quota — still plenty for single business but tighter).

- [ ] No action required. Noted for the record.

### 1.4 GCP budget alert — runaway protection

The Imagen fast tier is cheap ($0.02/image), but a bug that generates in a tight loop could still rack up bills. Set a project-level alert:

- [ ] In [console.cloud.google.com/billing](https://console.cloud.google.com/billing), set a **budget alert of $30/month** on the AI Platform / Vertex AI service line for `bemtech-478413`. Email `admin@aiweon.co.il` at 50% / 100%.

### 1.5 Meta token — dev (for Phase 1 test account `act_202495959`)

Strictly speaking, this is Meta-side not 2.3 (Anthropic/GCP). But validation script covers it, so we flag it here:

- [ ] Issue a short-lived token at [Graph API Explorer](https://developers.facebook.com/tools/explorer/) with `ads_read`, `ads_management`, `business_management`, `pages_read_engagement`, `pages_show_list`, `instagram_basic`.
- [ ] Extend to long-lived (~60 days) via [debug tool](https://developers.facebook.com/tools/debug/accesstoken/).
- [ ] Paste into `.env` as `META_ACCESS_TOKEN`.
- [ ] Validation script passes — Meta section.

---

## 2. Validation command

```bash
docker compose run --rm campaigner python scripts/validate_credentials.py
```

Expected output on a fully-configured dev env:

```
Campaigner credentials check
============================================================
[1/3] Anthropic — Claude Code CLI (headless)
      ANTHROPIC_API_KEY = sk-ant-...XXXXXX
  ✓ Claude Code responded: OK
[2/3] GCP — Vertex AI (Imagen)
      GCP_PROJECT_ID = bemtech-478413
      GCP_LOCATION   = us-central1
      ADC file       = /root/.config/gcloud/application_default_credentials.json
  ✓ Vertex AI client initialized
  - skipped live Imagen generation (pass --with-imagen to test, ~$0.02)
[3/3] Meta — Marketing API
      META_APP_ID          = XXXXXX...XXXXXX
      ...
  ✓ Meta API connected — account '...' (status 1)
============================================================
✓ All 3 checks passed.
```

On failure, each section prints a masked value of the credential it used and an actionable remediation hint.

---

## 3. What this task does **not** cover

Deferred to other tasks:

- **Production secrets in Google Secret Manager** — happens during Phase 0 execution of [§1.1](decisions-log.md#11-secret-management--google-secret-manager). The dev keys verified here live in `.env`; the production equivalents will be uploaded to Secret Manager separately.
- **Aiweon production Meta token** (`act_1390480923117690`) — verified only for `act_202495959` (dev). The Aiweon token is issued after Business Verification progresses + App Review is submitted — not a Phase 1 prereq.
- **Runtime behavior of Claude Code under the agent protocol** — this task only verifies the key + CLI respond. The actual agent loop (CAMPAIGNER.md + prompts + tool calls) is validated in Phase 1 golden-set tests (task 4.5).

---

## 4. Files touched in this task

| File                                                                     | Change                                                                                                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [.env.example](../../.env.example)                                       | Rewritten — added `ANTHROPIC_API_KEY`, `BUSINESS_ID`, Mongo/Redis vars, commentary about `.env` vs Secret Manager. Removed legacy Trello block. |
| [scripts/validate_credentials.py](../../scripts/validate_credentials.py) | **New.** Replaces legacy `test_credentials.py`. Covers Anthropic + GCP + Meta with pass/fail exit status.                                       |
| `test_credentials.py` (root)                                             | **Deleted.** Legacy fork artifact; superseded.                                                                                                  |
| [CLAUDE.md](../../CLAUDE.md)                                             | Setup section updated to point at the new validation script.                                                                                    |
| [docs/plans/conversation-map.md](conversation-map.md)                    | 2.3 status updated.                                                                                                                             |
