# Claude-at-`webhook/` — Meta Lead Ads webhook receiver

> Loaded automatically when cwd is here. Active alongside [root CLAUDE.md](../CLAUDE.md).

## What this folder is

A small Flask server that receives Meta Lead Ads webhook notifications and creates a Trello card per lead. **Narrow scope on purpose** — this service is the leads pipeline, not part of the agent loop.

| | |
|---|---|
| Framework | Flask |
| Image | `campaigner-webhook` (built from [`../dockerfiles/webhook.dockerfile`](../dockerfiles/webhook.dockerfile)) |
| Deployed | [`../kubefiles/webhook_deployment.yaml`](../kubefiles/webhook_deployment.yaml) |
| Entrypoint | [`app.py`](app.py) |

## What it does

1. **GET `/webhook`** — verifies the webhook subscription on Meta's side using `WEBHOOK_VERIFY_TOKEN`. One-time setup per app.
2. **POST `/webhook`** — receives leadgen events from Meta. Verifies HMAC via `META_APP_SECRET`, fetches lead details via Graph API, creates a Trello card.

## What it does NOT do

- It is **not** the agent. It does not propose, evaluate, or execute campaigns.
- It does **not** read or write Postgres (no `agent_decisions`, no `approvals`).
- It does **not** call Vertex / Imagen / Claude.

If a request looks like the webhook should orchestrate something more complex (route to multiple destinations, score the lead, etc.), that's a spec change — talk to it before adding logic here.

## Required env

```
WEBHOOK_VERIFY_TOKEN
META_APP_SECRET
META_ACCESS_TOKEN
TRELLO_API_KEY
TRELLO_TOKEN
TRELLO_LIST_ID
```

All read at import time (line ~23 of [`app.py`](app.py)). Missing env crashes on boot — that's intentional, k8s will surface it via CrashLoopBackOff before traffic hits.

## Conventions

1. **HMAC verification on every POST.** Never skip `verify_signature(...)` — Meta retries on 5xx, so a verification bypass becomes a forge-anything endpoint.
2. **Idempotency** — Meta retries the same `lead_id`. Either dedupe in this service (currently relies on Trello returning the same card if invoked twice with the same idempotency key) or accept that duplicate cards are possible and document it.
3. **No Postgres dependency.** Keep the deployment lean — it's stateless and trivially horizontally scalable. Adding Postgres makes it part of the agent's blast radius.
4. **Secrets via k8s `Secret`** — see [`../kubefiles/secrets_template.yaml`](../kubefiles/secrets_template.yaml). Don't add a separate webhook-only secret pattern.

## Deploy

```bash
make webhook              # build + push + apply + restart
make webhook_logs         # tail logs
make webhook_restart      # rollout restart only
```

## Where truth lives

| Question | Read |
|---|---|
| Meta webhook subscription setup | [Meta Webhooks docs](https://developers.facebook.com/docs/graph-api/webhooks) (external) + Meta App config |
| App review / privacy / data deletion language | [`../docs/plans/meta-app-review-*.md`](../docs/plans/) |
| Why Trello (not Slack / Linear / something else) | Aiweon ops choice — see [`../docs/plans/decisions-log.md`](../docs/plans/decisions-log.md) if a decision row exists |
| Deployment manifest | [`../kubefiles/webhook_deployment.yaml`](../kubefiles/webhook_deployment.yaml) |
