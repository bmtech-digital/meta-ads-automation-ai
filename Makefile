.PHONY: help \
        dev dev_down dev_logs \
        build build_agent build_web build_webhook \
        deploy deploy_agent deploy_web deploy_webhook deploy_migrations \
        agent_run_once \
        status pods logs agent_logs web_logs webhook_logs \
        generate verify-generated

# ─── Targets the daily developer uses ───────────────────────────────────────
# Normal path: `git push origin main` → GitHub Actions builds + deploys to
# Hetzner k3s. See docs/CI_CD.md.
# Local commands below are for local dev (`make dev`) and emergency
# operator hand-deploys (`make build deploy`).

# ─── Production cluster config ──────────────────────────────────────────────
# Hetzner k3s context (set via `~/.kube/config`; the operator's machine has
# the cluster registered as the `default` context).
KUBE_CONTEXT ?= default
NAMESPACE ?= campaigner

# Image registry — GitHub Container Registry under the `roihala` user.
GHCR_USER ?= roihala
GHCR_REPO ?= ghcr.io/$(GHCR_USER)

# Tag every local-build image with a timestamp so it doesn't collide with
# CI's per-SHA tags. CI uses `:${GITHUB_SHA}` + `:latest`; local uses
# `:manual-$(TS)` + `:latest`. The `:latest` tag is fine to reuse — k8s
# `imagePullPolicy: Always` makes the next pod restart pick it up.
TS := $(shell date +%Y%m%d-%H%M%S)
IMAGE_TAG ?= manual-$(TS)

# 7 agent CronJobs — kept in sync with kubefiles/CLAUDE.md (now superseded
# by the operator's Hetzner repo manifests, but the names match the live
# cluster state).
CRONJOBS := \
  agent-daily-observe \
  agent-execute-approvals \
  agent-daily-ab-decisions \
  agent-midday-health-check \
  agent-weekly-creative \
  agent-weekly-competitive-research \
  agent-weekly-self-audit

help:
	@echo "Daily path:"
	@echo "  git push origin main             → CI builds and deploys (see docs/CI_CD.md)"
	@echo ""
	@echo "Local development:"
	@echo "  make dev                         Start local stack (postgres + mongo + redis + campaigner shell)"
	@echo "  make dev_down                    Stop local stack"
	@echo "  make dev_logs                    Tail local stack logs"
	@echo ""
	@echo "Emergency hand-deploy (when CI is down):"
	@echo "  make build                       Build + push all 3 images to GHCR (cross-arch, amd64)"
	@echo "  make deploy                      Apply migrations + roll all workloads to the latest image"
	@echo "  make build deploy                Full hand-deploy in one command"
	@echo ""
	@echo "Inspection:"
	@echo "  make status                      Deployments + CronJobs + pods + services + ingress"
	@echo "  make pods                        Watch pods (kubectl -w)"
	@echo "  make agent_logs                  Tail logs from the most recent agent Job"
	@echo "  make web_logs                    Tail web Deployment logs"
	@echo "  make webhook_logs                Tail webhook Deployment logs"
	@echo "  make agent_run_once FLOW=...     Manually fire one CronJob (FLOW is one of: $(CRONJOBS))"
	@echo ""
	@echo "Generated artifacts (codegen):"
	@echo "  make generate                    Regenerate Python constants + spec tables from config/*.yaml"
	@echo "  make verify-generated            CI check — fail if any generated file drifts from source"

# ─── Local development (docker compose) ─────────────────────────────────────
dev:
	docker compose up -d

dev_down:
	docker compose down

dev_logs:
	docker compose logs -f

# ─── Build (local; usually triggered by CI on push to main) ─────────────────
# All builds use buildx --push and pin --platform=linux/amd64 because the
# Hetzner cluster nodes are amd64 and a default `docker build` on Apple Silicon
# would produce arm64-only manifests (ImagePullBackOff at deploy time).
build: build_agent build_web build_webhook
	@echo ""
	@echo "✓ All 3 images pushed: $(GHCR_REPO)/campaigner-{agent,web,webhook}:$(IMAGE_TAG) (and :latest)"

build_agent:
	@echo "→ Building campaigner-agent:$(IMAGE_TAG)"
	docker buildx build \
	  --platform=linux/amd64 --push \
	  -f dockerfiles/agent.dockerfile \
	  -t $(GHCR_REPO)/campaigner-agent:$(IMAGE_TAG) \
	  -t $(GHCR_REPO)/campaigner-agent:latest \
	  .

build_web:
	@echo "→ Building campaigner-web:$(IMAGE_TAG)"
	docker buildx build \
	  --platform=linux/amd64 --push \
	  -f dockerfiles/web.dockerfile \
	  -t $(GHCR_REPO)/campaigner-web:$(IMAGE_TAG) \
	  -t $(GHCR_REPO)/campaigner-web:latest \
	  web

build_webhook:
	@echo "→ Building campaigner-webhook:$(IMAGE_TAG)"
	docker buildx build \
	  --platform=linux/amd64 --push \
	  -f dockerfiles/webhook.dockerfile \
	  -t $(GHCR_REPO)/campaigner-webhook:$(IMAGE_TAG) \
	  -t $(GHCR_REPO)/campaigner-webhook:latest \
	  webhook

# ─── Deploy (local; usually triggered by CI on push to main) ────────────────
# Each `kubectl set image` mutates a single resource — no `apply -f`, no
# structural drift. Structural state (Deployments, Services, Ingress, Secrets,
# StatefulSet) is operator-managed via the Hetzner infra repo.
deploy: deploy_migrations deploy_agent deploy_web deploy_webhook

deploy_migrations:
	@echo "→ Applying migrations to in-cluster Postgres (idempotent — duplicate errors tolerated)"
	@for f in $$(ls migrations/*.sql | sort); do \
	  printf "  → %s … " "$$(basename $$f)"; \
	  if kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) exec -i postgres-0 -- \
	       psql -U campaigner -d campaigner_dev -v ON_ERROR_STOP=1 -q < $$f \
	       2>/tmp/mig-err.txt; then \
	    echo "ok"; \
	  elif grep -qE 'already exists|duplicate' /tmp/mig-err.txt; then \
	    echo "skipped (already applied)"; \
	  else \
	    echo "FAILED"; cat /tmp/mig-err.txt; exit 1; \
	  fi; \
	done

deploy_agent:
	@echo "→ Bumping all 7 CronJob images to :$(IMAGE_TAG)"
	@for cj in $(CRONJOBS); do \
	  echo "  → $$cj"; \
	  kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) set image cronjob/$$cj \
	    agent=$(GHCR_REPO)/campaigner-agent:$(IMAGE_TAG); \
	done

deploy_web:
	@echo "→ Rolling web Deployment to :$(IMAGE_TAG)"
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) set image deployment/web \
	  web=$(GHCR_REPO)/campaigner-web:$(IMAGE_TAG)
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) rollout status deployment/web --timeout=300s

deploy_webhook:
	@echo "→ Bumping webhook image to :$(IMAGE_TAG) (replicas: 0 — no rollout to wait for)"
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) set image deployment/webhook \
	  webhook=$(GHCR_REPO)/campaigner-webhook:$(IMAGE_TAG)

# ─── Inspection ─────────────────────────────────────────────────────────────
status:
	@echo "=== Namespace ==="
	kubectl --context=$(KUBE_CONTEXT) get namespace $(NAMESPACE) || echo "Namespace not found"
	@echo ""
	@echo "=== Deployments ==="
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) get deployments
	@echo ""
	@echo "=== CronJobs ==="
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) get cronjobs
	@echo ""
	@echo "=== Recent Jobs ==="
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) get jobs --sort-by=.metadata.creationTimestamp | tail -10
	@echo ""
	@echo "=== Pods ==="
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) get pods
	@echo ""
	@echo "=== Services ==="
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) get services
	@echo ""
	@echo "=== Ingress + Certificates ==="
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) get ingress,certificate 2>/dev/null || true

pods:
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) get pods -w

agent_logs:
	@JOB=$$(kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) get jobs --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}'); \
	echo "Tailing logs from job/$$JOB"; \
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) logs job/$$JOB -f

web_logs:
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) logs -l app=web --tail=100 -f

webhook_logs:
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) logs -l app=webhook --tail=100 -f

# Manually fire one CronJob immediately. Useful for smoke-testing a deploy
# or re-running a flow that missed its scheduled window.
agent_run_once:
	@if [ -z "$(FLOW)" ]; then \
	  echo "Usage: make agent_run_once FLOW=<one of: $(CRONJOBS)>"; \
	  echo "Shorthand also works — strip the 'agent-' prefix (e.g. FLOW=daily-observe)."; \
	  exit 1; \
	fi
	@CJ=$$(echo "$(FLOW)" | sed 's/^agent-//'); CJ="agent-$$CJ"; \
	echo "Firing $$CJ"; \
	kubectl --context=$(KUBE_CONTEXT) -n $(NAMESPACE) create job --from=cronjob/$$CJ manual-$$CJ-$$(date +%s)

# ─── Codegen ────────────────────────────────────────────────────────────────
# `make generate` regenerates everything derived from config/*.yaml.
# Currently: Python constants module + spec table fragments.
# (Generation of kubefiles/agent_cronjob_*.yaml was retired with the GKE
# deployment — production manifests now live in the operator's Hetzner repo.)
# Idempotent. Run after editing any source YAML; CI's `make verify-generated`
# rejects drift.
generate:
	python3 scripts/generate_from_flows.py
	python3 scripts/generate_from_thresholds.py

verify-generated:
	python3 scripts/generate_from_flows.py --check
	python3 scripts/generate_from_thresholds.py --check
