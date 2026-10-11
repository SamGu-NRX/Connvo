# Notes client/server payload mismatch — repair handoff (2026-10-11)

Branch `obv/connvo-notes-payload-20261011` (worktree `Connvo-notes-payload`, base `d86620c` on `obv/products-connvo-hardening-20261009-r1`). All runs below were executed in that worktree against the **registered** Convex functions via convex-test — no mocks of the note mutations anywhere.

## What was broken

`src/hooks/useCollaborativeNotes.ts` called the registered note mutations with payloads that fail argument validation on **every call** — the collaborative-notes sync path has never worked:

| Call | Hook sent | Registered signature (convex/notes/mutations.ts) | Failure |
|---|---|---|---|
| `applyNoteOperation` | `{meetingId, operation:{type, position, text, length}, clientTimestamp}` | `{meetingId, operation: NoteV.operation, clientSequence, expectedVersion?}` | `Validator error: Unexpected field 'text' in object` (+ unknown `clientTimestamp`) |
| `batchApplyNoteOperations` | `{meetingId, operations:[{type, position, text, length}], clientTimestamp}` | `{meetingId, operations:[{operation, clientSequence}], expectedVersion?}` | `Validator error: Missing required field 'operation' in object` — wrong wrapping, `text` vs `content`, no `clientSequence` |

`NoteV.operation` (convex/types/validators/note.ts) is `{type: 'insert'|'delete'|'retain', position: number, content?: string, length?: number}`.

## Red run (pre-fix state, before the hook repair)

Command: `corepack pnpm exec vitest run --project convex convex/notes/payloadContract.test.ts`

**Result: 10 failed / 3 passed (13 tests, 1 file).** Verbatim vitest tail from the red run:

```text
 × no longer sends the unknown field clientTimestamp to any mutation
 × sends clientSequence and expectedVersion at the mutation boundary
 × maps insert: text becomes content, no text field survives
 × maps delete: length survives, no text field survives
 × maps retain: calculateOperation omits position, so position defaults to 0
 ✓ applyNoteOperation rejects the pre-fix single payload (extra fields text/clientTimestamp)
 ✓ batchApplyNoteOperations rejects the pre-fix batch payload (text vs content, no clientSequence, clientTimestamp)
 ✓ the pre-fix rejection is validator-level: nothing persists
 × single insert succeeds and persists: return shape, noteOps row, materialized content
 × sequential ops with the hook's monotonic clientSequence and expectedVersion advance the document
 × retain (emitted by calculateOperation for same-length text) validates and persists
 × batch insert succeeds: {success, processed, failed, results, newVersion}, noteOps rows, content advanced
 × stale expectedVersion is rejected as a conflict and nothing persists
 Test Files  1 failed (1)
 Tests  10 failed | 3 passed (13)
```

Per-layer receipt:

| Layer (tests) | Pre-fix result | Meaning |
|---|---|---|
| Source contract — reads `src/hooks/useCollaborativeNotes.ts`, asserts no `clientTimestamp`, presence of `clientSequence`/`expectedVersion` (2) | **FAILED both** — hook still contained `clientTimestamp`, contained neither watermark field | hook-side contract, red |
| Mapping contract — dynamic-imports the hook module and executes `toServerOperation` (3) | **FAILED all** — `TypeError: toServerOperation is not a function` (export did not exist) | hook-side contract, red |
| Defect pins — invoke the registered `applyNoteOperation` / `batchApplyNoteOperations` with the EXACT pre-fix payload shapes (3) | **PASSED all** — rejections observed: `Validator error: Unexpected field 'text' in object` (single) and `Validator error: Missing required field 'operation' in object` (batch); the persistence pin verified no `meetingNotes`/`noteOps` rows were created | defect pins, green (they pin the defect, not the fix) |
| Corrected-shape E2E through the registered functions (5) | **FAILED all** (via the missing `toServerOperation` they build payloads from) | hook-shape receipt, red |

## What changed

`src/hooks/useCollaborativeNotes.ts` (only file; CRLF line endings preserved, public `NoteOperation` interface and `calculateOperation` untouched):

1. **New exported pure mapper `toServerOperation`** at the mutation boundary: insert → `{type, position, content: text}`; delete/retain → `{type, position, length}`. `position` defaults to `0` because `calculateOperation` emits retain **without** a position while the validator requires `position >= 0` (`validateOperation` in convex/notes/operations.ts rejects a missing position). No `text` field survives; no wall-clock timestamp is sent.
2. **`clientSequence` watermark** via `useRef(0)`, advanced from mutation responses (single: `result.serverSequence`; batch: last `results[].serverSequence`). Semantics: "server sequence of the last operation the client's local state incorporates". Within a batch, op `i` sends `watermark + i` — after sibling op *i* is applied the local state incorporates it, so each subsequent op's `clientSequence` advances by one to keep siblings out of each other's transform sets (server transforms against `noteOps` rows with `sequence > clientSequence`).
3. **`expectedVersion: notes?.version`** — the last observed materialized notes version (optimistic concurrency; server rejects stale writes with a version-mismatch conflict). `undefined` while the query is loading, which the server treats as "skip the check".
4. Batch payloads rewrapped to `{operation, clientSequence}` per element.

## Payload contract (post-fix, verified green)

```jsonc
// applyNoteOperation
{ "meetingId": "<id>", "operation": {"type": "insert", "position": 0, "content": "hello"},
  "clientSequence": 0, "expectedVersion": 0 }
// batchApplyNoteOperations
{ "meetingId": "<id>",
  "operations": [ {"operation": {"type": "insert", "position": 0, "content": "AB"}, "clientSequence": 0},
                  {"operation": {"type": "insert", "position": 2, "content": "CD"}, "clientSequence": 1} ],
  "expectedVersion": 0 }
```

## Green run (receipt, actual output)

`corepack pnpm exec vitest run --project convex convex/notes/payloadContract.test.ts` → **13/13 passed (1 file)**.

Full project `corepack pnpm exec vitest run --project convex` (base was 301/301; additions land on top):

- **3 consecutive runs: 25 files / 314 tests passed (314 = 301 baseline + 13 new).**
- `corepack pnpm exec tsc --noEmit -p convex/tsconfig.json` → **exit 0**.
- Root `tsc --noEmit` (root tsconfig): **30 errors vs the documented 32-error baseline (baseline.md)** — the repair *removes* the two hook payload-mismatch errors (`Type 'number | undefined' is not assignable to type 'number'` and the batch-operations array shape error in `src/hooks/useCollaborativeNotes.ts`) and adds **zero**. The one remaining hook error (`MeetingNote` entity vs the hook's local interface, line ~198) is the pre-existing entity/interface drift also present in `usePostCallInsights`/`useTranscription`; untouched per scope. The 3 intentional pre-fix payload literals in the contract test are TS-invalid **by design** and carry `@ts-expect-error` directives (which self-flag if the payload ever becomes valid).
- `pnpm lint`: broken repo-wide (ESLint 9 vs legacy `.eslintrc.json` — crashes identically on the pristine baseline and untouched files, e.g. `convex/notes/operations.ts`); pre-existing, not touched.
- Ambient noise, both directions, identical to pristine base: 1 unhandled rejection per full-suite run (`Write outside of transaction 10008;_scheduled_functions` — a scheduled-invocation error surfacing outside its test; `convex/notes/` contains zero `scheduler` usage). One intermittent pre-existing timing-variance flake: `convex/types/__tests__/performanceValidation.test.ts > Performance consistency across runs` (wall-clock variance assertion; failed 2 of 5 full runs in this worktree, 0 of 3 on pristine base; mechanism is timer-based, no connection to this change).

Key asserted receipts inside the new tests (all through the registered functions, no mocks): single insert returns `{success: true, serverSequence: 1, transformedOperation: {type: 'insert', position: 0, content: 'hello', length: undefined}, newVersion: 1, conflicts: []}` and persists an `applied: true` `noteOps` row (sequence 1, author set) plus materialized `meetingNotes.content = 'hello'`, version 1; sequential ops with the hook's advancing watermark produce "hello world" at version 2; retain validates and leaves content unchanged; batch of 2 returns `{success: true, processed: 2, failed: 0, results: [{serverSequence: 1, …}, {serverSequence: 2, …}], newVersion: 1}` with content "ABCD"; stale `expectedVersion` rejects with the version-mismatch conflict and persists nothing.

## Assumptions

- **`clientSequence` semantics** = watermark of the last server sequence the client's local state incorporates (the server's transform set is `sequence > clientSequence`). Initialized to 0 because the notes query returns no sequence information; advanced from mutation responses ("first observed server state"). An alternative — a separate query returning the current max `noteOps` sequence — would need a new registered query (out of scope).
- **`expectedVersion`** = `notes?.version` from the `getMeetingNotes` query. Between a mutation's return and the query's refetch, a rapid second edit can send a briefly-stale version and get a conflict (the client's catch surfaces it; Convex's `useMutation` + `useQuery` refetch loop is the existing recovery mechanism).
- **Batch watermark increments by one per op** so sibling ops do not double-transform each other; this mirrors the documented batch example (clientSequence 10/11/12 per op).
- The hook's runtime behavior on a genuine server-side version conflict is unchanged (log, rethrow) — handling retries/rebasing is a UX decision out of scope.
- The contract test's source-scan reads `src/hooks/useCollaborativeNotes.ts` relative to `process.cwd()` (vitest runs from repo root), and dynamic-imports the hook module — verified executable in the convex vitest environment (no React/DOM access at import time).

## How to resume

- Worktree pattern used here (shared checkout is switched by sibling threads): `git worktree add <dir> -b <branch> origin/obv/products-connvo-hardening-20261009-r1 && ln -sfn /home/user/work/Connvo/node_modules <dir>/node_modules` (the pre-run install warning about the "workspace hoist directory" is harmless).
- Re-run receipts: `corepack pnpm exec vitest run --project convex convex/notes/payloadContract.test.ts` (13/13) and `corepack pnpm exec vitest run --project convex` (314/314, modulo the two ambient items above); `corepack pnpm exec tsc --noEmit -p convex/tsconfig.json` (exit 0).
- Type-check the hook against the real generated API: root `tsc --noEmit` shows the hook's payload paths clean (only the pre-existing entity/interface error remains). The committed `_generated` tree is stale for some surfaces; the convex-side tsc + runtime receipts through convex-test are the authoritative check.
- Not done here (per instructions): no merge, no push to main, no deploy, no PR — the orchestrator integrates.
