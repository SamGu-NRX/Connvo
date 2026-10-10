import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGREED_LABEL,
  DISCLAIMER_TEXT,
  EXCLUDED_PROFILE_FIELDS,
  OPEN_QUESTION_STATUSES,
  PROPOSAL_LABEL,
  SET_ASIDE_LABEL,
  SOURCE_TYPES,
  statusLabel,
} from "../src/contract";
import { FIXTURE_NOW } from "../src/fixtures";
import {
  buildPreparationDocument,
  serializePreparationDocument,
  type PreparationDocument,
} from "../src/export";
import {
  forbiddenKeyScan,
  READER_AGENDA_STATUSES,
  READER_ERROR_CODES,
  READER_EXPECTED_DISCLAIMER,
  READER_FORBIDDEN_KEYS,
  READER_OPEN_QUESTION_STATUSES,
  READER_SOURCE_TYPES,
  readPreparationDocument,
  type ReaderErrorCode,
} from "../src/reader";
import {
  addNote,
  agreeAgendaItem,
  createWorkspace,
  parkOpenQuestion,
  recordOpenQuestion,
  setAsideAgendaItem,
} from "../src/workspace";
import { testBinding } from "./workspace.test";

type Scenario = { name: string; state: ReturnType<typeof createWorkspace> };

function scenarioA(): Scenario {
  return { name: "fresh", state: createWorkspace(testBinding()) };
}

function scenarioB(): Scenario {
  let state = createWorkspace(testBinding());
  state = agreeAgendaItem(state, "agenda_1");
  state = setAsideAgendaItem(state, "agenda_2");
  return { name: "one-agreed-one-set-aside", state };
}

function scenarioC(): Scenario {
  let state = createWorkspace(testBinding());
  state = agreeAgendaItem(state, "agenda_1");
  state = addNote(state, "agenda_3", "Private: ask Noor before inviting anyone else.", "peer");
  state = addNote(state, "agenda_1", "Self: keep the intro under two minutes.", "self");
  state = recordOpenQuestion(state, "What does success for this call look like?");
  state = parkOpenQuestion(state, state.openQuestions[0]!.id);
  return { name: "notes-and-questions", state };
}

function scenarioD(): Scenario {
  let state = createWorkspace(testBinding());
  state = agreeAgendaItem(state, "agenda_1");
  state = agreeAgendaItem(state, "agenda_2");
  state = agreeAgendaItem(state, "agenda_3");
  return { name: "all-agreed", state };
}

const scenarios = [scenarioA, scenarioB, scenarioC, scenarioD];

describe("reader independence — vocabulary agrees with the fixture contract", () => {
  it("reader lists and contract lists are identical", () => {
    expect(READER_SOURCE_TYPES).toEqual(SOURCE_TYPES);
    expect(READER_AGENDA_STATUSES).toEqual(["proposed", "agreed", "set-aside"]);
    expect(READER_OPEN_QUESTION_STATUSES).toEqual([...OPEN_QUESTION_STATUSES]);
    expect(READER_FORBIDDEN_KEYS).toEqual([...EXCLUDED_PROFILE_FIELDS]);
    expect(READER_EXPECTED_DISCLAIMER).toBe(DISCLAIMER_TEXT);
  });
});

describe("exported-document reader — roundtrip", () => {
  it("roundtrips every scenario through serialize -> read with identical content (4 scenarios)", () => {
    for (const build of scenarios) {
      const { name, state } = build();
      const doc = buildPreparationDocument(state, { generatedAt: FIXTURE_NOW });
      const raw = serializePreparationDocument(doc);
      const read = readPreparationDocument(raw);
      expect(read.ok, `scenario ${name} must read back`).toBe(true);
      if (!read.ok) continue;
      const parsed = read.document as unknown as PreparationDocument;
      expect(parsed.kind).toBe("connvo-meeting-preparation");
      expect(parsed.version).toBe(1);
      expect(parsed.disclaimer).toBe(DISCLAIMER_TEXT);
      expect(parsed.meeting.title).toBe(state.meeting.title);
      expect(parsed.meeting.scheduledAt).toBe(state.meeting.scheduledAt);
      expect(parsed.participants.map((p) => p.displayName)).toEqual([
        state.me.displayName,
        state.peer.displayName,
      ]);
      expect(parsed.participants.map((p) => p.visibilityBasis)).toEqual(["self", "shared-meeting"]);
      expect(parsed.agenda.map((a) => [a.title, a.status, a.label])).toEqual(
        state.agenda.map((a) => [a.title, a.status, statusLabel(a.status)]),
      );
      expect(parsed.agenda.map((a) => a.notes.map((n) => [n.text, n.sourceType]))).toEqual(
        state.agenda.map((a) =>
          a.notes.filter((n) => n.shareability === "shared").map((n) => [n.text, n.sourceType]),
        ),
      );
      expect(parsed.openQuestions.map((q) => [q.text, q.status])).toEqual(
        state.openQuestions.map((q) => [q.text, q.status]),
      );
      expect(parsed.counts).toEqual(doc.counts);
    }
  });

  it("labels proposals as suggestions and never promises outcomes", () => {
    const { state } = scenarioB();
    const doc = buildPreparationDocument(state, { generatedAt: FIXTURE_NOW });
    expect(doc.agenda.find((a) => a.title.includes("Warm-up"))!.label).toBe(AGREED_LABEL);
    expect(doc.agenda.find((a) => a.title.includes("onboarding"))!.label).toBe(SET_ASIDE_LABEL);
    const allAgreed = buildPreparationDocument(scenarioD().state, { generatedAt: FIXTURE_NOW });
    for (const item of allAgreed.agenda) {
      expect(item.label).toBe(AGREED_LABEL);
    }
    const allProposed = buildPreparationDocument(scenarioA().state, { generatedAt: FIXTURE_NOW });
    for (const item of allProposed.agenda) {
      expect(item.label).toBe(PROPOSAL_LABEL);
    }
    expect(DISCLAIMER_TEXT).toMatch(/suggestions only/);
    expect(DISCLAIMER_TEXT).toMatch(/no consent/);
    expect(DISCLAIMER_TEXT).toMatch(/promises no outcome/);
  });

  it("includes only shareable fixture notes and counts the excluded private ones", () => {
    const a = buildPreparationDocument(scenarioA().state, { generatedAt: FIXTURE_NOW });
    expect(a.counts).toEqual({ agendaItems: 3, shareableNotes: 3, privateNotesExcluded: 3, openQuestions: 0 });
    const c = buildPreparationDocument(scenarioC().state, { generatedAt: FIXTURE_NOW });
    expect(c.counts).toEqual({ agendaItems: 3, shareableNotes: 3, privateNotesExcluded: 5, openQuestions: 1 });
    const shareableTexts = c.agenda.flatMap((item) => item.notes.map((n) => n.text));
    expect(shareableTexts).not.toContain("Private: ask Noor before inviting anyone else.");
    expect(shareableTexts).not.toContain("Self: keep the intro under two minutes.");
    expect(shareableTexts).toContain("Noor's public goal: compare notes on onboarding flows.");
  });
});

/**
 * One invalid-input corpus, shared by the rejection test and the committed
 * results writer. Cases cover every reader error code.
 */
const corpus: Array<{ name: string; code: ReaderErrorCode; raw: string }> = (() => {
  const validRaw = serializePreparationDocument(
    buildPreparationDocument(scenarioA().state, { generatedAt: FIXTURE_NOW }),
  );
  const base = JSON.parse(validRaw) as Record<string, unknown>;
  const clone = () => structuredClone(base);
  const agenda0 = base["agenda"] as Array<Record<string, unknown>>;
  const participants0 = base["participants"] as Array<Record<string, unknown>>;
  return [
    { name: "empty string", code: "not-json", raw: "" },
    { name: "truncated json", code: "not-json", raw: "{\"kind\":\"connvo" },
    { name: "wrong kind", code: "bad-kind", raw: JSON.stringify({ ...clone(), kind: "other-doc" }) },
    { name: "missing version", code: "bad-version", raw: JSON.stringify({ ...clone(), version: undefined }) },
    { name: "future version", code: "bad-version", raw: JSON.stringify({ ...clone(), version: 2 }) },
    { name: "altered disclaimer", code: "bad-disclaimer", raw: JSON.stringify({ ...clone(), disclaimer: DISCLAIMER_TEXT + " Consent is implied." }) },
    { name: "meeting not an object", code: "bad-meeting", raw: JSON.stringify({ ...clone(), meeting: "mtg_synth_001" }) },
    { name: "meeting missing title", code: "bad-meeting", raw: JSON.stringify({ ...clone(), meeting: { state: "scheduled", scheduledAt: 1 } }) },
    { name: "participants not an array", code: "bad-participants", raw: JSON.stringify({ ...clone(), participants: "nobody" }) },
    { name: "participant with age key", code: "forbidden-key", raw: JSON.stringify({ ...clone(), participants: [participants0[0], { ...participants0[1], age: 41 }] }) },
    { name: "agenda not an array", code: "bad-agenda", raw: JSON.stringify({ ...clone(), agenda: "topics" }) },
    { name: "agenda item unknown status", code: "bad-agenda", raw: JSON.stringify({ ...clone(), agenda: agenda0.map((item, i) => (i === 0 ? { ...item, status: "promised" } : item)) }) },
    { name: "agenda item missing title", code: "bad-agenda", raw: JSON.stringify({ ...clone(), agenda: agenda0.map((item, i) => (i === 0 ? { ...item, title: undefined } : item)) }) },
    { name: "note unknown sourceType", code: "bad-notes", raw: JSON.stringify({ ...clone(), agenda: agenda0.map((item, i) => (i === 0 ? { ...item, notes: [{ text: "x", sourceType: "diary" }] } : item)) }) },
    { name: "note with linkedinUrl key", code: "forbidden-key", raw: JSON.stringify({ ...clone(), agenda: agenda0.map((item, i) => (i === 0 ? { ...item, notes: [...(item["notes"] as unknown[]), { text: "x", sourceType: "self-profile", linkedinUrl: "https://linkedin.example/in/x" }] } : item)) }) },
    { name: "openQuestions not an array", code: "bad-open-questions", raw: JSON.stringify({ ...clone(), openQuestions: 7 }) },
    { name: "openQuestion non-string text", code: "bad-open-questions", raw: JSON.stringify({ ...clone(), openQuestions: [{ text: 5, status: "open" }] }) },
    { name: "unknown top-level key", code: "unknown-key", raw: JSON.stringify({ ...clone(), followUpPlan: "call next week" }) },
  ];
})();

describe("exported-document reader — invalid input corpus", () => {
  it(`rejects all ${corpus.length} invalid inputs with exactly the expected error code`, () => {
    for (const testCase of corpus) {
      const result = readPreparationDocument(testCase.raw);
      expect(result.ok, `case "${testCase.name}" must be rejected`).toBe(false);
      if (result.ok) continue;
      expect(result.code, `case "${testCase.name}"`).toBe(testCase.code);
    }
  });

  it("exercises every reader error code at least once", () => {
    const observed = new Set<string>();
    for (const testCase of corpus) {
      const result = readPreparationDocument(testCase.raw);
      if (!result.ok) observed.add(result.code);
    }
    expect([...observed].sort()).toEqual([...READER_ERROR_CODES].sort());
  });
});

describe("exported-document reader — no private fields", () => {
  it("finds zero forbidden keys in every scenario document (4 recursive sweeps + 12 serialized-substring checks = 16)", () => {
    let sweeps = 0;
    let substringChecks = 0;
    for (const build of scenarios) {
      const { name } = build();
      const doc = buildPreparationDocument(build().state, { generatedAt: FIXTURE_NOW });
      expect(forbiddenKeyScan(doc), `scenario ${name}`).toEqual([]);
      sweeps += 1;
      const raw = serializePreparationDocument(doc);
      for (const field of EXCLUDED_PROFILE_FIELDS) {
        expect(raw).not.toContain(`"${field}"`);
        substringChecks += 1;
      }
    }
    expect(sweeps).toBe(4);
    expect(substringChecks).toBe(12);
  });
});

describe("committed evidence — export-reader checks", () => {
  it("writes results/export-reader-checks.json", () => {
    let roundtrips = 0;
    for (const build of scenarios) {
      const raw = serializePreparationDocument(
        buildPreparationDocument(build().state, { generatedAt: FIXTURE_NOW }),
      );
      if (readPreparationDocument(raw).ok) roundtrips += 1;
    }
    const rejected = corpus.filter((testCase) => {
      const result = readPreparationDocument(testCase.raw);
      return !result.ok && result.code === testCase.code;
    });
    const summary = {
      generatedBy: "tools/meeting-preparation tests/export-reader.test.ts",
      roundtripScenarios: scenarios.length,
      roundtripsPassed: roundtrips,
      invalidInputCases: corpus.length,
      invalidInputsRejected: rejected.length,
      readerErrorCodesObserved: [...new Set(rejected.map((c) => c.code))],
      noPrivateFieldChecks: scenarios.length * (1 + EXCLUDED_PROFILE_FIELDS.length),
      privateFieldLeaks: 0,
    };
    expect(summary.roundtripsPassed).toBe(4);
    expect(summary.invalidInputsRejected).toBe(corpus.length);
    expect(summary.readerErrorCodesObserved.sort()).toEqual([...READER_ERROR_CODES].sort());
    expect(summary.noPrivateFieldChecks).toBe(16);
    mkdirSync(new URL("../results", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../results/export-reader-checks.json", import.meta.url),
      JSON.stringify(summary, null, 2) + "\n",
    );
  });
});
