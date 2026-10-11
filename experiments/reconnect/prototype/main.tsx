/**
 * Reconnect-study prototype: mounts the REAL `useCollaborativeNotes` and
 * `useMeetingLifecycle` hooks against the owned fake Convex client so a
 * browser (driven by Playwright in walk.mjs) can demonstrate what a user
 * sees across connection cuts. No app source is modified.
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useCollaborativeNotes, calculateOperation } from "@/hooks/useCollaborativeNotes";
import { useMeetingLifecycle } from "@/hooks/useMeetingLifecycle";
import { FakeConvexClient, FakeConvexServer } from "../fake/fakeConvex";
import { setActiveClient } from "../fake/convexReactMock";

const MEETING = "m_walk_meeting";

const server = new FakeConvexServer({
  note: { meetingId: MEETING, content: "hello", version: 3 },
  meeting: { meetingId: MEETING, state: "scheduled", participants: ["user-local"] },
});
const client = new FakeConvexClient(server, [
  { kind: "query", names: ["notes.getMeetingNotes", "meetings.lifecycle.getMeetingConnectionInfo"] },
  {
    kind: "mutation",
    names: [
      "notes.applyNoteOperation",
      "notes.batchApplyNoteOperations",
      "meetings.lifecycle.createMeeting",
      "meetings.lifecycle.startMeeting",
      "meetings.lifecycle.endMeeting",
    ],
  },
  { kind: "action", names: ["prompts.actions.generatePreCallIdeas"] },
]);
client.enableAutoAck(); // browser mode: acks settle on their own microtask
setActiveClient(client);

function App() {
  const notes = useCollaborativeNotes(MEETING);
  const life = useMeetingLifecycle();
  const [local, setLocal] = useState("hello");
  // Heartbeat re-render so probe values that live outside React state
  // (connection status, server truth) stay fresh in the walk.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  // Keyboard operation: letter shortcuts so the walk controls work without
  // a mouse; Tab/Enter/Space operate the buttons natively.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      const fn: Record<string, () => void> = {
        c: () => client.cutConnection("before-server"),
        a: () => client.armAckLoss(),
        r: () => client.restore(),
        s: () => void life.startMeeting(MEETING),
        e: () => void life.endMeeting(MEETING),
      };
      const run = fn[e.key.toLowerCase()];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [life]);

  const note = server.getNote(MEETING);
  const meeting = server.getMeeting(MEETING);

  const onEdit = (next: string) => {
    const op = calculateOperation(local, next);
    setLocal(next); // consumer optimistic state, per the hook's documented example
    void notes.applyOperation(op);
  };

  return (
    <>
      <h1>Connvo reconnect-study prototype — real hooks, fake transport</h1>

      <div className="panel" data-testid="connection">
        <h2>Connection</h2>
        <div className="row" data-testid="conn-status">
          status: <b>{client.connectionStatus()}</b>
        </div>
        <div className="row" data-testid="inflight">
          unacked/queued mutations: <b>{client.inFlightCount}</b>
        </div>
        <div className="row" data-testid="ack-armed">
          ack loss armed: <b>{String(client.isAckLossArmed)}</b>
        </div>
        <button data-testid="btn-cut" onClick={() => client.cutConnection("before-server")}>
          Cut connection (request loss)
        </button>
        <button data-testid="btn-arm-ackloss" onClick={() => client.armAckLoss()}>
          Arm ack loss (next send)
        </button>
        <button data-testid="btn-restore" onClick={() => client.restore()}>
          Restore connection
        </button>
      </div>

      <div className="panel" data-testid="notes">
        <h2>Collaborative notes</h2>
        <div className="row" data-testid="notes-loading">
          isLoading: <b>{String(notes.isLoading)}</b>
        </div>
        <div className="row" data-testid="notes-syncing">
          isSyncing: <b>{String(notes.isSyncing)}</b>
        </div>
        <div className="row" data-testid="notes-saved">
          saved (query cache): <b>{notes.content}</b> @v{notes.version}
        </div>
        <div className="row" data-testid="server-truth">
          server truth: <b>{note?.content ?? "(none)"}</b> @v{note?.version ?? 0}
        </div>
        <div className="row" data-testid="duplicates">
          duplicate acceptances: <b>{server.history.duplicateEntryCount()}</b>
        </div>
        <textarea data-testid="editor" value={local} onChange={(e) => onEdit(e.target.value)} />
        {local !== notes.content && !notes.isSyncing && (
          <div className="warn" data-testid="divergence">
            consumer text diverges from saved state with NO unsaved indicator
          </div>
        )}
      </div>

      <div className="panel" data-testid="lifecycle">
        <h2>Meeting lifecycle</h2>
        <div className="row" data-testid="meeting-state">
          server meeting state: <b>{meeting?.state ?? "(none)"}</b>
        </div>
        <div className="row" data-testid="life-starting">
          isStarting: <b>{String(life.isStarting)}</b>
        </div>
        <div className="row" data-testid="life-ending">
          isEnding: <b>{String(life.isEnding)}</b>
        </div>
        <div className="row" data-testid="life-error">
          error: <b>{life.error?.message ?? "null"}</b>
        </div>
        <button data-testid="btn-start" onClick={() => void life.startMeeting(MEETING)}>
          Start meeting
        </button>
        <button data-testid="btn-end" onClick={() => void life.endMeeting(MEETING)}>
          End meeting
        </button>
      </div>

      <div className="row kbd-legend" data-testid="kbd-legend">
        keyboard: c=cut · a=arm ack loss · r=restore · s=start · e=end · Tab/Enter/Space operate the buttons
      </div>
    </>
  );
}

// Debug/demo access to the accepted-history ledger (written by the fake
// SERVER only — the client cannot edit it).
declare global {
  interface Window {
    __dumpJournal?: () => Array<{ seq: number; clientMutationId: string; name: string }>;
  }
}
window.__dumpJournal = () =>
  server.history.list().map((e) => ({ seq: e.seq, clientMutationId: e.clientMutationId, name: e.name }));

createRoot(document.getElementById("root")!).render(<App />);
