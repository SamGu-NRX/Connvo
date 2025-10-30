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

if [[ -f "${PROJECT_ROOT}/mint.json" ]]; then
  echo "ℹ️  Inspecting Mintlify configuration..."
  node <<'NODE' || true
const fs = require("fs");
const path = require("path");

try {
  const mintPath = path.resolve("mint.json");
  const raw = fs.readFileSync(mintPath, "utf8");
  const mint = JSON.parse(raw);
  const nav = mint.navigation;
  const navType = Array.isArray(nav) ? `array(length=${nav.length})` : typeof nav;
  console.log(`   navigation type: ${navType}`);

  if (Array.isArray(nav) && nav.length > 0) {
    const preview = nav.slice(0, 2).map((entry, index) => {
      const keys = Object.keys(entry || {});
      return `#${index}: keys=${keys.length > 0 ? keys.join(", ") : "(none)"}`;
    });
    console.log(`   navigation entries preview: ${preview.join(" | ")}`);
  }

  if (nav && !Array.isArray(nav)) {
    const keys = Object.keys(nav);
    console.log(`   navigation keys: ${keys.length > 0 ? keys.join(", ") : "(none)"}`);

    if (Object.prototype.hasOwnProperty.call(nav, "groups")) {
      const groups = nav.groups;
      const groupsType = Array.isArray(groups) ? `array(length=${groups.length})` : typeof groups;
      console.log(`   navigation.groups type: ${groupsType}`);
    }
  }
} catch (error) {
  console.warn(`   Failed to inspect mint.json: ${error.message}`);
}
NODE
else
  echo "ℹ️  Mintlify configuration (mint.json) not found; skipping inspection."
fi

if ! pnpm exec convex-helpers open-api-spec --help >/dev/null 2>&1; then
  echo "convex-helpers CLI is not available. Install dependencies with your package manager." >&2
  exit 1
fi

echo "🛠  Applying compatibility patch for convex-helpers (bytes → binary)..."
node scripts/patch-convex-helpers-openapi.js

echo "➡️  Generating base OpenAPI spec with convex-helpers..."
OUTPUT_BASENAME="convex-spec"
pnpm exec convex-helpers open-api-spec --output-file "${OUTPUT_BASENAME}"

echo "📄 Generated OpenAPI files:"
ls -1 convex-spec*.yaml 2>/dev/null || echo "  (no convex-spec*.yaml files present)"

if [[ ! -f "${PROJECT_ROOT}/convex-spec.yaml" ]]; then
  echo "Expected ${PROJECT_ROOT}/convex-spec.yaml but it was not found after generation." >&2
  echo "Check the listing above to confirm output file names." >&2
  exit 1
fi

echo "✨ Enhancing generated OpenAPI spec..."
pnpm exec tsx scripts/enhance-openapi.ts --env="${ENVIRONMENT}"

echo "✅ Validating enhanced OpenAPI spec..."
pnpm exec tsx scripts/validate-openapi.ts docs/api-reference/convex-openapi.yaml

echo "🎉 API documentation updated successfully. Enhanced spec located at docs/api-reference/convex-openapi.yaml"
