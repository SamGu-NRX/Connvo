#!/usr/bin/env bash

# Test script to validate the CI workflow behavior locally
# This simulates what the GitHub Actions workflow will do

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

echo "🧪 Testing CI Workflow Behavior"
echo "================================"
echo ""

# Step 1: Check current state
echo "📋 Step 1: Checking current state..."
if git diff --quiet docs/api-reference/convex-openapi.yaml; then
  echo "   ✅ OpenAPI spec is clean (no uncommitted changes)"
else
  echo "   ⚠️  OpenAPI spec has uncommitted changes"
  git diff --stat docs/api-reference/convex-openapi.yaml
fi
echo ""

# Step 2: Install dependencies (simulated - already installed)
echo "📦 Step 2: Dependencies check..."
if command -v pnpm &> /dev/null; then
  echo "   ✅ pnpm is installed ($(pnpm --version))"
else
  echo "   ❌ pnpm is not installed"
  exit 1
fi

if command -v node &> /dev/null; then
  echo "   ✅ Node.js is installed ($(node --version))"
else
  echo "   ❌ Node.js is not installed"
  exit 1
fi
echo ""

# Step 3: Regenerate OpenAPI spec
echo "🔄 Step 3: Regenerating OpenAPI spec..."
if pnpm run update:api-docs:dev > /tmp/ci-test-output.log 2>&1; then
  echo "   ✅ Documentation generation succeeded"
else
  echo "   ❌ Documentation generation failed"
  cat /tmp/ci-test-output.log
  exit 1
fi
echo ""

# Step 4: Check for changes
echo "🔍 Step 4: Checking for changes..."
if git diff --exit-code docs/api-reference/convex-openapi.yaml > /dev/null 2>&1; then
  echo "   ✅ No changes detected (spec is up to date)"
  HAS_CHANGES=false
else
  echo "   ⚠️  Changes detected in OpenAPI spec"
  HAS_CHANGES=true
  echo ""
  echo "   Changes summary:"
  git diff --stat docs/api-reference/convex-openapi.yaml
fi
echo ""

# Step 5: Show diff if changes exist
if [ "$HAS_CHANGES" = true ]; then
  echo "📊 Step 5: Showing documentation diff..."
  git diff docs/api-reference/convex-openapi.yaml | head -50
  echo ""
  echo "   (showing first 50 lines of diff)"
  echo ""
fi

# Step 6: Simulate commit (dry-run)
echo "💾 Step 6: Simulating commit behavior..."
if [ "$HAS_CHANGES" = true ]; then
  echo "   ℹ️  In CI, the following would happen:"
  echo "      1. git config user.name and user.email"
  echo "      2. git add docs/api-reference/convex-openapi.yaml"
  echo "      3. git commit -m 'chore: update API documentation'"
  echo "      4. git push origin HEAD:main"
  echo ""
  echo "   ⚠️  NOT executing actual commit (this is a test)"
else
  echo "   ✅ No commit needed (no changes)"
fi
echo ""

# Step 7: Validate the generated spec
echo "✅ Step 7: Validating generated spec..."
if pnpm exec tsx scripts/validate-openapi.ts docs/api-reference/convex-openapi.yaml > /tmp/ci-validate-output.log 2>&1; then
  echo "   ✅ Validation passed"
else
  echo "   ❌ Validation failed"
  cat /tmp/ci-validate-output.log
  exit 1
fi
echo ""

# Summary
echo "📝 Test Summary"
echo "==============="
echo ""
echo "✅ All CI workflow steps completed successfully"
echo ""
if [ "$HAS_CHANGES" = true ]; then
  echo "⚠️  Note: Changes were detected. In CI, these would be auto-committed."
  echo "   To reset: git checkout docs/api-reference/convex-openapi.yaml"
else
  echo "✅ No changes detected. CI would skip commit step."
fi
echo ""
echo "🎉 CI workflow test complete!"
