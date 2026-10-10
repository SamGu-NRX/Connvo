/**
 * App entry: binds the synthetic fixture meeting + permitted projections to
 * the workspace, then renders. Re-renders keep keyboard focus stable via
 * data-focus-key. Saving produces a local browser download — no network.
 */
import {
  INITIAL_AGENDA,
  INTERNAL_PROFILES,
  PEER_ID,
  SYNTHETIC_MEETINGS,
  VIEWER_ID,
} from "./fixtures";
import { projectProfile } from "./projection";
import {
  addNote,
  agreeAgendaItem,
  createWorkspace,
  parkOpenQuestion,
  proposeAgain,
  recordOpenQuestion,
  setAsideAgendaItem,
  type WorkspaceState,
} from "./workspace";
import { buildPreparationDocument, serializePreparationDocument } from "./export";
import { renderApp, type SaveSummary, type UiActions } from "./ui";

const meeting = SYNTHETIC_MEETINGS[0]!;
const meInternal = INTERNAL_PROFILES.find((p) => p.userId === VIEWER_ID)!;
const peerInternal = INTERNAL_PROFILES.find((p) => p.userId === PEER_ID)!;
const meProjection = projectProfile(meInternal, { viewerId: VIEWER_ID, basis: "self" });
const peerProjection = projectProfile(peerInternal, { viewerId: VIEWER_ID, basis: "shared-meeting" });
if (!meProjection.ok || !peerProjection.ok) {
  throw new Error("fixture binding invariant violated: projections must be visible");
}

let state: WorkspaceState = createWorkspace({
  meeting,
  me: meProjection.profile,
  peer: peerProjection.profile,
  peerBasis: "shared-meeting",
  peerRole: "participant",
  initialAgenda: INITIAL_AGENDA,
});

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app root element missing");
const rootEl: HTMLDivElement = root;

let lastSave: SaveSummary = null;

function focusKeyBeforeRender(): string | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const key = active.getAttribute("data-focus-key");
    if (key) return key;
  }
  return null;
}

function rerender(): void {
  const key = focusKeyBeforeRender();
  renderApp(rootEl, state, actions, key, lastSave);
}

function saveDocument(): void {
  const doc = buildPreparationDocument(state, { generatedAt: Date.now() });
  const raw = serializePreparationDocument(doc);
  const fileName = `meeting-preparation-${state.meeting.id}.json`;
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  lastSave = {
    shareableNotes: doc.counts.shareableNotes,
    privateNotesExcluded: doc.counts.privateNotesExcluded,
    openQuestions: doc.counts.openQuestions,
    fileName,
  };
  rerender();
}

const actions: UiActions = {
  agree: (itemId) => { state = agreeAgendaItem(state, itemId); rerender(); },
  setAside: (itemId) => { state = setAsideAgendaItem(state, itemId); rerender(); },
  proposeAgain: (itemId) => { state = proposeAgain(state, itemId); rerender(); },
  addNote: (itemId, text, subject) => { state = addNote(state, itemId, text, subject); rerender(); },
  addQuestion: (text) => { state = recordOpenQuestion(state, text); rerender(); },
  parkQuestion: (questionId) => { state = parkOpenQuestion(state, questionId); rerender(); },
  saveDocument,
};

rerender();
