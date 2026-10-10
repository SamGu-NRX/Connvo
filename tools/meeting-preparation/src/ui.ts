/**
 * DOM renderer for the offline meeting-preparation workspace.
 *
 * Rules baked into the UI:
 * - agenda agreement is always an explicit button press — nothing is
 *   agreed automatically;
 * - every note is labelled with its source type and shareability;
 * - the save action writes a local file (browser download) and reports
 *   exactly what was included vs excluded — no upload anywhere;
 * - all interactive controls are real buttons/inputs with labels;
 *   nothing depends on hover or animation.
 */
import {
  DISCLAIMER_TEXT,
  SOURCE_TYPE_LABELS,
  statusLabel,
  type ProjectedProfile,
  type SourceType,
} from "./contract";
import { buildPreparationDocument, serializePreparationDocument } from "./export";
import type { WorkspaceState } from "./workspace";

export type SaveSummary = {
  shareableNotes: number;
  privateNotesExcluded: number;
  openQuestions: number;
  fileName: string;
} | null;

export type UiActions = {
  agree(itemId: string): void;
  setAside(itemId: string): void;
  proposeAgain(itemId: string): void;
  addNote(itemId: string, text: string, subject: "self" | "peer"): void;
  addQuestion(text: string): void;
  parkQuestion(questionId: string): void;
  saveDocument(): void;
};

const PROFILE_FIELD_LABELS: Record<string, string> = {
  displayName: "Name",
  bio: "Bio",
  goals: "Goals",
  languages: "Languages",
  experience: "Experience",
  field: "Field",
  jobTitle: "Role title",
  company: "Company",
};

const PROFILE_FIELD_ORDER = [
  "displayName",
  "jobTitle",
  "company",
  "field",
  "experience",
  "goals",
  "languages",
  "bio",
] as const;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function profileValue(profile: ProjectedProfile, field: string): string {
  const raw = (profile as unknown as Record<string, unknown>)[field];
  if (raw === undefined || raw === null) return "";
  if (Array.isArray(raw)) return raw.map(String).join(", ");
  return String(raw);
}

function participantCard(title: string, profile: ProjectedProfile, basisNote: string): HTMLElement {
  const list = el("dl", { class: "profile-fields" });
  for (const field of PROFILE_FIELD_ORDER) {
    const value = profileValue(profile, field);
    if (!value) continue;
    list.append(
      el("dt", { text: PROFILE_FIELD_LABELS[field] ?? field }),
      el("dd", { text: value }),
    );
  }
  return el("section", { class: "card participant", "aria-label": title },
    el("h3", { text: title }),
    el("p", { class: "basis-note", text: basisNote }),
    list,
  );
}

function noteTag(sourceType: SourceType, shareability: string): HTMLElement {
  const label = `${SOURCE_TYPE_LABELS[sourceType] ?? sourceType} · ${
    shareability === "shared" ? "shareable (fixture contract)" : "private — never exported"
  }`;
  return el("span", {
    class: shareability === "shared" ? "tag tag-shared" : "tag tag-private",
    text: label,
  });
}

function agendaItem(state: WorkspaceState, itemId: string, actions: UiActions): HTMLElement {
  const item = state.agenda.find((i) => i.id === itemId)!;
  const statusClass = item.status === "agreed" ? "status-agreed" : item.status === "set-aside" ? "status-aside" : "status-proposed";
  const card = el("li", { class: "card agenda-item", "data-item-id": item.id });
  card.append(
    el("div", { class: "agenda-head" },
      el("h3", { text: item.title }),
      el("span", { class: `status ${statusClass}`, text: statusLabel(item.status) }),
    ),
  );

  const actionsBox = el("div", { class: "agenda-actions", role: "group", "aria-label": `Agreement actions for ${item.title}` });
  if (item.status === "proposed") {
    actionsBox.append(
      el("button", {
        type: "button",
        "data-action": "agree",
        "data-focus-key": `agree-${item.id}`,
        text: "I agree to bring this up",
      }),
      el("button", {
        type: "button",
        class: "secondary",
        "data-action": "set-aside",
        "data-focus-key": `aside-${item.id}`,
        text: "Set aside for now",
      }),
    );
  } else if (item.status === "agreed") {
    actionsBox.append(
      el("button", {
        type: "button",
        class: "secondary",
        "data-action": "set-aside",
        "data-focus-key": `aside-${item.id}`,
        text: "Set aside for now",
      }),
    );
  } else {
    actionsBox.append(
      el("button", {
        type: "button",
        class: "secondary",
        "data-action": "propose-again",
        "data-focus-key": `propose-${item.id}`,
        text: "Propose again",
      }),
    );
  }
  for (const button of Array.from(actionsBox.querySelectorAll("button"))) {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      if (action === "agree") actions.agree(item.id);
      else if (action === "set-aside") actions.setAside(item.id);
      else if (action === "propose-again") actions.proposeAgain(item.id);
    });
  }
  card.append(actionsBox);

  if (item.notes.length > 0) {
    const notes = el("ul", { class: "note-list", "aria-label": `Source notes for ${item.title}` });
    for (const note of item.notes) {
      notes.append(el("li", { class: "note" }, noteTag(note.sourceType, note.shareability), el("p", { text: note.text })));
    }
    card.append(notes);
  } else {
    card.append(el("p", { class: "muted", text: "No source notes for this topic." }));
  }
  return card;
}

function currentPreview(state: WorkspaceState): string {
  const doc = buildPreparationDocument(state, { generatedAt: state.meeting.scheduledAt });
  return serializePreparationDocument(doc);
}

export function renderApp(
  root: HTMLElement,
  state: WorkspaceState,
  actions: UiActions,
  focusKey: string | null,
  lastSave: SaveSummary,
): void {
  root.replaceChildren();

  const header = el("header", { class: "app-header" },
    el("h1", { text: `Meeting preparation — ${state.meeting.title}` }),
    el("p", {
      class: "muted",
      text: "Offline workspace. Nothing here connects to a network; saving writes a local file only.",
    }),
  );

  const participants = el("div", { class: "participants" },
    participantCard(
      "You",
      state.me,
      "Shown from your own profile (self).",
    ),
    participantCard(
      `${state.peer.displayName} (other participant)`,
      state.peer,
      `Shown only from what the meeting fixture marks shareable (${state.peerBasis}). Sensitive details are never projected.`,
    ),
  );

  const agendaList = el("ul", { class: "agenda-list", "aria-label": "Proposed agenda" });
  for (const item of state.agenda) {
    agendaList.append(agendaItem(state, item.id, actions));
  }
  const agendaSection = el("section", { class: "panel" },
    el("h2", { text: "Agenda" }),
    el("p", {
      class: "muted",
      text: "These topics are proposals. Agreement is recorded only when you press the agreement button — nothing is inferred.",
    }),
    agendaList,
  );

  const noteItemSelect = el("select", { id: "note-item-select", "data-focus-key": "note-item-select" });
  for (const item of state.agenda) {
    noteItemSelect.append(el("option", { value: item.id, text: item.title }));
  }
  const noteSubjectSelf = el("input", { type: "radio", name: "note-subject", id: "note-subject-self", value: "self", "data-focus-key": "note-subject-self" }) as HTMLInputElement;
  noteSubjectSelf.checked = true;
  const noteSubjectPeer = el("input", { type: "radio", name: "note-subject", id: "note-subject-peer", value: "peer", "data-focus-key": "note-subject-peer" }) as HTMLInputElement;
  const noteInput = el("input", { type: "text", id: "note-text-input", "data-focus-key": "note-text-input", autocomplete: "off", placeholder: "Write a private note…", "aria-describedby": "note-privacy-hint" }) as HTMLInputElement;
  const noteForm = el("form", { class: "note-form", "aria-label": "Add a private note" },
    el("div", { class: "field-row" },
      el("label", { for: "note-item-select", text: "Topic" }),
      noteItemSelect,
    ),
    el("fieldset", { class: "field-row" },
      el("legend", { text: "Note about" }),
      el("label", { for: "note-subject-self", text: "Myself" }),
      noteSubjectSelf,
      el("label", { for: "note-subject-peer", text: state.peer.displayName }),
      noteSubjectPeer,
    ),
    el("div", { class: "field-row" },
      el("label", { for: "note-text-input", text: "Note" }),
      noteInput,
    ),
    el("button", { type: "submit", "data-focus-key": "note-submit", text: "Add private note" }),
    el("p", {
      id: "note-privacy-hint",
      class: "muted",
      text: "Notes you write here are private to this workspace and never appear in a saved document. Which fixture notes are shareable is decided by the fixture contract, not by this UI.",
    }),
  );
  noteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = noteInput.value;
    if (!text.trim()) return;
    const subject = noteSubjectPeer.checked ? "peer" : "self";
    actions.addNote(noteItemSelect.value, text, subject);
  });

  const questionInput = el("input", { type: "text", id: "question-input", "data-focus-key": "question-input", autocomplete: "off", placeholder: "What do you want to find out on the call?", "aria-label": "Open question" }) as HTMLInputElement;
  const questionForm = el("form", { class: "question-form", "aria-label": "Record an open question" },
    questionInput,
    el("button", { type: "submit", "data-focus-key": "question-submit", text: "Record open question" }),
  );
  questionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = questionInput.value;
    if (!text.trim()) return;
    actions.addQuestion(text);
  });

  const questionList = el("ul", { class: "question-list", "aria-label": "Open questions" });
  for (const question of state.openQuestions) {
    questionList.append(
      el("li", { class: "question" },
        el("span", { class: question.status === "parked" ? "question-text parked" : "question-text", text: question.text }),
        el("span", { class: "tag", text: question.status === "parked" ? "parked" : "open" }),
        el("button", {
          type: "button",
          class: "secondary",
          "data-action": "park",
          "data-question-id": question.id,
          "data-focus-key": `park-${question.id}`,
          text: "Park",
        }),
      ),
    );
  }
  if (state.openQuestions.length === 0) {
    questionList.append(el("li", { class: "muted", text: "No open questions recorded yet." }));
  }
  for (const question of state.openQuestions) {
    const parkButton = questionList.querySelector<HTMLButtonElement>(`[data-question-id="${question.id}"]`);
    if (parkButton) {
      parkButton.disabled = question.status === "parked";
      parkButton.addEventListener("click", () => actions.parkQuestion(question.id));
    }
  }

  const saveButton = el("button", { type: "button", id: "save-doc", "data-focus-key": "save-doc", text: "Save preparation document locally" });
  saveButton.addEventListener("click", () => actions.saveDocument());
  const saveConfirmation = el("div", {
    id: "save-confirmation",
    class: "save-confirmation",
    role: "status",
    "aria-live": "polite",
    text: lastSave
      ? `Saved ${lastSave.fileName} locally — included ${lastSave.shareableNotes} shareable note(s), excluded ${lastSave.privateNotesExcluded} private note(s), ${lastSave.openQuestions} open question(s).`
      : "Nothing saved yet. Saving writes a local JSON file: shareable fixture notes are included, private notes are excluded and counted.",
  });
  const documentSection = el("section", { class: "panel" },
    el("h2", { text: "Preparation document" }),
    el("p", { class: "disclaimer", text: `The saved document starts with this disclaimer: “${DISCLAIMER_TEXT}”` }),
    saveButton,
    saveConfirmation,
    el("details", { class: "preview" },
      el("summary", { text: "Preview of the document as it would be saved now" }),
      el("pre", { class: "doc-preview", text: currentPreview(state) }),
    ),
  );

  const footer = el("footer", { class: "app-footer" },
    el("p", {
      class: "muted",
      text: "Offline workspace built on synthetic fixtures. It never sends messages, requests meetings, or contacts anyone.",
    }),
  );

  root.append(
    el("div", { class: "container" },
      header,
      el("main", {},
        el("section", { class: "panel", "aria-label": "Participants" },
          el("h2", { text: "Participants" }),
          participants,
        ),
        agendaSection,
        el("section", { class: "panel", "aria-label": "Private notes" },
          el("h2", { text: "Private notes" }),
          noteForm,
        ),
        el("section", { class: "panel", "aria-label": "Open questions" },
          el("h2", { text: "Open questions" }),
          questionForm,
          questionList,
        ),
        documentSection,
      ),
      footer,
    ),
  );

  if (focusKey) {
    const target = root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    target?.focus();
  }
}
