import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import { expect, test, vi } from "vitest";
import { NotesConvexTransportProvider } from "@/hooks/notes/notesConvexTransport";
import { useNotesLedger } from "@/hooks/notes/useNotesLedger";
import { NotesBackend } from "../notes/harness/backend";
import { ConvexReactSim, type QueryArgs } from "./helpers/convexReactSim";

const convexSim = vi.hoisted(() => ({
  current: null as ConvexReactSim | null,
}));
vi.mock("convex/react", () => ({
  useQuery: (query: unknown, args: QueryArgs) =>
    convexSim.current!.useQuery(query, args),
  useMutation: () => convexSim.current!.useMutation(),
  useConvexConnectionState: () => convexSim.current!.useConvexConnectionState(),
}));

function Editor({ meetingId }: { meetingId: Id<"meetings"> }) {
  const notes = useNotesLedger(meetingId, {
    clientId: "switch-client",
    storage: null,
  });
  return (
    <>
      <output data-testid="switch-content">{notes.content}</output>
      <output data-testid="switch-version">
        {notes.isLoading ? "loading" : notes.version}
      </output>
      <button
        onClick={() => {
          notes.onEdit("bravo");
          notes.flushNow();
        }}
      >
        Write B
      </button>
    </>
  );
}
function Session({ meetingId }: { meetingId: Id<"meetings"> }) {
  return (
    <NotesConvexTransportProvider
      meetingId={meetingId}
      clientId="switch-client"
    >
      <Editor meetingId={meetingId} />
    </NotesConvexTransportProvider>
  );
}

test("switching from meeting A version 5 to rowless B never adopts A's content or mutation basis", async () => {
  const backend = new NotesBackend();
  const a = await backend.addParticipant("meeting-a");
  const b = await backend.addParticipant("meeting-b");
  for (const [index, content] of [..."alpha"].entries()) {
    await backend.applyBatch(
      a.face,
      a.meetingId,
      "seed-a",
      {
        operations: [
          {
            operation: { type: "insert", position: index, content },
            clientSequence: index,
            clientOpId: `seed-${index}`,
          },
        ],
      },
      { push: false },
    );
  }
  convexSim.current = new ConvexReactSim(backend, a.face);
  const view = render(<Session meetingId={a.meetingId} />);
  await waitFor(() =>
    expect(screen.getByTestId("switch-version")).toHaveTextContent("5"),
  );
  expect(screen.getByTestId("switch-content")).toHaveTextContent("alpha");

  const simB = new ConvexReactSim(backend, b.face);
  convexSim.current = simB;
  view.rerender(<Session meetingId={b.meetingId} />);
  await waitFor(() =>
    expect(screen.getByTestId("switch-version")).toHaveTextContent("0"),
  );
  expect(screen.getByTestId("switch-content")).toBeEmptyDOMElement();
  fireEvent.click(screen.getByRole("button", { name: "Write B" }));
  await waitFor(async () =>
    expect(await backend.readServerText(b.meetingId)).toMatchObject({
      content: "bravo",
      version: 1,
    }),
  );
  expect(simB.attemptedBatches).toHaveLength(1);
  expect(
    simB.attemptedBatches[0].operations.map((op) => op.clientSequence),
  ).toEqual([0]);
  expect(await backend.readServerText(a.meetingId)).toEqual({
    content: "alpha",
    version: 5,
  });
});
