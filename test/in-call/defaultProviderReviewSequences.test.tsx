/**
 * The two loss sequences from the review of 3c5f1f9, mounted: MeetingNotesPanel
 * with no provider above it, so its own production chain runs
 * (DefaultNotesTransportProvider → NotesConvexTransportProvider →
 * convex/react, shimmed over the REAL convex-test notes server). The other
 * person writes through the real mutation as a second participant.
 *
 * - Teardown during the debounce: A types "base alpha" over "base"; B's
 *   " bravo" lands before A's edit is sent; A's panel unmounts. The
 *   recovery must keep B's words.
 * - Separate remote changes: A changes "ab" to "ac"; B's two inserts make
 *   "XabY" before A's edit is sent. A's edit must land as "XacY".
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import { describe, expect, it, vi } from "vitest";
import { MeetingNotesPanel } from "@/components/meeting-notes/MeetingNotesPanel";
import {
  NotesBackend,
  type BackendParticipant,
} from "../notes/harness/backend";
import { setupParticipant } from "../notes/matrixHarness";
import { ConvexReactSim, type QueryArgs } from "./helpers/convexReactSim";

const convexSim = vi.hoisted(() => ({
  current: null as ConvexReactSim | null,
}));

vi.mock("convex/react", () => {
  const sim = () => convexSim.current as ConvexReactSim;
  return {
    useQuery: (query: unknown, args: QueryArgs) => sim().useQuery(query, args),
    useMutation: () => sim().useMutation(),
  } as unknown as Record<string, unknown>;
});

async function badgeShows(expected: string | RegExp) {
  await waitFor(() =>
    expect(screen.getByTestId("notes-status")).toHaveTextContent(expected),
  );
}

async function serverText(backend: NotesBackend, meetingId: Id<"meetings">) {
  return (await backend.readServerText(meetingId)).content;
}

/** Two participants of one meeting; A's panel runs the production chain. */
async function twoPeople(tag: string) {
  const backend = new NotesBackend();
  const a = await setupParticipant(backend, tag);
  const b = await backend.joinMeeting(a.meetingId, `${tag}-b`);
  const sim = new ConvexReactSim(backend, a.face);
  convexSim.current = sim;
  window.sessionStorage.clear();
  return { backend, a, b, sim };
}

/** B's write through the real mutation, at B's current view of the server. */
async function remoteWrite(
  backend: NotesBackend,
  b: BackendParticipant,
  ops: Array<{ type: "insert"; position: number; content: string }>,
) {
  const snapshot = await backend.readSnapshot(b.face, b.meetingId, "client-b");
  await backend.applyBatch(
    b.face,
    b.meetingId,
    "client-b",
    {
      operations: ops.map((operation, i) => ({
        operation,
        clientSequence: snapshot?.headSequence ?? 0,
        clientOpId: `b-${Date.now()}-${i}`,
      })),
    },
    { push: false },
  );
}

/** The panel's "Version N" line: the server version A's ledger has read. */
const shownVersion = () =>
  screen.queryByText(/^Version \d+$/)?.textContent ?? "";

/** Deliver the remote write to A and wait until A's ledger has read it. */
async function deliverToA(sim: ConvexReactSim) {
  const before = shownVersion();
  await sim.refreshAll();
  await waitFor(() => expect(shownVersion()).not.toBe(before));
}

/** Type into A's editor and send at once (blur flushes). */
function typeAndCommit(next: string) {
  const editor = screen.getByTestId("notes-editor");
  fireEvent.change(editor, { target: { value: next } });
  fireEvent.blur(editor);
}

describe("MeetingNotesPanel — review sequences through the default provider", () => {
  it("a teardown inside the debounce keeps the other person's words", async () => {
    const { backend, a, b, sim } = await twoPeople("teardown");
    const view = render(<MeetingNotesPanel meetingId={a.meetingId} />);
    await badgeShows(/Synced/i);
    typeAndCommit("base");
    await waitFor(async () =>
      expect(await serverText(backend, a.meetingId)).toBe("base"),
    );
    await badgeShows(/Synced/i);

    // A types, and the debounce has not fired when B's words arrive.
    fireEvent.change(screen.getByTestId("notes-editor"), {
      target: { value: "base alpha" },
    });
    await remoteWrite(backend, b, [
      { type: "insert", position: 4, content: " bravo" },
    ]);
    await deliverToA(sim);
    // Still inside the debounce: nothing of "alpha" has been sent.
    expect(sim.attemptedBatches).toHaveLength(1);
    view.unmount();

    render(<MeetingNotesPanel meetingId={a.meetingId} />);
    await waitFor(async () => {
      const text = await serverText(backend, a.meetingId);
      expect(text).toContain(" bravo");
      expect(text).toContain(" alpha");
    });
    const text = await serverText(backend, a.meetingId);
    expect(text).toHaveLength("base alpha bravo".length);
    await badgeShows(/Synced/i);
    expect(screen.getByTestId("notes-editor")).toHaveValue(text);
  });

  it("the same, when the transport changes on every query update (the ledger restarts each time)", async () => {
    const { backend, a, b, sim } = await twoPeople("churn");
    sim.churn = true;
    const view = render(<MeetingNotesPanel meetingId={a.meetingId} />);
    await badgeShows(/Synced/i);
    typeAndCommit("base");
    await waitFor(async () =>
      expect(await serverText(backend, a.meetingId)).toBe("base"),
    );
    await badgeShows(/Synced/i);

    // A types, and the debounce has not fired when B's words arrive.
    fireEvent.change(screen.getByTestId("notes-editor"), {
      target: { value: "base alpha" },
    });
    await remoteWrite(backend, b, [
      { type: "insert", position: 4, content: " bravo" },
    ]);
    await deliverToA(sim);
    // Each restart commits the buffered words and sends them at once, so
    // here "alpha" may already be on its way: only the outcome is judged.
    view.unmount();

    render(<MeetingNotesPanel meetingId={a.meetingId} />);
    await waitFor(async () => {
      const text = await serverText(backend, a.meetingId);
      expect(text).toContain(" bravo");
      expect(text).toContain(" alpha");
    });
    const text = await serverText(backend, a.meetingId);
    expect(text).toHaveLength("base alpha bravo".length);
    await badgeShows(/Synced/i);
    expect(screen.getByTestId("notes-editor")).toHaveValue(text);
  });

  it("separate remote inserts keep their positions: ab, local ac, remote XabY → XacY", async () => {
    const { backend, a, b, sim } = await twoPeople("hunks");
    render(<MeetingNotesPanel meetingId={a.meetingId} />);
    await badgeShows(/Synced/i);
    typeAndCommit("ab");
    await waitFor(async () =>
      expect(await serverText(backend, a.meetingId)).toBe("ab"),
    );
    await badgeShows(/Synced/i);

    fireEvent.change(screen.getByTestId("notes-editor"), {
      target: { value: "ac" },
    });
    await remoteWrite(backend, b, [
      { type: "insert", position: 0, content: "X" },
      { type: "insert", position: 2, content: "Y" }, // in the "ab" frame, like its sibling
    ]);
    expect(await serverText(backend, a.meetingId)).toBe("XabY");
    await deliverToA(sim);
    expect(sim.attemptedBatches).toHaveLength(1);
    fireEvent.blur(screen.getByTestId("notes-editor"));

    await waitFor(async () =>
      expect(await serverText(backend, a.meetingId)).toBe("XacY"),
    );
    await badgeShows(/Synced/i);
    expect(screen.getByTestId("notes-editor")).toHaveValue("XacY");
  });
});
