/**
 * Preparation-document builder + serializer.
 *
 * Privacy rules encoded here:
 * - only notes whose shareability is "shared" (fixture-contract-approved)
 *   are included; private notes are counted and excluded;
 * - documents describe only projected profile data (the workspace only
 *   ever holds projections);
 * - agenda statuses render as explicit labels: proposals are suggestions
 *   only, agreement is explicit, and nothing promises an outcome.
 */
import {
  DISCLAIMER_TEXT,
  statusLabel,
  type AgendaStatus,
  type SourceType,
  type VisibilityBasis,
} from "./contract";
import type { WorkspaceState } from "./workspace";

export type ExportedNote = { text: string; sourceType: SourceType };

export type ExportedAgendaItem = {
  title: string;
  status: AgendaStatus;
  label: string;
  notes: ExportedNote[];
};

export type ExportedParticipant = {
  displayName: string;
  role: string;
  visibilityBasis: VisibilityBasis;
};

export type ExportedOpenQuestion = { text: string; status: "open" | "parked" };

export type PreparationDocument = {
  kind: "connvo-meeting-preparation";
  version: 1;
  generatedAt: number;
  disclaimer: string;
  meeting: { title: string; state: string; scheduledAt: number };
  participants: ExportedParticipant[];
  agenda: ExportedAgendaItem[];
  openQuestions: ExportedOpenQuestion[];
  counts: {
    agendaItems: number;
    shareableNotes: number;
    privateNotesExcluded: number;
    openQuestions: number;
  };
};

export function buildPreparationDocument(
  state: WorkspaceState,
  options: { generatedAt?: number } = {},
): PreparationDocument {
  const generatedAt = options.generatedAt ?? state.meeting.scheduledAt;
  let shareableNotes = 0;
  let privateNotesExcluded = 0;

  const agenda: ExportedAgendaItem[] = state.agenda.map((item) => {
    const notes: ExportedNote[] = [];
    for (const note of item.notes) {
      if (note.shareability === "shared") {
        shareableNotes += 1;
        notes.push({ text: note.text, sourceType: note.sourceType });
      } else {
        privateNotesExcluded += 1;
      }
    }
    return { title: item.title, status: item.status, label: statusLabel(item.status), notes };
  });

  const openQuestions: ExportedOpenQuestion[] = state.openQuestions.map((q) => ({
    text: q.text,
    status: q.status,
  }));

  return {
    kind: "connvo-meeting-preparation",
    version: 1,
    generatedAt,
    disclaimer: DISCLAIMER_TEXT,
    meeting: {
      title: state.meeting.title,
      state: state.meeting.state,
      scheduledAt: state.meeting.scheduledAt,
    },
    participants: [
      { displayName: state.me.displayName, role: "host", visibilityBasis: "self" },
      { displayName: state.peer.displayName, role: state.peerRole, visibilityBasis: state.peerBasis },
    ],
    agenda,
    openQuestions,
    counts: {
      agendaItems: agenda.length,
      shareableNotes,
      privateNotesExcluded,
      openQuestions: openQuestions.length,
    },
  };
}

export function serializePreparationDocument(doc: PreparationDocument): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
