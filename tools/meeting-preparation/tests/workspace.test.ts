import { describe, expect, it } from "vitest";
import {
  AGREED_LABEL,
  PROPOSAL_LABEL,
  SET_ASIDE_LABEL,
  statusLabel,
} from "../src/contract";
import {
  INITIAL_AGENDA,
  INTERNAL_PROFILES,
  PEER_ID,
  SYNTHETIC_MEETINGS,
  VIEWER_ID,
} from "../src/fixtures";
import { projectProfile } from "../src/projection";
import {
  addNote,
  agreeAgendaItem,
  createWorkspace,
  parkOpenQuestion,
  proposeAgain,
  recordOpenQuestion,
  setAsideAgendaItem,
  type MeetingBinding,
  type WorkspaceState,
} from "../src/workspace";

export function testBinding(): MeetingBinding {
  const meeting = SYNTHETIC_MEETINGS[0]!;
  const meInternal = INTERNAL_PROFILES.find((p) => p.userId === VIEWER_ID)!;
  const peerInternal = INTERNAL_PROFILES.find((p) => p.userId === PEER_ID)!;
  const me = projectProfile(meInternal, { viewerId: VIEWER_ID, basis: "self" });
  const peer = projectProfile(peerInternal, { viewerId: VIEWER_ID, basis: "shared-meeting" });
  if (!me.ok || !peer.ok) throw new Error("fixture binding invariant violated");
  return {
    meeting,
    me: me.profile,
    peer: peer.profile,
    peerBasis: "shared-meeting",
    peerRole: "participant",
    initialAgenda: INITIAL_AGENDA,
  };
}

function fresh(): WorkspaceState {
  return createWorkspace(testBinding());
}

describe("workspace — agenda agreement is explicit", () => {
  it("starts with zero agreed items: proposals are suggestions only", () => {
    const state = fresh();
    expect(state.agenda.every((item) => item.status === "proposed")).toBe(true);
    expect(state.agenda.filter((item) => item.status === "agreed")).toHaveLength(0);
  });

  it("agrees an item only via agreeAgendaItem, with the explicit agreed label", () => {
    const state = agreeAgendaItem(fresh(), "agenda_1");
    const item = state.agenda.find((i) => i.id === "agenda_1")!;
    expect(item.status).toBe("agreed");
    expect(statusLabel(item.status)).toBe(AGREED_LABEL);
    expect(statusLabel("proposed")).toBe(PROPOSAL_LABEL);
    expect(statusLabel("set-aside")).toBe(SET_ASIDE_LABEL);
  });

  it("supports the full explicit cycle proposed -> agreed -> set-aside -> proposed", () => {
    let state = fresh();
    state = agreeAgendaItem(state, "agenda_2");
    state = setAsideAgendaItem(state, "agenda_2");
    state = proposeAgain(state, "agenda_2");
    expect(state.agenda.find((i) => i.id === "agenda_2")!.status).toBe("proposed");
  });

  it("leaves the previous state untouched (pure updates)", () => {
    const before = fresh();
    const after = agreeAgendaItem(before, "agenda_1");
    expect(before.agenda.find((i) => i.id === "agenda_1")!.status).toBe("proposed");
    expect(after.agenda.find((i) => i.id === "agenda_1")!.status).toBe("agreed");
    expect(before).not.toBe(after);
  });

  it("throws on unknown agenda item ids", () => {
    expect(() => agreeAgendaItem(fresh(), "agenda_missing")).toThrow(/unknown agenda item/);
  });
});

describe("workspace — notes about the other participant stay private", () => {
  it("creates every workspace note as private, including notes about the peer", () => {
    let state = fresh();
    state = addNote(state, "agenda_1", "Self reminder: bring the flow diagrams.", "self");
    state = addNote(state, "agenda_2", "Ask Noor directly about availability.", "peer");
    for (const item of state.agenda) {
      for (const note of item.notes) {
        if (note.id.startsWith("note_w")) {
          expect(note.shareability).toBe("private");
          expect(note.sourceType).toBe("participant-note");
        }
      }
    }
  });

  it("never gains the ability to flip shareability: no exported API returns a shared note", async () => {
    const workspace = await import("../src/workspace");
    let state = addNote(fresh(), "agenda_3", "Private: Noor's timezone changed.", "peer");
    // Drive every public mutation; no sequence may produce a shared note.
    for (let i = 1; i <= 3; i += 1) {
      state = agreeAgendaItem(state, `agenda_${i}`);
      state = setAsideAgendaItem(state, `agenda_${i}`);
      state = proposeAgain(state, `agenda_${i}`);
      state = addNote(state, `agenda_${i}`, `Private ${i}.`, "peer");
      state = recordOpenQuestion(state, `Question ${i}?`);
      state = parkOpenQuestion(state, state.openQuestions[state.openQuestions.length - 1]!.id);
    }
    const allNotes = state.agenda.flatMap((item) => item.notes);
    expect(allNotes.filter((n) => n.shareability === "shared").length).toBe(3); // fixture notes only
    expect(allNotes.every((n) => n.id.startsWith("note_w") ? n.shareability === "private" : true)).toBe(true);
    // The module's exported API surface offers no shareability mutation.
    expect(Object.keys(workspace).sort()).toEqual([
      "addNote",
      "agreeAgendaItem",
      "createWorkspace",
      "parkOpenQuestion",
      "proposeAgain",
      "recordOpenQuestion",
      "setAsideAgendaItem",
    ]);
  });

  it("rejects empty note and question text", () => {
    expect(() => addNote(fresh(), "agenda_1", "   ", "self")).toThrow(/must not be empty/);
    expect(() => recordOpenQuestion(fresh(), "")).toThrow(/must not be empty/);
  });
});

describe("workspace — open questions", () => {
  it("records and parks open questions raised by the viewer", () => {
    let state = recordOpenQuestion(fresh(), "What does success for this call look like?");
    expect(state.openQuestions).toHaveLength(1);
    expect(state.openQuestions[0]!.status).toBe("open");
    expect(state.openQuestions[0]!.raisedBy).toBe("viewer");
    state = parkOpenQuestion(state, state.openQuestions[0]!.id);
    expect(state.openQuestions[0]!.status).toBe("parked");
  });

  it("throws on parking an unknown question", () => {
    expect(() => parkOpenQuestion(fresh(), "q_missing")).toThrow(/unknown open question/);
  });
});
