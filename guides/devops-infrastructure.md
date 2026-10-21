---
name: devops-infrastructure
description: CI/CD pipelines, Docker and containers, Kubernetes and Helm, Infrastructure as Code (Terraform/OpenTofu, Pulumi, CloudFormation, Bicep, Ansible), cloud platforms (AWS, Azure, GCP), shell and PowerShell scripting, deployments, monitoring.
---
# DevOps and infrastructure

- Infrastructure changes are production changes: plan before apply, and never apply, destroy or deploy against a real environment without explicit approval. Prefer `terraform plan`, `helm diff`, `kubectl diff`, `--dry-run`, `what-if`.
- IaC: remote, locked state; no secrets in committed variables or state; modules and providers with pinned versions; `terraform fmt`/`validate`, tflint, checkov or trivy.
- Docker: pinned base images (exact tag or digest), multi-stage builds, minimal images (distroless, slim, alpine), non-root user, .dockerignore, dependency layers before source layers, HEALTHCHECK, build secrets instead of secrets in layers.
- Kubernetes: resource requests and limits; liveness, readiness and startup probes; PodDisruptionBudgets; securityContext (runAsNonRoot, readOnlyRootFilesystem); secrets from a secret manager; validate manifests (kubeconform, kube-linter).
- CI: fast feedback (lint → unit → integration), dependency caching, third-party actions pinned by SHA, least-privilege tokens, the same commands locally and in CI.
- Deployments are reversible (blue/green, canary, rollback), migrations are compatible with the previous version, risky changes go behind feature flags.
- Shell scripts: `set -euo pipefail`, quoted variables, shellcheck, idempotent. PowerShell: `$ErrorActionPreference = 'Stop'`, approved verbs, PSScriptAnalyzer.
- Observability: logs, metrics, alerts on symptoms and SLOs, dashboards, runbooks.
- Cloud: least-privilege IAM, encryption at rest and in transit, tagging, cost awareness — warn the user before creating resources that cost money.
