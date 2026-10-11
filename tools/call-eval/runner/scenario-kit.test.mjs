/**
 * joinPair config-resolution tests (reviewed bug: relay config bypass).
 *
 * The runner's joinPair must hand ctx.launchPeer NO rtcConfig so the context
 * resolves each participant's relay-only configuration (H-07/H-15 route media
 * through the harness's per-peer UDP shaper). The old code pinned
 * `rtcConfig = null` here, which launchPeer treated as an explicit override —
 * H-07 and H-15 silently bypassed the shaper (H-15 proved "loss" with an
 * RTT of 1 ms). The first test fails against that code because it captures
 * [null, null] instead of [undefined, undefined].
 */
import { describe, expect, it } from "vitest";
import { joinPair } from "./scenario-kit.mjs";

function fakePeer(id) {
  return {
    peerId: id,
    page: {
      // phaseIs sources are evaluated strings; the fake returns the phase
      // joinPair waits for, so no browser is needed.
      evaluate: async () => "connected",
      click: async () => {},
    },
    close: async () => {},
  };
}

function fakeCtx(captured) {
  return {
    launchPeer: async (participant, params, rtcConfig) => {
      captured.push({ participant, params, rtcConfig });
      return fakePeer(participant);
    },
  };
}

describe("joinPair rtcConfig resolution", () => {
  it("leaves rtcConfig unset so ctx.launchPeer resolves per-participant relay configs", async () => {
    const captured = [];
    const { peerA, peerB, tJoinMs } = await joinPair(fakeCtx(captured));
    expect(captured.map((c) => c.rtcConfig)).toEqual([undefined, undefined]);
    expect(peerA.peerId).toBe("A");
    expect(peerB.peerId).toBe("B");
    expect(tJoinMs).toBeGreaterThanOrEqual(0);
  });

  it("forwards an explicitly pinned rtcConfig unchanged", async () => {
    const captured = [];
    const pinned = { iceServers: [], iceTransportPolicy: "all" };
    await joinPair(fakeCtx(captured), { rtcConfig: pinned });
    expect(captured.map((c) => c.rtcConfig)).toEqual([pinned, pinned]);
  });
});
