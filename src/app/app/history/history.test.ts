/**
 * Client-side tests for the history slice (frontend project, jsdom).
 * The backend boundary regression lives in test/convex/history/historyBoundary.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  createFixtureHistoryTransport,
  FIXTURE_IDS,
  FIXTURE_MALICIOUS_NOTES,
  FIXTURE_QUERY_FLAG,
} from "./fixtureTransport";
import { createRequestGate } from "./requestGate";
import {
  buildListSearchParams,
  DEFAULT_LIST_QUERY,
  PAGE_SIZE,
  parseListQuery,
  selectVisibleMeetings,
} from "./listQuery";
import { NotesSection, TranscriptSection } from "./components";
import type { HistoryMeetingListItem } from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function listItem(partial: Partial<HistoryMeetingListItem>): HistoryMeetingListItem {
  return {
    meetingId: "m",
    title: "Meeting",
    state: "concluded",
    createdAt: 1,
    updatedAt: 1,
    userRole: "participant",
    userPresence: "joined",
    ...partial,
  };
}

describe("history transport fixture boundary", () => {
  it("lists only the viewer's own meetings for the requested state", async () => {
    const transport = createFixtureHistoryTransport({ listLatencyMs: 0, detailLatencyMs: 0 });
    const result = await transport.listMeetings({ state: "concluded" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.data.map((m) => m.meetingId);
    expect(ids).toContain(FIXTURE_IDS.withNotes);
    expect(ids).not.toContain(FIXTURE_IDS.otherUser);
    expect(ids).not.toContain(FIXTURE_IDS.removed);
    expect(result.data.every((m) => m.state === "concluded")).toBe(true);
  });

  it("refuses other-user, removed, and unknown meetings with ONE uniform outcome", async () => {
    const transport = createFixtureHistoryTransport({ listLatencyMs: 0, detailLatencyMs: 0 });
    for (const id of [FIXTURE_IDS.otherUser, FIXTURE_IDS.removed, "fixture-meeting-does-not-exist"]) {
      const result = await transport.getMeeting(id);
      expect(result).toEqual({ ok: false, error: { kind: "unavailable" } });
    }
  });

  it("recovers after a one-shot list failure", async () => {
    const transport = createFixtureHistoryTransport({ listLatencyMs: 0, detailLatencyMs: 0, failListOnce: true });
    const first = await transport.listMeetings({});
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error).toEqual({ kind: "recoverable", message: "fixture-list-failure" });
    const second = await transport.listMeetings({});
    expect(second.ok).toBe(true);
  });

  it("advances the notes version between reads (version-bump scenario)", async () => {
    const transport = createFixtureHistoryTransport({ listLatencyMs: 0, detailLatencyMs: 0 });
    const first = await transport.getMeeting(FIXTURE_IDS.versionBump);
    const second = await transport.getMeeting(FIXTURE_IDS.versionBump);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.data.notes?.version).toBe(3);
    expect(second.data.notes?.version).toBe(4);
  });
});

describe("request gate (stale-response guard)", () => {
  it("only lets the newest request land", () => {
    const gate = createRequestGate();
    const first = gate.next();
    expect(gate.isCurrent(first)).toBe(true);
    const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });
});

describe("history list selection and URL params", () => {
  const items: HistoryMeetingListItem[] = [
    listItem({ meetingId: "a", title: "Rust study group", createdAt: 3 }),
    listItem({ meetingId: "b", title: "Portfolio review", description: "rust adjacent", createdAt: 2, state: "active" }),
    listItem({ meetingId: "c", title: "RUST cleanup", createdAt: 1 }),
    ...Array.from({ length: 20 }, (_, i) => listItem({ meetingId: "filler-" + i, title: "Filler " + i, createdAt: i })),
  ];

  it("filters by state and searches titles and descriptions case-insensitively", () => {
    const concluded = selectVisibleMeetings(items, { q: "", state: "concluded", page: 1 });
    expect(concluded.totalMatches).toBe(items.filter((m) => m.state === "concluded").length);
    const rust = selectVisibleMeetings(items, { q: "rust", state: "all", page: 1 });
    expect(rust.items.map((m) => m.meetingId).sort()).toEqual(["a", "b", "c"]);
  });

  it("paginates with a clamped page number", () => {
    const all = selectVisibleMeetings(items, { q: "", state: "all", page: 1 });
    expect(all.totalPages).toBe(Math.ceil(items.length / PAGE_SIZE));
    expect(all.items).toHaveLength(PAGE_SIZE);
    const beyond = selectVisibleMeetings(items, { q: "", state: "all", page: 999 });
    expect(beyond.page).toBe(all.totalPages);
    expect(beyond.items.length).toBeGreaterThan(0);
  });

  it("round-trips URL params and falls back to defaults", () => {
    expect(parseListQuery(new URLSearchParams("q=abc&state=all&page=3"))).toEqual({ q: "abc", state: "all", page: 3 });
    expect(parseListQuery(new URLSearchParams())).toEqual(DEFAULT_LIST_QUERY);
    expect(parseListQuery(new URLSearchParams("state=bogus&page=0")).state).toBe(DEFAULT_LIST_QUERY.state);
    expect(parseListQuery(new URLSearchParams("page=-4")).page).toBe(1);
    expect(buildListSearchParams({ q: "", state: "concluded", page: 1 }).toString()).toBe("");
    expect(buildListSearchParams({ q: "hi", state: "all", page: 2 }).toString()).toBe("q=hi&state=all&page=2");
  });
});

describe("untrusted meeting content renders inert", () => {
  it("renders hostile notes and transcript text as plain text nodes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          createElement(
            "div",
            null,
            createElement(NotesSection, {
              state: "ready",
              notes: { content: FIXTURE_MALICIOUS_NOTES, version: 1, updatedAt: 1 },
            }),
            createElement(TranscriptSection, {
              state: "ready",
              segments: [
                {
                  id: "s1",
                  startMs: 0,
                  endMs: 1000,
                  speakers: ['<script>alert("speaker")</script>'],
                  text: '<iframe src="https://fixture-evil.example"></iframe>',
                  topics: [],
                },
              ],
            }),
          ),
        );
      });
      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("iframe")).toBeNull();
      expect(container.textContent).toContain("<script>window.__fixturePwned = true</script>");
      expect(container.textContent).toContain("<img src=x");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

describe("no-global-scan discovery guard (source-level)", () => {
  const sliceDir = join(process.cwd(), "src", "app", "app", "history");
  const files = [
    "types.ts",
    "historyTransport.ts",
    "fixtureTransport.ts",
    "requestGate.ts",
    "listQuery.ts",
    "format.ts",
    "components.tsx",
    "useHistoryTransport.tsx",
    "page.tsx",
    join("[meetingId]", "page.tsx"),
  ];

  it("the client references only the permitted participant-scoped reads", () => {
    const transportSource = readFileSync(join(sliceDir, "historyTransport.ts"), "utf8");
    expect(transportSource).toContain("api.meetings.queries.listUserMeetings");
    expect(transportSource).toContain("api.meetings.queries.getMeeting");
    expect(transportSource).toContain("api.notes.queries.getMeetingNotes");
    expect(transportSource).toContain("api.transcripts.queries.getTranscriptSegments");
  });

  it("no slice file global-scans meetings or invents discovery", () => {
    for (const file of files) {
      const source = readFileSync(join(sliceDir, file), "utf8");
      expect(source, file).not.toMatch(/getActiveMeetings/);
      expect(source, file).not.toMatch(/ctx\.db\.query\(/);
      expect(source, file).not.toMatch(/\bfetch\(/);
      expect(source, file).not.toMatch(/XMLHttpRequest/);
    }
  });

  it("the fixture is always labeled as synthetic", () => {
    const pageSource = readFileSync(join(sliceDir, "page.tsx"), "utf8");
    expect(pageSource).toContain("Local fixture transport");
    const fixtureSource = readFileSync(join(sliceDir, "fixtureTransport.ts"), "utf8");
    expect(fixtureSource).toContain("LOCAL TRANSPORT FIXTURE");
    expect(pageSource).toContain(FIXTURE_QUERY_FLAG);
  });
});
