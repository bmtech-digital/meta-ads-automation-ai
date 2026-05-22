# Continue Prompt — Campaigner brain migration

**Updated:** 2026-05-20
**Branch:** `main` — local at `a0ddfad` (Step 5 committed; not yet pushed).
**Status:** PRD Steps 1, 2, 3, **and 5** of 9 landed. **All four parallel-safe foundations (Phase A) are done.** Next move: **Step 4 (per-flow prompt split + shared brain)** — the large atomic structural change.

## Side task in flight — local non-docker demo against Supabase

Roi asked for a light, docker-free way to run the campaigner end-to-end against Supabase so he can smoke-test the PRD step 5 logic. Mid-setup as of this writing:

- ✅ `.venv/` created at repo root, `pip install -r requirements.txt` succeeded (~250 MB).
- ✅ `.env` updated with new Supabase Session-pooler URI (ap-northeast-1 region).
- ✅ Supabase DB ping works (`from campaigner.lib.db import ping; ping()` → True).
- ✅ Supabase wiped clean (8 stale tables dropped) and migrated fresh from 001 → 032. All 34 migrations applied cleanly, including the PRD step 3 (`031_thresholds_schema_version`) and step 5 (`032_plans_structured_trigger`) ones we wanted to test.
- ✅ Aiweon `businesses` row seeded via `scripts/seed_local.py` (id `9f8f42d9-3f6c-4e2e-bc1a-b60f9ff551f3`, `meta_auth_mode='user_token'`).
- ✅ K8s `campaigner-secrets` Secret in `campaigner` namespace patched via `make secrets` — DATABASE_URL + fresh ANTHROPIC_API_KEY now live.
- ✅ Flow A end-to-end against Supabase **succeeded as a logic demo** ($2.63 Anthropic spend, 40 turns, ~9 min). Wrote 3 `agent_decisions` rows + start/error heartbeats for `RUN_ID=5ac78704-f3a5-4a37-a077-a6052bf3d9ca`. The brain correctly diagnosed that the seeded `META_ACCESS_TOKEN` is a Sandbox-app token (owner: synthetic "Sandbox Ad Account Owner" from app `ADS-CAMPINER`/`1279534720998161`) that cannot access the real `act_1390480923117690`, and emitted a Hebrew-rationale error decision with a structured `outputs.fix` payload. **Confirmed PRD step 3 is wired**: every decision row has `thresholds_schema_version='1.0.0'` stamped. **PRD step 5 was NOT exercised** because the flow errored at Step 0 (budget health) before reaching the plan-emission stage — to test step 5 specifically, either swap in a real System User Token or unit-test `propose_task --plan` directly against `plans_carryover`.
- 🐛 **macOS runner bug** still present: `runners/*.sh` use `date +%s%3N` (Linux/coreutils only). BSD `date` outputs the literal `%3N` as `3N`, breaking the `$((...))` arithmetic at lines 42, 68, 69. **Demoted from blocker to cosmetic** because the agent's protocol self-writes heartbeats via `python -m campaigner.tools.heartbeat` — start/error rows landed correctly even though the bash trap crashed. Worth fixing if runners are ever invoked on macOS dev machines (alternatives: `python -c 'import time;print(int(time.time()*1000))'` or `gdate +%s%3N`).
- 🧹 **Cleanup pending** (Roi answered "Stop here — demo is done" but then pivoted to frontend): Claude's nested session created `.venv-host/` (~150 MiB) and `.run-host.sh` (381 B) at repo root. Both safe to delete; not deleted yet.
- 🚨 **Disk pressure noticed during the run**: 820 MiB free of 926 GiB (94% used). Unrelated to this work but worth a separate tidy-up pass.

## Side task #2 — Meta Path A (System User Token) — in flight

**Pivoted 2026-05-21:** Roi tried the OAuth flow (Path B) and couldn't complete it on Meta's side — likely an app-mode/role/scope-review issue. Now switching to **Path A** (System User Token) which is the production-intended path for Aiweon per `meta-integration-readiness.md §1` anyway. OAuth env setup below remains in place for future SaaS-tenant testing.

Path A blockers + next steps:
- ✅ Driving BM walkthrough via claude-in-chrome MCP, tab `1133734152`. Roi granted partial permissions (ref-based clicks + text reads work; coordinate clicks + screenshots blocked). Workflow: `find` for element refs, then `computer:left_click` by ref.
- ✅ Reached Bemtech Business Manager system_users page (business_id `908932824234740`). Discovered existing `bemtech-admin` System User (id `61579420437900`, Admin role) already assigned: Page Aiweon (Full control), Ad account bemtech = `act_1390480923117690` (Full control), App `bemtech-app` (Full control), Pixel test-pixel (Full control), IG `aiweon.agent` (Nothing assigned yet ⚠️).
- 🔀 **App pivot**: started Generate Token wizard with ADS-CAMPINER (the .env META_APP_ID), but Step 3 errored "No permissions available — Assign an app role to the system user or select another app to continue" — bemtech-admin isn't installed on ADS-CAMPINER. Pivoted to `bemtech-app` (which the SU IS installed on). **Implication: .env's META_APP_ID + META_APP_SECRET must change** from ADS-CAMPINER (1279534720998161) to bemtech-app's id + secret, otherwise appsecret_proof signing breaks every API call.
- ✅ Token generated after Meta async identity check (came back almost immediately, not hours/days as I'd feared). New token saved to `.env` `META_ACCESS_TOKEN`. Validated via `debug_token` + live API: `type=SYSTEM_USER`, `is_valid=true`, `expires_at=0` (never), `app_id=1663090314693954` (bemtech-app), `profile_id=bemtech-admin (122114456888980681)`. Scopes granted: `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, plus harmless catalog/threads/whatsapp/manage_app_solution. **Real bemtech ad account is now reachable**: `act_1390480923117690` insights for last 7d returns 8,424 impressions / $306.40 spend / Asia/Jerusalem TZ. Flow A re-run will produce real diagnoses on real data.
- 🔑 **App secret mismatch detected**: `.env` still has `META_APP_ID=1279534720998161` (ADS-CAMPINER) + ADS-CAMPINER's secret. SDK computes `appsecret_proof=HMAC(token, app_secret)` — wrong secret = Meta returns "Invalid appsecret_proof" on every call. Tested directly: bare-token works, ADS-CAMPINER-secret-signed call fails as expected. Bemtech-app does NOT require appsecret_proof (verified) — but the SDK insists on sending one whenever app_secret is set, so we must either populate the right secret or empty it.
- ⏳ Roi chose option 1 (grab the real secret). Opened `https://developers.facebook.com/apps/1663090314693954/settings/basic/` in Chrome AND opened `.env` in VS Code (he asked to paste it himself, same pattern as the DATABASE_URL + ANTHROPIC_API_KEY edits earlier). Waiting for him to save the file with `META_APP_ID=1663090314693954` + the 32-char hex secret.
- ✅ Roi pasted bemtech-app secret directly into `.env` (META_APP_ID=1663090314693954, META_APP_SECRET=961009cd…). Signed Meta API call verified working both via raw HTTP and via the facebook-business SDK.
- ✅ Supabase `businesses.meta_auth_mode` flipped to `'system_user_token'`, `meta_access_token_expires_at=NULL`.
- ⏸ **`make secrets` skipped** (gcloud token expired, needs interactive `gcloud auth login`). Discovered via Hetzner migration doc (`~/projects/bemtech/setup/hetzner/CLAUDE.md`) that **`campaigner` namespace has NOT been migrated yet** — still lives on GKE, so the GKE Secret push is still the correct future target. Migration table lists it as "pending, 24 deployments, medium risk." When campaigner does migrate, the new push path will be SOPS-encrypted secrets under `setup/hetzner/secrets/campaigner/` to k3s context `bemtech-hetzner-k3s` (pattern: see `setup/hetzner/manifests/aiweon-demo/` + `secrets/aiweon-demo/`).
- 🔄 **Flow A currently running** (started 2026-05-21 16:17 UTC, PID 41335, ~10 min elapsed when this note written). DB already shows 5 new `agent_decisions` rows from this run (8 total including prior session's 3) — agent IS reaching real Bemtech data this time. Waiting for the runner to finish; result will land at `/private/tmp/claude-502/.../baxxny6jj.output` (currently 0-byte; `claude -p` buffers stdout until completion).
- ⏭ When it lands: capture result summary, show Roi which decisions got written, decide whether the run also produced any proposals (`approvals` rows) — that'd be the first real-data approval the system has ever generated, worth inspecting in detail.
- ⏭ Once token lands: (1) replace `META_ACCESS_TOKEN` in `.env`, (2) in Supabase: `UPDATE businesses SET meta_auth_mode='system_user_token', meta_access_token_expires_at=NULL WHERE id='9f8f42d9-…'`, (3) `set -a; source .env; set +a; make secrets` to push to K8s `campaigner-secrets`, (4) re-run `PATH=$(pwd)/.venv/bin:$PATH bash runners/daily_observe_propose.sh` and watch Flow A get past Step 0 this time.
- ⚠️ Frontend implication: Path A does NOT populate `meta_connections`/`meta_pages`/`meta_ig_accounts` (those are OAuth-only tables). The `/integrations` page in `system_user_token` mode shows the never-expires badge but no asset list — assets live only in `.env` (`META_AD_ACCOUNT_ID`, `META_PAGE_ID`).

## Side task #2b — Frontend OAuth (Path B) — paused but configured

Original frontend OAuth attempt configured but Roi couldn't complete the Meta-side dialog. Env is still in place for future use:

- ✅ `web/.env.local` created with: `WEB_DB_MODE=local-postgres`, `DATABASE_URL` (Supabase pooler), `WEB_AUTH_MODE=dev-cookie`, `WEB_DEV_ALLOWED_EMAILS=roihalamish@gmail.com,admin@aiweon.co.il`, `BUSINESS_ID`, `META_PUBLIC_ORIGIN=http://localhost:3100`, `META_APP_ID=1279534720998161`, `META_APP_SECRET`, `META_REVIEW_TIER=3`, freshly generated `META_ENCRYPTION_KEY_BASE64` (32B b64) + `META_STATE_SECRET` (48B b64).
- ✅ Next.js dev server running on `localhost:3100` (background task `by1e8ydma`, started via `cd web && pnpm exec next dev -p 3100` — note: `pnpm dev` hard-codes `-p 3000`, so we bypass it via `pnpm exec next`).
- ✅ OAuth tables (`meta_oauth_state`, `meta_connections`) verified present in Supabase from earlier full migration.
- ✅ Confirmed `businesses.meta_auth_mode='user_token'` for Aiweon — the `/integrations` page WILL render the התחבר ל-Meta button (the System-User-Token path A would hide it).
- ⏳ Waiting for Roi to: (1) add `http://localhost:3100/api/meta/oauth/callback` to **Facebook Login → Settings → Valid OAuth Redirect URIs** at `https://developers.facebook.com/apps/1279534720998161/fb-login/settings/`, (2) confirm Client OAuth Login + Web OAuth Login are both Yes, (3) click התחבר ל-Meta on `http://localhost:3100/integrations`.
- 📝 **Production URLs Roi will need later** (for App Review submission) — all under `campaigner.aiweon.co.il` (the GKE-ingress hostname): OAuth callback `https://campaigner.aiweon.co.il/api/meta/oauth/callback`, Deauthorize Callback URL `https://campaigner.aiweon.co.il/api/meta/deauthorize`, Data Deletion Request URL `https://campaigner.aiweon.co.il/api/meta/data-deletion`. The deauth + data-deletion URLs need the prod web actually deployed before Meta will accept them (Meta does a reachability probe on save).

## Side task #3 — Frontend visual verification (queued behind #2)

Once OAuth completes and `meta_connections` has a row, the original "run the frontend and let me see the results" ask resumes: dashboard routes that surface what the agent wrote — `/runs` and `/history` should show the 3 `agent_decisions` rows + heartbeats from `run_id 5ac78704…`; `/approvals` will be empty (Flow A errored before proposing); `/integrations` will show the Connected card with Pages/IG/Ad Accounts.

Resume by reading the conversation above — Roi finishing the Meta dashboard config + clicking התחבר is the unblocker.

## Where we are

Executing the nine-step migration in [`docs/plans/campaigner-migration-prd.md`](../plans/campaigner-migration-prd.md). The audit that motivates it: [`docs/AUDIT_AND_MIGRATION.md`](../AUDIT_AND_MIGRATION.md).

Commits on `main` (in PRD-step order):

- **107088a** — planning baseline (audit + PRD + line-ending normalize on `guardrails.md`).
- **00bf7f9** — PRD Step 1: stripped the interactive persona. Closes audit Finding 5.
- **04716d4** — PRD Step 2: `config/flows.yaml` + generator + cronjob manifests for F/G/H. Closes audit Finding 1.
- **9ebe2f7** — restored CONTINUE_PROMPT after a prior session.
- **0b58454** — PRD Step 3: `config/thresholds.yaml` + generator + `{{<domain>.<name>}}` placeholders in prompts + `lib/thresholds.py` constants module consumed by `log_decision.py` for schema-version stamping. Closes audit Finding 3.
- **a0ddfad** — PRD Step 5: structured plans trigger. Migration 032 adds metric / operator / threshold-by-name / sustained-days / proposed_action columns to `plans_carryover`; `propose_task --plan` writes the structured row alongside the approval; `load_active_plans.py` queries the table only (regex fallback gone). Closes audit Finding 6.

## What's next

**Recommended:** PRD **Step 4 — Per-flow prompt files + shared brain** (large effort — PRD calls it 2-3 weeks, so realistically multiple sessions). Atomic: per-flow split + shared-brain extraction ship together (PRD §Step 4 atomicity note).

Scope from PRD §Step 4:

- Split `CAMPAIGNER.md` (currently ~1,200 lines) into `prompts/flows/<flow_name>.md` per the template in PRD §2.3: Identity → When this runs → Inputs → What to check → What to compare → Decision rules → Constraints → Plans consumed/created → Outputs → Edge cases → Worked example.
- Extract every concept used by ≥2 flows into `prompts/shared-brain.md` — two-gate model, fatigue detection, portfolio rebalance, the diagnostic method, lane definitions referenced from multiple flows. Per-flow files reference shared concepts; flow-specific stays in the flow file.
- Update `config/flows.yaml` load matrix to declare which flows load `shared-brain.md` (most do).
- Shrink `CAMPAIGNER.md` to ~100 lines: thin index + universal preamble. Sections that moved are either deleted or replaced with a single line pointing at the new home.
- Run all currently-passing goldens under `tests/golden/` against the post-Step-4 brain before merging.

**Atomicity warning (PRD §6.2):** splitting per-flow WITHOUT the shared-brain extraction is not independently shippable — it distributes shared reasoning across N files without a home, creating exactly the drift risk Finding 10 warns about. The two halves of Step 4 must land together.

**If you'd rather defer Step 4:** Steps 6 (stable slugs), 7 (generated guardrails reference), 8 (concept index), 9 (onboarding cut-over) remain, but they all depend on Step 4's per-flow / shared-brain structure existing first. So Step 4 is the next bottleneck regardless.

## Operational TODOs accumulated

1. **`make agent` still pending from Step 2** — the new cronjob manifests for F/G/H are committed but not deployed. PRD's "F/G/H run for 14 consecutive days in production" AC for Step 2 can't start its clock until then.
2. **Migration 031 not yet applied in production** — from Step 3. `log_decision.py` writes `thresholds_schema_version` and will fail with "column does not exist" until 031 lands.
3. **Migration 032 not yet applied in production** — from Step 5 (this session). `propose_task --plan` writes the new columns and will fail with "column does not exist" until 032 lands.
4. **Push `a0ddfad`** — Step 5 is committed locally but not on `origin/main` yet.

Recommended order when shipping: push first, then apply migrations 031+032 in one window, then redeploy the agent image. The migrations are additive (new columns, all NULLable), so they're safe to land independently of the agent rolling out.

## Files to read first on restart

1. [`docs/plans/campaigner-migration-prd.md`](../plans/campaigner-migration-prd.md) §Step 4 — the contract for the next step.
2. [`campaigner/CAMPAIGNER.md`](../../campaigner/CAMPAIGNER.md) — what's being split. ~1,200 lines today; target is ~100.
3. [`campaigner/prompts/`](../../campaigner/prompts/) — what already exists in per-prompt form. `performance-brain.md`, `decision-tree.md`, `guardrails.md`, `creative-guide.md`, `hebrew-copy-style.md`, plus a few support files.
4. [`config/flows.yaml`](../../config/flows.yaml) `flows[*].prompts.always` / `prompts.on_demand` — Step 4 will add `shared-brain.md` to most flows' `always` list.
5. [`tests/golden/`](../../tests/golden/) — the regression surface. Step 4 atomicity note demands a green run against these before merge.
6. Run `make verify-generated` first — must exit 0 against both flows + thresholds.

## Decisions already made (don't relitigate)

- **Generator pattern**: YAML in `config/`, Python generator at `scripts/generate_from_<name>.py`, sentinel-comment fenced regions in markdown, `make generate` + `make verify-generated`. Steps 7-8 will add more generators following the same pattern.
- **The agent never reads YAML directly.** Claude reads the generated markdown reference tables in `CAMPAIGNER.md`. PyYAML is build-time only.
- **Threshold placeholder syntax is `{{<domain>.<name>}}`.** Prose carries the placeholder; the reference table resolves it.
- **`plans_carryover` is the plans store** (kept the name; new columns are additive). Renaming to `plans` would be cosmetic — not required by PRD §5 AC.
- **Step 5 trigger fields reference thresholds.yaml by dotted name** (`gate_2.winner_ratio`), not literals. The denormalized `trigger_threshold_value` column keeps historical triggers interpretable if a threshold is later renamed.
- **`propose_task --plan` validation is format-only.** The validator checks the dotted-name shape, not existence in `thresholds.yaml` — same convention as the markdown `{{...}}` placeholders.
- **The legacy `lib.plans.persist_from_approval()` regex-parsing helper STILL EXISTS** — it's the back-compat path for proposals that don't pass `--plan`. It's only `load_active_plans.py`'s fallback that was removed (per PRD AC). Don't delete `persist_from_approval` without a separate cleanup pass.
- **Historical references to PERSONALITY.md in `docs/plans/*` are left alone.** Past-tense decision-log entries; the audit doc explains the deletion.
- **`docs/audit-summary-he.html` is untracked and unrelated.** Leave it.

## Sentinel pattern (unchanged)

```
<!-- BEGIN GENERATED:<sentinel-name> -->
... generator owns everything between the markers ...
<!-- END GENERATED:<sentinel-name> -->
```

The generators error out if a sentinel pair is missing. For Step 4, no new generated regions are obviously needed — the per-flow split moves content between hand-written markdown files. The flow load matrix already exists (Step 2 generates it from `flows.yaml`).

## How the session ended

Cleanly. `a0ddfad` committed and tested:
- `python3 -m py_compile` passes on every modified file.
- `make verify-generated` exits 0 against both generators.
- `validate_structured_plan` smoke-tested across the contract surface (valid, missing trigger, bad operator, bad threshold_name, neither name nor value, value-only).
- `git status` shows only `docs/audit-summary-he.html` untracked (pre-existing, intentional).

Step 5 not yet on `origin/main` — first action next session should be `git push origin main`.
