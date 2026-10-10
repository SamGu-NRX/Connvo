# Connvo Hardening Summary — Round 1 (2026-10-10)

Branch: `obv/products-connvo-hardening-20261009-r1` (draft PR to `main`).
Scope: close authorization and meeting-state gaps end to end across identity,
webhooks, notes/transcripts, WebRTC signaling, matching/deactivation, and the
batched realtime writers. All fixes were verified against actual registered
Convex endpoints (mocks only for external services); nothing was merged,
deployed, or pushed to a default branch.

## Final state

- Convex suite: **301/301 passing** (24 files) — baseline was 240 passing with
  5 repro-reds pending and 1 unhandled rejection; the insights unhandled
  rejection is pre-existing and reproduces with all changes stashed.
- `tsc --noEmit -p convex/tsconfig.json`: clean (was clean at baseline).
- Root `pnpm type-check`: **32 errors, all pre-existing `src/` baseline
  errors** (workers measured 29 on their branch states before the final
  merges; the merged branch matches the original baseline of 32 — zero new
  errors introduced by this pass).

## What was wrong, and what changed

### Identity & tenancy (`eeeab64`, `a255d8e`)
- `upsertUser` accepted anonymous callers and client-supplied WorkOS/org
  identity — a full account-takeover and role-forgery path. It now requires a
  verified identity and derives all claims from the verified token.
- Audit-log reads were public; they are now internal-only.
- Privileged worker functions were publicly registered; internalized.
- `requireIdentity` ignored `isActive`, so deactivated accounts kept access;
  `getCurrentUser` now returns null for them and guarded calls reject.
- Sessions/identity are bound to verified users throughout (see
  `convex/auth/identity.test.ts` and the tenancy suite).

### Stream webhooks (`9cb7af4`)
- Signature verification was **optional**: a delivery with no signature header
  was processed. Now fail-closed — missing header → 401, missing
  `STREAM_SECRET` → 500 (Stream retries; never an accept), constant-time HMAC
  compare.
- The dispatcher passed the raw payload (always containing `type`) to strict
  validators that omitted that field, so **every webhook event failed argument
  validation and 500'd forever — the pipeline never worked end to end**. `type`
  is now part of `StreamWebhookPayloadV`.
- Retries double-applied effects. New `dispatchWebhook` internalMutation wraps
  all event handling in `withIdempotency` keyed on the event identity; the
  dedupe-key insert and handler commit atomically, so redeliveries replay the
  stored result. (`withIdempotency`'s replay path never returned stored
  results — `metadata.result` is never populated; fixed to decode
  `resultInline`/`resultJson`.)
- `session_ended` re-scheduled post-processing on every delivery; guarded by
  the meeting `concluded` state (defense in depth beyond key expiry).
- `recording_ready` inserted a duplicate `meetingRecordings` row per
  redelivery; now upserts by `recordingId`.
- Events about unmapped calls returned 500 and Stream retried forever;
  unmapped calls and unknown event types are now acknowledged (200) because
  retrying cannot succeed. Unexpected internal errors still return 500.

### Offline notes & batched writer (`9822c99` merge)
- The offline sync queue was looked up by `queueId` with no scoping — a caller
  could inject/replay operations across meetings. Queue rows are now bound to
  the verified caller's identity and the meeting id server-side; all
  client-scoped paths filter by `requireIdentity`-derived author.
- `batchApplyNoteOperation` acked operations its stub flusher never persisted;
  it now persists the op and advances the materialized doc in the same
  transaction before acking.
- Note-log pruning could replay-inconsistently without a server checkpoint;
  pruning is now checkpoint-guarded (no durable checkpoint → no pruning; ops
  above the newest checkpoint sequence are never deleted). Positions remain
  UTF-16 code-unit offsets.

### WebRTC signaling (`c4791a8` merge)
- `getPendingSignals` took a bounded batch **before** filtering by session and
  compared opaque signal ids as cursors, so signals could be silently skipped.
  Reads now use a `by_meeting_session_target_and_processed` composite index
  scoped to the session; cursors paginate within the session-scoped result.
- Broadcast signals (no `toUserId`) could never match a recipient query and
  could never be acked — they accumulated forever. They are now delivered to
  every participant and acked per-caller via a `webrtcSignalAcks` table
  (`processed` stays false so the broadcast survives for others); the cleanup
  sweep ages them out (the old `processed`-only sweep could never remove them).
- `markSignalsProcessed` silently ignored foreign signal ids; it now verifies
  ownership (direct → recipient, broadcast → meeting participant) and throws
  forbidden otherwise.

### Matching & deactivation (`a92e99f` merge)
- `deactivateUser` only flipped `isActive`: queue entries kept pairing the
  user and future meetings stayed scheduled. It now, in one transaction,
  cancels waiting `matchingQueue` rows (history preserved), cancels
  not-yet-started scheduled meetings (active/concluded history untouched),
  and writes a `user_deactivated` audit entry. No scheduler handles exist for
  unstarted meetings (room creation/transcription/post-processing are
  scheduled at start/end time), so nothing to cancel there — noted in code.
- Both pairing selections defensively skip deactivated users, so a stale
  queue row can never pair one. `createMatch`'s race-safe transactional
  re-check of both waiting rows is preserved byte-for-byte.

### Batched realtime writers (`6992c07`)
- `batchIngestTranscriptChunk` and `batchUpdatePresence` enqueued into an
  in-memory processor whose flushers only logged — every acked write was
  guaranteed lost. Both now persist durably in the mutation transaction
  (final transcript chunks via the sequence-allocating ingestion path;
  presence via participant-row patch). Interim chunks are acked as coalesced
  without a durable write (transient by definition). The stub
  `BatchProcessorManager` is removed.
- The repair exposed a latent bug: `processBatchedTranscriptChunks` chained
  `.order('desc')` inside its `withIndex` callback, which throws — the path
  was previously dead code. Fixed.

## Verification method

Red-first: each slice's regression tests were written to fail on the pre-fix
baseline and pass after (worker-verified red runs; webhook repro documented in
`repro-red.md`, commit `9371841`). Security behavior is asserted through the
actual registered endpoints (`http.ts` routes, public mutations/actions), not
mocked internals; only the external Stream service is mocked.

## Known follow-ups (deliberately out of scope)

- `src/hooks/useCollaborativeNotes.ts` sends a shape incompatible with
  `batchApplyNoteOperation` (`{type,position,text,length}` instead of
  `{operation:{type,position,content},clientSequence}`). A correct fix needs
  client sequence/version tracking that feeds OT transformation — not a small
  patch. Flagged by the notes worker; pre-existing.
- `offlineCheckpoints` remain client-supplied (sequence/contentHash
  unverified); pruning trusts them per the conservative-reuse decision.
- Stale `_generated` tree: offline `convex codegen` needs deployment
  credentials (401 offline). Regenerate on a credentialed machine before
  merge so generated api types include the new internal functions.
- Untracked `bun.lock` is pre-existing residue — never committed.
- Baseline build/lint failures (Next 16 lint breakage; build env-var and
  Suspense failures) are recorded in `baseline.md` and untouched, per scope.

## Commit index

| Commit | Slice |
|---|---|
| `21fba5d` | Baseline measurement (tests, type-check, lint, build) |
| `9371841` | Red reproduction run (9F/1P) + webhook validator defect discovery |
| `99e9385` | Transcripts hardening slice merge (speaker attribution, query registration, interim handling) |
| `eeeab64` / `a255d8e` | Identity binding, tenancy closure, deactivated gating |
| `9cb7af4` | Webhook fail-closed signatures, transactional dedupe, idempotent handlers |
| `a92e99f` | Deactivation lifecycle closure |
| `c4791a8` | WebRTC signaling repair |
| `5bc0888` | Offline-notes scoping + persist-before-ack notes writer |
| `6992c07` | Batched transcript/presence persist-before-ack repair |
