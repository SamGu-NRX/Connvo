# In-call client — server-contract alignment (M2)

Client-layer alignment of the collaborative-notes and meeting-lifecycle
interfaces with the server contract established by M1. The server is fixed
truth: nothing under `convex/**` was changed (verified by the final diff —
only `src/` and `test/` files appear).

## Implemented interface contract

**Payload sent to `api.notes.mutations.batchApplyNoteOperations`**
(`convex/notes/mutations.ts:392`):

```jsonc
{
  "meetingId": "…",
  "operations": [
    { "operation": { "type": "insert", "position": 0, "content": "…" },
      "clientSequence": 1 }
  ],
  "expectedVersion": 3
}
```

- `position` is required by the server's `operationValidator`
  (`convex/types/entities/note.ts:20`). The client normalizer
  (`normalizeOperation(operation, documentLength)`) defaults an absent
  position to append-at-end of the composed document.
- Legacy `text` inputs are normalized to the server-shaped `content` field
  (`convex/schema/offline.ts` — the server field is `content`, not `text`).
- `clientSequence` is a per-meeting monotonic counter; `expectedVersion`
  always comes from the latest server state (the query snapshot's version,
  or the `newVersion` of the last accepted ack).
- The response is typed from the server's inferred return —
  `{ success, processed, failed, results: [{ serverSequence,
  transformedOperation, conflicts: string[] }], newVersion }` — with no
  `as`-cast: the hook's `NormalizedNoteOperation` and
  `BatchApplyNoteOperationsResponse` mirror the server shapes structurally,
  so the mutation's types flow through checked.
- `MeetingNote` is imported from the generated `convex/types/entities/note.ts`
  instead of a redeclared interface (the old local copy had drifted: it named
  `lastEditedBy`/`lastEditedAt`/`createdAt`, which the generated type does
  not have, and lacked `_creationTime`, `lastRebasedAt`, `updatedAt`).
- Public surface is a compatible superset of M1: `content`, `version`,
  `isLoading`, `isSyncing`, `applyOperation`, `applyOperations`, plus
  `reconcile`, `operationStates`, `unsavedOperationIds`,
  `duplicateAcknowledgementCount`, and aggregate status for the editor.

## Operation ledger (per meeting, module-scoped external store)

`src/hooks/collaborativeNotesLedger.ts` — survives React remounts and
transport cycles.

- States: `pending → syncing → saved | rejected | conflict`, with an explicit
  unconfirmed marker for unknowable outcomes.
- Keyed by `operationId` — deterministic uuid v5 over
  `meetingId + normalized operation` — so a retry of the same edit carries
  the same id.
- **The ledger is the only dedupe that exists.** The server dedupes nothing:
  the `by_queue_and_operation` index (`convex/schema/offline.ts:40`) is
  queried by no code; every accepted op is applied. Identical unresolved
  edits therefore coalesce client-side at submit time.
- Late/duplicate acks (a second ack, or a response for an already-saved
  `operationId`) change nothing and are counted (`duplicateAcks` per record,
  `duplicateAcknowledgementCount` per ledger) — observable, never harmful.
- On FORBIDDEN (removed/expired participant, `assertMeetingAccess`,
  `convex/auth/guards.ts:143`) the document rolls back to the last
  server-confirmed content and the record is marked `rejected` — the
  rejected edit's words stay visible in the ledger. Document state and
  unsaved local work are distinct; nothing is silently discarded.
- On CONFLICT (`expectedVersion` mismatch) the record is marked `conflict`
  and the composed edit is rolled back the same way.
- If it is unknowable whether an op reached the server (ack lost mid-flight),
  the record is explicitly unconfirmed — the client never blind-resends an
  op the ledger shows as saved (the duplicate bug from the M1 study).

## Reconcile state machine (on transport restore)

`reconcile()` in `useCollaborativeNotes`, per record, after snapshotting
server truth (content + version from the query):

1. **Server evidence says applied** → mark the record `saved` from reconcile.
   It is never re-sent.
2. **Server evidence says not applied, record never confirmed** → re-send the
   pending op with its **original** `operationId`/`clientSequence` in the
   next batch (text typed while offline stays in the pending queue until
   then).
3. **Unknowable** (e.g. a delete whose response was lost — absence of text
   proves nothing) → mark explicitly unconfirmed and surface it in the
   reconcile report (`unconfirmedIds`). No re-send.
4. Terminal `rejected`/`conflict` records are skipped.

## Scenario-outcome table (exact, asserted in tests)

`test/in-call/useCollaborativeNotes.scenarios.test.ts` +
`test/in-call/useMeetingLifecycle.journal.test.ts`.

| Scenario | Preserved | Lost | Duplicate | Exact behavior asserted |
|---|---|---|---|---|
| Delayed ack | 1 | 0 | 0 | Edit stays pending until the ack, then saved exactly once (`duplicateAcknowledgementCount` 0) |
| Out-of-order acks (two edits, reverse order) | 2 | 0 | 0 | Both saved; final content correct per server OT semantics |
| Duplicate response for a saved op | 1 | 0 | 2 observed | Second/third acks change nothing; `duplicateAcks` 2, `duplicateCount` 2 |
| Removed participation | 0 in document (rolled back) | 0 — words kept in ledger | 0 | Explicit `rejected` state; re-sends 0 |
| Repeat reconnects (two cut/restore cycles) | 2 | 0 | 0 | Nothing lost silently; re-sends 0; `duplicateAcknowledgementCount` 0 |
| Ack lost after apply | 1 (confirmed via server evidence) | 0 | 0 | Reconcile confirms from evidence; never re-sent; content "lost-ack" intact, no doubling |
| Send lost before apply | 1 | 0 | 0 | Reconcile re-sends the original op exactly once |
| Unknowable (delete, response lost) | 0 | 0 — surfaced as unconfirmed | 0 | Explicitly unconfirmed; never blind-resend |

Lifecycle journal (create/start/end):

| Scenario | Journal outcome |
|---|---|
| Accepted create re-invoked | Recorded outcome returned; `attempts` stays 1; `sentMutations` stays 1 — never re-sent |
| Start, ack lost before apply | `unconfirmed` (attempts 1) → explicit retry sends again → `accepted` (attempts 2, sent 2) |
| Start, ack lost after apply | `unconfirmed` — NOT failed; a definite rejection marks `failed` |
| Concurrent start invocations | One shared in-flight send — `pending` → `accepted`, attempts 1, sent 1 |

Also fixed in `useMeetingLifecycle`: the render-phase `setState` in
`getConnectionInfo` (connection-info selection is now effect-driven), and
prompt-generation failure is surfaced as state, not only `console.warn`.

`CollaborativeNotesEditor` renders the explicit per-edit state — Saving… /
Saved / Syncing / Unsaved (N pending) / Conflict / Rolled back — keyboard
operability preserved, polite live region, reduced-motion-aware transitions.

## Receipts

- **`pnpm test:run` (full suite): 28 test files / 323 tests passed.** One
  unhandled rejection is reported by Vitest —
  `Error: Write outside of transaction 10008;_scheduled_functions` from
  `convex-test@0.0.38` internals — and is **pre-existing**: it occurs
  identically on the clean M1 tree with the M2 changes stashed. The nonzero
  exit code comes solely from that library-internal rejection.
- **Focused in-call tests: 3 files / 16 tests passed** — the four M1
  witnesses (`useCollaborativeNotes.witness.test.ts`) **pass unchanged**,
  the 8 notes scenarios, and the 4 lifecycle-journal scenarios.
- **`pnpm type-check`: 32 errors — exactly the M1 baseline count** (baseline
  captured on a detached M1 worktree at b9e6020). Zero new error codes.
  Composition changes vs baseline, verbatim:
  - Eliminated (existed only in code this task rewrote):
    `useCollaborativeNotes.ts` — TS2322 MeetingNote local-interface drift;
    TS2322 `number | undefined` not assignable to `number`; TS2322
    operation-array (`position: number | undefined; text: …`) not assignable
    to the server payload shape.
  - Same pre-existing error, more surfaced occurrences:
    `useMeetingLifecycle.ts` TS2322 `Type '{ meetingId: Id<"meetings">;
    webrtcReady: boolean; videoProvider: "webrtc" | "getstream"; features:
    { recording: boolean; transcription: true; maxParticipants: number; } }'
    is not assignable to type 'Id<"meetings">'` — the baseline surfaces it
    at 2 sites, this tree at 5. Root cause pre-exists at M1:
    `createMeetingMutation` resolves to the connectionInfo object, which is
    passed where `Id<"meetings">` is expected; the journal's shared
    in-flight generic return surfaces the same mismatch at every journal
    call site. Not changed here (pre-existing, outside the M2 contract
    alignment); follow-up candidate.
  - All other errors unchanged (useTranscription ×5, usePostCallInsights
    ×3, ui/chart.tsx ×7, app/videocall, one-on-one-meeting, prompts hooks,
    test scaffolding) — identical shapes; only the embedded checkout path in
    the message text differs between worktrees.
- No runtime dependency changes; no dev/test-only additions beyond the two
  test files and the extended fake transport.
