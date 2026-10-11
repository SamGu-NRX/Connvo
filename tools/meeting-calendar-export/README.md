# @connvo/meeting-calendar-export

Local, offline exporter from Connvo meeting records to RFC 5545 (.ics) calendar files.
Deliberately minimal, privacy-first projection. Zero runtime dependencies; tests run on
Node's built-in `node:test` runner, independent of the monorepo's broken lint/build baseline.

## Status — SCAFFOLD (red), 2026-10-11

Committed during a provider sandbox outage. Honest state:

- DONE: RFC 5545 primitives (`src/ics.js`: exact-UTC instants, TEXT escaping, folding), an
  independent reader (`src/reader.js` — shares no code with the writer, so agreement between
  the two is evidence), tests for exact-UTC conversion, escaping, injection canaries, folding.
- NOT DONE: `npm test --prefix tools/meeting-calendar-export` has never been executed — run
  it before believing anything above.
- NOT DONE: schema binding. The actual `meetings` table in `convex/schema/` was never read
  (every clone attempt died). The binding below is from client-side references only
  (CreateMeetingParams: title, description?, scheduledAt? epoch-ms, duration?,
  participantIds: Id<"users">[]; lifecycle scheduled→active→concluded; participant-scoped
  access guard convex/meetings/guards.ts:143) and is UNVERIFIED against the real table.

## Projection contract (planned, pending M1 binding)

- Permitted: UID `connvo-meeting-<id>@calendar-export`; SUMMARY (title, escaped, folded,
  bounded); DTSTART/DTEND exact UTC from epoch-ms `scheduledAt` + `duration` (sub-second
  truncated); STATUS CANCELLED for cancelled lifecycle state, else CONFIRMED; SEQUENCE and
  DTSTAMP from the schema's version/updatedAt fields (bind to the actual fields).
- Omitted for privacy: description, participantIds (attendee list), any
  notes/transcript/connection fields; no ORGANIZER/ATTENDEE lines at all.
- No recurrence support (do not infer); no VTIMEZONE/TZID (instants only, exact UTC).

## Untested client compatibility

Google Calendar, Apple Calendar, and Outlook are UNTESTED. Validation is limited to this
repo's independent reader and the RFC 5545 rules encoded in the tests.

## Verify commands

- `npm test --prefix tools/meeting-calendar-export`
- `git log -1 --format='author: %an <%ae>%n%B'` — must show Sam Gu
  <127461594+SamGu-NRX@users.noreply.github.com> with the Co-authored-by
  obvious-autobuild[bot] trailer.
