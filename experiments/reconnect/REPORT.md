# Reconnect study — findings

Subject: the real `useCollaborativeNotes` and `useMeetingLifecycle` hooks
against an experiment-owned fake Convex transport ([simulated-transport]),
plus the registered production Convex handlers exercised directly under
convex-test ([production-handler]). Production code untouched.

29 tests across 4 vitest suites, all passing — 14 [simulated-transport]
(hooks over the fake transport), 9 [production-handler] convex-test
scenarios (`scenarios/productionHandlers.test.ts`), and 6 receipt-pin tests
for the standalone `production-handlers.ts` script — plus a keyboard-only,
reduced-motion Playwright walk of the same hooks in a real browser
(`results/walk/*.png` + per-step snapshots, `results/walk.json`).
Aggregated counts: `results/counts.json` (every scenario labeled with its
layer); production receipts: `results/productionHandlers.json` (both
production suites merged — they agree on every overlapping verdict); replay
agreement: `results/replay.json` (replay AGREES across runs).

## Findings — [simulated-transport] (hooks over the owned fake transport)

These claims describe the hooks and their consumers when messages repeat;
the delivery semantics are the fake's model, not production's.

1. **[simulated-transport] A lost ack duplicates the note, silently.** When
   the fake server accepts a note operation but its ack is lost, restore()
   re-sends it (at-least-once) and the op is applied a second time:
   `hello world!` becomes `hello world!!` on the server AND in the
   reconciled UI, with no error. The browser walk shows the identical
   signature (screenshot 05, duplicate acceptances: 1). Four consecutive
   cut/restore cycles turned one "!" into eight (scenario
   `notes/repeated-reconnect`).

2. **[simulated-transport] Unacked ≠ indistinguishable, but the UI can't
   tell.** The no-ack control (`notes/no-ack-control`) holds two worlds —
   server accepted vs server never saw the op — and the hook's visible
   state is byte-for-byte identical between them at the same tick.
   Everything the user could see (content, version, isSyncing) is the
   same; only the ledger differs.

3. **[simulated-transport] Removal while offline: optimistic text
   orphaned.** A participant removed server-side causes the queued op to
   be REJECTED on replay. The hook's cache reconciles to server truth
   (cleared), but the consumer — following the hook's documented example —
   keeps the typed text, `isSyncing` returns to false, and nothing anywhere
   signals that the text on screen is saved nowhere (scenario
   `notes/edit-removed`; visible as the divergence line in the walk
   screenshots).

4. **[simulated-transport] Navigation during an offline lifecycle change
   loses it permanently.** With start/end queued offline, `reset()`
   (navigation away) destroys the queue: the meeting never starts, or
   stays `active` while the user believed it ended — and post-call
   processing never triggers (scenarios `lifecycle/start-request-lost`,
   `lifecycle/end-request-lost`).

5. **[simulated-transport] Lifecycle ack-loss duplicates acceptances too.**
   Re-sent start/end mutations land a second time in the fake's journal
   (state no-ops, but the duplicate-acceptance ledger records them;
   scenarios `lifecycle/start-ack-lost`, `lifecycle/end-ack-lost`).
   NOTE: the [production-handler] layer corrects the production side of
   this — the REAL handlers reject lifecycle duplicates (see below).

6. **[simulated-transport] Actions are fire-and-forget.** The
   prompt-generation action run while disconnected is not replayed and
   fails with only a `console.warn` — `error` state stays null (scenario
   `lifecycle/prompts-action-offline`).

7. **[simulated-transport] `getConnectionInfo` is a render-phase state
   update.** Calling it with a meeting id different from current state
   calls `setCurrentMeetingId` during render; with a changing id it loops
   until React caps it ("Too many re-renders") — scenario
   `lifecycle/connection-info-render-setstate`.

## Findings — [production-handler] (registered handlers under duplicate delivery)

What the REGISTERED production handlers actually did when the same
delivery arrived twice, observed through convex-test against the real
schema, validators, and auth guards. Full receipts:
`results/vitest/production-*.json` and
`results/production-handlers.json`, merged in
`results/productionHandlers.json`. None of this is scripted in the fake
transport; the two production suites agree on every overlapping verdict.

| Handler | Duplicate verdict (observed) | Protection |
|---|---|---|
| `applyNoteOperation` | verbatim duplicate (stale `expectedVersion`) REJECTED (`CONFLICT 409: Version mismatch` — observed by BOTH production suites); a re-based duplicate (same `clientSequence`, fresh `expectedVersion`) is ACCEPTED and applied again | version guard, incidental; `clientSequence` dedupes nothing |
| `batchApplyNoteOperations` | stale duplicate REJECTED; re-based duplicate ACCEPTED, re-applies every op (`AABBAABB` → `AAAABBBB`: the server transforms re-applied positions) | version guard, incidental |
| `queueOfflineOperations` | duplicate ACCEPTED: two queue rows for the same `operationId`, distinct server-minted queueIds | none |
| `syncOfflineOperations` | duplicate DEDUPED by the `pending`→`synced` status transition; content applied once | row status transition |
| `retryFailedOperations` | duplicate retries reject deterministically under the harness (see note); retries on exhausted rows (attempts ≥ maxRetries) are zero-delta no-ops (`retriedCount 0`), silently | none surfaced |
| `startMeeting` | duplicate REJECTED (`Meeting is already active`) | state guard, incidental; `idempotencyKeys` rows: 0 |
| `endMeeting` | duplicate REJECTED (`Can only end active meetings`, VALIDATION_ERROR 400) | state guard, incidental |
| `createMeeting` | duplicate ACCEPTED: two separate meeting documents | none |
| `streamHandlers.dispatchWebhook` | duplicate redelivery DEDUPED by `withIdempotency` (keys 0→1→1, first result replayed) | REAL idempotency — the one path wired to it |

**Observed production-handler conclusions.**

- **The idempotency mechanism exists but is unwired where notes duplicate.**
  `withIdempotency` (`convex/lib/idempotency.ts`) is never invoked on the
  notes/offline/lifecycle paths — `idempotencyKeys` stayed empty in every
  such scenario. The one production path that DOES use it, the GetStream
  `dispatchWebhook`, dedupes redelivery cleanly (keys 0→1→1, first result
  replayed) — proving the mechanism works and simply is not attached to
  the note and lifecycle mutations that corrupt under at-least-once
  delivery. Every other duplicate-protection we observed is an incidental
  side effect of state ordering (version guards, state guards, a queue
  status transition), and `createMeeting` / `queueOfflineOperations`
  duplicates sail through.
- **Production failure mode for a blind re-send: spurious 409 plus a stale
  saved cache.** The [production-handler] verdicts refine finding 1: a
  blind re-send of an already-applied op does NOT duplicate it (the
  version guard rejects with CONFLICT 409), but the hook never refetches —
  the user is left with a stale saved-cache value and an error to nowhere.
  Silent duplication (finding 1's signature) requires the re-based
  duplicate: the same `clientSequence` with a refetched `expectedVersion`
  sails through and applies a second time.
- **The hook cannot even reach the validator.** The [production-handler]
  scenario `production/notes-hook-args` confirms the source-level suspicion
  against the real registered handler: the hook sends `clientTimestamp`,
  the validator requires `clientSequence` — observed rejection.
- **Harness note (recorded, not hidden).** `retryFailedOperations` resets
  failed rows then re-syncs through a NESTED `ctx.runMutation`.
  convex-test 0.0.38 does not propagate caller identity into nested
  contexts (get-convex/convex-test#50, open), so under the harness a retry
  with a non-empty row-set rejects `UNAUTHORIZED` and rolls back; the
  post-reset sync behavior is not observable through this harness.
  Production Convex propagates caller identity into nested calls, so that
  leg is a harness artifact. The exhausted-row exclusion (attempts ≥
  maxRetries → `retriedCount 0`) IS directly observed: retries stop
  silently, with no surfaced error — an op that can never apply stays
  failed forever.

## Suggested directions (not implemented)

- Attaching `withIdempotency` (keyed on `clientSequence`) to
  `applyNoteOperation` / `batchApplyNoteOperations` would collapse BOTH the
  re-based-duplicate re-application observed in the production layer AND
  the [simulated-transport] duplicate-application signature — the webhook
  path already demonstrates the pattern works.
- A persisted "unsaved changes" signal would close finding 3's silent
  divergence, and a refetch (or surfaced error) after a CONFLICT would
  close the stale-cache half of the production failure mode.
- Persisting the replay queue across navigation (finding 4) needs a
  storage-level decision.

## Reproduction

Everything runs offline through the commands in `README.md` (entry point:
`run.ts`, sections handlers / vitest / walk); results are deterministic
(`--replay` reports agreement; counts carry no timestamps).
