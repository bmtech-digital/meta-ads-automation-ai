# Claude-at-`dockerfiles/` — image definitions

> Loaded automatically when cwd is here. Active alongside [root CLAUDE.md](../CLAUDE.md).

## What this folder is

Three Dockerfiles. Each builds one of the three services this project ships. They are referenced explicitly via `-f dockerfiles/<name>.dockerfile` from the [Makefile](../Makefile) and [`docker-compose.yml`](../docker-compose.yml) — there is no `Dockerfile` at the repo root.

| File | Image | Used by |
|---|---|---|
| [`agent.dockerfile`](agent.dockerfile) | `campaigner-agent` | The 3 cron CronJobs in `kubefiles/agent_cronjob_*.yaml`, and `docker compose run --rm campaigner` for local dev. |
| [`web.dockerfile`](web.dockerfile) | `campaigner-web` | `kubefiles/web_deployment.yaml`, public dashboard. |
| [`webhook.dockerfile`](webhook.dockerfile) | `campaigner-webhook` | `kubefiles/webhook_deployment.yaml`, Flask receiver for Meta webhooks (data-deletion etc.). |

## When to rebuild which image

| You changed | Rebuild |
|---|---|
| `campaigner/`, `runners/`, `scripts/`, `migrations/`, `requirements.txt`, root `*.py` | agent |
| `web/src/`, `web/package.json`, `web/next.config.mjs`, `web/tailwind.config.ts` | web |
| `webhook/app.py`, `webhook/requirements.txt` | webhook |

The Makefile bakes this in: `make agent`, `make web`, `make webhook`.

## Build context

Each Dockerfile uses a **specific** build context — not the repo root for all three:

```bash
docker build -f dockerfiles/agent.dockerfile -t campaigner-agent .              # context = repo root
docker build -f dockerfiles/web.dockerfile   -t campaigner-web   web            # context = web/
docker build -f dockerfiles/webhook.dockerfile -t campaigner-webhook webhook    # context = webhook/
```

This is why `web.dockerfile` cannot reference `campaigner/` files (it's outside its context) and vice versa. Don't try to share files across images by tweaking the context — duplicate or extract a third image instead.

## Conventions

1. **Pin major versions, not patch versions.** `python:3.11-slim`, `node:20-alpine`. Patch updates within the major are fine; major updates are decisions, not Dockerfile diffs.
2. **`--no-cache` only when invalidating intentionally.** The Makefile's `--no-cache` on `*_build_push` is deliberate (production should never depend on a stale layer). For local iteration use `docker compose build` without `--no-cache`.
3. **Multi-stage where it pays.** `web.dockerfile` uses `output=standalone` from Next.js — keep it. `agent.dockerfile` is single-stage and that's fine because Python doesn't compile.
4. **Don't bake secrets in.** Secrets enter at runtime via env or k8s `Secret` mounts (see [`../kubefiles/secrets_template.yaml`](../kubefiles/secrets_template.yaml)). If a `Dockerfile` ever contains `ANTHROPIC_API_KEY=`, that's a bug.
5. **No `latest` tag in production.** The Makefile tags both `:latest` and a digest-pinned ref where applicable; `kubefiles/*.yaml` should pin to digest in prod.

## Where truth lives

| Question | Read |
|---|---|
| Build + push commands | [Makefile](../Makefile) `*_build_push` targets |
| What's actually deployed | [`../kubefiles/`](../kubefiles/) `image:` fields |
| Why the agent image needs `claude` CLI installed | [root CLAUDE.md "Architecture"](../CLAUDE.md#architecture-mvp--claude-code-native) — runners shell to `claude -p` |
| Why local dev uses the same agent image | [`../docker-compose.yml`](../docker-compose.yml) — `campaigner` service |
