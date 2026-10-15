/**
 * The mounted notes panel and the recap chain over the REAL Convex handlers.
 *
 * Suite 1 mounts the production default-provider wiring — MeetingNotesPanel
 * → DefaultNotesTransportProvider → NotesConvexTransportProvider → the
 * convex/react hooks (shimmed at the hook boundary by ConvexReactSimLive) →
 * the REAL convex-test notes server — for an authenticated OUTSIDER (a user
 * with no meetingParticipants row) and proves NotesBoundary (exported from
 * the real call page) owns the refused read.
 *
 * Suite 2 writes through the mounted panel as a real participant, concludes
 * the meeting through the REAL lifecycle mutation, and reads the recap back
 * through the REAL after-call history query — the committed notes arrive
 * verbatim.
 *
 * Both suites pin chains nothing else covers: the handler-level and mounted
 * outsider refusal for notes, and participant notes surviving the
 * end-meeting → history boundary.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "@convex/_generated/api";
import type { FunctionReference } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesBoundary } from "@/app/app/call/[id]/real-call";
import { MeetingNotesPanel } from "@/components/meeting-notes/MeetingNotesPanel";
import {
  createTestEnvironment,
  createTestMeetingWithParticipants,
  createTestUser,
} from "../convex/helpers";
import {
  ConvexReactSimLive,
  SimFaceProvider,
  type SimFace,
} from "./helpers/convexReactSimLive";

/** Hoisted holder so the vi.mock factory can reach the per-test instance. */
const convexSim = vi.hoisted(() => ({
  current: null as ConvexReactSimLive | null,
}));

vi.mock("convex/react", () => {
  const sim = () => convexSim.current as ConvexReactSimLive;
  return {
    useQuery: (query: unknown, args: Record<string, unknown>) =>
      sim().useQuery(query as FunctionReference<"query">, args),
    useMutation: (mutation: unknown) =>
      sim().useMutation(mutation as FunctionReference<"mutation">),
    useAction: (action: unknown) =>
      sim().useAction(action as FunctionReference<"action">),
    useConvexConnectionState: () => sim().useConvexConnectionState(),
    // The real-call page module is imported for NotesBoundary; its other
    // convex/react consumers never render in these tests.
    useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
    useConvex: () => ({}),
    usePaginatedQuery: () => ({
      results: [],
      status: "Exhausted",
      loadMore: () => {},
    }),
    ConvexReactClient: class {},
  } as unknown as Record<string, unknown>;
});

/** One committed change (change + blur → the panel's immediate flush). */
function typeAndCommit(next: string) {
  const editor = screen.getByTestId("notes-editor");
  fireEvent.change(editor, { target: { value: next } });
  fireEvent.blur(editor);
}

describe("call collaboration over the real notes and history handlers", () => {
  let t: ReturnType<typeof createTestEnvironment>;
  let sim: ConvexReactSimLive;

  beforeEach(() => {
    t = createTestEnvironment();
    sim = new ConvexReactSimLive(t);
    convexSim.current = sim;
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function mountPanel(face: SimFace, meetingId: Id<"meetings">) {
    return render(
      <SimFaceProvider sim={sim} face={face}>
        <NotesBoundary>
          <MeetingNotesPanel meetingId={meetingId} />
        </NotesBoundary>
      </SimFaceProvider>,
    );
  }

  it("hides notes from an outsider and refuses the read at the real handler", async () => {
    const meeting = await createTestMeetingWithParticipants(
      t,
      {},
      1,
      { state: "active", duration: 1_800_000 },
      {},
    );
    const meetingId = meeting.meetingId;

    const outsiderSubject = `notes-outsider-${Date.now()}`;
    await createTestUser(t, { workosUserId: outsiderSubject });
    const outsider = sim.authFace("outsider", outsiderSubject);

    // Handler level: the real getMeetingNotes query refuses a caller with no
    // meetingParticipants row.
    await expect(
      outsider.query(api.notes.queries.getMeetingNotes, { meetingId }),
    ).rejects.toThrow(/Not a meeting participant/);

    // Mounted level: the refusal reaches NotesBoundary, which answers with
    // the participant-specific refusal instead of the editor.
    mountPanel(outsider, meetingId);

    await waitFor(() =>
      expect(screen.getByTestId("notes-unavailable")).toHaveTextContent(
        "Notes are only for the people in this meeting.",
      ),
    );
    expect(screen.queryByTestId("notes-editor")).toBeNull();

    // The same read succeeds for a real participant, and the row reads back
    // with the committed content after a real batch apply.
    const participant = sim.authFace("p0", meeting.participantWorkosIds[0]);
    await participant.mutation(api.notes.mutations.batchApplyNoteOperations, {
      meetingId,
      clientId: "seed-client",
      operations: [
        {
          operation: {
            type: "insert",
            position: 0,
            content: "participant words",
          },
          clientSequence: 0,
          clientOpId: "seed-op-0",
        },
      ],
    });
    const row = await participant.query(api.notes.queries.getMeetingNotes, {
      meetingId,
      clientId: "seed-client",
    });
    expect(row).toMatchObject({ content: "participant words" });
  });

  it("returns the participant's committed notes verbatim through the real recap history", async () => {
    const meeting = await createTestMeetingWithParticipants(
      t,
      {},
      1,
      { state: "active", duration: 1_800_000 },
      {},
    );
    const meetingId = meeting.meetingId;
    const participant = sim.authFace("p0", meeting.participantWorkosIds[0]);
    const host = sim.authFace("host", meeting.organizerWorkosId);

    mountPanel(participant, meetingId);
    await waitFor(() =>
      expect(screen.getByTestId("notes-status")).toHaveTextContent(/Synced/i),
    );

    typeAndCommit("recap chain committed words");

    // The real server row carries exactly the committed words.
    await waitFor(async () => {
      const server = await t.run(async (ctx) => {
        const row = await ctx.db
          .query("meetingNotes")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();
        return row?.content ?? "";
      });
      expect(server).toBe("recap chain committed words");
    });

    // Conclude the meeting through the REAL lifecycle mutation (host only).
    const ended = await host.mutation(api.meetings.lifecycle.endMeeting, {
      meetingId,
    });
    expect(ended.success).toBe(true);
    const meetingRow = await t.run((ctx) => ctx.db.get(meetingId));
    expect(meetingRow?.state).toBe("concluded");

    // The after-call history read accepts a concluded meeting for a
    // participant and returns the committed notes verbatim.
    vi.stubEnv("CONNVO_AFTER_CALL", "1");
    const history = await participant.query(
      api.history.queries.getMeetingHistory,
      {
        meetingId,
      },
    );
    expect(history.meeting.state).toBe("concluded");
    expect(history.notes?.content).toBe("recap chain committed words");
  });
});
