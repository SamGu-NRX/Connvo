# experiments/account-export — caller-only account export study

An isolated, add-only study that answers one question: **what exactly does a
caller-only account export return under the production permission contract,
and can we prove it never crosses data boundaries?**

Everything here is experimental scaffolding. No production file is modified;
the export function lives at `functions.ts` and is invoked through convex-test
with a virtual module mapping, not registered into the Convex tree.

## The contract being tested

Every access decision in the study is source-indexed (see `projection.ts`
`AUTHORITY_SOURCES`):

| Authority | Source | What it decides |
|---|---|---|
| `requireIdentity` | `convex/auth/guards.ts:42` | anonymous / deactivated accounts are refused outright |
| `assertMeetingAccess` | `convex/auth/guards.ts:128` | meeting-scoped data requires a participants row |
| `permissionsForResource` | `convex/lib/permissions.ts:26` | `export` exists **only** for `meetingNotes` (host) and `transcripts` (host); participants never get it |
| `ExportResponse` | `convex/types/api/responses.ts:244` (+ validator) | the envelope the export must satisfy |

The study's core stances: **missing export authority is a refusal, never a
guessed permission**, and **meeting discovery is scoped to caller-owned and
participating meetings** — unrelated meetings are never scanned, counted, or
receipted, so the archive cannot reveal their existence.

## Files

| File | Role |
|---|---|
| `projection.ts` | per-table/field projection policies (33 tables), owner/shared/excluded row classification, policy checksum, redaction |
| `fixtures.json` | deterministic fixture universe: alice (caller), bob, carol, dave (removed), erin (deactivated); meetings m1 (alice hosts), m2 (bob hosts), m3 (no participation); 247 bulk transcripts |
| `seed.ts` | seeds the fixture through convex-test, classifies every row with the projection policy |
| `functions.ts` | the export function itself: identity check, permission-gated meeting-scoped export, refusal receipts, bounded pagination (pageSize ≤ 100), field projection, stable `_id` ordering |
| `archive.ts` | archive consistency validator + fixture-derived leak-token builder |
| `run.ts` | full pipeline: seed → export → validate → leak scan → writes `results/` |
| `reader.mjs` | standalone Node reader (imports no Convex, no project code): checksum, counts, ordering, redaction, refusal receipts |
| `account-export.test.ts` | 15 vitest cases covering every boundary above |
| `vitest.config.ts` | scoped vitest config, isolated from the repo's root setup |
| `preview.html` | read-only results viewer + archive download link |
| `results/` | committed outputs: `export.json`, `manifest.json`, `runs.jsonl` |

## Reproduce

```bash
# full pipeline (seeds, exports, validates, writes results/)
npx tsx experiments/account-export/run.ts

# independent reader over the committed archive
node experiments/account-export/reader.mjs experiments/account-export/results/export.json

# test suite
npx vitest run --config experiments/account-export/vitest.config.ts

# results page (serves the folder, then open http://localhost:8412/preview.html)
python3 -m http.server 8412 --directory experiments/account-export
```

## Results (committed in results/)

- 266 rows exported across 33 tables from a 317-row fixture universe
  (11 owner + 255 shared rows exported; 51 excluded).
- 12 refusal receipts: 3 `missing_export_permission` (bob's retro m2), 9
  `no_export_authority_defined` (meeting-scoped tables with no export
  authority). Zero `no_meeting_participation` — unrelated meetings are never
  discovered.
- Indifference proof: inserting two extra meetings owned by other users
  (with private transcripts) leaves the archive byte-identical
  (`manifest.indifference.archiveSha256Unchanged: true`).
- Leak scan: 33 private tokens, 0 hits in the archive.
- Two consecutive runs produce byte-identical archives (deterministic clock).
- Independent reader: PASS; tampered archive: rejected (checksum mismatch).
- 16/16 tests pass.

See `REPORT.md` for findings and caveats.
