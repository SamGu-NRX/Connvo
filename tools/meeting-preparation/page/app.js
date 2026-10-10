"use strict";
(() => {
  // src/fixtures.ts
  var SYNTHETIC_MEETINGS = [
    {
      id: "mtg_synth_001",
      title: "Synthetic intro call \u2014 agenda preparation",
      state: "scheduled",
      scheduledAt: 17919864e5,
      durationMinutes: 30
    }
  ];
  var VIEWER_ID = "u_synth_viewer_riley";
  var PEER_ID = "u_synth_peer_noor";
  var INTERNAL_PROFILES = [
    {
      userId: VIEWER_ID,
      displayName: "Riley Chen",
      bio: "Synthetic viewer profile (fixture data, not a real person).",
      goals: "Keep calls short and agenda-led",
      languages: ["en", "de"],
      experience: "5 years synthetic product work",
      age: 34,
      gender: "non-binary",
      field: "product",
      jobTitle: "Product designer",
      company: "Example Synthetics",
      linkedinUrl: "https://linkedin.example/in/riley-synth"
    },
    {
      userId: PEER_ID,
      displayName: "Noor Haddad",
      bio: "Synthetic peer profile (fixture data, not a real person).",
      goals: "Compare notes on onboarding flows",
      languages: ["en", "ar"],
      experience: "8 years synthetic engineering",
      age: 41,
      gender: "female",
      field: "engineering",
      jobTitle: "Staff engineer",
      company: "Example Synthetics",
      linkedinUrl: "https://linkedin.example/in/noor-synth"
    }
  ];
  var INITIAL_AGENDA = [
    {
      id: "agenda_1",
      title: "Warm-up: what each of us wants from this call",
      status: "proposed",
      notes: [
        {
          id: "note_1",
          sourceType: "self-profile",
          shareability: "shared",
          subject: "self",
          text: "Riley's own profile goal: keep calls short and agenda-led."
        },
        {
          id: "note_2",
          sourceType: "peer-public-profile",
          shareability: "shared",
          subject: "peer",
          contractRationale: "Sourced exclusively from the peer's permitted public projection.",
          text: "Noor's public goal: compare notes on onboarding flows."
        }
      ]
    },
    {
      id: "agenda_2",
      title: "Compare onboarding flows",
      status: "proposed",
      notes: [
        {
          id: "note_3",
          sourceType: "participant-note",
          shareability: "private",
          subject: "peer",
          text: "Private recollection: Noor mentioned preferring short calls."
        },
        {
          id: "note_4",
          sourceType: "shared-meeting-context",
          shareability: "shared",
          subject: "meeting",
          text: "Both participants are invited to the synthetic meeting mtg_synth_001."
        }
      ]
    },
    {
      id: "agenda_3",
      title: "Agree what, if anything, happens after the call",
      status: "proposed",
      notes: [
        {
          id: "note_5",
          sourceType: "participant-note",
          shareability: "private",
          subject: "peer",
          text: "Private: check with Noor directly before assuming any follow-up."
        },
        {
          id: "note_6",
          sourceType: "self-profile",
          shareability: "private",
          subject: "self",
          text: "Private: Riley is still practising agenda-setting."
        }
      ]
    }
  ];

  // src/contract.ts
  var PERMITTED_PROFILE_FIELDS = [
    "displayName",
    "bio",
    "goals",
    "languages",
    "experience",
    "field",
    "jobTitle",
    "company"
  ];
  var PROPOSAL_LABEL = "Proposal \u2014 suggestion only, not yet agreed";
  var AGREED_LABEL = "Agreed for discussion";
  var SET_ASIDE_LABEL = "Set aside \u2014 not proposed right now";
  var SOURCE_TYPE_LABELS = {
    "self-profile": "Your profile",
    "peer-public-profile": "Other participant's public profile",
    "shared-meeting-context": "Shared meeting context",
    "participant-note": "Private participant note"
  };
  var DISCLAIMER_TEXT = "Agenda topics marked as proposals are suggestions only. Agreement is recorded only when each participant explicitly agrees. This document records no consent and promises no outcome.";
  function statusLabel(status) {
    switch (status) {
      case "proposed":
        return PROPOSAL_LABEL;
      case "agreed":
        return AGREED_LABEL;
      case "set-aside":
        return SET_ASIDE_LABEL;
    }
  }

  // src/projection.ts
  function projectProfile(profile, grant) {
    const isSelf = grant.viewerId === profile.userId;
    const tenancyBounded = grant.basis === "shared-meeting" || grant.basis === "same-org";
    if (!isSelf && !tenancyBounded) {
      return { ok: false, reason: "not-visible" };
    }
    const source = profile;
    const projected = { userId: profile.userId };
    for (const field of PERMITTED_PROFILE_FIELDS) {
      const value = source[field];
      if (value !== void 0) {
        projected[field] = value;
      }
    }
    return { ok: true, profile: projected };
  }

  // src/workspace.ts
  var noteSeq = 0;
  var questionSeq = 0;
  function createWorkspace(binding) {
    return {
      meeting: { ...binding.meeting },
      me: { ...binding.me },
      peer: { ...binding.peer },
      peerBasis: binding.peerBasis,
      peerRole: binding.peerRole,
      agenda: binding.initialAgenda.map((item) => ({
        ...item,
        notes: item.notes.map((note) => ({ ...note }))
      })),
      openQuestions: [],
      savedCount: 0
    };
  }
  function withAgendaItem(state2, itemId, fn) {
    if (!state2.agenda.some((item) => item.id === itemId)) {
      throw new Error(`unknown agenda item: ${itemId}`);
    }
    return {
      ...state2,
      agenda: state2.agenda.map((item) => item.id === itemId ? fn(item) : item)
    };
  }
  function agreeAgendaItem(state2, itemId) {
    return withAgendaItem(
      state2,
      itemId,
      (item) => item.status === "agreed" ? item : { ...item, status: "agreed" }
    );
  }
  function setAsideAgendaItem(state2, itemId) {
    return withAgendaItem(
      state2,
      itemId,
      (item) => item.status === "set-aside" ? item : { ...item, status: "set-aside" }
    );
  }
  function proposeAgain(state2, itemId) {
    return withAgendaItem(
      state2,
      itemId,
      (item) => item.status === "proposed" ? item : { ...item, status: "proposed" }
    );
  }
  function addNote(state2, itemId, text, subject) {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("note text must not be empty");
    noteSeq += 1;
    return withAgendaItem(state2, itemId, (item) => ({
      ...item,
      notes: [
        ...item.notes,
        {
          id: `note_w${noteSeq}`,
          sourceType: "participant-note",
          shareability: "private",
          subject,
          text: trimmed
        }
      ]
    }));
  }
  function recordOpenQuestion(state2, text) {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("question text must not be empty");
    questionSeq += 1;
    return {
      ...state2,
      openQuestions: [
        ...state2.openQuestions,
        { id: `q_w${questionSeq}`, text: trimmed, status: "open", raisedBy: "viewer" }
      ]
    };
  }
  function parkOpenQuestion(state2, questionId) {
    if (!state2.openQuestions.some((q) => q.id === questionId)) {
      throw new Error(`unknown open question: ${questionId}`);
    }
    return {
      ...state2,
      openQuestions: state2.openQuestions.map(
        (q) => q.id === questionId ? { ...q, status: "parked" } : q
      )
    };
  }

  // src/export.ts
  function buildPreparationDocument(state2, options = {}) {
    const generatedAt = options.generatedAt ?? state2.meeting.scheduledAt;
    let shareableNotes = 0;
    let privateNotesExcluded = 0;
    const agenda = state2.agenda.map((item) => {
      const notes = [];
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
    const openQuestions = state2.openQuestions.map((q) => ({
      text: q.text,
      status: q.status
    }));
    return {
      kind: "connvo-meeting-preparation",
      version: 1,
      generatedAt,
      disclaimer: DISCLAIMER_TEXT,
      meeting: {
        title: state2.meeting.title,
        state: state2.meeting.state,
        scheduledAt: state2.meeting.scheduledAt
      },
      participants: [
        { displayName: state2.me.displayName, role: "host", visibilityBasis: "self" },
        { displayName: state2.peer.displayName, role: state2.peerRole, visibilityBasis: state2.peerBasis }
      ],
      agenda,
      openQuestions,
      counts: {
        agendaItems: agenda.length,
        shareableNotes,
        privateNotesExcluded,
        openQuestions: openQuestions.length
      }
    };
  }
  function serializePreparationDocument(doc) {
    return JSON.stringify(doc, null, 2) + "\n";
  }

  // src/ui.ts
  var PROFILE_FIELD_LABELS = {
    displayName: "Name",
    bio: "Bio",
    goals: "Goals",
    languages: "Languages",
    experience: "Experience",
    field: "Field",
    jobTitle: "Role title",
    company: "Company"
  };
  var PROFILE_FIELD_ORDER = [
    "displayName",
    "jobTitle",
    "company",
    "field",
    "experience",
    "goals",
    "languages",
    "bio"
  ];
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) node.append(child);
    return node;
  }
  function profileValue(profile, field) {
    const raw = profile[field];
    if (raw === void 0 || raw === null) return "";
    if (Array.isArray(raw)) return raw.map(String).join(", ");
    return String(raw);
  }
  function participantCard(title, profile, basisNote) {
    const list = el("dl", { class: "profile-fields" });
    for (const field of PROFILE_FIELD_ORDER) {
      const value = profileValue(profile, field);
      if (!value) continue;
      list.append(
        el("dt", { text: PROFILE_FIELD_LABELS[field] ?? field }),
        el("dd", { text: value })
      );
    }
    return el(
      "section",
      { class: "card participant", "aria-label": title },
      el("h3", { text: title }),
      el("p", { class: "basis-note", text: basisNote }),
      list
    );
  }
  function noteTag(sourceType, shareability) {
    const label = `${SOURCE_TYPE_LABELS[sourceType] ?? sourceType} \xB7 ${shareability === "shared" ? "shareable (fixture contract)" : "private \u2014 never exported"}`;
    return el("span", {
      class: shareability === "shared" ? "tag tag-shared" : "tag tag-private",
      text: label
    });
  }
  function agendaItem(state2, itemId, actions2) {
    const item = state2.agenda.find((i) => i.id === itemId);
    const statusClass = item.status === "agreed" ? "status-agreed" : item.status === "set-aside" ? "status-aside" : "status-proposed";
    const card = el("li", { class: "card agenda-item", "data-item-id": item.id });
    card.append(
      el(
        "div",
        { class: "agenda-head" },
        el("h3", { text: item.title }),
        el("span", { class: `status ${statusClass}`, text: statusLabel(item.status) })
      )
    );
    const actionsBox = el("div", { class: "agenda-actions", role: "group", "aria-label": `Agreement actions for ${item.title}` });
    if (item.status === "proposed") {
      actionsBox.append(
        el("button", {
          type: "button",
          "data-action": "agree",
          "data-focus-key": `agree-${item.id}`,
          text: "I agree to bring this up"
        }),
        el("button", {
          type: "button",
          class: "secondary",
          "data-action": "set-aside",
          "data-focus-key": `aside-${item.id}`,
          text: "Set aside for now"
        })
      );
    } else if (item.status === "agreed") {
      actionsBox.append(
        el("button", {
          type: "button",
          class: "secondary",
          "data-action": "set-aside",
          "data-focus-key": `aside-${item.id}`,
          text: "Set aside for now"
        })
      );
    } else {
      actionsBox.append(
        el("button", {
          type: "button",
          class: "secondary",
          "data-action": "propose-again",
          "data-focus-key": `propose-${item.id}`,
          text: "Propose again"
        })
      );
    }
    for (const button of Array.from(actionsBox.querySelectorAll("button"))) {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-action");
        if (action === "agree") actions2.agree(item.id);
        else if (action === "set-aside") actions2.setAside(item.id);
        else if (action === "propose-again") actions2.proposeAgain(item.id);
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
  function currentPreview(state2) {
    const doc = buildPreparationDocument(state2, { generatedAt: state2.meeting.scheduledAt });
    return serializePreparationDocument(doc);
  }
  function renderApp(root2, state2, actions2, focusKey, lastSave2) {
    root2.replaceChildren();
    const header = el(
      "header",
      { class: "app-header" },
      el("h1", { text: `Meeting preparation \u2014 ${state2.meeting.title}` }),
      el("p", {
        class: "muted",
        text: "Offline workspace. Nothing here connects to a network; saving writes a local file only."
      })
    );
    const participants = el(
      "div",
      { class: "participants" },
      participantCard(
        "You",
        state2.me,
        "Shown from your own profile (self)."
      ),
      participantCard(
        `${state2.peer.displayName} (other participant)`,
        state2.peer,
        `Shown only from what the meeting fixture marks shareable (${state2.peerBasis}). Sensitive details are never projected.`
      )
    );
    const agendaList = el("ul", { class: "agenda-list", "aria-label": "Proposed agenda" });
    for (const item of state2.agenda) {
      agendaList.append(agendaItem(state2, item.id, actions2));
    }
    const agendaSection = el(
      "section",
      { class: "panel" },
      el("h2", { text: "Agenda" }),
      el("p", {
        class: "muted",
        text: "These topics are proposals. Agreement is recorded only when you press the agreement button \u2014 nothing is inferred."
      }),
      agendaList
    );
    const noteItemSelect = el("select", { id: "note-item-select", "data-focus-key": "note-item-select" });
    for (const item of state2.agenda) {
      noteItemSelect.append(el("option", { value: item.id, text: item.title }));
    }
    const noteSubjectSelf = el("input", { type: "radio", name: "note-subject", id: "note-subject-self", value: "self", "data-focus-key": "note-subject-self" });
    noteSubjectSelf.checked = true;
    const noteSubjectPeer = el("input", { type: "radio", name: "note-subject", id: "note-subject-peer", value: "peer", "data-focus-key": "note-subject-peer" });
    const noteInput = el("input", { type: "text", id: "note-text-input", "data-focus-key": "note-text-input", autocomplete: "off", placeholder: "Write a private note\u2026", "aria-describedby": "note-privacy-hint" });
    const noteForm = el(
      "form",
      { class: "note-form", "aria-label": "Add a private note" },
      el(
        "div",
        { class: "field-row" },
        el("label", { for: "note-item-select", text: "Topic" }),
        noteItemSelect
      ),
      el(
        "fieldset",
        { class: "field-row" },
        el("legend", { text: "Note about" }),
        el("label", { for: "note-subject-self", text: "Myself" }),
        noteSubjectSelf,
        el("label", { for: "note-subject-peer", text: state2.peer.displayName }),
        noteSubjectPeer
      ),
      el(
        "div",
        { class: "field-row" },
        el("label", { for: "note-text-input", text: "Note" }),
        noteInput
      ),
      el("button", { type: "submit", "data-focus-key": "note-submit", text: "Add private note" }),
      el("p", {
        id: "note-privacy-hint",
        class: "muted",
        text: "Notes you write here are private to this workspace and never appear in a saved document. Which fixture notes are shareable is decided by the fixture contract, not by this UI."
      })
    );
    noteForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = noteInput.value;
      if (!text.trim()) return;
      const subject = noteSubjectPeer.checked ? "peer" : "self";
      actions2.addNote(noteItemSelect.value, text, subject);
    });
    const questionInput = el("input", { type: "text", id: "question-input", "data-focus-key": "question-input", autocomplete: "off", placeholder: "What do you want to find out on the call?", "aria-label": "Open question" });
    const questionForm = el(
      "form",
      { class: "question-form", "aria-label": "Record an open question" },
      questionInput,
      el("button", { type: "submit", "data-focus-key": "question-submit", text: "Record open question" })
    );
    questionForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = questionInput.value;
      if (!text.trim()) return;
      actions2.addQuestion(text);
    });
    const questionList = el("ul", { class: "question-list", "aria-label": "Open questions" });
    for (const question of state2.openQuestions) {
      questionList.append(
        el(
          "li",
          { class: "question" },
          el("span", { class: question.status === "parked" ? "question-text parked" : "question-text", text: question.text }),
          el("span", { class: "tag", text: question.status === "parked" ? "parked" : "open" }),
          el("button", {
            type: "button",
            class: "secondary",
            "data-action": "park",
            "data-question-id": question.id,
            "data-focus-key": `park-${question.id}`,
            text: "Park"
          })
        )
      );
    }
    if (state2.openQuestions.length === 0) {
      questionList.append(el("li", { class: "muted", text: "No open questions recorded yet." }));
    }
    for (const question of state2.openQuestions) {
      const parkButton = questionList.querySelector(`[data-question-id="${question.id}"]`);
      if (parkButton) {
        parkButton.disabled = question.status === "parked";
        parkButton.addEventListener("click", () => actions2.parkQuestion(question.id));
      }
    }
    const saveButton = el("button", { type: "button", id: "save-doc", "data-focus-key": "save-doc", text: "Save preparation document locally" });
    saveButton.addEventListener("click", () => actions2.saveDocument());
    const saveConfirmation = el("div", {
      id: "save-confirmation",
      class: "save-confirmation",
      role: "status",
      "aria-live": "polite",
      text: lastSave2 ? `Saved ${lastSave2.fileName} locally \u2014 included ${lastSave2.shareableNotes} shareable note(s), excluded ${lastSave2.privateNotesExcluded} private note(s), ${lastSave2.openQuestions} open question(s).` : "Nothing saved yet. Saving writes a local JSON file: shareable fixture notes are included, private notes are excluded and counted."
    });
    const documentSection = el(
      "section",
      { class: "panel" },
      el("h2", { text: "Preparation document" }),
      el("p", { class: "disclaimer", text: `The saved document starts with this disclaimer: \u201C${DISCLAIMER_TEXT}\u201D` }),
      saveButton,
      saveConfirmation,
      el(
        "details",
        { class: "preview" },
        el("summary", { text: "Preview of the document as it would be saved now" }),
        el("pre", { class: "doc-preview", text: currentPreview(state2) })
      )
    );
    const footer = el(
      "footer",
      { class: "app-footer" },
      el("p", {
        class: "muted",
        text: "Offline workspace built on synthetic fixtures. It never sends messages, requests meetings, or contacts anyone."
      })
    );
    root2.append(
      el(
        "div",
        { class: "container" },
        header,
        el(
          "main",
          {},
          el(
            "section",
            { class: "panel", "aria-label": "Participants" },
            el("h2", { text: "Participants" }),
            participants
          ),
          agendaSection,
          el(
            "section",
            { class: "panel", "aria-label": "Private notes" },
            el("h2", { text: "Private notes" }),
            noteForm
          ),
          el(
            "section",
            { class: "panel", "aria-label": "Open questions" },
            el("h2", { text: "Open questions" }),
            questionForm,
            questionList
          ),
          documentSection
        ),
        footer
      )
    );
    if (focusKey) {
      const target = root2.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
      target?.focus();
    }
  }

  // src/index.ts
  var meeting = SYNTHETIC_MEETINGS[0];
  var meInternal = INTERNAL_PROFILES.find((p) => p.userId === VIEWER_ID);
  var peerInternal = INTERNAL_PROFILES.find((p) => p.userId === PEER_ID);
  var meProjection = projectProfile(meInternal, { viewerId: VIEWER_ID, basis: "self" });
  var peerProjection = projectProfile(peerInternal, { viewerId: VIEWER_ID, basis: "shared-meeting" });
  if (!meProjection.ok || !peerProjection.ok) {
    throw new Error("fixture binding invariant violated: projections must be visible");
  }
  var state = createWorkspace({
    meeting,
    me: meProjection.profile,
    peer: peerProjection.profile,
    peerBasis: "shared-meeting",
    peerRole: "participant",
    initialAgenda: INITIAL_AGENDA
  });
  var root = document.querySelector("#app");
  if (!root) throw new Error("#app root element missing");
  var rootEl = root;
  var lastSave = null;
  function focusKeyBeforeRender() {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      const key = active.getAttribute("data-focus-key");
      if (key) return key;
    }
    return null;
  }
  function rerender() {
    const key = focusKeyBeforeRender();
    renderApp(rootEl, state, actions, key, lastSave);
  }
  function saveDocument() {
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
      fileName
    };
    rerender();
  }
  var actions = {
    agree: (itemId) => {
      state = agreeAgendaItem(state, itemId);
      rerender();
    },
    setAside: (itemId) => {
      state = setAsideAgendaItem(state, itemId);
      rerender();
    },
    proposeAgain: (itemId) => {
      state = proposeAgain(state, itemId);
      rerender();
    },
    addNote: (itemId, text, subject) => {
      state = addNote(state, itemId, text, subject);
      rerender();
    },
    addQuestion: (text) => {
      state = recordOpenQuestion(state, text);
      rerender();
    },
    parkQuestion: (questionId) => {
      state = parkOpenQuestion(state, questionId);
      rerender();
    },
    saveDocument
  };
  rerender();
})();
