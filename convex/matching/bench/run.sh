#!/usr/bin/env bash
# One-command load harness for convex/matching hot paths.
#
# Usage (from the repo root):
#   bash convex/matching/bench/run.sh <tag>          # defaults: N=32, repeats=5
#   MATCHING_BENCH_N=64 bash convex/matching/bench/run.sh <tag>
#   MATCHING_BENCH_PURE=1 bash convex/matching/bench/run.sh <tag>
#
# Runs the benchmark through vitest (edge-runtime, same as the repo's convex
# test project), captures the machine's load average before and after, parses
# the benchmark's MATCHING_BENCH_JSON line, writes results/<tag>.json, and
# prints a median-based summary table.

set -euo pipefail

TAG="${1:-run}"
BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${BENCH_DIR}/results"
REPO_ROOT="$(cd "${BENCH_DIR}/../../.." && pwd)"

mkdir -p "${OUT_DIR}"

# The tag is metadata only — never forwarded to vitest as a filename filter.
export MATCHING_BENCH_TAG="${TAG}"

loadavg() {
  if [[ -f /proc/loadavg ]]; then
    awk '{print $1, $2, $3}' /proc/loadavg
  else
    uptime | sed 's/.*load averages*: //' || true
  fi
}

LOAD_BEFORE="$(loadavg)"
LOAD_AFTER_CAPTURED=""

# Vitest must run from the repo root so aliases and setup files resolve.
cd "${REPO_ROOT}"
LOG="/tmp/matching-bench-${TAG}.log"
set +e
npx vitest run --config convex/matching/bench/vitest.bench.config.ts >"${LOG}" 2>&1
VITEST_EXIT=$?
set -e
LOAD_AFTER="$(loadavg)"

echo "-----------------------------"
echo "matching bench results (${TAG})"
echo "loadavg before: ${LOAD_BEFORE}"
echo "loadavg after:  ${LOAD_AFTER}"
echo "-----------------------------"
grep -E "^=== |^runMatchingCycle|^getShardQueueEntries|^calculateCompatibility|^scorePairPrepared|median" "${LOG}" | tail -20 || true

JSON_LINE="$(grep 'MATCHING_BENCH_JSON:' "${LOG}" | tail -1 | sed 's/^.*MATCHING_BENCH_JSON://')"

if [[ -z "${JSON_LINE}" ]]; then
  echo "ERROR: benchmark did not emit a MATCHING_BENCH_JSON line; full log at ${LOG}" >&2
  exit "${VITEST_EXIT:-1}"
fi

echo "${JSON_LINE}" | node -e '
  const fs = require("fs");
  const raw = fs.readFileSync(0, "utf8").trim();
  const payload = JSON.parse(raw);
  payload.machine = { loadavgBefore: process.argv[1], loadavgAfter: process.argv[2] };
  const out = process.argv[3];
  fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
  console.table(
    payload.scenarios.map((s) => ({
      scenario: s.name,
      "median ms": s.medianMs,
      "mean ms": Number(s.meanMs.toFixed(1)),
      "p95 ms": s.p95Ms,
      "min ms": s.minMs,
      "max ms": s.maxMs,
      runs: s.iterations,
    })),
  );
  console.log(`n=${payload.n} users, repeats=${payload.repeats}, node ${payload.node}`);
  console.log(`wrote ${out}`);
' "${LOAD_BEFORE}" "${LOAD_AFTER}" "${OUT_DIR}/${TAG}.json"

exit "${VITEST_EXIT}"
