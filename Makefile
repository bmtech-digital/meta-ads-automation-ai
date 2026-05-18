.PHONY: help auth get_gcp_cluster \
        agent agent_build_push agent_deploy agent_logs \
        web web_build_push web_deploy web_restart web_logs \
        webhook webhook_build_push webhook_deploy webhook_restart webhook_logs \
        namespace secrets gcp_credentials_secret \
        generate verify-generated \
        all status pods delete_all \
        dev dev_down dev_logs

# --- GCP Configuration (shared with generic_agent — same cluster, same registry) ---
PROJECT_ID=bemtech-478413
GCP_ACCOUNT=b.m.tech.digital1@gmail.com
DOCKER_REGISTRY=us-central1-docker.pkg.dev
REPO=$(DOCKER_REGISTRY)/$(PROJECT_ID)/generic-agent-repo
ZONE=us-central1-a
REGION=us-central1
CLUSTER_NAME=generic-agent-cluster
NAMESPACE=campaigner
STATIC_IP_NAME=campaigner-web-ip

help:
	@echo "Local development:"
	@echo "  make dev              - Start local stack (postgres, mongo, redis, campaigner shell)"
	@echo "  make dev_down         - Stop local stack"
	@echo "  make dev_logs         - Tail local stack logs"
	@echo ""
	@echo "Authentication:"
	@echo "  make auth             - gcloud auth + configure-docker + get k8s creds"
	@echo ""
	@echo "Build & deploy (per service):"
	@echo "  make agent            - Build/push agent image, restart all agent CronJobs"
	@echo "  make web              - Build/push web image, rollout web Deployment"
	@echo "  make webhook          - Build/push webhook image, rollout webhook Deployment"
	@echo ""
	@echo "Cluster setup (one-time):"
	@echo "  make namespace               - Create campaigner namespace"
	@echo "  make secrets                 - Apply secrets (edit kubefiles/secrets_template.yaml first!)"
	@echo "  make gcp_credentials_secret  - Upload local ADC JSON as gcp-vertexai-credentials secret"
	@echo "  make static_ip               - Reserve global static IP for public dashboard"
	@echo "  make web_ingress             - Apply ingress + ManagedCertificate (after DNS is set)"
	@echo "  make all                     - Full stack: namespace + secrets + GCP creds + agent + web + webhook"
	@echo ""
	@echo "Generated artifacts (config/flows.yaml -> manifests + docs):"
	@echo "  make generate         - Regenerate cronjob YAMLs + the routing/matrix tables in CAMPAIGNER.md + ARCHITECTURE.md"
	@echo "  make verify-generated - CI check: exit 1 if generated files have drifted from config/flows.yaml"
	@echo ""
	@echo "Inspection:"
	@echo "  make status           - Show deployments, pods, services, cronjobs, ingress"
	@echo "  make pods             - Watch pods in the namespace"
	@echo "  make agent_logs       - Tail logs from the most recent agent Job"
	@echo "  make web_logs         - Tail web Deployment logs"
	@echo "  make webhook_logs     - Tail webhook Deployment logs"

# --- Local Development ---

dev:
	docker compose up -d

dev_down:
	docker compose down

dev_logs:
	docker compose logs -f

# --- Authentication ---

auth:
	gcloud config set account $(GCP_ACCOUNT)
	gcloud config set project $(PROJECT_ID)
	gcloud auth configure-docker $(DOCKER_REGISTRY) --quiet
	gcloud container clusters get-credentials $(CLUSTER_NAME) --zone $(ZONE) --project $(PROJECT_ID)

get_gcp_cluster:
	gcloud container clusters get-credentials $(CLUSTER_NAME) --zone $(ZONE) --project $(PROJECT_ID)

# --- Agent (Python + Claude CLI, runs as 3 CronJobs) ---

agent: agent_build_push agent_deploy

agent_build_push:
	- docker rmi $(REPO)/campaigner-agent:latest || true
	docker build --no-cache --platform linux/amd64 -t campaigner-agent:latest -t $(REPO)/campaigner-agent:latest -f dockerfiles/agent.dockerfile .
	docker push $(REPO)/campaigner-agent:latest

agent_deploy: get_gcp_cluster
	kubectl apply -f kubefiles/agent_cronjob_daily_observe.yaml
	kubectl apply -f kubefiles/agent_cronjob_execute_approvals.yaml
	kubectl apply -f kubefiles/agent_cronjob_weekly_creative.yaml
	kubectl apply -f kubefiles/agent_cronjob_weekly_competitive_research.yaml
	kubectl apply -f kubefiles/agent_cronjob_weekly_self_audit.yaml
	kubectl apply -f kubefiles/agent_cronjob_daily_ab_decisions.yaml
	kubectl apply -f kubefiles/agent_cronjob_midday_health_check.yaml

agent_logs:
	@JOB=$$(kubectl get jobs -n $(NAMESPACE) --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}'); \
	echo "Tailing logs from job/$$JOB"; \
	kubectl logs -n $(NAMESPACE) job/$$JOB -f

agent_run_once:
	@if [ -z "$(FLOW)" ]; then echo "Usage: make agent_run_once FLOW=daily-observe|execute-approvals|weekly-creative"; exit 1; fi
	kubectl create job -n $(NAMESPACE) --from=cronjob/agent-$(FLOW) manual-$(FLOW)-$$(date +%s)

# --- Web (Next.js) ---

web: web_build_push web_deploy web_restart

# Default — local docker build. Forces linux/amd64 because GKE nodes are amd64
# and an arm64-only image (the default on Apple Silicon) yields ImagePullBackOff.
# On Apple Silicon this runs through qemu emulation and is slow; prefer
# `make web_cloudbuild` for a faster path.
web_build_push:
	- docker rmi $(REPO)/campaigner-web:latest || true
	docker build --no-cache --platform linux/amd64 -t campaigner-web:latest -t $(REPO)/campaigner-web:latest -f dockerfiles/web.dockerfile web
	docker push $(REPO)/campaigner-web:latest

# Faster path on Apple Silicon — Cloud Build runs natively on amd64.
# See cloudbuild.web.yaml for the build spec and .gcloudignore for what's
# uploaded. ~2 min total vs ~25 min for the local qemu cross-build.
web_cloudbuild:
	gcloud builds submit --config=cloudbuild.web.yaml --project=$(PROJECT_ID) --region=global .

# Convenience: cloud build + apply + rollout. Use this for routine web ships.
web_cloud: web_cloudbuild web_deploy web_restart

web_deploy: get_gcp_cluster
	kubectl apply -f kubefiles/web_deployment.yaml

web_ingress: get_gcp_cluster
	kubectl apply -f kubefiles/web_ingress.yaml

# Reserve a global static IP for the public dashboard. Run once.
# After: point campaigner.aiweon.co.il at the IP shown by `make static_ip_show`.
static_ip:
	gcloud compute addresses create $(STATIC_IP_NAME) --global --project $(PROJECT_ID)
	@echo "Reserved. Run 'make static_ip_show' to see the IP."

static_ip_show:
	gcloud compute addresses describe $(STATIC_IP_NAME) --global --project $(PROJECT_ID) --format="get(address)"

web_restart:
	kubectl rollout restart deployment web -n $(NAMESPACE)

web_logs:
	kubectl logs -n $(NAMESPACE) -l app=web --tail=100 -f

# --- Webhook (Flask) ---

webhook: webhook_build_push webhook_deploy webhook_restart

webhook_build_push:
	- docker rmi $(REPO)/campaigner-webhook:latest || true
	docker build --no-cache --platform linux/amd64 -t campaigner-webhook:latest -t $(REPO)/campaigner-webhook:latest -f dockerfiles/webhook.dockerfile webhook
	docker push $(REPO)/campaigner-webhook:latest

webhook_deploy: get_gcp_cluster
	kubectl apply -f kubefiles/webhook_deployment.yaml

webhook_restart:
	kubectl rollout restart deployment webhook -n $(NAMESPACE)

webhook_logs:
	kubectl logs -n $(NAMESPACE) -l app=webhook --tail=100 -f

# --- Generated artifacts (config/flows.yaml -> manifests + docs) ---

# `make generate` regenerates kubefiles/agent_cronjob_*.yaml and the
# routing / matrix / flow-index tables inside CAMPAIGNER.md and
# ARCHITECTURE.md from config/flows.yaml. Idempotent. Run after every
# edit to config/flows.yaml; CI's `make verify-generated` rejects drift.
generate:
	python3 scripts/generate_from_flows.py

verify-generated:
	python3 scripts/generate_from_flows.py --check

# --- Cluster setup ---

namespace: get_gcp_cluster
	kubectl apply -f kubefiles/namespace.yaml

secrets: get_gcp_cluster
	@echo "Substituting env vars (ANTHROPIC_API_KEY, META_*, SUPABASE_*, DATABASE_URL, BUSINESS_ID) and applying."
	@envsubst < kubefiles/secrets_template.yaml | kubectl apply -f -

# Upload local Application Default Credentials as the secret used by agent CronJobs
# to call Vertex AI Imagen. Re-run after `gcloud auth application-default login`.
gcp_credentials_secret: get_gcp_cluster
	@if [ ! -f $(HOME)/.config/gcloud/application_default_credentials.json ]; then \
		echo "ADC file not found. Run: gcloud auth application-default login"; exit 1; \
	fi
	- kubectl delete secret gcp-vertexai-credentials -n $(NAMESPACE) --ignore-not-found
	kubectl create secret generic gcp-vertexai-credentials \
		--from-file=credentials.json=$(HOME)/.config/gcloud/application_default_credentials.json \
		-n $(NAMESPACE)

all: auth namespace secrets gcp_credentials_secret agent web webhook

# --- Inspection ---

status: get_gcp_cluster
	@echo "=== Namespace ==="
	kubectl get namespace $(NAMESPACE) || echo "Namespace not found"
	@echo ""
	@echo "=== Deployments ==="
	kubectl get deployments -n $(NAMESPACE)
	@echo ""
	@echo "=== CronJobs ==="
	kubectl get cronjobs -n $(NAMESPACE)
	@echo ""
	@echo "=== Recent Jobs ==="
	kubectl get jobs -n $(NAMESPACE) --sort-by=.metadata.creationTimestamp | tail -10
	@echo ""
	@echo "=== Pods ==="
	kubectl get pods -n $(NAMESPACE)
	@echo ""
	@echo "=== Services ==="
	kubectl get services -n $(NAMESPACE)
	@echo ""
	@echo "=== Ingress ==="
	kubectl get ingress -n $(NAMESPACE) 2>/dev/null || true

pods:
	kubectl get pods -n $(NAMESPACE) -w

# --- Cleanup ---

delete_all: get_gcp_cluster
	- kubectl delete -f kubefiles/agent_cronjob_daily_observe.yaml || true
	- kubectl delete -f kubefiles/agent_cronjob_execute_approvals.yaml || true
	- kubectl delete -f kubefiles/agent_cronjob_weekly_creative.yaml || true
	- kubectl delete -f kubefiles/agent_cronjob_weekly_competitive_research.yaml || true
	- kubectl delete -f kubefiles/agent_cronjob_weekly_self_audit.yaml || true
	- kubectl delete -f kubefiles/agent_cronjob_daily_ab_decisions.yaml || true
	- kubectl delete -f kubefiles/agent_cronjob_midday_health_check.yaml || true
	- kubectl delete -f kubefiles/web_ingress.yaml || true
	- kubectl delete -f kubefiles/web_deployment.yaml || true
	- kubectl delete -f kubefiles/webhook_deployment.yaml || true
	- kubectl delete -f kubefiles/secrets_template.yaml || true
	- kubectl delete secret gcp-vertexai-credentials -n $(NAMESPACE) --ignore-not-found
	- kubectl delete namespace $(NAMESPACE) || true
