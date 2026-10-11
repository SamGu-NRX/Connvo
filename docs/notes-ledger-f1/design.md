# S1 — Notes ledger design (task `connvo-notes-ledger-f1`)

Base: `alpha` @ `ddc94d4`. Branch: `obv/connvo-notes-ledger-f1`. Draft PR → `alpha`.

Evidence-only inputs (read, never base/merge/cherry-pick): PR #24 head `b9b4c5a2e27d` and the
recovery exports at `f7b3bcbc28e64a8256da846e880af0ef1ac6858a` (data only — never executed).
The #24 audit + Handoff list the defects this design must make fail-before/pass-after:

| # | Defect (from #24 audit / M3 export notes) |
|---|---|
| D1 | Ack retires **all** pending entries at once (blanket retirement) |
| D2 | Equal-length replacements treated as no-ops (length-only diff) |
| D3 | Unstable snapshots (fresh object every `getSnapshot`) |
| D4 | Stale or loading query results drop edits |
| D5 | Wrong batch / newVersion / sequence acknowledgements (incl. per-operation version prediction) |
| D6 | Matching text taken as confirmation (invented acceptance history, `includes()` evidence) |
| D7 | Lost teardown (unmount inside debounce discards unsent text) |

## Hard rules (from the lead)

1. Additive-only server changes under `convex/notes/**` (+ `convex/schema/meetings.ts` noteOps fields/indexes).
   No access check or authorization helper changes (`convex/auth/guards.ts`, `convex/auth.config.ts` untouched).
2. Acknowledgement is by **operation identity only** — never inferred from matching text, never from
   "version moved", never from content equality.
3. An edit the client cannot prove incorporated stays **visibly unconfirmed** and recoverable; it is
   never blind-resent (resend only after fresh server evidence shows non-incorporation).
4. Boundaries: never edit `convex/auth.config.ts`, `tools/call-eval/`, `convex/meetings/**`,
   `src/app/app/call/**`, Andrew's landing/dashboard pages, or anyone else's branch.

## 1. Registered server semantics (fixed truth, `convex/notes/*` @ alpha)

- `batchApplyNoteOperations` args: `{ meetingId, operations: [{ operation: NoteV.operation, clientSequence: number }], expectedVersion? }`.
  Flow: `assertMeetingAccess` → version check (`CONFLICT` when `expectedVersion` mismatches; **nothing applied**) →
  per op: validate → transform against noteOps with `sequence > clientSequence` (so **`clientSequence` is an OT basis**,
  the server-history watermark the client had incorporated — NOT a per-client counter) → apply → insert noteOps row →
  version bumps **once per batch** → response `{ success, processed, failed, results: [{ serverSequence,
  transformedOperation, conflicts }], newVersion }`. Per-op failures `continue` silently (`failed++`, no identity in response).
  noteOps rows are written in the same transaction as the text change (persist-before-ack).
- `applyNoteOperation`: single-op variant, same semantics, result `{ success, serverSequence, transformedOperation, newVersion, conflicts }`.
- `getMeetingNotes` returns the materialized row `{ _id, _creationTime, meetingId, content, version, lastRebasedAt, updatedAt } | null`.
  **Gap (the lead decision):** it carries no operation identity or history watermark — the client cannot know
  which of its local edits the server incorporated when a response is lost.
- OT core (`convex/notes/operations.ts`) is **pure** and client-importable: `transformAgainst` (insert/insert
  lexicographic tie-break; delete/insert range-extension; delete/delete overlap), `applyToDoc` (strict bounds:
  insert position ≤ len; delete position < len), `validateOperation` (insert needs content.length>0; delete needs
  length>0), `normalizeOperations`, `applyOperations`, `composeOperations`.

Key OT consequence: batch ops sent from ONE base must be **siblings** (each diffed against the same base
content). The server then transforms each sibling against the batch's own earlier ops plus concurrent foreign
ops — which is exactly a rebase of parallel edits. Ops composed *on top of* an unacked earlier op must never be
sent with the same basis (the server would double-transform them).

## 2. Server additive changes (M1) — `convex/**` only

All optional/additive; old callers unaffected.

1. `convex/schema/meetings.ts` — `noteOps` table gains optional fields `clientId: v.optional(v.string())`,
   `clientOpId: v.optional(v.string())`, `clientSequence: v.optional(v.number())` and two additive indexes:
   `by_meeting_client` `["meetingId","clientId"]`, `by_meeting_client_op` `["meetingId","clientOpId"]`.
2. `convex/notes/mutations.ts` —
   - batch args: each `operations[]` entry gains `clientOpId: v.optional(v.string())`; top-level gains
     `clientId: v.optional(v.string())`. Single-op mutation gains the same optionals.
   - Handler writes `clientId` / `clientOpId` / `clientSequence` onto the noteOps row **in the same transaction**
     (persist-before-ack identity).
   - **Idempotence on identity**: before applying an op, if `clientOpId` is provided and a noteOps row with
     `(meetingId, clientOpId)` exists → do NOT reapply; return the existing row as the op's result with
     `deduped: true`. This makes an evidence-gated resend safe even if a read raced a late server-side commit.
   - `results[]` entries gain `clientOpId: v.optional(v.string())`, `clientSequence: v.optional(v.number())`,
     `deduped: v.optional(v.boolean())` — the response echo that lets the client retire exactly the accepted ops.
   - Response gains `failedOps: v.optional(v.array(v.object({ index: v.number(), clientOpId: v.optional(v.string()), clientSequence: v.optional(v.number()), reason: v.optional(v.string()) })))` — per-op failure identity (today failures are invisible).
   - Returns validators extended accordingly (optional fields only).
3. `convex/notes/queries.ts` — `getMeetingNotes` gains optional arg `clientId: v.optional(v.string())` and
   extends its return (optional fields): `headSequence: v.optional(v.number())` = current max noteOps sequence
   (0 when none; this is the incorporated-history watermark W) and
   `clientAcks: v.optional(v.array(v.object({ clientOpId: v.string(), clientSequence: v.number(), serverSequence: v.number(), appliedAt: v.number() })))`
   = the ≤100 most recent applied ops carrying this client's identity (asc by sequence). The null return and all
   existing fields are unchanged; `getMeetingNotesInternal` untouched.
4. Regression-proof in convex-test: non-participant rejection and participant pass-through are byte-identical
   before/after (the additive change must not alter `assertMeetingAccess` behavior).

## 3. Client protocol (M2) — `src/hooks/notes/**` (new; old `useCollaborativeNotes.ts` untouched)

Files: `notesLedger.ts` (framework-free external store + persistence), `notesDiff.ts` (sibling-op diff),
`notesTransport.ts` (transport seam + Convex default wiring + context), `useNotesLedger.ts` (hook), `index.ts`.

### Identity
- `clientId`: UUID, stable per tab per meeting (`sessionStorage`), sent with every batch and query.
- `clientOpId`: UUID per operation — the ledger's primary key and the server's dedupe identity.
- `clientSequence` (per op): the **incorporated server-history watermark** W — the `headSequence` of the server
  snapshot the op's base came from. Same W for all sibling ops in one flush.

### Diff (`notesDiff.ts`)
`diffToSiblingOps(base: string, buffer: string): Operation[]` — trim common prefix/suffix; emit per contiguous
hunk in base coordinates: insert / delete / replace as `[delete(p,k), insert(p,s)]`. An equal-length replacement
produces real ops (D2 killed here). No-ops only when `buffer === base`. Ops validated against `applyToDoc`
bounds before submission (never send what the server would throw on). Reuse pure helpers from
`@convex/notes/operations` where useful.

### Ledger (`notesLedger.ts`)
Per-(meeting) external store (useSyncExternalStore-compatible: stable snapshot object identity between changes
— D3 killed here), persisted to `sessionStorage` under `(meetingId, clientId)` for teardown/remount recovery.
Record: `{ clientOpId, op, baseVersion, baseHeadSequence (W), state, attempts, content, timestamps }`.
States: `pending` (not sent) → `sending` (in flight) → `saved` (acked by identity) | `rejected` (definite
per-op failure / FORBIDDEN) | `conflict` | `unconfirmed` (send settled with unknown outcome; resolved by the
next fresh read). Duplicate/late acks by identity are counted, never applied twice.

### Composition (the stability core)
- Ingest server snapshots **monotonically by version**: loading (`undefined`) and stale (lower version) results
  never reset or regress state — D4 killed here. A same-version re-delivery is idempotent.
- Composed view = `content` of the ingested snapshot whose version == the base of all unacked records,
  with unacked records' ops applied sequentially (they are siblings from that base). If a newer server version
  arrives while unacked records exist, the view **holds at base+ops** (adopting the newer content would need
  unknown transforms); the panel shows an honest "updating" state. Once every record is acked, the view adopts
  the latest ingested snapshot (≥ the batch's `newVersion`) wholesale — the server's OT already rebased our ops.
- Flushes are **serialized**: at most one in-flight batch. A second flush waits for the first to settle AND a
  fresh ingest ≥ its `newVersion`, then diffs from the new base. This is what makes the OT basis sound.

### Ack retirement (identity only — D1, D5, D6 killed here)
A record is retired to `saved` iff either (a) the mutation response contains a result echoing its `clientOpId`,
or (b) a fresh ingested snapshot's `clientAcks` contains its `clientOpId`. Never by text, never by version bump
alone, never blanket. `newVersion` from the response is adopted as the batch's post-version; per-op
`serverSequence` comes from the echoed results. Conflicts/failures: `CONFLICT` error = nothing applied → records
→ `conflict`, view adopts fresh server truth, user's words stay in the record + edit buffer; `failedOps` echo →
those records → `rejected`; `FORBIDDEN` → records → `rejected`, view rolls back to server truth, words stay
visible in the ledger list.

### Resend (never blind)
Only ops in `pending` may be sent. A send that settles with an unknown outcome goes `unconfirmed` and is
resolved by the next fresh read: acked → `saved`; still absent → back to `pending` → resent with the **same
`clientOpId`** (server idempotence makes this safe even if a read raced a late commit). No timers, no automatic
resends without a fresh ingest first.

### Teardown / remount (D7 killed here)
Unmount inside the debounce: the hook synchronously commits the edit buffer into the ledger (computed op,
`pending`) and persists. Remount restores ledger + buffer from `sessionStorage` and resumes (fresh-read-gated).
Restore failure degrades to in-memory (still flushed per-flush; honest about it in code comments).

### Transport seam (`notesTransport.ts`)
```ts
interface NotesTransport {
  subscribe(meetingId, clientId, onSnapshot: (s: NotesServerSnapshot) => void): () => void; // may also expose refresh()
  applyBatch(meetingId, clientId, batch): Promise<BatchApplyNoteOperationsResponse>;
  close(): void;
}
```
Default wiring (React context provider) uses `useQuery`/`useMutation` against the registered
`api.notes.queries.getMeetingNotes` / `api.notes.mutations.batchApplyNoteOperations` with the additive
`clientId`/`clientOpId` fields. Tests inject a fault-injecting transport that fronts the **convex-test backend**
(see §5). `MeetingNotesPanel` is self-contained: it supplies the default provider internally.

## 4. Panel (M3) — `src/components/meeting-notes/MeetingNotesPanel.tsx`

Props: `{ meetingId: Id<"meetings"> }`. Self-contained; the S3 call-UX task mounts it; call pages are NOT edited.
Entry point note for Andrew's pages goes in the PR only.

Honest aggregate states (all from ledger truth, no optimism about acks):
`loading` / `synced` / `saving` (batch in flight) / `unconfirmed` (N unconfirmed) / `conflict` / `offline`
(transport failing) / `updating` (server moved while ops unacked) — plus a per-record unsaved list showing
rejected/conflict/pending words (the user's text never disappears into a console.log).

A11y + polish (repo skills: better-accessibility, anti-ui-slop; the named external skills
frontend-design/emil-design-eng/holistic-ux are absent from every reachable branch and the workspace — their
principles applied from first principles): textarea with accessible name + native keyboard behavior, status as
polite live region (`role="status"`), every control keyboard-reachable with visible focus, `prefers-reduced-motion`
removes non-essential motion (transitions built with `animate` from `motion`, guarded), no layout shift at
1440×900 and 390×844. jest-axe clean on every state. data-testids: `notes-panel`, `notes-status`,
`notes-editor`, `notes-unsaved-list`, `notes-retry`.

Dev-only preview route `src/app/dev/notes-preview` mounts the panel against a clearly-labeled in-memory demo
backend (drives real states via real faults — drop/offline toggles). It exists for screenshots and manual
verification only; functional proof lives in the matrix tests. Real-browser two-client driving is the later
harness integration step, explicitly not ours.

## 5. Test architecture

- **Server (M1)** `test/convex/notes-watermark.test.ts` (vitest project `convex`, convex-test per
  `test/convex/helpers.ts`): identity persisted in-transaction; response echo; `failedOps`; idempotent
  dedupe (same clientOpId applied once); `headSequence` + `clientAcks` shape; additive-only return
  (old consumers unaffected); auth guard unchanged (participant passes, non-participant rejected).
- **Mounted matrix (M2)** `test/in-call/**` (new vitest project `in-call`, jsdom, testing-library —
  `renderToStaticMarkup` is explicitly NOT proof). Fault-injecting transport in front of a convex-test backend:
  `{ dropResponseBeforeApply, dropResponseAfterApply, delay, reorderResults, duplicateAcks, offline }`.
  Cases (each named after its defect; every case asserts final server text AND no lost/duplicated keystrokes):
  1. equal-length replacement applies (D2)
  2. partial ack retires only accepted ops (D1)
  3. reordered acks
  4. duplicate acks
  5. lost ack after apply → resolved via `clientAcks`, never re-sent, no `includes()` evidence (D6)
  6. lost send before apply → resend exactly once, same clientOpId
  7. stale + loading query results preserve edits (D4)
  8. stable snapshot identity across renders (D3)
  9. two reconnect cycles
  10. removal (FORBIDDEN) → words preserved visibly, no blind resend
  11. unmount inside debounce → flush + remount recovery (D7)
  12. two clients editing concurrently → convergence, no loss/dup (D5: one version bump per batch)
- **Property (M4)** `test/in-call/property/notesLedger.property.test.ts` — fast-check, fixed seed recorded in
  file + output, `numRuns: 10_000`. P1: single client, random edit sequences (insert/delete/replace at random
  positions) × random faults (drop before/after apply, offline windows, unmount/remount) → invariant: after
  settle, server text == final client buffer EXACTLY, composed view == server text, every op sent ≤2 times with
  identical clientOpId. P2: two clients, random interleaved edits + faults → conservation (each uniquely-chunked
  insert appears exactly once unless absorbed by a concurrent delete; deletes remove their target) + convergence
  (both views == server text at settle).

### Failing-before evidence
Run the matrix against (a) the alpha hook (via a test-only adapter) and (b) a defect-replica ledger implementing
the #24-audited behaviors **as described in the audit only** (no copied code). Record which named test fails for
which defect; then show all green against the new client. Receipts go in the PR Proof section.

## 6. Verification loop and milestones

Baseline @ ddc94d4 (recorded in baseline.md): `pnpm type-check` = 32 errors / exit 2 (3 in the old
useCollaborativeNotes; it is intentionally untouched); `pnpm test:run` = 1 failed | 239 passed (240), 1 unhandled
error (convex-test internals), exit 1 — all pre-existing.

Every push requires: `pnpm type-check` (≤32 errors, zero new codes), `pnpm test:run` (no new failures),
plus the milestone's new suites green. CI does not run for pushes to `obv/*` or PRs into `alpha` (verified
triggers: ci.yml → push [main, develop] / PR [main]; type-validation.yml → push [main, develop] / PR [main, develop]).

- M1 = §2 + its convex-test suite green.
- M2 = §3 + full matrix green incl. failing-before receipts.
- M3 = panel + axe + keyboard + reduced-motion (jsdom) + browser screenshots (agent-browser) at 1440×900 and 390×844.
- M4 = property suite clean at the recorded seed and 10k cases + final Proof/Handoff in the PR.

Commits: author Sam Gu `127461594+SamGu-NRX@users.noreply.github.com`; trailer
`Co-authored-by: obvious-autobuild[bot] <262744130+obvious-autobuild[bot]@users.noreply.github.com>`.
Draft PR only; never merge; no force-push; no history rewrites.
