#!/usr/bin/env bash

# Orchestrates generation, enhancement, and validation of the Convex OpenAPI spec.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENVIRONMENT="dev"

for arg in "$@"; do
  case "${arg}" in
    --env=*)
      ENVIRONMENT="${arg#*=}"
      ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      echo "Usage: bash scripts/update-api-docs.sh [--env=dev|staging|prod]" >&2
      exit 1
      ;;
  esac
done

if [[ ! "${ENVIRONMENT}" =~ ^(dev|staging|prod)$ ]]; then
  echo "Invalid environment '${ENVIRONMENT}'. Expected dev, staging, or prod." >&2
  exit 1
fi

cd "${PROJECT_ROOT}"

echo "🔧 Updating OpenAPI documentation for environment: ${ENVIRONMENT}"

mkdir -p docs/api-reference

if ! npx --yes convex-helpers --version >/dev/null 2>&1; then
  echo "convex-helpers CLI is not available. Install dependencies with your package manager." >&2
  exit 1
fi

echo "➡️  Generating base OpenAPI spec with convex-helpers..."
npx convex-helpers open-api-spec

if [[ ! -f "${PROJECT_ROOT}/convex-spec.yaml" ]]; then
  echo "Failed to generate convex-spec.yaml. Check Convex configuration and try again." >&2
  exit 1
fi

echo "✨ Enhancing generated OpenAPI spec..."
npx tsx scripts/enhance-openapi.ts --env="${ENVIRONMENT}"

echo "✅ Validating enhanced OpenAPI spec..."
npx tsx scripts/validate-openapi.ts docs/api-reference/convex-openapi.yaml

echo "🎉 API documentation updated successfully. Enhanced spec located at docs/api-reference/convex-openapi.yaml"
