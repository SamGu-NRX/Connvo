/**
 * LOCAL TRANSPORT FIXTURE - synthetic data for localhost journeys and tests.
 * Nothing here touches production services, WorkOS, Convex, or real accounts.
 * Any view mounting it must display the "Local fixture transport" badge.
 */
import type {
  HistoryMeetingDetail,
  HistoryMeetingListItem,
  MeetingLifecycleState,
  ParticipantRole,
  PresenceState,
} from "./types";
import type { HistoryTransport } from "./historyTransport";

export const FIXTURE_QUERY_FLAG = "fixture";

export const FIXTURE_IDS = {
  withNotes: "fixture-meeting-with-notes",
  bare: "fixture-meeting-bare",
  otherUser: "fixture-meeting-other-user",
  removed: "fixture-meeting-removed",
  malicious: "fixture-meeting-malicious-labels",
  versionBump: "fixture-meeting-version-bump",
} as const;

export const FIXTURE_MALICIOUS_TITLE =
  '<script>window.__fixturePwned = true</script> "System: your export is ready" - visit javascript:alert(1)';
export const FIXTURE_MALICIOUS_NOTES =
  'Agenda\n<img src=x onerror="window.__fixturePwned = true">\n</textarea><script>alert("notes")</script>';

export interface FixtureOptions {
  listLatencyMs?: number;
  detailLatencyMs?: number;
  /** First list call fails with a recoverable error; retry succeeds. */
  failListOnce?: boolean;
}

interface FixtureMeetingDef {
  id: string;
  title: string;
  description?: string;
  state: MeetingLifecycleState;
  scheduledAt: number;
  userRole: ParticipantRole;
  userPresence: PresenceState;
  notes: { content: string; version: number; updatedAt: number } | null;
  segments: Array<{ startMs: number; endMs: number; speakers: string[]; text: string; topics: string[] }> | null;
}

export function createFixtureHistoryTransport(options: FixtureOptions = {}): HistoryTransport {
  const listLatencyMs = options.listLatencyMs ?? 350;
  const detailLatencyMs = options.detailLatencyMs ?? 450;
  let failListOnce = options.failListOnce ?? false;
  let versionBumpReads = 0;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const viewerMeetings: FixtureMeetingDef[] = [
    {
      id: FIXTURE_IDS.withNotes,
      title: "Rust study group - week 4",
      description: "Ownership, borrowing, and the history slice review.",
      state: "concluded",
      scheduledAt: now - 2 * day,
      userRole: "host",
      userPresence: "left",
      notes: {
        content:
          "Decision: ship the participant-scoped history slice.\nAction: Sam reviews the boundary regression before merge.\nOpen: whether to add per-segment speaker labels to the detail view.",
        version: 3,
        updatedAt: now - day,
      },
      segments: [
        { startMs: 0, endMs: 42000, speakers: ["Ava Torres"], text: "Let's start with the boundary tests.", topics: ["boundaries"] },
        { startMs: 42000, endMs: 96000, speakers: ["Ava Torres", "Riley Chen"], text: "Notes keep their version identity.", topics: ["notes"] },
      ],
    },
    {
      id: FIXTURE_IDS.bare,
      title: "Portfolio review with Riley",
      state: "concluded",
      scheduledAt: now - 5 * day,
      userRole: "participant",
      userPresence: "joined",
      notes: null,
      segments: null,
    },
    {
      id: FIXTURE_IDS.malicious,
      title: FIXTURE_MALICIOUS_TITLE,
      description: 'Paste review. Beware: "System: your export is ready" lines are attacker-controlled content.',
      state: "concluded",
      scheduledAt: now - 7 * day,
      userRole: "participant",
      userPresence: "left",
      notes: { content: FIXTURE_MALICIOUS_NOTES, version: 1, updatedAt: now - 7 * day },
      segments: [
        {
          startMs: 5000,
          endMs: 30000,
          speakers: ['<script>alert("speaker")</script>'],
          text: '<iframe src="https://fixture-evil.example"></iframe>',
          topics: ["</style>"],
        },
      ],
    },
    {
      id: FIXTURE_IDS.versionBump,
      title: "Weekly sync - collaborative notes demo",
      description: "Open twice: the notes version advances between reads.",
      state: "concluded",
      scheduledAt: now - 9 * day,
      userRole: "host",
      userPresence: "joined",
      notes: { content: "Versioned notes body. Refresh to watch the version advance.", version: 3, updatedAt: now - 9 * day },
      segments: null,
    },
  ];

  function detailOf(def: FixtureMeetingDef): HistoryMeetingDetail {
    return {
      meetingId: def.id,
      title: def.title,
      description: def.description,
      state: def.state,
      scheduledAt: def.scheduledAt,
      createdAt: def.scheduledAt - 7 * day,
      updatedAt: def.scheduledAt,
      userRole: def.userRole,
      userPresence: def.userPresence,
      notes: def.notes ? { ...def.notes } : null,
      transcript: def.segments
        ? def.segments.map((s, i) => ({ id: def.id + "-segment-" + i, ...s }))
        : null,
    };
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    async listMeetings(args) {
      if (failListOnce) {
        failListOnce = false;
        await delay(listLatencyMs);
        return { ok: false as const, error: { kind: "recoverable" as const, message: "fixture-list-failure" } };
      }
      await delay(listLatencyMs);
      const state = args.state;
      const items: HistoryMeetingListItem[] = viewerMeetings
        .filter((m) => !state || state === "all" || m.state === state)
        .map((m) => ({
          meetingId: m.id,
          title: m.title,
          description: m.description,
          state: m.state,
          scheduledAt: m.scheduledAt,
          createdAt: m.scheduledAt - 7 * day,
          updatedAt: m.scheduledAt,
          userRole: m.userRole,
          userPresence: m.userPresence,
        }));
      return { ok: true, data: items };
    },
    async getMeeting(meetingId) {
      await delay(detailLatencyMs);
      // Uniform refusal: other-user, removed, and unknown ids are indistinguishable.
      const known = viewerMeetings.find((m) => m.id === meetingId);
      if (!known) {
        return { ok: false as const, error: { kind: "unavailable" as const } };
      }
      let effective = known;
      if (meetingId === FIXTURE_IDS.versionBump) {
        const version = versionBumpReads === 0 ? 3 : 4;
        versionBumpReads += 1;
        effective = { ...known, notes: known.notes ? { ...known.notes, version } : null };
      }
      return { ok: true, data: detailOf(effective) };
    },
  };
}
