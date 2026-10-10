/**
 * Offline workspace state model: agenda agreement, open questions, notes.
 *
 * Pure and synchronous — no I/O, no network. Every mutation returns new
 * state and never mutates the previous state.
 *
 * Privacy invariant: notes created inside the workspace are ALWAYS
 * "private". The workspace exposes no way to make a note shareable —
 * shareability is owned by the fixture contract (contract.ts/fixtures.ts).
 * Notes about the other participant therefore cannot leave the workspace
 * unless the fixture contract explicitly marked them shareable.
 */
import type {
  AgendaStatus,
  MeetingRef,
  OpenQuestionStatus,
  ProjectedProfile,
  SourceNote,
  VisibilityBasis,
} from "./contract";

export type AgendaItem = {
  id: string;
  title: string;
  status: AgendaStatus;
  notes: SourceNote[];
};

export type OpenQuestion = {
  id: string;
  text: string;
  status: OpenQuestionStatus;
  raisedBy: "viewer";
};

export type MeetingBinding = {
  meeting: MeetingRef;
  me: ProjectedProfile;
  peer: ProjectedProfile;
  peerBasis: VisibilityBasis;
  peerRole: "host" | "participant" | "observer";
  initialAgenda: readonly AgendaItem[];
};

export type WorkspaceState = {
  meeting: MeetingRef;
  me: ProjectedProfile;
  peer: ProjectedProfile;
  peerBasis: VisibilityBasis;
  peerRole: "host" | "participant" | "observer";
  agenda: AgendaItem[];
  openQuestions: OpenQuestion[];
  savedCount: number;
};

let noteSeq = 0;
let questionSeq = 0;

export function createWorkspace(binding: MeetingBinding): WorkspaceState {
  return {
    meeting: { ...binding.meeting },
    me: { ...binding.me },
    peer: { ...binding.peer },
    peerBasis: binding.peerBasis,
    peerRole: binding.peerRole,
    agenda: binding.initialAgenda.map((item) => ({
      ...item,
      notes: item.notes.map((note) => ({ ...note })),
    })),
    openQuestions: [],
    savedCount: 0,
  };
}

function withAgendaItem(
  state: WorkspaceState,
  itemId: string,
  fn: (item: AgendaItem) => AgendaItem,
): WorkspaceState {
  if (!state.agenda.some((item) => item.id === itemId)) {
    throw new Error(`unknown agenda item: ${itemId}`);
  }
  return {
    ...state,
    agenda: state.agenda.map((item) => (item.id === itemId ? fn(item) : item)),
  };
}

/** Explicit user action: proposal -> agreed. Never inferred, never automatic. */
export function agreeAgendaItem(state: WorkspaceState, itemId: string): WorkspaceState {
  return withAgendaItem(state, itemId, (item) =>
    item.status === "agreed" ? item : { ...item, status: "agreed" },
  );
}

export function setAsideAgendaItem(state: WorkspaceState, itemId: string): WorkspaceState {
  return withAgendaItem(state, itemId, (item) =>
    item.status === "set-aside" ? item : { ...item, status: "set-aside" },
  );
}

export function proposeAgain(state: WorkspaceState, itemId: string): WorkspaceState {
  return withAgendaItem(state, itemId, (item) =>
    item.status === "proposed" ? item : { ...item, status: "proposed" },
  );
}

/**
 * Adds a viewer note, always shareability "private". There is no API on
 * this module that can produce a "shared" note.
 */
export function addNote(
  state: WorkspaceState,
  itemId: string,
  text: string,
  subject: "self" | "peer",
): WorkspaceState {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("note text must not be empty");
  noteSeq += 1;
  return withAgendaItem(state, itemId, (item) => ({
    ...item,
    notes: [
      ...item.notes,
      {
        id: `note_w${noteSeq}`,
        sourceType: "participant-note",
        shareability: "private",
        subject,
        text: trimmed,
      } satisfies SourceNote,
    ],
  }));
}

export function recordOpenQuestion(state: WorkspaceState, text: string): WorkspaceState {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("question text must not be empty");
  questionSeq += 1;
  return {
    ...state,
    openQuestions: [
      ...state.openQuestions,
      { id: `q_w${questionSeq}`, text: trimmed, status: "open", raisedBy: "viewer" },
    ],
  };
}

export function parkOpenQuestion(state: WorkspaceState, questionId: string): WorkspaceState {
  if (!state.openQuestions.some((q) => q.id === questionId)) {
    throw new Error(`unknown open question: ${questionId}`);
  }
  return {
    ...state,
    openQuestions: state.openQuestions.map((q) =>
      q.id === questionId ? { ...q, status: "parked" } : q,
    ),
  };
}
