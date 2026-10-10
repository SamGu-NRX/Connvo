# Caller-only account export — study report

**Question.** If a user invokes an account export, what comes back — and can
we prove, row by row, that nothing the caller has no authority over crosses
the boundary?

**Answer.** The production contract supports a clean caller-only export, but
only if "no authority" is treated as a refusal rather than a permission. This
study builds that export as an experiment (`functions.ts`), runs it against a
fixture universe covering every boundary case, and commits the evidence.

## Findings

### 1. Export is legitimate for owner + host rows; refused for everything else

`permissionsForResource` grants `export` only for `transcripts` (host),
`transcriptSegments` (host), and `meetingNotes` (host). Alice hosts m1: her
export carries m1's transcript, note, and segment rows. She *participates* in
bob's retro (m2) — those rows are refused with a receipt naming
`permissionsForResource` and her role. She has no relationship with m3 — and
m3 is never discovered at all (finding 5).

### 2. Identity gating is absolute

`requireIdentity` refuses anonymous callers (`UNAUTHORIZED / Authentication
required`) and deactivates accounts (`isActive === false`) before any row is
read. Verified by direct handler invocation against the real guard.

### 3. Projection policy is the redaction contract

`workosUserId` is redacted even from the caller's own row (IdP subject +
email invites correlation; documented in the policy note). `meetings.streamRoomId`
is stripped. The recording URL row is excluded outright with its meeting. The
caller's own `email`/`displayName` remain — they are the portable data the
export exists to deliver. A 51-key policy checklist (33 tables × field lists)
is enforced by the archive validator and the independent reader.

### 4. Pagination is bounded and honestly receipted

pageSize clamps to 100. The 250-row transcripts table paginates in 3 pages;
a 200k-character segment exports in full via pagination, never truncated.
`maxRowsPerTable` caps tables and the receipt says `truncated: true` when the
cap bites. Receipt math (`pages == ceil(rows/pageSize)`) is validated per
table; merged multi-scan tables (`connections`, `meetings`) carry a
`merged-index` mode exempt from that equation because the row count is not
proportional to scan pages.

### 5. Discovery is scoped: unrelated meetings do not exist to the export

Meeting discovery is only `by_organizer` plus the caller's own
`meetingParticipants` rows — there is no meetings-table universe scan.
Meetings the caller has no relationship with (m3) produce no refusal, no
ordinal, no count. An earlier draft emitted one `no_meeting_participation`
receipt per unrelated meeting, which leaked one bit of existence per meeting
plus the total count; that receipt class is now zero by construction. The
proof is differential: two extra meetings owned by other users (with private
transcript content) are inserted after the baseline export and the re-run
archive is byte-identical — receipted as `manifest.indifference` in `run.ts`
and asserted in a dedicated vitest case.

### 6. Refusals are first-class receipts, not silent gaps

Every refusal names: the table, an in-scope meeting label, the caller's role,
a machine-parsable reason (`missing_export_permission`,
`no_export_authority_defined`), and the `authoritySource` that backs the
decision. Nine meeting-scoped tables have no export authority at all in the
permission matrix — each gets its own refusal scoped to the caller's in-scope
meeting count, rather than being silently skipped.

### 7. The archive is verifiable without trusting the exporter

`results/export.json` carries a sha256 in `results/manifest.json`. The
standalone `reader.mjs` — importing no Convex, no project code, no policy —
verifies checksum, envelope math, `_id` ordering, redaction, refusal receipts,
and a leak scan, then reports PASS. Re-computing counts against the manifest
catches any drift. A deliberately tampered archive (re-attached `email`,
deleted refs receipt) is rejected on checksum mismatch.

### 8. Determinism

With a fixture-fixed clock, two consecutive runs produce byte-identical
archives (`exportId` embeds `requestedAt`, not wall time). Every exported
collection is ordered by `_id`; ordering is asserted in the validator.

## Verified results (committed)

| Check | Result |
|---|---|
| Fixture universe | 317 rows (11 owner / 255 shared / 51 excluded) |
| Exported | 266 rows across 33 tables |
| Refusals | 12 (3 missing-export, 9 no-authority; 0 existence-leak receipts) |
| Indifference | adding 2 unrelated meetings leaves the archive byte-identical |
| Leak scan | 33 tokens, 0 hits |
| Determinism | byte-identical archives across runs |
| Independent reader | PASS; tamper-detection PASS |
| Tests | 16/16 pass |

## Caveats & scope

- The export function here is **experiment-only**: it lives in
  `experiments/account-export/` and is invoked through convex-test with a
  virtual module mapping; it is not registered into the Convex function tree
  and does not change any production file.
- Bulk transcripts are synthetic fixture content; row counts are the claim,
  not transcript realism.
- `userSettings` exports 0 rows because the fixture caller has none seeded;
  the policy and code path are covered by the validator's empty-table
  contract (zero-row receipt present for all 33 tables).
- Excluded row ids may legitimately appear as foreign keys inside owner rows
  (e.g. an owner meeting's organizer id); the leak scan excludes those ids
  from the row-id check and checks them against refs receipts and refusal
  entries instead — documented in the manifest.

## What would change these conclusions

A change to `permissionsForResource` (new export grants), to
`requireIdentity`'s deactivated-account behavior, or to the `ExportResponse`
envelope would invalidate the policy checksum (`c0ee6bf5`) and the test
expectations; the suite fails loudly on any of those drifts.
