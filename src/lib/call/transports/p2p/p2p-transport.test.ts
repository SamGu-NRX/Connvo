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
