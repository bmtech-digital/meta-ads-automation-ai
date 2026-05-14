#!/usr/bin/env bash
# Build + push the two Campaigner images to Artifact Registry.
# Registry: us-central1-docker.pkg.dev/bemtech-478413/generic-agent-repo
# Precondition: `gcloud auth login` + `gcloud auth configure-docker us-central1-docker.pkg.dev` once.
set -euo pipefail

REGISTRY="us-central1-docker.pkg.dev/bemtech-478413/generic-agent-repo"
TAG="${TAG:-stable}"

cd "$(dirname "$0")/.."

echo "==> building campaigner-runner (root Dockerfile)"
docker build -t "${REGISTRY}/campaigner-runner:${TAG}" -f Dockerfile .

echo "==> building campaigner-web (web/Dockerfile.k8s)"
docker build -t "${REGISTRY}/campaigner-web:${TAG}" -f web/Dockerfile.k8s web

echo "==> pushing"
docker push "${REGISTRY}/campaigner-runner:${TAG}"
docker push "${REGISTRY}/campaigner-web:${TAG}"

echo "done — both images at ${REGISTRY}/*:${TAG}"
