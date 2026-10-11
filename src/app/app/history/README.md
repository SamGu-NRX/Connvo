# Meeting history - participant-scoped list and detail client

Layer-4 slice for the Connvo hardening line. Discovery is participant-scoped:
the ONLY list read is the authenticated `listUserMeetings` query, which walks
the caller's own `meetingParticipant` rows. There is no global meeting scan
anywhere in this slice (asserted by a source-level guard in
`history.test.ts`). Detail reads use only the other permitted registered
functions: `getMeeting`, `getMeetingNotes`, `getTranscriptSegments`.

## Contracts consumed
- `convex/meetings/queries.ts` - `listUserMeetings` (state/limit, newest first), `getMeeting` (guarded by `assertMeetingAccess`; returns the meeting plus `userRole`/`userPresence`; null only after access succeeds)
- `convex/notes/queries.ts` - `getMeetingNotes` (versioned document or null)
- `convex/transcripts/queries.ts` - `getTranscriptSegments` (segments with `startMs`/`endMs`, bounded limit)
- Every refusal - other-user meeting, removed participant, deactivated
  account, nonexistent meeting, orphaned row - collapses to ONE uniform
  "unavailable" outcome client-side; the UI never claims whether a meeting
  exists. A clean authorized null is stated as "not captured" (safe absence),
  distinct from a failed read ("not available right now").
- A concluded meeting is NOT evidence of a recording or insight: this slice
  renders no recording or insight sections at all.

## Fixture (clearly labeled, synthetic only)
`fixtureTransport.ts` is a LOCAL TRANSPORT FIXTURE (synthetic participants
Ava/Riley/Pat; no WorkOS/Convex/production touch). Opt in per journey with
`?fixture=1`; every view displays a "Local fixture transport" badge.
Scenarios: notes version 3 with two time-ranged segments, a bare concluded
meeting (no notes/transcript), other-user + removed + unknown-id uniform
refusals, a hostile-label meeting (title/notes/transcript text carry
script/img/iframe payloads that must render as inert text), notes version
bump 3 to 4 between reads (changed-version notice), one-shot recoverable
list failure (retry succeeds).

## Run
- `pnpm vitest run src/app/app/history/history.test.ts` (client: boundary outcomes, stale-request gate, URL round-trip, no-global-scan guard, inert rendering)
- `pnpm vitest run test/convex/history/historyBoundary.test.ts` (real registered functions via convex-test)
- `pnpm dev` then `http://localhost:3000/app/history?fixture=1` (fixture) or `/app/history` (real transport)
- Type-check note: the parent baseline has pre-existing tsc errors; this slice must add zero (`pnpm exec tsc --noEmit | grep "src/app/app/history"` must print nothing).

## Status / Handoff
- Committed and pushed from a live window during the shared-sandbox death
  storm; whether local checks ran before the push is recorded in the PR body
  (updated as checks complete). Runner commands are above.
- Deferred in this window: Playwright walkthrough (desktop/mobile,
  keyboard-only, reduced-motion) plus axe scan; `listMeetingParticipants`
  enrichment for detail headers; PR-body verification updates from a stable
  window.
