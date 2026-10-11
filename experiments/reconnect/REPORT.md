# Reconnect study — findings

Subject: the real `useCollaborativeNotes` and `useMeetingLifecycle` hooks
against an experiment-owned fake Convex transport (production code
untouched). 14 scenarios across 2 vitest suites, all passing, plus a
Playwright walk of the same hooks in a real browser
(`results/walk/*.png`, `results/walk.json`; keyboard-only, reduced
motion, zero console errors). Aggregated counts:
`results/counts.json`; replay agreement: `results/replay.json`
(replay AGREES across runs).

**Evidence tiers.** Findings 1–7 below are SIMULATED-TRANSPORT: they
exercise the real hooks, but the transport is ours. The next section is
PRODUCTION-OBSERVED: the same duplicate-delivery question put to the real
registered handlers through convex-test (real schema, real auth, real
guards), recorded in `results/production-handlers.json` and pinned by
`production-handlers.test.ts` (6 tests; 20/20 across the suite).

## PRODUCTION-OBSERVED: real handlers under duplicate delivery

| Delivery | Observed outcome |
|---|---|
| `applyNoteOperation`, first delivery | accepted (v0→v1) |
| `applyNoteOperation`, exact re-send (same args) | **rejected** — 409 CONFLICT, "Version mismatch: expected 0, got 1"; op applied exactly once |
| `applyNoteOperation`, re-sent with refetched version | **accepted, applied twice** — content duplicated ("hellohello"), no idempotency key consulted |
| `startMeeting`, duplicate | **rejected** — "Meeting is already active" (state guard) |
| `endMeeting`, duplicate | **rejected** — "Can only end active meetings" (state guard); the client cannot distinguish this from "my first end never landed" |
| GetStream webhook redelivery | **deduped** — `withIdempotency` stores the key in the same transaction; redelivery replays the stored result (idempotency keys 0→1→1) |

What this changes about the simulated findings:

- Finding 1 refines, it does not vanish. Production's version guard
  rejects a blind re-send of the identical op — so the failure mode is
  not a silent duplicate but a spurious 409 plus a stale saved-cache
  value (server has the text, the reconciled UI shows the old "saved"
  content). The duplicate acceptance still occurs the moment any layer
  refetches the version and re-sends, and nothing in the hook's contract
  prevents that. The fake transport (no version guard) shows the
  worst-case bound.
- Finding 5 is WRONG about production and stands only as a
  transport-level statement. Real lifecycle handlers reject duplicates
  via state guards. The residual production risk is the one the
  `lifecycle/end-duplicate` receipt names: the guard's rejection is
  indistinguishable from a first delivery that never landed.
- The webhook path is the model to copy: it is the only notes/meeting
  delivery path with a real idempotency wrapper.

The sibling evidence round (`4b91cfb`, `results/vitest/production-*.json`)
reached the same verdicts through a second harness path: it also covers
`batchApplyNoteOperations`, the offline queue/sync/retry flow, lifecycle
`create`, and records the hook-shaped-args validator rejection. Its retry
legs that go through nested `ctx.runMutation` hit convex-test's
nested-identity limitation (convex-test#50) and are flagged there as
harness artifacts; the direct-call receipts above avoid that layer
entirely. Where the two rounds overlap, they agree.


## Findings

1. **A lost ack duplicates the note, silently.** *(refined by the
   PRODUCTION-OBSERVED section below: the real handler's version guard
   turns the blind re-send into a 409 + stale saved cache; duplication
   requires a version refetch.)* When the server accepts a
   note operation but its ack is lost, restore() re-sends it (at-least-once)
   and the op is applied a second time: `hello world!` becomes
   `hello world!!` on the server AND in the reconciled UI, with no error.
   The browser walk shows the identical signature (screenshot 05, duplicate
   acceptances: 1). Four consecutive cut/restore cycles turned one "!" into
   eight (scenario `notes/repeated-reconnect`).

2. **Unacked ≠ indistinguishable, but the UI can't tell.** The no-ack
   control (`notes/no-ack-control`) holds two worlds — server accepted vs
   server never saw the op — and the hook's visible state is
   byte-for-byte identical between them at the same tick. Everything the
   user could see (content, version, isSyncing) is the same; only the
   ledger differs.

3. **Removal while offline: optimistic text orphaned.** A participant
   removed server-side causes the queued op to be REJECTED on replay.
   The hook's cache reconciles to server truth (cleared), but the
   consumer — following the hook's documented example — keeps the typed
   text, `isSyncing` returns to false, and nothing anywhere signals that
   the text on screen is saved nowhere (scenario `notes/edit-removed`;
   visible as the divergence line in the walk screenshots).

4. **Navigation during an offline lifecycle change loses it permanently.**
   With start/end queued offline, `reset()` (navigation away) destroys the
   queue: the meeting never starts, or stays `active` while the user
   believed it ended — and post-call processing never triggers (scenarios
   `lifecycle/start-request-lost`, `lifecycle/end-request-lost`).

5. **Lifecycle ack-loss duplicates acceptances too.** Re-sent start/end
   mutations land a second time in the journal (state no-ops, but the
   duplicate-acceptance ledger records them; scenarios
   `lifecycle/start-ack-lost`, `lifecycle/end-ack-lost`).

6. **Actions are fire-and-forget.** The prompt-generation action run while
   disconnected is not replayed and fails with only a `console.warn` —
   `error` state stays null (scenario `lifecycle/prompts-action-offline`).

7. **`getConnectionInfo` is a render-phase state update.** Calling it with
   a meeting id different from current state calls `setCurrentMeetingId`
   during render; with a changing id it loops until React caps it
   ("Too many re-renders") — scenario
   `lifecycle/connection-info-render-setstate`.

## Source-level observation (from reading, not from runs)

The notes hook sends `clientTimestamp` with each operation while the
`applyNoteOperation` validator requires `clientSequence` — a field-name
mismatch worth confirming against the deployed validator.

## Suggested directions (not implemented)

- Idempotency keys (clientSequence) honored server-side would collapse
  finding 1's duplicates.
- A persisted "unsaved changes" signal would close finding 3's silent
  divergence.
- Persisting the replay queue across navigation (finding 4) needs a
  storage-level decision.

## Reproduction

Everything runs offline through the commands in `README.md`; results are
deterministic (`--replay` reports agreement; counts carry no timestamps).
