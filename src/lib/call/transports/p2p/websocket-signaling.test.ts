// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SignalingHandlers } from "./signaling";
import { websocketSignaling } from "./websocket-signaling";

/** A WebSocket stand-in the test drives by hand. */
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static last: FakeSocket | null = null;
  readyState = FakeSocket.CONNECTING;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code: number, reason = "") {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

function handlers(): SignalingHandlers & { closed: Array<unknown> } {
  const closed: unknown[] = [];
  return {
    closed,
    onWelcome: vi.fn(),
    onPeerJoined: vi.fn(),
    onPeerLeft: vi.fn(),
    onSignal: vi.fn(),
    onRemoteState: vi.fn(),
    onClosed: (reason) => closed.push(reason),
  };
}

async function openWith(h: SignalingHandlers) {
  const conn = websocketSignaling("ws://127.0.0.1:9301/").open(
    { meetingId: "m1", identityToken: async () => "token-A" },
    h,
  );
  await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
  const socket = FakeSocket.last as FakeSocket;
  socket.open();
  return { conn, socket };
}

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("websocketSignaling", () => {
  it("says hello with the token and meeting, then routes the server's messages", async () => {
    const h = handlers();
    const { socket } = await openWith(h);
    expect(socket.sent[0]).toEqual({
      type: "hello",
      token: "token-A",
      meetingId: "m1",
    });
    socket.receive({ type: "welcome", selfId: "A", peers: ["B"] });
    socket.receive({
      type: "remote-state",
      from: "B",
      micOn: false,
      cameraOn: true,
    });
    expect(h.onWelcome).toHaveBeenCalledWith(["B"]);
    expect(h.onRemoteState).toHaveBeenCalledWith({
      participantId: "B",
      micOn: false,
      cameraOn: true,
    });
  });

  it("reports a lost connection when pongs stop arriving", async () => {
    // Fake only the heartbeat clock; openWith still waits on real timeouts.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const h = handlers();
    const { socket } = await openWith(h);
    vi.advanceTimersByTime(2000);
    expect(socket.sent.at(-1)).toEqual({ type: "ping" });
    vi.advanceTimersByTime(6000);
    expect(h.closed).toEqual([
      { kind: "lost", message: "the signaling service stopped answering" },
    ]);
  });

  it("keeps the connection while pongs arrive", async () => {
    // Fake only the heartbeat clock; openWith still waits on real timeouts.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const h = handlers();
    const { socket } = await openWith(h);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(2000);
      socket.receive({ type: "pong" });
    }
    expect(h.closed).toEqual([]);
  });

  it("reports a refusal as rejected, with the server's words", async () => {
    const h = handlers();
    const { socket } = await openWith(h);
    socket.receive({
      type: "error",
      code: "auth",
      message: "signaling rejected: O is not a bench participant",
    });
    socket.drop(4006, "not a participant");
    expect(h.closed).toEqual([
      {
        kind: "rejected",
        message: "signaling rejected: O is not a bench participant",
      },
    ]);
  });

  it("reports being replaced by the same identity, so the mesh does not fight it", async () => {
    const h = handlers();
    const { socket } = await openWith(h);
    socket.drop(4007, "replaced by re-join");
    expect(h.closed).toEqual([
      {
        kind: "replaced",
        message: "This call is open in another window or tab.",
      },
    ]);
  });

  it("reports an ordinary drop as lost, once", async () => {
    const h = handlers();
    const { socket } = await openWith(h);
    socket.drop(1006);
    socket.drop(1006);
    expect(h.closed).toEqual([
      { kind: "lost", message: "lost the connection to the signaling service" },
    ]);
  });

  it("leaving sends bye and reports nothing", async () => {
    const h = handlers();
    const { conn, socket } = await openWith(h);
    conn.close();
    socket.drop(4002, "bye");
    expect(socket.sent.at(-1)).toEqual({ type: "bye" });
    expect(h.closed).toEqual([]);
  });

  it("reports lost when no token can be had", async () => {
    const h = handlers();
    websocketSignaling("ws://127.0.0.1:9301/").open(
      {
        meetingId: "m1",
        identityToken: async () => Promise.reject(new Error("mint down")),
      },
      h,
    );
    await vi.waitFor(() =>
      expect(h.closed).toEqual([{ kind: "lost", message: "mint down" }]),
    );
    expect(FakeSocket.last).toBeNull();
  });
});
