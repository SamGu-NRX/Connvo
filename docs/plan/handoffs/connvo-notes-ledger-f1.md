# PR #31 — feat(notes): loss-proof in-call collaborative notes ledger (S1)

**Branch** `obv/connvo-notes-ledger-f1` → `alpha` · **Draft PR #31** (opened from the host at `76d296d`)
**This doc is the PR body's source of truth.** The sandbox cannot reach `api.github.com` (egress proxy blocks the host), so nothing in this workspace edits the PR: the lead copies this file into the PR body at review. Keep this file current with every push — update the SHA line, the Proof log and the Handoff in the same commit as each milestone.
**Last updated at:** `76d296d`

---

## PR description

### Why

Step S1 of `docs/plan/CALL-PLAN.md` (base `alpha` @ `ddc94d4`): rebuild #24's notes repair from main so in-call collaborative notes are impossible to lose. PR #24 (`b9b4c5a`) is evidence only — never merged. Its audited defects each get a named failing-before / pass-after test here: blanket ack retirement, equal-length replacements treated as no-ops, unstable snapshots, stale/loading results dropping edits, wrong batch/newVersion/sequence acknowledgements, text-matching "confirmation", lost teardown.

### Approach — `docs/notes-ledger-f1/design.md` is the contract

- **Server, additive only** (no access-check changes): `noteOps` gains optional `clientId` / `clientOpId` / `clientSequence` + two indexes; batch results echo per-op identity, `failedOps` reports failures with identity, resends dedupe on `clientOpId` (identity persisted in the same transaction as the text change); `getMeetingNotes` accepts an optional `clientId` and additively returns `headSequence` (incorporated server-history watermark W) and `clientAcks` (identity acks).
- **Client** (new `src/hooks/notes/**`; the old `useCollaborativeNotes.ts` is intentionally untouched): a pending-operation ledger keyed by `clientOpId`; `clientSequence` is the incorporated server-history watermark (not a counter); sibling-op diffs from one base with serialized flushes; monotonic snapshot ingest (stale/loading never drop edits); stable `useSyncExternalStore` snapshots; **identity-only ack retirement** (never text matching); evidence-gated resend with the same `clientOpId` (server idempotence); synchronous buffer→ledger commit on teardown + `sessionStorage` recovery.
- **UI** (`src/components/meeting-notes/MeetingNotesPanel`, props `{ meetingId }`): honest loading / synced / saving / unconfirmed / conflict / offline / updating states, polite live region, keyboard-first, reduced-motion-aware (`animate` from `motion`), self-contained for the S3 call-UX task to mount.
- **Tests**: mounted React matrix (testing-library) over a fault-injecting transport in front of a **convex-test** backend — 12 named cases incl. two clients, two reconnect cycles, unmount-in-debounce; fast-check property suite (10,000 cases, recorded seed) with convergence + conservation invariants; convex-test server suite; jest-axe on every panel state.

### Milestones

- [x] M0 — design contract, baseline receipt, pinned hook types (`3162e18`, `c33518f`, `76d296d`)
- [ ] M1 — server identity/watermark fields + convex-test suite
- [ ] M2 — ledger + hook + outcome matrix (failing-before receipts for every #24 defect)
- [ ] M3 — panel + axe + keyboard + reduced-motion + screenshots (1440×900, 390×844)
- [ ] M4 — property run clean at recorded seed (10k) + final Proof / Handoff

### Baseline @ `ddc94d4` (`docs/notes-ledger-f1/baseline.md`)

- `pnpm type-check`: **32 errors, exit 2** — all pre-existing (3 in the old `useCollaborativeNotes.ts`, intentionally untouched). Bar: ≤32 total, zero new codes, none in new files.
- `pnpm test:run`: **1 failed | 239 passed (240), 1 unhandled convex-test error, exit 1** — all pre-existing (perf test `ArrayBuffer operations are efficient`; unhandled `Write outside of transaction 10008;_scheduled_functions`).
- CI triggers verified: `ci.yml` → push `[main, develop]` / PR `[main]`; `type-validation.yml` → push/PR `[main, develop]`. **No workflow fires for `obv/*` pushes or PRs into `alpha`.** Full local verification runs before every push regardless.

### Boundaries respected

`convex/auth.config.ts`, `tools/call-eval/`, `convex/meetings/**`, `src/app/app/call/**` untouched; no #16/#22/#24/#25 content; Andrew's landing/dashboard pages (PRs #9/#13) untouched — an entry-point suggestion for his pages is recorded in the Handoff, not applied. Draft PR; never merges; no force-push; author Sam Gu on every commit.

---

## Proof

Reproduction environment: fresh clone of `SamGu-NRX/Connvo`, branch `obv/connvo-notes-ledger-f1`, `export PATH=/home/user/.npm-global/bin:$PATH` (node v20, pnpm 9).

| When | HEAD | Check | Command | Result |
|---|---|---|---|---|
| @ `ddc94d4` (baseline) | — | types | `pnpm type-check` | exit 2, 32 errors, all pre-existing |
| @ `ddc94d4` (baseline) | — | tests | `pnpm test:run` | exit 1: 1 failed / 239 passed, 1 unhandled error — all pre-existing |
| @ `3162e18`+`c33518f`+`76d296d` | `76d296d` | types after contract files | `pnpm type-check 2>&1 \| grep -cE "error TS"` | `32` — no new errors; `grep src/hooks/notes/` → none |
| @ `76d296d` | `76d296d` | authorship | `git log --format='%h %an <%ae>' -3` | all three commits `Sam Gu <127461594+SamGu-NRX@users.noreply.github.com>`; each ends with the `Co-authored-by: obvious-autobuild[bot]` trailer |

Milestone receipts (M1–M4) are appended here as they land, each with failing-before evidence where applicable (M2's matrix over every #24 defect; M4's fast-check run with the recorded seed).

---

## Handoff

*(at `76d296d`)*

**Done**

- Design contract + baseline receipt committed: `docs/notes-ledger-f1/design.md` (registered semantics: op identity, watermark, dedupe, diff base, snapshot ingest, fault matrix, boundaries) and `baseline.md` (recorded baseline outputs).
- Shared client contract pinned on the branch: `src/hooks/notes/types.ts`, `notesTransport.tsx` (provider + `useNotesTransport`), `index.ts` with a `useNotesLedger` placeholder (throws until M2) — verified to add zero new type errors.
- Draft PR #31 open, maintained by the lead from the host; sandbox never touches `api.github.com`.

**In flight**

- M1 (server identity/watermark + convex-test suite) and M3 (panel + a11y + demo preview route) run as parallel sub-threads off this branch, each in its own fresh clone, reporting commits on `obv/connvo-notes-f1-m1-server` / `obv/connvo-notes-f1-m3-panel` for the owner to merge. M2 (ledger + hook) starts when M1 lands; M4 (property run at recorded seed + final proof) when M2 lands.

**Left**

- M1–M4 as listed under Milestones; merge each milestone into this branch with `git merge --no-ff` (no rebase/force-push), re-run the full verification bar, update this doc in the same push.

**How to continue**

1. `git clone https://github.com/SamGu-NRX/Connvo.git && git fetch origin obv/connvo-notes-ledger-f1 && git checkout obv/connvo-notes-ledger-f1`
2. Read `docs/notes-ledger-f1/design.md` (the contract) and `docs/notes-ledger-f1/baseline.md` (the bar: type-check ≤32 total / none in new files; `pnpm test:run` keeps exactly the one pre-existing failure + one unhandled error).
3. Engineering skills to read (branch `chore/agent-skills-20261011`, never merge): `pstack-principle-*`, `better-accessibility/**`, `anti-ui-slop`, `anti-lazy-architecture`.
4. Commit as `Sam Gu <127461594+SamGu-NRX@users.noreply.github.com>` with the `Co-authored-by: obvious-autobuild[bot] <262744130+obvious-autobuild[bot]@users.noreply.github.com>` trailer; push only after the verification bar passes; update this file's SHA line, Proof table and Milestones in the same commit. Never edit the PR from the sandbox — hand the body copy to the lead.

**Notes for reviewers / other owners**

- The panel is self-contained (props `{ meetingId }`) so the later S3 call-UX task can mount it on call pages and retire the old `useCollaborativeNotes` hook. For Andrew's landing/dashboard pages (PRs #9/#13, untouched here): the same panel can be dropped into any meeting summary surface with a one-line import once S3 wires production transport — suggestion only, not applied.
- If a continuation starts from this PR: the operator must verify the original writer is not actively editing, recover branch/PR/checkpoint progress, and record the handoff before launching a replacement. No competing writer, no rebase/amend/force-push.
