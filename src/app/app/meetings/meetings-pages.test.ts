// @vitest-environment node
/**
 * Mounted proofs for the flagged after-call meetings routes.
 *
 * The real page components are rendered with react-dom/server while the
 * Convex data layer is mocked at the module boundary — the repo has no
 * jsdom, and these proofs only need static markup. Flag gating runs the
 * real isAfterCallEnabled() against process.env, so flag-on/flag-off is
 * exercised end to end.
 */

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { historyQueries } from "@/lib/history/api";

const mocks = vi.hoisted(() => ({
  listPayload: null as unknown,
  queryDispatch: ((query: unknown) => undefined) as (query: unknown) => unknown,
  params: { id: "j57fixturemeeting" },
}));

vi.mock("convex/react", () => ({
  usePaginatedQuery: () => mocks.listPayload,
  useQuery: (query: unknown) => mocks.queryDispatch(query),
  useMutation: () => async () => undefined,
}));

vi.mock("next/link", () => ({
  default: (props: { href: string; children?: ReactNode }) =>
    createElement("a", { href: props.href }, props.children),
}));

vi.mock("next/navigation", () => ({
  useParams: () => mocks.params,
}));

vi.mock("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));

const FLAG = "NEXT_PUBLIC_CONNVO_AFTER_CALL";

beforeEach(() => {
  delete process.env[FLAG];
  mocks.listPayload = null;
  mocks.queryDispatch = () => undefined;
});

afterEach(() => {
  delete process.env[FLAG];
});

function listItem(id: string, title: string) {
  return {
    meeting: {
      _id: id,
      title,
      state: "concluded",
      scheduledAt: 1780000000000,
      duration: 1800000,
      createdAt: 1779900000000,
    },
    role: "host",
    startedAt: 1780000000000,
    endedAt: 1780001800000,
  };
}

function historyFixture() {
  return {
    meeting: {
      _id: "j57fixturemeeting",
      organizerId: "j57host",
      title: "Weekly sync",
      description: "Talk about the roadmap",
      scheduledAt: 1780000000000,
      duration: 1800000,
      state: "concluded",
      createdAt: 1779900000000,
      updatedAt: 1780001000000,
    },
    myRole: "host",
    participants: [
      {
        userId: "j57u1",
        displayName: "Dana Kim",
        role: "host",
        presence: "left",
        joinedAt: 1,
        leftAt: 2,
      },
      {
        userId: "j57u2",
        displayName: null,
        role: "participant",
        presence: "joined",
        joinedAt: 1,
        leftAt: null,
      },
    ],
    state: {
      meetingId: "j57fixturemeeting",
      active: false,
      startedAt: 1780000000000,
      endedAt: 1780001800000,
      topics: [],
      recordingEnabled: false,
      updatedAt: 1780001000000,
    },
    lifecycleEvents: [
      {
        _id: "e1",
        meetingId: "j57fixturemeeting",
        event: "call.started",
        userId: "j57u1",
        success: true,
        metadata: {},
        timestamp: 1780000000500,
        createdAt: 1780000000500,
      },
      {
        _id: "e2",
        meetingId: "j57fixturemeeting",
        event: "recording.started",
        userId: "j57u1",
        success: true,
        metadata: {},
        timestamp: 1780000001000,
        createdAt: 1780000001000,
      },
    ],
    notes: {
      meetingId: "j57fixturemeeting",
      content: "Follow up on pricing",
      version: 3,
      lastRebasedAt: 0,
      updatedAt: 0,
    },
    prompts: [
      {
        _id: "p1",
        meetingId: "j57fixturemeeting",
        content: "Ask about goals",
        type: "precall",
        usedAt: 1780000002000,
        createdAt: 1,
      },
      {
        _id: "p2",
        meetingId: "j57fixturemeeting",
        content: "Share next steps",
        type: "incall",
        usedAt: null,
        createdAt: 2,
      },
    ],
  };
}

async function renderList(): Promise<string> {
  const { default: MeetingsPage } = await import("./page");
  return renderToStaticMarkup(createElement(MeetingsPage));
}

async function renderDetail(): Promise<string> {
  const { default: MeetingDetailPage } = await import("./[id]/page");
  return renderToStaticMarkup(createElement(MeetingDetailPage));
}

describe("flag-off invisibility (mounted)", () => {
  it("renders nothing for the meetings list route", async () => {
    expect(await renderList()).toBe("");
  });

  it("renders nothing for the meeting detail route", async () => {
    expect(await renderDetail()).toBe("");
  });
});

describe("flag-on list route (mounted)", () => {
  beforeEach(() => {
    process.env[FLAG] = "1";
  });

  it("renders the loading skeleton before the first page arrives", async () => {
    mocks.listPayload = {
      results: { page: [], isDone: false, continueCursor: null },
      status: "LoadingFirstPage",
      loadMore: () => undefined,
    };
    const html = await renderList();
    expect(html).toContain("meetings-loading");
    expect(html).toContain("Loading meetings");
  });

  it("renders the empty state when the caller has no meetings", async () => {
    mocks.listPayload = {
      results: { page: [], isDone: true, continueCursor: null },
      status: "Exhausted",
      loadMore: () => undefined,
    };
    const html = await renderList();
    expect(html).toContain("meetings-empty");
    expect(html).toContain("No meetings yet");
  });

  it("renders meeting items with titles, badges and links from the contract shape", async () => {
    mocks.listPayload = {
      results: {
        page: [listItem("j57aaa", "Weekly sync"), listItem("j57bbb", "Portfolio review")],
        isDone: true,
        continueCursor: null,
      },
      status: "Exhausted",
      loadMore: () => undefined,
    };
    const html = await renderList();
    expect(html).toContain("meeting-list");
    expect(html).toContain("Weekly sync");
    expect(html).toContain("Portfolio review");
    expect(html).toContain('href="/app/meetings/j57aaa"');
    expect(html).toContain('href="/app/meetings/j57bbb"');
    expect(html).toContain("concluded");
    expect(html).not.toContain("Load more");
  });
});

describe("flag-on detail route (mounted)", () => {
  beforeEach(() => {
    process.env[FLAG] = "1";
    mocks.queryDispatch = (query) =>
      query === historyQueries.getMeetingHistory
        ? historyFixture()
        : { enabled: false, mutual: false };
  });

  it("renders the loading skeleton while history resolves", async () => {
    mocks.queryDispatch = () => undefined;
    const html = await renderDetail();
    expect(html).toContain("meeting-detail-loading");
  });

  it("renders title, recap, calendar export and stay-in-touch from the history payload", async () => {
    const html = await renderDetail();
    expect(html).toContain("Weekly sync");
    expect(html).toContain("Joined as host");
    expect(html).toContain("meeting-recap");
    expect(html).toContain("Participants");
    expect(html).toContain("Dana Kim (host)");
    expect(html).toContain("j57u2 (participant)");
    expect(html).toContain("30 minutes");
    expect(html).toContain("Follow up on pricing (version 3)");
    expect(html).toContain("Ask about goals");
    expect(html).toContain("Share next steps");
    expect(html).toContain("download-ics");
    expect(html).toContain("stay-in-touch-switch");
  });

  it("hides calendar export for meetings without a scheduled time", async () => {
    const fixture = historyFixture();
    (fixture.meeting as { scheduledAt: number | null }).scheduledAt = null;
    mocks.queryDispatch = (query) =>
      query === historyQueries.getMeetingHistory
        ? fixture
        : { enabled: false, mutual: false };
    const html = await renderDetail();
    expect(html).not.toContain("download-ics");
    expect(html).toContain("stay-in-touch-switch");
  });

  it("notes when everyone has opted in to stay in touch", async () => {
    mocks.queryDispatch = (query) =>
      query === historyQueries.getMeetingHistory
        ? historyFixture()
        : { enabled: true, mutual: true };
    const html = await renderDetail();
    expect(html).toContain("stay-in-touch-mutual");
  });
});
