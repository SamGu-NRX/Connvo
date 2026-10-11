# Notes payload receipt — client/server contract round trip

End-to-end receipt for the Finding-2 repair (`src/hooks/useCollaborativeNotes.ts`
now builds payloads that the registered mutations in `convex/notes/mutations.ts`
actually accept). Every value below was **observed in a real convex-test run**
(`convex/notes/payloadReceipt.test.ts`, 5/5 passing) — nothing here is
illustrative. The suite drives each exchange through the registered functions:
client-shaped payload → registered mutation → persisted note state → returned
value, and emits the same JSON tagged `NOTES_PAYLOAD_RECEIPT_JSON`.

Recorded from the run on 2026-10-11 (convex-test `0.0.38`, `convex@1.28.0`).
`meetingId` values are virtual ids minted by convex-test (`10002;meetings`) and
conflict ids are per-run (`10010;noteOps`); everything else is deterministic
given the same operations.

## The defect (what the old sender sent)

`useCollaborativeNotes.ts` called the registered mutations with payloads that
the server rejects. Observed rejections from the pre-repair shapes (captured in
the `legacy defect` test — exact validator errors):

| Pre-repair client payload | Server reaction (observed) |
|---|---|
| `clientTimestamp: 1760…` instead of `clientSequence` | `Validator error: Missing required field 'clientSequence' in object` |
| insert operation keyed `text: "X"` | `Validator error: Unexpected field 'text' in object` |
| batch as flat operation array `operations: [{…}]` with `clientTimestamp` | `Validator error: Missing required field 'operation' in object` |

Even if those fields had validated, the handler's `validateOperation` requires
`content: string` on inserts and `clientSequence` drives the OT transform
window (`sequence > clientSequence`), so a timestamp would also have corrupted
conflict resolution. The client was the wrong side: the server validator
(`NoteV.operation`), the op log (`noteOps`), and `convex/notes/offline.ts` all
already speak `content` / `clientSequence`.

## The repair (client side, one file)

`src/hooks/useCollaborativeNotes.ts`:

- `toWireOperation` maps the hook-level operation (`text`) to the wire
  operation (`content` for inserts, numeric `position` for every type,
  `length` for delete/retain).
- `buildNoteOperationRequest(meetingId, operation, lastKnownSequence)` produces
  `{ meetingId, operation, clientSequence }`.
- `buildBatchNoteOperationsRequest(...)` produces
  `{ meetingId, operations: [{ operation, clientSequence }, …] }` (wrapped
  elements).
- The hook tracks the last acknowledged `serverSequence` (seeded from the
  fetched note's `version`) in `lastKnownSequenceRef` and sends it as
  `clientSequence` — the window the server transforms against — instead of the
  old `clientTimestamp`.

## Round trip 1 — fresh insert (no concurrent ops)

Hook operation: `{ type: "insert", position: 0, text: "Hello" }`
(`calculateOperation("", "Hello")`).

Wire request (observed):

```json
{
  "meetingId": "10002;meetings",
  "operation": { "type": "insert", "position": 0, "content": "Hello" },
  "clientSequence": 0
}
```

Response (observed):

```json
{
  "success": true,
  "serverSequence": 1,
  "transformedOperation": { "type": "insert", "position": 0, "content": "Hello" },
  "newVersion": 1,
  "conflicts": []
}
```

Persisted state (observed): `meetingNotes` → `{ content: "Hello", version: 1 }`;
`noteOps` row → `{ sequence: 1, operation: { type: "insert", position: 0,
content: "Hello" }, applied: true }`.

## Round trip 2 — stale client window (server-side OT transform)

Setup (observed, two registered mutations by the organizer):
op 1 `insert "Hello" @0` → content `"Hello"` (sequence 1); op 2
`insert "XY" @2` → content `"HeXYllo"` (sequence 2).

The participant's client has only incorporated op 1 (view `"Hello"`, known
sequence 1) and appends `"!"` at position 5. Wire request (observed):

```json
{
  "meetingId": "10002;meetings",
  "operation": { "type": "insert", "position": 5, "content": "!" },
  "clientSequence": 1
}
```

Response (observed) — the server transformed the position 5 → 7 past the
concurrent `"XY"` insert and reports the concurrent op as a conflict source:

```json
{
  "success": true,
  "serverSequence": 3,
  "transformedOperation": { "type": "insert", "position": 7, "content": "!" },
  "newVersion": 3,
  "conflicts": ["10010;noteOps"]
}
```

Persisted state (observed): `meetingNotes` → `{ content: "HeXYllo!", version:
3 }`; `noteOps` sequence 3 → `{ type: "insert", position: 7, content: "!" }`.

(Side observation, not part of the fix: for inserts at *equal* positions the
server's `transformAgainst` tie-breaks lexicographically on content — the op
with the smaller content keeps the position. `"!"` vs `"World"` keeps `"`!"`
at 5 with no conflict. The receipt scenario uses a concurrent insert strictly
before the incoming position so the shift path is exercised deterministically.)

## Round trip 3 — batch with wrapped elements

Setup: content `"HelloWorld"` (sequences 1–2). Wire request (observed):

```json
{
  "meetingId": "10002;meetings",
  "operations": [
    { "operation": { "type": "insert", "position": 10, "content": "!" }, "clientSequence": 2 },
    { "operation": { "type": "delete", "position": 0, "length": 5 }, "clientSequence": 2 }
  ]
}
```

Response (observed) — the batch composed in order and returned per-op
sequences:

```json
{
  "success": true,
  "processed": 2,
  "failed": 0,
  "newVersion": 3,
  "results": [
    { "conflicts": [], "serverSequence": 3,
      "transformedOperation": { "type": "insert", "position": 10, "content": "!" } },
    { "conflicts": [], "serverSequence": 4,
      "transformedOperation": { "type": "delete", "position": 0, "length": 5 } }
  ]
}
```

Persisted state (observed): `meetingNotes` → `{ content: "World!", version: 3 }`.

## How to re-run

```bash
npx vitest run convex/notes/payloadReceipt.test.ts   # this receipt, 5 tests
npx vitest run                                       # full suite (convex + frontend)
```

The `NOTES_PAYLOAD_RECEIPT_JSON …` line in the test output is the machine
capture; note that vitest's edge-runtime environment swallows in-VM
`console.log` in some reporters — the assertions in
`convex/notes/payloadReceipt.test.ts` pin every value shown above.
