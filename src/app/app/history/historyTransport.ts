/**
 * Real transport for the meeting-history client.
 *
 * Boundary doctrine (this file is the load-bearing surface):
 * - Discovery is participant-scoped. The ONLY list read is the authenticated
 *   listUserMeetings query, which walks the caller's own meeting-participant
 *   rows. There is no global meeting scan in this slice.
 * - Detail reads use only the permitted registered functions: getMeeting,
 *   getMeetingNotes, getTranscriptSegments.
 * - Every refusal (other-user meeting, removed participant, deactivated
 *   account, nonexistent meeting, orphaned row) collapses to ONE uniform
 *   "unavailable" outcome so the UI can never leak whether a meeting exists.
 */
import { api } from "@convex/_generated/api";
import type {
  HistoryMeetingDetail,
  HistoryMeetingListItem,
  MeetingLifecycleState,
  ParticipantRole,
  PresenceState,
  TranscriptSegmentView,
} from "./types";

/** Structural client type satisfied by useConvex()/ConvexClient. Kept minimal for testability. */
export interface ConvexQueryClient {
  query(fn: unknown, args?: unknown): Promise<unknown>;
}

export type HistoryTransportError =
  | { kind: "signed-out" }
  | { kind: "unavailable" }
  | { kind: "recoverable"; message?: string };

export type TransportResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: HistoryTransportError };

export interface HistoryTransport {
  listMeetings(args: { state?: MeetingLifecycleState; limit?: number }): Promise<TransportResult<HistoryMeetingListItem[]>>;
  getMeeting(meetingId: string): Promise<TransportResult<HistoryMeetingDetail>>;
}

/** Refusal/protocol codes that must map to the uniform "unavailable" outcome. */
const UNIFORM_REFUSAL_CODES = new Set([
  "FORBIDDEN",
  "INSUFFICIENT_PERMISSIONS",
  "NOT_FOUND",
  "MEETING_NOT_FOUND",
  "RESOURCE_NOT_FOUND",
  "INVALID_INPUT",
  "VALIDATION_ERROR",
  "BAD_REQUEST",
]);

export function mapTransportError(err: unknown): HistoryTransportError {
  const data = (err as { data?: { code?: string } } | null)?.data;
  const code = typeof data?.code === "string" ? data.code : "";
  if (code === "UNAUTHORIZED") return { kind: "signed-out" };
  if (UNIFORM_REFUSAL_CODES.has(code)) return { kind: "unavailable" };
  if (code !== "") return { kind: "recoverable", message: code };
  // No structured code: transport/network/tooling failure - retryable, never a refusal signal.
  return { kind: "recoverable", message: err instanceof Error ? err.message : undefined };
}

/** Defensive read of list-shaped returns (array or {meetings}) without trusting either shape. */
function extractListItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const wrapped = (raw as { meetings?: unknown } | null)?.meetings;
  return Array.isArray(wrapped) ? wrapped : [];
}

function mapListItem(raw: unknown): HistoryMeetingListItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    meetingId: String(r.meetingId ?? r._id ?? ""),
    title: String(r.title ?? ""),
    description: typeof r.description === "string" ? r.description : undefined,
    state: (r.state as HistoryMeetingListItem["state"]) ?? "concluded",
    scheduledAt: typeof r.scheduledAt === "number" ? r.scheduledAt : undefined,
    duration: typeof r.duration === "number" ? r.duration : undefined,
    participantCount: typeof r.participantCount === "number" ? r.participantCount : undefined,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
    userRole: (r.userRole as ParticipantRole) ?? "participant",
    userPresence: (r.userPresence as PresenceState) ?? "invited",
  };
}

function mapSegments(raw: unknown): TranscriptSegmentView[] {
  const items = extractListItems(raw);
  return items.map((item) => {
    const s = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(s.id ?? s._id ?? ""),
      startMs: typeof s.startMs === "number" ? s.startMs : 0,
      endMs: typeof s.endMs === "number" ? s.endMs : 0,
      speakers: Array.isArray(s.speakers) ? s.speakers.map(String) : [],
      text: String(s.text ?? ""),
      topics: Array.isArray(s.topics) ? s.topics.map(String) : [],
    };
  });
}

/** getMeeting's meeting payload (server doc plus the caller's role/presence). */
interface RawMeeting {
  _id: string;
  title: string;
  description?: string;
  state: MeetingLifecycleState;
  scheduledAt?: number;
  duration?: number;
  createdAt: number;
  updatedAt: number;
  userRole: ParticipantRole;
  userPresence: PresenceState;
}

export function createConvexHistoryTransport(client: ConvexQueryClient): HistoryTransport {
  async function call<T>(fn: unknown, args: Record<string, unknown>): Promise<TransportResult<T>> {
    try {
      return { ok: true, data: (await client.query(fn, args)) as T };
    } catch (err) {
      return { ok: false, error: mapTransportError(err) };
    }
  }

  return {
    async listMeetings(args) {
      const result = await call<unknown>(api.meetings.queries.listUserMeetings, {
        state: args.state,
        limit: args.limit ?? 200,
      });
      if (!result.ok) return result;
      return { ok: true, data: extractListItems(result.data).map(mapListItem) };
    },
    async getMeeting(meetingId) {
      const meeting = await call<RawMeeting | null>(api.meetings.queries.getMeeting, { meetingId });
      if (!meeting.ok) return meeting;
      if (meeting.data === null) {
        // Access succeeded but the row is gone (orphaned participation): the
        // same uniform outcome as a refusal - no existence claim either way.
        return { ok: false, error: { kind: "unavailable" } };
      }
      const m = meeting.data;
      const [notes, segments] = await Promise.all([
        call<{ content: string; version: number; updatedAt: number } | null>(
          api.notes.queries.getMeetingNotes,
          { meetingId },
        ),
        call<unknown>(api.transcripts.queries.getTranscriptSegments, { meetingId, limit: 200 }),
      ]);
      const detail: HistoryMeetingDetail = {
        meetingId: m._id,
        title: m.title,
        description: m.description,
        state: m.state,
        scheduledAt: m.scheduledAt,
        duration: m.duration,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        userRole: m.userRole,
        userPresence: m.userPresence,
        notes: notes.ok ? notes.data : null,
        notesError: notes.ok ? undefined : "unavailable",
        transcript: segments.ok ? mapSegments(segments.data) : null,
        transcriptError: segments.ok ? undefined : "unavailable",
      };
      return { ok: true, data: detail };
    },
  };
}
