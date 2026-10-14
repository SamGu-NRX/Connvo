/**
 * After-call screens, mounted, against the REAL history functions in
 * convex-test. convex/react is shimmed at the hook boundary (useQuery,
 * useMutation, usePaginatedQuery run the real queries and mutations as the
 * signed-in test user); everything above it is the shipped components.
 *
 * Both flags are exercised: the client flag NEXT_PUBLIC_CONNVO_AFTER_CALL
 * decides whether anything renders; the server flag CONNVO_AFTER_CALL
 * decides whether the functions answer.
 */
import { useEffect, useReducer, useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { axe } from "jest-axe";
import ICAL from "ical.js";
import { getFunctionName } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMeetingParticipant,
  createTestEnvironment,
  createTestMeeting,
  createTestUser,
} from "../convex/helpers";

type Env = ReturnType<typeof createTestEnvironment>;
type Face = ReturnType<Env["withIdentity"]>;

/** convex/react over convex-test, as one signed-in person (`face`). */
class HistorySim {
  face!: Face;
  private readonly entries = new Map<
    string,
    {
      ref: unknown;
      args: Record<string, unknown>;
      value: unknown;
      error: unknown;
      listeners: Set<() => void>;
    }
  >();
  private readonly mutations = new Map<
    unknown,
    (args: Record<string, unknown>) => Promise<unknown>
  >();

  private async refresh(key: string) {
    const entry = this.entries.get(key)!;
    try {
      entry.value = await this.face.query(
        entry.ref as never,
        entry.args as never,
      );
      entry.error = null;
    } catch (error) {
      entry.error = error;
    }
    entry.listeners.forEach((l) => l());
  }

  async refreshAll() {
    for (const key of [...this.entries.keys()]) await this.refresh(key);
  }

  useQuery(ref: unknown, args: Record<string, unknown> | "skip") {
    const key = `${getFunctionName(ref as never)}|${JSON.stringify(args)}`;
    if (args !== "skip" && !this.entries.has(key)) {
      this.entries.set(key, {
        ref,
        args,
        value: undefined,
        error: null,
        listeners: new Set(),
      });
    }
    const entry = this.entries.get(key);
    const [, bump] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
      if (!entry) return;
      entry.listeners.add(bump);
      void this.refresh(key);
      return () => void entry.listeners.delete(bump);
    }, [key]);
    if (!entry) return undefined;
    if (entry.error) throw entry.error;
    return entry.value;
  }

  useMutation(ref: unknown) {
    if (!this.mutations.has(ref)) {
      this.mutations.set(ref, async (args) => {
        const result = await this.face.mutation(ref as never, args as never);
        await this.refreshAll();
        return result;
      });
    }
    return this.mutations.get(ref)!;
  }

  usePaginatedQuery(
    ref: unknown,
    args: Record<string, unknown> | "skip",
    opts: { initialNumItems: number },
  ) {
    const [state, setState] = useState<{
      results: unknown[];
      cursor: string | null;
      status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
      error: unknown;
    }>({ results: [], cursor: null, status: "LoadingFirstPage", error: null });
    const fetchPage = async (cursor: string | null, numItems: number) => {
      try {
        const page = (await this.face.query(
          ref as never,
          {
            ...(args as Record<string, unknown>),
            paginationOpts: { numItems, cursor },
          } as never,
        )) as { page: unknown[]; isDone: boolean; continueCursor: string };
        setState((prev) => ({
          results:
            cursor === null ? page.page : [...prev.results, ...page.page],
          cursor: page.continueCursor,
          status: page.isDone ? "Exhausted" : "CanLoadMore",
          error: null,
        }));
      } catch (error) {
        setState((prev) => ({ ...prev, error }));
      }
    };
    useEffect(() => {
      if (args !== "skip") void fetchPage(null, opts.initialNumItems);
    }, []);
    if (state.error) throw state.error;
    return {
      results: state.results,
      status: state.status,
      loadMore: (n: number) => {
        setState((prev) => ({ ...prev, status: "LoadingMore" }));
        void fetchPage(state.cursor, n);
      },
    };
  }
}

const sim = vi.hoisted(() => ({
  current: null as unknown as HistorySim,
  auth: { isLoading: false, isAuthenticated: true },
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => sim.auth,
  useQuery: (ref: unknown, args: Record<string, unknown> | "skip") =>
    sim.current.useQuery(ref, args),
  useMutation: (ref: unknown) => sim.current.useMutation(ref),
  usePaginatedQuery: (
    ref: unknown,
    args: Record<string, unknown> | "skip",
    opts: { initialNumItems: number },
  ) => sim.current.usePaginatedQuery(ref, args, opts),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useParams: () => ({}),
}));

// Imported after the mocks.
import { MeetingList } from "@/components/history/MeetingList";
import { MeetingDetail } from "@/components/history/MeetingDetail";
import { EndedRecap, OpenRecapLink } from "@/components/history/EndedRecap";
import MeetingsPage from "@/app/app/meetings/page";

let t: Env;
let people: Record<"A" | "B" | "O", Face>;
let meetingId: Id<"meetings">;
const NOTES = "Agenda: budget review.\nOwner: Bob.";
const STARTED = Date.UTC(2026, 9, 12, 15, 0);

async function seed() {
  t = createTestEnvironment();
  const ids: Record<string, Id<"users">> = {};
  for (const [k, name] of [
    ["A", "Alice Anderson"],
    ["B", "Bob Brown"],
    ["O", "Owen Outsider"],
  ] as const) {
    ids[k] = await createTestUser(t, {
      workosUserId: `ac-${k}`,
      email: `${k.toLowerCase()}@after-call.test`,
      displayName: name,
    });
  }
  people = {
    A: t.withIdentity({ subject: "ac-A" }),
    B: t.withIdentity({ subject: "ac-B" }),
    O: t.withIdentity({ subject: "ac-O" }),
  };
  const older = await createTestMeeting(t, ids.A, {
    title: "Kickoff",
    scheduledAt: STARTED - 7 * 86_400_000,
    duration: 1_800_000,
    state: "concluded",
  });
  meetingId = await createTestMeeting(t, ids.A, {
    title: "Budget review",
    scheduledAt: STARTED,
    duration: 1_800_000,
    state: "active",
  });
  for (const m of [older, meetingId]) {
    await addMeetingParticipant(t, m, ids.A, "host", "joined");
    await addMeetingParticipant(t, m, ids.B, "participant", "joined");
  }
  await t.run(async (ctx) => {
    await ctx.db.insert("meetingState", {
      meetingId,
      active: false,
      startedAt: STARTED,
      endedAt: STARTED + 30 * 60_000,
      topics: [],
      recordingEnabled: false,
      updatedAt: STARTED,
    });
  });
  await people.A.mutation(api.notes.mutations.batchApplyNoteOperations, {
    meetingId,
    clientId: "client-a",
    operations: [
      {
        operation: { type: "insert", position: 0, content: NOTES },
        clientSequence: 0,
        clientOpId: "op-1",
      },
    ],
  });
}

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_CONNVO_AFTER_CALL", "1");
  vi.stubEnv("CONNVO_AFTER_CALL", "1");
  await seed();
  sim.current = new HistorySim();
  sim.auth = { isLoading: false, isAuthenticated: true };
  sim.current.face = people.A;
});
afterEach(() => vi.unstubAllEnvs());

describe("with the client flag off", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_CONNVO_AFTER_CALL", ""));

  it("the call page shows no recap link and no recap", () => {
    const { container } = render(
      <>
        <OpenRecapLink meetingId={meetingId} />
        <EndedRecap meetingId={meetingId} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("/app/meetings is not found", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<MeetingsPage />)).toThrow("NEXT_NOT_FOUND");
    spy.mockRestore();
  });
});

describe("with the client flag on", () => {
  it("lists the person's meetings newest first, and is axe-clean", async () => {
    const { container } = render(<MeetingList />);
    const list = await screen.findByTestId("meeting-list");
    const titles = within(list)
      .getAllByRole("link")
      .map((a) => a.textContent ?? "");
    expect(titles[0]).toContain("Budget review");
    expect(titles[1]).toContain("Kickoff");
    expect(within(list).getAllByRole("link")[0]).toHaveAttribute(
      "href",
      `/app/meetings/${meetingId}`,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows the empty state to someone with no meetings", async () => {
    sim.current.face = people.O;
    render(<MeetingList />);
    expect(await screen.findByTestId("meeting-list-empty")).toHaveTextContent(
      "No meetings yet",
    );
  });

  it("asks a signed-out person to sign in, and sends no history query", async () => {
    sim.auth = { isLoading: false, isAuthenticated: false };
    render(<MeetingDetail meetingId={meetingId} />);
    expect(screen.getByTestId("history-signed-out")).toHaveTextContent(
      "Sign in to see your meetings.",
    );
    expect(screen.queryByTestId("history-error")).not.toBeInTheDocument();
  });

  it("shows the loading state while sign-in is still being checked", () => {
    sim.auth = { isLoading: true, isAuthenticated: false };
    render(<MeetingList />);
    expect(screen.getByTestId("meeting-list-loading")).toBeInTheDocument();
  });

  it("shows the loading state before the first page", () => {
    render(<MeetingList />);
    expect(screen.getByTestId("meeting-list-loading")).toBeInTheDocument();
  });

  it("says history is unavailable when the server flag is off", async () => {
    vi.stubEnv("CONNVO_AFTER_CALL", "");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MeetingList />);
    expect(await screen.findByTestId("history-error")).toHaveAttribute(
      "data-kind",
      "disabled",
    );
    spy.mockRestore();
  });

  it("shows the recap built from the records: people, duration, the notes verbatim", async () => {
    const { container } = render(<MeetingDetail meetingId={meetingId} />);
    const recap = await screen.findByTestId("meeting-recap");
    expect(recap).toHaveTextContent("Alice Anderson");
    expect(recap).toHaveTextContent("Bob Brown");
    expect(recap).toHaveTextContent("30 minutes");
    expect(screen.getByTestId("recap-notes").textContent).toBe(NOTES);
    expect(recap).toHaveTextContent("No prompts were recorded.");
    await waitFor(() =>
      expect(screen.getByTestId("stay-in-touch")).toBeInTheDocument(),
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("refuses the recap to someone who was not in the meeting", async () => {
    sim.current.face = people.O;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MeetingDetail meetingId={meetingId} />);
    const error = await screen.findByTestId("history-error");
    expect(error).toHaveAttribute("data-kind", "refused");
    expect(screen.queryByTestId("recap-notes")).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it("downloads a calendar file that a real parser reads back", async () => {
    let blob: Blob | null = null;
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blob = b as Blob;
      return "blob:ics";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<MeetingDetail meetingId={meetingId} />);
    fireEvent.click(await screen.findByTestId("calendar-download"));
    expect(create).toHaveBeenCalledOnce();
    // jsdom's Blob has no text(); read it the way a browser could.
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob as unknown as Blob);
    });
    const event = new ICAL.Event(
      new ICAL.Component(ICAL.parse(text)).getFirstSubcomponent("vevent")!,
    );
    expect(event.summary).toBe("Budget review");
    expect(event.startDate.toJSDate().getTime()).toBe(STARTED);
    expect(event.endDate.toJSDate().getTime()).toBe(STARTED + 1_800_000);
  });

  it("stay in touch: nothing shows until both said yes, then each sees the other", async () => {
    render(<MeetingDetail meetingId={meetingId} />);
    fireEvent.click(await screen.findByTestId("stay-in-touch-switch"));
    await screen.findByText(/Nobody else has yet/);
    expect(
      screen.queryByTestId("stay-in-touch-contacts"),
    ).not.toBeInTheDocument();

    await act(async () => {
      await people.B.mutation(api.history.mutations.setStayInTouch, {
        meetingId,
        enabled: true,
      });
      await sim.current.refreshAll();
    });
    const contacts = await screen.findByTestId("stay-in-touch-contacts");
    expect(contacts).toHaveTextContent("Bob Brown");
    expect(contacts).toHaveTextContent("b@after-call.test");
  });

  it("stay in touch: the switch keeps keyboard focus while its choice saves", async () => {
    render(<MeetingDetail meetingId={meetingId} />);
    const toggle = await screen.findByTestId("stay-in-touch-switch");
    toggle.focus();
    fireEvent.click(toggle);
    // Saving: a disabled button would lose focus in a browser, so it stays
    // enabled and says it is busy.
    expect(toggle).toHaveAttribute("aria-busy", "true");
    expect(toggle).not.toBeDisabled();
    expect(document.activeElement).toBe(toggle);
    await screen.findByText(/Nobody else has yet/);
    expect(toggle).toHaveAttribute("aria-busy", "false");
    expect(document.activeElement).toBe(toggle);
  });

  it("the call page's ended screen links to the recap and shows it", async () => {
    render(
      <>
        <OpenRecapLink meetingId={meetingId} />
        <EndedRecap meetingId={meetingId} />
      </>,
    );
    expect(screen.getByTestId("open-recap")).toHaveAttribute(
      "href",
      `/app/meetings/${meetingId}`,
    );
    const recap = await screen.findByTestId("meeting-recap");
    expect(recap).toHaveTextContent("Bob Brown");
  });
});
