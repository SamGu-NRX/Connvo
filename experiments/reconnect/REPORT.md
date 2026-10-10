# Reconnect study — findings

Subject: the real `useCollaborativeNotes` and `useMeetingLifecycle` hooks
against an experiment-owned fake Convex transport (production code
untouched). 14 scenarios across 2 vitest suites, all passing, plus a
Playwright walk of the same hooks in a real browser
(`results/walk/*.png`, `results/walk.json`). Aggregated counts:
`results/counts.json`; replay agreement: `results/replay.json`
(replay AGREES across runs).

## Findings

1. **A lost ack duplicates the note, silently.** When the server accepts a
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
