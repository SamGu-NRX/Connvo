# In-call client/server contract witnesses (M1, red)

Status: **RED milestone** — four client witness tests fail on purpose (they
assert the desired contract against today's hook), while the server-contract
tests pass and reproduce real endpoint behavior. The client hooks are NOT
fixed in this milestone. Scope walls held: nothing under `convex/**`,
`.github/**`, `src/app/**`, `src/providers/**`, or auth files was modified.

## 1. Contract table — what the hook sends vs what the server requires

| Surface (file:line) | Server requires | Hook sends today (src/hooks/useCollaborativeNotes.ts:109-149) | Result |
|---|---|---|---|
| `api.notes.mutations.batchApplyNoteOperations` (convex/notes/mutations.ts:392) | `{ meetingId, operations: [{ operation: NoteV.operation, clientSequence: number }], expectedVersion?: number }` | `{ meetingId, operations: [{ type, position, text, length }], clientTimestamp }` (no wrapper, no clientSequence, unknown `clientTimestamp`) | rejected: ``Validator error: Missing required field `operation` in object`` |
| `api.notes.mutations.applyNoteOperation` (convex/notes/mutations.ts:113) | `{ meetingId, operation: NoteV.operation, clientSequence, expectedVersion?: number }` | `{ meetingId, operation: { type, position, text, length }, clientTimestamp }` | rejected: ``Validator error: Unexpected field `text` in object`` (the validator field is `content`) |
| note-operation shape `NoteV.operation` (convex/types/validators/note.ts:44) | `{ type: "insert"\|"delete"\|"retain", position: number, content?: string, length?: number }` | hook's `NoteOperation` carries `text` (src/hooks/useCollaborativeNotes.ts:30-34) | `text` is not a declared field |
| `api.realtime.batchedOperations.batchApplyNoteOperation` (convex/realtime/batchedOperations.ts:110) | `{ meetingId, operation, clientSequence, expectedVersion: number }` — expectedVersion REQUIRED; optimistic concurrency; persist-before-ack in the same transaction | hook does not call this endpoint at all; no operationId argument exists | no dedupe surface: the `by_queue_and_operation` index (convex/schema/offline.ts:40) is queried by no code |
| participant guard `assertMeetingAccess` (convex/auth/guards.ts:143) | a `meetingParticipants` row for (meeting, user) — `by_meeting_and_user`; no organizer bypass | removed participants keep editing optimistically; nothing marks the edit unsaved | rejected: `FORBIDDEN` / "Access denied: Not a meeting participant" |
| version conflict (convex/notes/mutations.ts:443) | `createError.conflict("Version mismatch: expected X, got Y")` | hook sends no `expectedVersion`, so conflicts are undetectable by the client | stale versions fail hard on the server, silently on the client |

## 2. The four witness failure messages (verbatim, red)

From `pnpm test:run` (vitest project `in-call`, 4 failed | 307 passed (311)):

1. `witness: payload mismatch — hook payload accepted by real batchApplyNoteOperations validator` →
   `AssertionError: witness: batch entries must be wrapped as { operation, clientSequence } per convex/notes/mutations.ts:392-400 — the hook sends bare operations carrying `text` instead: expected { type: 'insert', position: +0, …(2) } to have property "operation"`
2. `witness: removed participation — optimistic edit surfaced as rejected with explicit unsaved/rolled-back state` →
   `AssertionError: witness: the rejection must carry explicit per-operation unsaved marking (unsavedOperationIds) so the UI can tell the edit was NOT persisted: expected undefined to be defined`
   (the guard-message assertion passes — the rejection DOES carry "Access denied: Not a meeting participant" through the fake bridge — but the hook rethrows it bare, with no unsaved marking)
3. `witness: late response — re-sent accepted operation deduplicated, no double application` →
   `AssertionError: witness: the re-sent accepted operation must be deduplicated (applied exactly once); today it was applied again on re-send, so the text reads: "onceonce": expected 'onceonce' to be 'once' // Object.is equality`
4. `witness: optimistic-save confusion — accepted vs never-acked edits distinguishable (per-op pending/saved state)` →
   `AssertionError: witness: the hook must expose a live per-operation state ledger (operationStates) distinguishing saved from never-acked edits — today only a global isSyncing boolean exists: expected undefined to be defined`

## 3. Passing server-contract receipts (real registered endpoints)

Suite: `test/convex/in-call-server-contract.test.ts` (vitest project
`convex`, convex-test harness — same as `convex/notes/offlineHardening.test.ts`).
All 6 tests pass and pin:

- hook-shaped batch payload → ``Validator error: Missing required field `operation` in object``
- hook-shaped singular payload → ``Validator error: Unexpected field `text` in object``
- removed participant (row deleted) → both `batchApplyNoteOperations` and the realtime writer reject with "Access denied: Not a meeting participant" (convex/auth/guards.ts:143)
- realtime writer dedupe reality: NO dedupe — two identical writes apply twice (`hellohello`, two noteOps rows); `by_queue_and_operation` (convex/schema/offline.ts:40) is dead schema
- offline queue dedupe reality: duplicate `operationId`s in one queue sync as 2 applied rows
- batch response shape `{ success, processed, failed, results: [{ serverSequence, transformedOperation, conflicts }], newVersion }` and hard version-conflict rejection ("Version mismatch: expected 0, got 1")

## 4. Command receipts

- `pnpm exec vitest run --project convex` → **Test Files 25 passed (25), Tests 307 passed (307)** — 301 baseline plus the 6 new contract tests; Vitest reported the 1 known pre-existing unhandled rejection ("Vitest caught 1 unhandled error during the test run", insights/scheduling path in the performance suites).
- `pnpm test:run` → **Test Files 1 failed | 25 passed (26); Tests 4 failed | 307 passed (311)** — the 4 failures are exactly the four named witnesses above; nothing else fails.
- `pnpm type-check` → **32 errors, identical to the pre-existing baseline (docs/hardening-20261009/baseline.md); zero NEW errors** — none in `test/in-call/**` or `test/convex/in-call-server-contract.test.ts` (verified by filtering the error list on those paths).

## 5. Provenance rule (study evidence vs endpoint evidence)

The L2 reconnect study (branch `obv/products-l2-reconnect-study-20261010`,
`experiments/reconnect/REPORT.md`) IS delivered evidence about HOOK behavior:
lost-ack duplicates, no-ack indistinguishability, removal orphaning optimistic
text, lifecycle ack-loss duplication, render-phase `setCurrentMeetingId`. Its
fake-client PATTERN was ported into `test/in-call/fakeMeetingTransport.ts`.

The fake transport is a STAND-IN, not proof of real server behavior. Its
bridge semantics (apply-on-receive, no dedupe, version-conflict and participant
mirrors) only exist so the real hook can be driven deterministically; every
SERVER-behavior claim in this document comes from the PASSING tests against
the real registered endpoints (convex-test harness, section 3). Where the
brief's expectations and observed server behavior diverged (operationId
dedupe: the index exists but no code queries it), the tests and this document
record the observed behavior, not the brief.
