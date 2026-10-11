/**
 * View types for the meeting-history client.
 *
 * They mirror the parent read contracts this slice consumes - never the wider
 * schema: convex/meetings/queries.ts listUserMeetings + getMeeting,
 * convex/notes/queries.ts getMeetingNotes, convex/transcripts/queries.ts
 * getTranscriptSegments. Artifact existence here means only "an authorized
 * read returned data"; it never implies a recording or insight exists.
 */

export type MeetingLifecycleState = "scheduled" | "active" | "concluded" | "cancelled";
export type MeetingStateFilter = MeetingLifecycleState | "all";
export type ParticipantRole = "host" | "participant" | "observer";
export type PresenceState = "invited" | "joined" | "left";

export interface HistoryMeetingListItem {
  meetingId: string;
  title: string;
  description?: string;
  state: MeetingLifecycleState;
  scheduledAt?: number;
  duration?: number;
  participantCount?: number;
  createdAt: number;
  updatedAt: number;
  userRole: ParticipantRole;
  userPresence: PresenceState;
}

export interface TranscriptSegmentView {
  id: string;
  startMs: number;
  endMs: number;
  speakers: string[];
  text: string;
  topics: string[];
}

export interface HistoryNotesArtifact {
  content: string;
  version: number;
  updatedAt: number;
}

export interface HistoryMeetingDetail {
  meetingId: string;
  title: string;
  description?: string;
  state: MeetingLifecycleState;
  scheduledAt?: number;
  duration?: number;
  createdAt: number;
  updatedAt: number;
  userRole: ParticipantRole;
  userPresence: PresenceState;
  /** null = the authorized notes read returned a clean null (captured absence). */
  notes: HistoryNotesArtifact | null;
  /** set when the notes read itself failed while the meeting read succeeded. */
  notesError?: "unavailable";
  /** null = the authorized transcript read returned no segments (captured absence). */
  transcript: TranscriptSegmentView[] | null;
  transcriptError?: "unavailable";
}
