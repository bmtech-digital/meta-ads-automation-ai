#!/usr/bin/env bash
# Deploy Campaigner to GKE `campaigner` namespace via kustomize.
# Precondition: GKE cluster credentials set (`gcloud container clusters get-credentials <name>`)
# and secrets already provisioned (see web/k8s/base/runner-secret.example.yaml).
set -euo pipefail

cd "$(dirname "$0")/.."

NS="${NAMESPACE:-campaigner}"

echo "==> ensure namespace ${NS}"
kubectl get ns "${NS}" >/dev/null 2>&1 || kubectl create ns "${NS}"

echo "==> applying prod overlay"
kubectl apply -k web/k8s/overlays/prod/

echo "==> status"
kubectl -n "${NS}" get cronjobs -o wide
kubectl -n "${NS}" get deployment campaigner-web
echo "(watch a cron slot log with: kubectl -n ${NS} logs -l flow=daily-observe-propose --tail=100)"
