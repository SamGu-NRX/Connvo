/**
 * Per-run context: wires the mock server + signaling relay (or an external
 * base URL), coturn, per-participant UDP shapers, fixture paths, and meeting
 * identity. Scenarios never touch these pieces directly — they launch peers
 * through ctx and reach fault hooks (killPeerSocket, shaper profiles,
 * sessionEvents) through it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServer } from "./mock-server.mjs";
import { createTurn, turnAvailable, relayConfig } from "./turn.mjs";
import { createShaper } from "./shaper.mjs";

const RUNNER_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(RUNNER_DIR, "..", "fixtures");
const MOCK_DIR = path.join(RUNNER_DIR, "mock");

const FIXTURES = {
  A: { video: "peer-A.y4m", audio: "peer-A.wav" },
  B: { video: "peer-B.y4m", audio: "peer-B.wav" },
  C: { video: "peer-C.y4m", audio: "peer-C.wav" },
};
const SHAPER_BASE_PORT = 3479; // coturn owns 3478; shapers forward to it

/**
 * Mock runs navigate the bundled mock bench page; integration runs
 * (--base-url) navigate the real bench route, which registers one path
 * segment per transport name (/dev/call-bench/[transport]).
 *
 * @param {string} transport
 * @param {string | null} baseUrl
 * @returns {string}
 */
export function benchPathFor(transport, baseUrl) {
  return baseUrl ? `/dev/call-bench/${transport}` : "/mock-bench.html";
}

export class RunContext {
  /**
   * @param {object} opts
   * @param {string} [opts.transport] transport name (mock today; the bench
   *   route registers as its own transport name via --base-url)
   * @param {number} [opts.seed] run seed (shaper determinism)
   * @param {string | null} [opts.baseUrl] external page origin (integration mode)
   * @param {string} [opts.signalingStatePath] state.json override for the
   *   reference signaling members derivation (tests inject a synthetic one)
   * @param {(message: string) => void} [opts.log] progress logger
   */
  constructor({ transport = "mock", seed = 1, baseUrl = null, log = console.log, signalingStatePath } = {}) {
    this.transport = transport;
    this.seed = seed;
    this.baseUrl = baseUrl;
    this.log = log;
    this._signalingStatePath = signalingStatePath;
    this.url = baseUrl;
    this.server = null;
    this.relay = null;
    this.turn = null;
    this.shapers = new Map(); // participant -> shaper handle
    this.meetingId = null;
    this.signaling = null; // reference-transport signaling server handle (integration mode)
    this.signalUrl = null; // ws://127.0.0.1:<port> handed to the bench page as ?signal=
    this.seededMeetingId = null; // reference runs reuse the seeded meeting: the manifest pins one id
    this.benchPath = benchPathFor(transport, baseUrl);
    this._relayConfigCache = new Map(); // participant -> RTCConfiguration|null
    this._relayEnabled = false; // H-07/H-15 flip this on
    this._peers = new Set(); // live peer records - stop() closes them so failed scenarios never leak browsers
  }

  async start() {
    if (this.baseUrl) {
      this.url = this.baseUrl;
      // Integration runs against the bench route: the harness still owns the
      // TURN/shaper path; relay-dependent hooks (killPeerSocket) are absent
      // and scenarios must guard on them.
      await this.ensureTurn();
      await this.startReferenceSignalingIfWired();
      return this;
    }
    this.server = await startMockServer({ root: MOCK_DIR });
    this.relay = this.server.relay;
    this.url = this.server.url;
    await this.ensureTurn();
    return this;
  }

  async ensureTurn() {
    if (this.turn) return this.turn;
    if (!(await turnAvailable())) {
      throw new Error(
        "coturn (turnserver) is not installed — the H-07/H-15 fault path requires it. Install coturn or report the fault scenarios as blocked.",
      );
    }
    this.turn = await createTurn({ port: 3478 });
    return this.turn;
  }

  /**
   * Reference transports ride the eval-only signaling server; the runner owns
   * its lifecycle and feeds it --jwks-file / --members-file (H-14 design
   * note). The server pins ONE meetingId per manifest, so reference runs
   * reuse the seeded meeting instead of per-scenario ids.
   */
  async startReferenceSignalingIfWired() {
    const { referenceVariantFor, startReferenceSignaling } = await import("./reference-signaling.mjs");
    if (!referenceVariantFor(this.transport) || this.signaling) return;
    this.signaling = await startReferenceSignaling({
      transport: this.transport,
      ...(this._signalingStatePath ? { statePath: this._signalingStatePath } : {}),
      log: this.log,
    });
    this.signalUrl = this.signaling.signalUrl;
    this.seededMeetingId = JSON.parse(fs.readFileSync(this.signaling.membersPath, "utf8")).meetingId;
    this.log(`reference transport "${this.transport}": bench URL ${this.url}${this.benchPath}, signaling ${this.signalUrl}`);
  }

  /** Fresh meeting per scenario-seed for isolation. */
  newMeeting(name) {
    // The reference signaling server fail-closes membership against one
    // pinned meetingId — per-scenario ids would be rejected. Isolation there
    // comes from the server's re-hello socket replacement instead.
    this.meetingId = this.seededMeetingId ?? `${name}-${this.transport}-s${this.seed}-${Date.now()}`;
    this.relay?.reset();
    return this.meetingId;
  }

  /**
   * Relay-only RTCConfiguration for one participant (their own shaper port).
   * Returns null unless enableRelay() was called — the wrapper then uses the
   * page's own configuration.
   */
  async rtcConfigFor(participant) {
    if (!this._relayEnabled) return null;
    const cached = this._relayConfigCache.get(participant);
    if (cached) return cached;
    const turn = await this.ensureTurn();
    const shaper = this.shaperFor(participant);
    const config = relayConfig(turn, shaper.port);
    this._relayConfigCache.set(participant, config);
    return config;
  }

  /** H-07/H-15 call this before launching peers. */
  enableRelay() {
    this._relayEnabled = true;
  }

  shaperFor(participant) {
    let shaper = this.shapers.get(participant);
    if (!shaper) {
      shaper = createShaper({ seed: this.seed });
      const idx = ["A", "B", "C", "O"].indexOf(participant);
      const port = SHAPER_BASE_PORT + (idx >= 0 ? idx : this.shapers.size + 4);
      // Fire-and-bind; scenario code awaits .ready before applying profiles.
      shaper.ready = shaper.start({ listenPort: port, targetPort: this.turn.port });
      shaper.port = port;
      this.shapers.set(participant, shaper);
    }
    return shaper;
  }

  fixturePaths(participant) {
    const f = FIXTURES[participant] ?? FIXTURES.A;
    return {
      video: path.join(FIXTURES_DIR, f.video),
      audio: path.join(FIXTURES_DIR, f.audio),
    };
  }

  fixturesExist(participant) {
    const { video, audio } = this.fixturePaths(participant);
    return [video, audio].every((p) => fs.existsSync(p));
  }

  /**
   * Launch one peer page. `rtcConfig` overrides the participant-specific
   * default (joinPair passes a single config for both peers unless given
   * per-participant overrides).
   */
  async launchPeer(participant, params = {}, rtcConfig) {
    const config = rtcConfig !== undefined ? rtcConfig : await this.rtcConfigFor(participant);
    const { video, audio } = this.fixturePaths(participant);
    const { launchPeer: launch } = await import("./peers.mjs");
    const query = new URLSearchParams({ as: participant, meeting: this.meetingId ?? "bench-meeting", ...params });
    if (this.signalUrl) query.set("signal", this.signalUrl); // additive param: the page's reference client reads it; the mock page ignores it
    const peer = await launch({
      fixtureVideo: video,
      fixtureAudio: audio,
      baseUrl: this.url,
      benchPath: this.benchPath,
      rtcConfig: config,
      participant,
    });
    peer.__query = query;
    await peer.page.goto(`${this.url}${this.benchPath}?${query}`, { waitUntil: "domcontentloaded" });
    this._peers.add(peer);
    const origClose = peer.close.bind(peer);
    peer.close = () => {
      this._peers.delete(peer);
      return origClose();
    };
    return peer;
  }

  // Fault hooks (mock relay only; integration mode reports absence).
  killPeerSocket(participant) {
    if (!this.relay) {
      throw new Error(`killPeerSocket unavailable for transport "${this.transport}" — H-07's signaling drop needs the harness relay`);
    }
    return this.relay.killPeerSocket(participant);
  }

  sessionEvents() {
    return this.relay ? this.relay.sessionEvents() : [];
  }

  async stop() {
    await Promise.allSettled([...this._peers].map((p) => p.close()));
    this._peers.clear();
    for (const shaper of this.shapers.values()) shaper.stop();
    this.shapers.clear();
    this.turn?.stop();
    this.turn = null;
    this.signaling?.stop();
    this.signaling = null;
    this.signalUrl = null;
    this.seededMeetingId = null;
    if (this.server) await this.server.close();
    this.server = null;
    this.relay = null;
  }
}
