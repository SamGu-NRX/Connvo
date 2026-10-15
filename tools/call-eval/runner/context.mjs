/**
 * Per-run context: wires the mock server + signaling relay (or an external
 * base URL), the Node TURN relay, per-participant UDP shapers, fixture paths, and meeting
 * identity. Scenarios never touch these pieces directly — they launch peers
 * through ctx and reach fault hooks (killPeerSocket, shaper profiles,
 * sessionEvents) through it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServer } from "./mock-server.mjs";
import { createTurn, relayConfig } from "./turn.mjs";
import { createShaper } from "./shaper.mjs";
import { closedSessions, createEvalMeeting, installSignalingCut } from "./convex-signaling.mjs";
import { SECOND_CAMERA_ID, secondCameraInit } from "./second-camera.mjs";
import { loadContracts } from "./contracts.mjs";

const RUNNER_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(RUNNER_DIR, "..", "fixtures");
const MOCK_DIR = path.join(RUNNER_DIR, "mock");

/** @type {Record<string, {video: string, audio: string}>} */
const FIXTURES = {
  A: { video: "peer-A.y4m", audio: "peer-A.wav" },
  B: { video: "peer-B.y4m", audio: "peer-B.wav" },
  C: { video: "peer-C.y4m", audio: "peer-C.wav" },
  D: { video: "peer-D.y4m", audio: "peer-D.wav" },
};
// The TURN relay binds a free port unless pinned; shapers forward to it. The
// shaper ports stay fixed per participant (env override keeps concurrent runs
// on disjoint ranges).
const TURN_PORT = Number(process.env.CONNVO_EVAL_TURN_PORT) || 0;
const SHAPER_BASE_PORT = Number(process.env.CONNVO_EVAL_SHAPER_BASE_PORT) || 3479;

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
   * @param {"bench" | "real"} [opts.page] which page the peers open
   * @param {boolean} [opts.warmUp] load the bench page once before scoring (tests that never start Next pass false)
   * @param {string} [opts.signalingStatePath] state.json override for the
   *   reference signaling members derivation (tests inject a synthetic one)
   * @param {(message: string) => void} [opts.log] progress logger
   * @param {"reference" | "convex"} [opts.signaling] who carries call
   *   signaling: the eval reference server, or the local Convex backend
   *   (real page only; see convex-signaling.mjs)
   */
  constructor({ transport = "mock", seed = 1, baseUrl = null, page = "bench", log = console.log, signalingStatePath, warmUp = true, signaling = "reference" } = {}) {
    /** "bench" (/dev/call-bench/<transport>) or "real" (/app/call/<id>, the product page). */
    this.page = page;
    if (signaling !== "reference" && signaling !== "convex") throw new Error(`signaling must be reference or convex (got "${signaling}")`);
    if (signaling === "convex" && (page !== "real" || !baseUrl)) throw new Error("signaling over Convex runs on the real call page (--page=real --base-url=...)");
    this.signalingMode = signaling;
    this._warmUp = warmUp;
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
    /** @type {WeakMap<object, Awaited<ReturnType<typeof installSignalingCut>>>} peer -> its Convex signaling cut */
    this._signalingCuts = new WeakMap();
  }

  async start() {
    if (this.baseUrl) {
      this.url = this.baseUrl;
      // TURN starts lazily, only for the scenarios that force relay
      // (H-07/H-15): the rest must run on a machine without it.
      if (this.signalingMode === "reference") await this.startReferenceSignalingIfWired();
      if (this._warmUp) await this.warmUpBench();
      return this;
    }
    this.server = await startMockServer({ root: MOCK_DIR });
    this.relay = this.server.relay;
    this.url = this.server.url;
    return this;
  }

  /**
   * Load the bench page once, unscored, before the first scenario. `next dev`
   * compiles client chunks on the first browser load; without this the first
   * seed of a run measured that compile (about 30 s here) as join latency.
   */
  async warmUpBench() {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const path = this.page === "real" ? "/app/call/warm-up?as=A" : `${this.benchPath}?as=A&autojoin=0`;
      await page.goto(`${this.url}${path}`, { waitUntil: "networkidle", timeout: 120000 });
      await page.waitForSelector("[data-call-phase]", { timeout: 60000 });
    } finally {
      await browser.close();
    }
  }

  async ensureTurn() {
    if (this.turn) return this.turn;
    this.turn = await createTurn({ port: TURN_PORT });
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
      // No seeded state fixture -> self-sufficient bench mode (clean
      // checkout); a fixture opts back into the backend-mode JWKS/members
      // flow the H-14 machinery pins.
      bench: !this._signalingStatePath,
      ...(this._signalingStatePath ? { statePath: this._signalingStatePath } : {}),
      log: this.log,
    });
    this.signalUrl = this.signaling.signalUrl;
    if (this.signaling.benchMode) {
      // Bench mode accepts any meeting id, so scenarios keep their fresh
      // per-seed ids (isolation below); the seeded meeting only exists in
      // backend mode, where the manifest pins it.
      this.seededMeetingId = null;
    } else {
      const membersPath = this.signaling.membersPath;
      if (typeof membersPath !== "string") throw new Error("backend signaling started without a members manifest");
      this.seededMeetingId = JSON.parse(fs.readFileSync(membersPath, "utf8")).meetingId;
    }
    this.log(`reference transport "${this.transport}": bench URL ${this.url}${this.benchPath}, signaling ${this.signalUrl}`);
  }

  /** Fresh meeting per scenario-seed for isolation. */
  /** @param {string} name */
  newMeeting(name) {
    if (this.signalingMode === "convex") {
      // A real meeting row: the mesh API refuses unknown meetings.
      this.meetingId = createEvalMeeting(`${name} s${this.seed}`);
      this._relayEnabled = false;
      this._relayConfigCache.clear();
      return this.meetingId;
    }
    // Backend mode: the reference signaling server fail-closes membership
    // against one pinned meetingId — per-scenario ids would be rejected.
    // Bench mode (no manifest) always uses fresh per-scenario ids. Isolation
    // in both cases comes from the server's re-hello socket replacement.
    this.meetingId = this.seededMeetingId ?? `${name}-${this.transport}-s${this.seed}-${Date.now()}`;
    this.relay?.reset();
    // Relay forcing is per scenario: H-07 or H-15 turn it on, and it must
    // not leak into every scenario that runs after them.
    this._relayEnabled = false;
    this._relayConfigCache.clear();
    return this.meetingId;
  }

  /**
   * Relay-only RTCConfiguration for one participant (their own shaper port).
   * Returns null unless enableRelay() was called — the wrapper then uses the
   * page's own configuration.
   */
  /** @param {string} participant */
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

  /**
   * Per-scenario-seed determinism: shaper loss patterns derive from the seed
   * PRNG, so a new seed must re-create the shapers (the reviewed bug kept the
   * constructor seed for every run of the matrix). Live shapers are stopped
   * and the relay-config cache dropped — re-created shapers rebind the same
   * per-participant ports.
   */
  /** @param {number} seed */
  setSeed(seed) {
    this.seed = seed;
    if (this.shapers.size > 0) {
      for (const shaper of this.shapers.values()) shaper.stop();
      this.shapers.clear();
      this._relayConfigCache.clear();
    }
  }

  /** @param {string} participant */
  shaperFor(participant) {
    let shaper = this.shapers.get(participant);
    if (!shaper) {
      shaper = createShaper({ seed: this.seed });
      const idx = ["A", "B", "C", "O", "D"].indexOf(participant);
      const port = SHAPER_BASE_PORT + (idx >= 0 ? idx : this.shapers.size + 4);
      // Fire-and-bind; scenario code awaits .ready before applying profiles.
      // TURN starts here on first use, not at run start.
      shaper.ready = this.ensureTurn().then((turn) => shaper.start({ listenPort: port, targetPort: turn.port }));
      shaper.port = port;
      this.shapers.set(participant, shaper);
    }
    return shaper;
  }

  /** @param {string} participant */
  fixturePaths(participant) {
    const f = FIXTURES[participant] ?? FIXTURES.A;
    return {
      video: path.join(FIXTURES_DIR, f.video),
      audio: path.join(FIXTURES_DIR, f.audio),
    };
  }

  /** @param {string} participant */
  fixturesExist(participant) {
    const { video, audio } = this.fixturePaths(participant);
    return [video, audio].every((p) => fs.existsSync(p));
  }

  /**
   * Launch one peer page. `rtcConfig` overrides the per-participant default;
   * null or undefined both mean "no explicit config" — the context then
   * resolves the relay-only config itself (H-07/H-15 route media through the
   * participant's shaper). joinPair deliberately passes neither.
   */
  /**
   * @param {string} participant
   * @param {Record<string, string>} [params]
   * @param {object | null} [rtcConfig]
   * @param {{ fullChromium?: boolean }} [opts]
   */
  async launchPeer(participant, params = {}, rtcConfig, { fullChromium = false } = {}) {
    const config = rtcConfig ?? (await this.rtcConfigFor(participant));
    const { video, audio } = this.fixturePaths(participant);
    const { launchPeer: launch } = await import("./peers.mjs");
    const query = new URLSearchParams({ as: participant, meeting: this.meetingId ?? "bench-meeting", ...params });
    if (this.signalUrl) query.set("signal", this.signalUrl); // additive param: the page's reference client reads it; the mock page ignores it
    if (!this.url) throw new Error("RunContext must start before launching a peer");
    const peer = await launch({
      fixtureVideo: video,
      fixtureAudio: audio,
      baseUrl: this.url,
      rtcConfig: config,
      participant,
      fullChromium,
    });
    if (this.page === "real") {
      // H-05: the real page switches cameras from its device menu, so it
      // needs a second camera to pick.
      const { SECOND_CAMERA_COLOR } = loadContracts();
      await peer.context.addInitScript(/** @type {any} */ (secondCameraInit), { deviceId: SECOND_CAMERA_ID, color: [...SECOND_CAMERA_COLOR] });
    }
    if (this.signalingMode === "convex") this._signalingCuts.set(peer, await installSignalingCut(peer.context));
    if (this.page === "real") {
      await this.openRealPage(peer, participant, params);
    } else {
      await peer.page.goto(`${this.url}${this.benchPath}?${query}`, { waitUntil: "domcontentloaded" });
    }
    this._peers.add(peer);
    const origClose = peer.close.bind(peer);
    peer.close = () => {
      this._peers.delete(peer);
      return origClose();
    };
    return peer;
  }

  /**
   * The real call page has a lobby and no auto-join, so a peer joins the way
   * a person does: once the preview is ready, press Join call. `autojoin=0`
   * leaves it in the lobby. `delayJoin` waits that long before pressing Join:
   * on the real page that holds the lobby for 5 s; it does not slow the
   * network join the way the bench's delay does.
   * @param {{ page: import('@playwright/test').Page }} peer
   * @param {string} participant
   * @param {Record<string, string>} params
   */
  async openRealPage(peer, participant, params) {
    const q = new URLSearchParams({ as: participant });
    if (params.name) q.set("name", params.name);
    if (this.signalUrl) q.set("signal", this.signalUrl);
    const meeting = encodeURIComponent(this.meetingId ?? "bench-meeting");
    await peer.page.goto(`${this.url}/app/call/${meeting}?${q}`, { waitUntil: "domcontentloaded" });
    if (params.autojoin === "0") return;
    const delay = Number(params.delayJoin ?? 0);
    void (async () => {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      await peer.page.locator('[data-testid="join-call"]:not([disabled])').click({ timeout: 30000 }).catch(() => {});
    })();
  }

  /**
   * Press Join call once the lobby allows it (the real page after a reload
   * or after Rejoin). The bench joins by itself.
   * @param {{ page: import('@playwright/test').Page }} peer
   */
  async joinFromLobby(peer) {
    if (this.page !== "real") return;
    await peer.page.locator('[data-testid="join-call"]:not([disabled])').click({ timeout: 30000 });
  }

  /**
   * H-05: switch to the second camera. The bench has a button for it; the
   * real page picks it from the device menu, as a person would.
   * @param {{ page: import('@playwright/test').Page }} peer
   */
  async switchCamera(peer) {
    if (this.page !== "real") {
      await peer.page.click('[data-testid="switch-camera"]');
      return;
    }
    await peer.page.click('[data-testid="device-settings"]');
    await peer.page.selectOption("#device-camera", SECOND_CAMERA_ID, { timeout: 5000 });
    await peer.page.keyboard.press("Escape");
  }

  /**
   * The Convex signaling cut of the participant's most recent live peer.
   * @param {string} participant
   */
  _signalingCut(participant) {
    const peer = [...this._peers].filter((p) => p.peerId === participant).pop();
    const cut = peer && this._signalingCuts.get(peer);
    if (!cut) throw new Error(`no live peer ${participant} with a Convex signaling cut`);
    return cut;
  }

  // Fault hooks (mock relay only; integration mode reports absence).
  /** @param {string} participant */
  killPeerSocket(participant) {
    if (this.signalingMode === "convex") return this._signalingCut(participant).cut();
    if (this.relay) return this.relay.killPeerSocket(participant);
    // Reference transports: the signaling server exposes the same fault
    // hook (POST /drop) — the peer's socket dies without a bye, exactly
    // like the mock relay's socket kill.
    if (this.signaling?.dropParticipant) return this.signaling.dropParticipant(participant);
    throw new Error(`killPeerSocket unavailable for transport "${this.transport}" — no relay and no reference signaling handle`);
  }

  /**
   * Bring a cut peer's signaling back. The reference server and the relay
   * kill one socket and the client reconnects by itself, so only the Convex
   * cut, which holds the network down, needs this.
   * @param {string} participant
   */
  async restorePeerSocket(participant) {
    if (this.signalingMode === "convex") await this._signalingCut(participant).restore();
  }

  sessionEvents() {
    if (this.signalingMode === "convex") return this.meetingId ? closedSessions(this.meetingId) : [];
    // Mock relay keeps the log in-process; the reference transports' log
    // lives in the spawned signaling server (GET /?events=1). Neither → [].
    if (this.relay) return this.relay.sessionEvents();
    if (this.signaling) return this.signaling.sessionEvents();
    return [];
  }

  /** Close every peer browser a scenario launched (runOne calls this after each run). */
  async closePeers() {
    await Promise.allSettled([...this._peers].map((p) => p.close()));
    this._peers.clear();
  }

  async stop() {
    await this.closePeers();
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
