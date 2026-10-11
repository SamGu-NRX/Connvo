/**
 * launchPeer rtcConfig-resolution tests (reviewed bug: relay config bypass).
 *
 * launchPeer must treat null exactly like undefined — "no explicit config" —
 * and fall back to ctx.rtcConfigFor so the per-participant relay-only
 * configuration (coturn via that participant's shaper) applies. The old code
 * only fell back for undefined, so any explicit null silently bypassed the
 * shaper. peers.mjs is mocked out: these tests exercise the context's config
 * decision, not a browser.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./peers.mjs", () => ({
  launchPeer: vi.fn(async (opts) => ({
    peerId: opts.participant,
    page: { goto: async () => {}, evaluate: async () => "connected", click: async () => {} },
    close: async () => {},
  })),
}));

vi.mock("./shaper.mjs", () => ({
  createShaper: vi.fn((opts) => ({
    seed: opts.seed,
    port: 0,
    ready: Promise.resolve(),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
  })),
}));

import { RunContext } from "./context.mjs";
import { launchPeer as launchMock } from "./peers.mjs";
import { createShaper } from "./shaper.mjs";

function relayContext() {
  const ctx = new RunContext({ transport: "reference", baseUrl: "http://localhost:3311" });
  ctx._relayEnabled = true;
  // Stubbed coturn handle: rtcConfigFor only reads port/user/pass, and a
  // pre-seeded shaper avoids binding real UDP ports in a unit test.
  ctx.turn = { port: 3488, user: "eval-user", pass: "eval-pass", realm: "eval", stop() {} };
  ctx.shapers.set("A", { port: 3489, ready: Promise.resolve() });
  return ctx;
}

const RELAY_CONFIG = {
  iceServers: [{ urls: "turn:127.0.0.1:3489?transport=udp", username: "eval-user", credential: "eval-pass" }],
  iceTransportPolicy: "relay",
};

describe("RunContext.launchPeer rtcConfig resolution", () => {
  beforeEach(() => {
    vi.mocked(launchMock).mockClear(); // mock.calls accumulate across tests
  });
  it("falls back to the context's relay config when an explicit null is given", async () => {
    const ctx = relayContext();
    await ctx.launchPeer("A", {}, null);
    expect(vi.mocked(launchMock).mock.calls[0]?.[0]?.rtcConfig).toEqual(RELAY_CONFIG);
  });

  it("resolves the relay config when no rtcConfig is given", async () => {
    const ctx = relayContext();
    await ctx.launchPeer("A");
    expect(vi.mocked(launchMock).mock.calls[0]?.[0]?.rtcConfig).toEqual(RELAY_CONFIG);
  });

  it("uses an explicitly provided rtcConfig verbatim", async () => {
    const ctx = relayContext();
    const pinned = { iceServers: [], iceTransportPolicy: "all" };
    await ctx.launchPeer("A", {}, pinned);
    expect(vi.mocked(launchMock).mock.calls[0]?.[0]?.rtcConfig).toBe(pinned);
  });
});

describe("RunContext.setSeed shaper re-creation", () => {
  beforeEach(() => {
    vi.mocked(createShaper).mockClear();
  });

  it("re-creates shapers per seed so loss patterns re-derive per matrix row", async () => {
    const ctx = new RunContext({ transport: "reference", baseUrl: "http://localhost:3311" });
    ctx._relayEnabled = true;
    ctx.turn = { port: 3488, user: "eval-user", pass: "eval-pass", realm: "eval", stop() {} };

    await ctx.rtcConfigFor("A"); // lazily creates A's shaper from the constructor seed (1)
    expect(vi.mocked(createShaper).mock.calls[0]?.[0]).toEqual({ seed: 1 });
    const first = ctx.shapers.get("A");

    ctx.setSeed(7);
    expect(ctx.seed).toBe(7);
    expect(ctx.shapers.has("A")).toBe(false); // the seed-1 shaper is dropped…
    expect(first.stop).toHaveBeenCalled(); // …and stopped, not leaked

    await ctx.rtcConfigFor("A"); // re-resolves against the NEW seed
    expect(vi.mocked(createShaper).mock.calls.at(-1)?.[0]).toEqual({ seed: 7 });
    expect(ctx.shapers.get("A")).not.toBe(first);
  });

  it("recreates shapers with the new seed but keeps port assignment stable", async () => {
    const ctx = new RunContext({ transport: "reference", baseUrl: "http://localhost:3311" });
    ctx._relayEnabled = true;
    ctx.turn = { port: 3488, user: "eval-user", pass: "eval-pass", realm: "eval", stop() {} };
    ctx.shapers.set("A", { port: 3489, ready: Promise.resolve(), stop: vi.fn() });
    ctx._relayConfigCache.set("A", { iceServers: [] });

    ctx.setSeed(2);
    const config = await ctx.rtcConfigFor("A");
    // Same deterministic port slot (SHAPER_BASE_PORT default 3479 for
    // participant "A"), fresh shaper, config cache not reused across seeds.
    expect(config.iceServers[0].urls).toContain(":3479");
  });
});
