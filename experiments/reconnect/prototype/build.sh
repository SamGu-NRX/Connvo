#!/usr/bin/env bash
# Builds the reconnect prototype bundle from the repo root. Uses esbuild from
# the repo's existing dependency tree; no repo files are modified.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ESBUILD=$(ls node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | head -1)
mkdir -p experiments/reconnect/prototype/dist
node "$ESBUILD" experiments/reconnect/prototype/main.tsx \
  --bundle --format=esm --jsx=automatic \
  --outfile=experiments/reconnect/prototype/dist/main.js \
  "--alias:convex/react=./experiments/reconnect/fake/convexReactMock.ts" \
  "--alias:@=./src"
sed "s|./main.tsx|./main.js|" experiments/reconnect/prototype/index.html > experiments/reconnect/prototype/dist/index.html
echo "prototype built -> experiments/reconnect/prototype/dist/"
