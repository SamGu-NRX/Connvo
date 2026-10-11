#!/usr/bin/env bash
# Builds the reconnect prototype bundle from the repo root. Uses esbuild from
# the repo's existing dependency tree; no repo files are modified.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ESBUILD=""
for cand in node_modules/esbuild/bin/esbuild node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild node_modules/.bin/esbuild; do
  # Must be the JS wrapper: node_modules/.bin/esbuild may symlink to the
  # platform's native ELF binary, which node cannot execute.
  if [ -f "$cand" ] && head -c 15 "$cand" | grep -q "#!/usr/bin/env"; then
    ESBUILD="$cand"
    break
  fi
done
if [ -z "$ESBUILD" ]; then
  echo "esbuild JS wrapper not found in the repo's node_modules" >&2
  exit 1
fi
mkdir -p experiments/reconnect/prototype/dist
node "$ESBUILD" experiments/reconnect/prototype/main.tsx \
  --bundle --format=esm --jsx=automatic \
  --outfile=experiments/reconnect/prototype/dist/main.js \
  "--alias:convex/react=./experiments/reconnect/fake/convexReactMock.ts" \
  "--alias:@=./src"
sed "s|./main.tsx|./main.js|" experiments/reconnect/prototype/index.html > experiments/reconnect/prototype/dist/index.html
echo "prototype built -> experiments/reconnect/prototype/dist/"
