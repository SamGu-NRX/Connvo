# Handoff — caller-only account export study (PR #20)

**Branch** `obv/products-l2-account-export-20261010` → draft PR SamGu-NRX/Connvo#20,
target base `obv/products-connvo-hardening-20261009-r1` (NOT merged; do not merge
without owner review). Base contains the parent hardening work, which this branch
preserves untouched — the PR diff is `experiments/account-export/` only.

## What this study establishes

A caller-only account export is implementable under the production contract with
two non-negotiable properties, both verified:

1. **Authority-bounded inclusion.** Every row is either caller-owned, in a
   meeting the caller hosts, or refused with a receipt naming the authority
   source. `permissionsForResource` grants `export` only for `transcripts`,
   `transcriptSegments`, and `meetingNotes` — host-only. Participant rows
   (m2) are refused; the caller's own `workosUserId` and all
   `meetings.streamRoomId` values are redacted.
2. **Discovery-scoped refusals (no existence leaks).** Meeting discovery is
   only `by_organizer` + the caller's `meetingParticipants` rows. Unrelated
   meetings are never scanned, never counted, never receipted — the archive
   cannot reveal that they exist. (An earlier draft emitted one
   `no_meeting_participation` receipt per unrelated meeting; that was a
   1-bit-per-meeting existence leak and was removed. `no_meeting_participation`
   receipts are now always zero by construction.)

## The indifference proof

`run.ts` (section 5b) inserts two extra meetings owned by other users — carol
hosts, each with private transcript content — after the baseline export, then
re-runs the export as alice. The perturbed archive is **byte-identical** to the
baseline (same fixture clock, same seeding order → identical ids). The same
proof exists as the vitest case "is indifferent to unrelated meetings…". The
manifest carries the receipt: `indifference.archiveSha256Unchanged: true`, and
`reader.mjs` fails if a future manifest ever records `false`.

## Current numbers (committed in `results/`)

- Archive sha256 `db9308fb631c82d5…` — 266 rows exported across 33 tables
  (fixture universe 317: 11 owner / 255 shared / 51 excluded).
- **12 refusal receipts**: 3 `missing_export_permission` (m2, participant
  role), 9 `no_export_authority_defined` (per no-grant meeting-scoped table,
  scoped to the caller's in-scope meeting count). Zero
  `no_meeting_participation`.
- Leak scan: 33 private tokens, 0 hits; 51 excluded row ids, 0 hits in
  refs/refusals.
- Tests: **16/16** (scoped vitest config). Reader: PASS; tamper detection:
  PASS (checksum mismatch on a mutated archive).

## Reproduce

```bash
npx tsx experiments/account-export/run.ts
node experiments/account-export/reader.mjs \
  experiments/account-export/results/export.json \
  experiments/account-export/results/manifest.json
npx vitest run --config experiments/account-export/vitest.config.ts
python3 -m http.server 8412 --directory experiments/account-export  # then /preview.html
```

## Environment notes (what bit, and the fix that stuck)

- The shared Connvo sandbox checkout is switched by sibling threads; this
  study works in the dedicated worktree `/home/user/work/Connvo-account-export`
  (node_modules symlinked). Do not move this work back to the main checkout.
- convex-test needs a `"_generated"` key in the modules map to anchor its
  module-root prefix; Convex 1.28 exposes `_handler` (not `handler`);
  query objects cannot be re-paginated under convex-test (a fresh query
  factory per page is used); `transcripts` has no bare `by_meeting` index
  (`by_meeting_and_created_at` with a leading `eq` is equivalent).
- `tsx` runs `run.ts` as CJS — no top-level await; everything is inside
  `main()`.
- Test-scratch files `results/.tampered*.json` are gitignored; results
  (`export.json`, `manifest.json`, `runs.jsonl`) are committed.

## Invariants to preserve in any follow-up

- Author identity: commits are authored as
  `Sam Gu <127461594+SamGu-NRX@users.noreply.github.com>` and end with
  `Co-authored-by: obvious-autobuild[bot] <262744130+obvious-autobuild[bot]@users.noreply.github.com>`.
- Any change to `permissionsForResource`, `requireIdentity`, or the
  `ExportResponse` envelope invalidates policy checksum `c0ee6bf5` — the
  suite and reader fail loudly by design.
- The export stays experiment-only: not registered in the Convex function
  tree, no production file modified.
