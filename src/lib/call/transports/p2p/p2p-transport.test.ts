// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CallTransport, TransportEvents } from "../../transport";
import { createP2PTransport } from "./p2p-transport";
import type { P2PSignal, SignalingHandlers } from "./signaling";

class CaptureStream {
  constructor(private tracks: Array<{ kind: string; id: string }>) {}
  getTracks() {
    return this.tracks;
  }
}

class TestPeerConnection {
  static instances: TestPeerConnection[] = [];
  connectionState = "new";
  signalingState = "stable";
  localDescription: { toJSON: () => RTCSessionDescriptionInit } | null = null;
  onnegotiationneeded: (() => void) | null = null;
  slots: Array<{
    kind: string;
    direction: string;
    mid: string | null;
    stopped: boolean;
    sender: {
      track: { kind: string; id: string } | null;
      replaceTrack: (
        track: { kind: string; id: string } | null,
      ) => Promise<void>;
    };
  }> = [];

  constructor() {
    TestPeerConnection.instances.push(this);
  }

  addTransceiver(kind: string, { direction }: { direction: string }) {
    const sender = {
      track: null as { kind: string; id: string } | null,
      async replaceTrack(track: { kind: string; id: string } | null) {
        this.track = track;
      },
    };
    const slot = {
      kind,
      direction,
      sender,
      mid: null as string | null,
      stopped: false,
    };
    this.slots.push(slot);
    return slot;
  }

  addTrack(track: { kind: string; id: string }) {
    const slot = this.addTransceiver(track.kind, { direction: "sendrecv" });
    slot.sender.track = track;
    return slot.sender;
  }

  close() {
    this.connectionState = "closed";
  }
  getTransceivers() {
    return this.slots;
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.signalingState =
      description.type === "offer" ? "have-remote-offer" : "stable";
    // An incoming offer can reuse addTrack's audio slot, but leaves a
    // reserved addTransceiver slot unassociated until this side offers.
    this.slots[0].mid = "0";
  }
  async setLocalDescription() {
    const type =
      this.signalingState === "have-remote-offer" ? "answer" : "offer";
    if (type === "offer")
      this.slots.forEach((slot, index) => {
        slot.mid = String(index);
      });
    this.localDescription = { toJSON: () => ({ type, sdp: "test-sdp" }) };
    this.signalingState = type === "answer" ? "stable" : "have-local-offer";
  }
}

const events: TransportEvents = {
  onPhase() {},
  onRemoteJoined() {},
  onRemoteLeft() {},
  onRemoteStream() {},
  onRemoteState() {},
  onError() {},
};
const active: CallTransport[] = [];

afterEach(async () => {
  for (const transport of active.splice(0)) await transport.leave();
  TestPeerConnection.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function connect(tracks: Array<{ kind: string; id: string }>) {
  vi.stubGlobal("MediaStream", CaptureStream);
  vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
  let handlers: SignalingHandlers | undefined;
  const sent: P2PSignal[] = [];
  const transport = createP2PTransport({
    signaling: {
      open(_session, callbacks) {
        handlers = callbacks;
        return {
          send(_to, signal) {
            sent.push(signal);
          },
          publishState() {},
          close() {},
        };
      },
    },
  });
  active.push(transport);
  await transport.connect(
    {
      meetingId: "meeting",
      selfId: "A",
      identityToken: async () => "test",
      getLocalStream: () => new CaptureStream(tracks) as unknown as MediaStream,
    },
    events,
  );
  if (!handlers) throw new Error("transport did not open signaling");
  handlers.onWelcome(["B"]);
  return { transport, pc: TestPeerConnection.instances[0], handlers, sent };
}

describe("P2P camera publication", () => {
  it("offers the unassociated camera slot after answering an offer that cancelled its initial polite timer", async () => {
    vi.useFakeTimers();
    const { pc, handlers, sent } = await connect([
      { kind: "audio", id: "microphone" },
    ]);
    pc.onnegotiationneeded?.();
    await vi.advanceTimersByTimeAsync(100);
    handlers.onSignal("B", {
      description: { type: "offer", sdp: "remote-offer" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([
      { description: { type: "answer", sdp: "test-sdp" } },
    ]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent).toEqual([
      { description: { type: "answer", sdp: "test-sdp" } },
      { description: { type: "offer", sdp: "test-sdp" } },
    ]);
    expect(pc.slots.map((slot) => slot.mid)).toEqual(["0", "1"]);
    handlers.onSignal("B", {
      description: { type: "answer", sdp: "remote-answer" },
    });
    await vi.advanceTimersByTimeAsync(0);
    handlers.onSignal("B", {
      description: { type: "offer", sdp: "remote-restart" },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toEqual([
      { description: { type: "answer", sdp: "test-sdp" } },
      { description: { type: "offer", sdp: "test-sdp" } },
      { description: { type: "answer", sdp: "test-sdp" } },
    ]);
  });

  it("reserves sending video in the initial negotiation and fills the same slot after an audio-only join", async () => {
    const audio = { kind: "audio", id: "microphone" };
    const { transport, pc } = await connect([audio]);
    expect(
      pc.slots.map((slot) => ({
        kind: slot.kind,
        direction: slot.direction,
        track: slot.sender.track?.id ?? null,
      })),
    ).toEqual([
      { kind: "audio", direction: "sendrecv", track: "microphone" },
      { kind: "video", direction: "sendrecv", track: null },
    ]);

    const camera = { kind: "video", id: "camera-one" };
    const videoSender = pc.slots[1].sender;
    transport.publishLocalStream(
      new CaptureStream([audio, camera]) as unknown as MediaStream,
    );
    expect(videoSender.track).toEqual({ kind: "video", id: "camera-one" });
    transport.publishLocalStream(
      new CaptureStream([audio]) as unknown as MediaStream,
    );
    expect(videoSender.track).toBeNull();
    transport.publishLocalStream(
      new CaptureStream([
        audio,
        { kind: "video", id: "camera-two" },
      ]) as unknown as MediaStream,
    );
    expect(videoSender.track).toEqual({ kind: "video", id: "camera-two" });
    expect(pc.slots).toHaveLength(2);
  });

  it("keeps one video slot when capture already contains a camera", async () => {
    const { pc } = await connect([
      { kind: "audio", id: "microphone" },
      { kind: "video", id: "camera" },
    ]);
    expect(
      pc.slots.map((slot) => ({
        kind: slot.kind,
        track: slot.sender.track?.id,
      })),
    ).toEqual([
      { kind: "audio", track: "microphone" },
      { kind: "video", track: "camera" },
    ]);
  });
});

class FakeScreenTrack {
  kind = "video" as const;
  id = "screen-1";
  readyState: MediaStreamTrackState = "live";
  stopped = false;
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  end() {
    this.readyState = "ended";
    for (const listener of [...(this.listeners.get("ended") ?? [])]) listener();
  }
  stop() {
    this.stopped = true;
    this.readyState = "ended";
  }
}

describe("P2P screen share publication", () => {
  /** The interface keeps the method optional so transports may lack it. */
  const share = (transport: CallTransport, track: MediaStreamTrack | null) => {
    const publish = transport.publishScreenShare;
    if (!publish) throw new Error("transport lacks publishScreenShare");
    publish(track);
  };

  it("replaces the reserved camera slot with the screen and restores the camera when the track ends", async () => {
    const { transport, pc } = await connect([
      { kind: "audio", id: "microphone" },
      { kind: "video", id: "camera" },
    ]);
    const screen = new FakeScreenTrack();
    share(transport, screen as unknown as MediaStreamTrack);
    expect(pc.slots[1].sender.track?.id).toBe("screen-1");
    screen.end();
    expect(pc.slots[1].sender.track?.id).toBe("camera");
  });

  it("hands a peer that joins mid-share the screen from its first negotiation", async () => {
    const { transport, handlers } = await connect([
      { kind: "audio", id: "microphone" },
    ]);
    const screen = new FakeScreenTrack();
    share(transport, screen as unknown as MediaStreamTrack);
    handlers.onWelcome(["C"]);
    const latecomer = TestPeerConnection.instances[1];
    expect(
      latecomer.slots.map((slot) => slot.sender.track?.id ?? null),
    ).toEqual(["microphone", "screen-1"]);
  });

  it("keeps the screen while the camera is switched and restores it only when the share ends", async () => {
    const { transport, pc } = await connect([
      { kind: "audio", id: "microphone" },
      { kind: "video", id: "camera" },
    ]);
    const screen = new FakeScreenTrack();
    share(transport, screen as unknown as MediaStreamTrack);
    transport.publishLocalStream(
      new CaptureStream([
        { kind: "audio", id: "microphone" },
        { kind: "video", id: "camera-two" },
      ]) as unknown as MediaStream,
    );
    expect(pc.slots[1].sender.track?.id).toBe("screen-1");
    share(transport, null);
    expect(pc.slots[1].sender.track?.id).toBe("camera-two");
  });

  it("never stops the caller-owned screen track on leave", async () => {
    const { transport } = await connect([{ kind: "audio", id: "microphone" }]);
    const screen = new FakeScreenTrack();
    share(transport, screen as unknown as MediaStreamTrack);
    await transport.leave();
    expect(screen.stopped).toBe(false);
    expect(screen.readyState).toBe("live");
  });
});
