// @ts-nocheck
// The ws client import has no bundled types (@types/ws is not a devDependency)
// and this file runs under the tools/call-eval checkJs budget (pinned at 316
// errors), so checking is disabled here rather than inflating the count.
//
// Protocol tests for the reference signaling server. These spawn the real
// process with a generated RS256 JWKS + members manifest and drive the wire
// contract the runner depends on: the ready line, hello/welcome, peer
// presence, offer/answer/ICE relay keyed by peer id, state broadcast, and the
// fail-closed auth paths (bad signature, wrong issuer, expiry, outsider,
// missing members file).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createSign, createPrivateKey, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const SERVER = fileURLToPath(new URL("./signaling-server.mjs", import.meta.url));
const ISSUER = "https://connvo-local-test.invalid";
const MEETING = "m-bench-1";
const MEMBERS = ["local-test-a", "local-test-b", "local-test-c"];

/** Minimal JWT mint matching the test-auth route's RS256 shape. */
function mintToken(privateJwk, claims) {
  const key = createPrivateKey({ key: privateJwk, format: "jwk" });
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT", kid: "connvo-local-test-1" });
  const payload = b64(claims);
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(key);
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

function tokenFor(privateJwk, sub, { issuer = ISSUER, atMinusNowS = 0 } = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  return mintToken(privateJwk, {
    sub,
    email: `${sub}@connvo-local.test`,
    iss: issuer,
    aud: "connvo-local-test",
    iat: nowS,
    exp: nowS + 600 - atMinusNowS,
  });
}

/** Tiny ws client with an ordered message queue and per-message timeouts. */
class WsClient {
  constructor(url) {
    this.messages = [];
    this.waiters = [];
    this.closedCode = null;
    this.error = null;
    this.opened = new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.on("open", resolve);
      this.ws.on("error", (err) => {
        this.error = err;
        reject(err);
      });
      this.closed = new Promise((resolve) => {
        this.ws.on("close", (code) => {
          this.closedCode = code;
          resolve(code);
          for (const w of this.waiters) w.fn(null);
          this.waiters = [];
        });
      });
      this.ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (process.env.SIGNAL_DEBUG) console.log(`[ws ${url.slice(-4)}] <-`, raw.toString());
        const waiterIdx = this.waiters.findIndex((w) => !w.filter || w.filter(msg));
        if (waiterIdx >= 0) {
          const [waiter] = this.waiters.splice(waiterIdx, 1); // consumed exactly once
          waiter.fn(msg);
        } else {
          this.messages.push(msg);
        }
      });
    });
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  /**
   * Resolves the next message, optionally filtered by type; unmatching
   * messages stay queued. Hello arrival order across two TCP connections is
   * not guaranteed, so assertions must not assume send order.
   */
  next(timeoutMs = 2000, filter = null) {
    const idx = this.messages.findIndex((m) => !filter || filter(m));
    if (idx >= 0) return Promise.resolve(this.messages.splice(idx, 1)[0]);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(entry);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve(null);
      }, timeoutMs);
      const entry = { fn: (msg) => { clearTimeout(timer); resolve(msg); }, filter };
      this.waiters.push(entry);
    });
  }
  /** next(), but also resolves null when the socket closes first. */
  async nextOrFail(timeoutMs = 2000, filter = null) {
    return Promise.race([this.next(timeoutMs, filter), this.closed.then(() => null)]);
  }
  close() {
    this.ws.close();
  }
}

function spawnServer(args) {
  const child = spawn(process.execPath, [SERVER, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  return child;
}

/** Waits for the pinned single ready line: {"ok":true,"port":<p>,"variant":"..."} */
function waitForReady(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`no ready line; stdout=${buf}`)), timeoutMs);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const line = buf.split("\n").find((l) => l.trim().length > 0);
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      }
    });
    child.stderr.on("data", (chunk) => {
      buf += chunk.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code}); stdout=${buf}`));
    });
  });
}

let dir;
let jwksPath;
let membersPath;
let privateJwk;
const servers = [];

beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" });
  publicJwk.kid = "connvo-local-test-1";
  publicJwk.alg = "RS256";
  privateJwk = privateKey.export({ format: "jwk" });

  dir = mkdtempSync(path.join(tmpdir(), "connvo-signal-"));
  jwksPath = path.join(dir, "jwks.json");
  membersPath = path.join(dir, "members.json");
  writeFileSync(jwksPath, JSON.stringify({ keys: [publicJwk] }));
  writeFileSync(membersPath, JSON.stringify({ meetingId: MEETING, members: MEMBERS }));
});

afterAll(() => {
  for (const child of servers) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});

function spawnOnPort(port) {
  const child = spawnServer([
    `--port=${port}`,
    "--variant=reference",
    `--jwks-file=${jwksPath}`,
    `--members-file=${membersPath}`,
  ]);
  servers.push(child);
  return child;
}

describe("reference signaling server", () => {
  it("prints exactly one JSON ready line and verifies membership on the happy path", async () => {
    const child = spawnOnPort(9305);
    const ready = await waitForReady(child);
    expect(ready).toEqual({ ok: true, port: 9305, variant: "reference" });

    const a = new WsClient("ws://127.0.0.1:9305");
    await a.opened;
    a.send({ type: "hello", token: tokenFor(privateJwk, "local-test-a"), meetingId: MEETING });
    const welcomeA = await a.next();
    expect(welcomeA.type).toBe("welcome");
    expect(welcomeA.selfId).toBe("local-test-a");

    const b = new WsClient("ws://127.0.0.1:9305");
    await b.opened;
    b.send({ type: "hello", token: tokenFor(privateJwk, "local-test-b"), meetingId: MEETING });
    const welcomeB = await b.next();
    expect(welcomeB.type).toBe("welcome");
    expect(welcomeB.selfId).toBe("local-test-b");

    // Hello arrival order is not guaranteed across two connections: exactly
    // one peer list is empty and the other holds the first joiner's subject.
    const peerLists = [welcomeA.peers, welcomeB.peers];
    expect(peerLists.filter((p) => p.length === 0)).toHaveLength(1);
    expect(peerLists.filter((p) => p.length === 1)).toHaveLength(1);
    for (const p of peerLists) {
      if (p.length === 1) expect(["local-test-a", "local-test-b"]).toContain(p[0]);
    }

    // Exactly one client hears the other's arrival: whoever's hello was
    // processed second (its own peer-joined is never broadcast to itself).
    const [joinedA, joinedB] = await Promise.all([
      a.nextOrFail(2000, (m) => m.type === "peer-joined"),
      b.nextOrFail(2000, (m) => m.type === "peer-joined"),
    ]);
    const arrivals = [joinedA, joinedB].filter(Boolean);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].participantId).toBe(joinedA ? "local-test-b" : "local-test-a");
    a.close();
    b.close();
    child.kill();
  }, 15000);

  it("relays offer/answer/ICE payloads keyed by peer id", async () => {
    const child = spawnOnPort(9306);
    await waitForReady(child);
    const a = new WsClient("ws://127.0.0.1:9306");
    const b = new WsClient("ws://127.0.0.1:9306");
    await Promise.all([a.opened, b.opened]);
    a.send({ type: "hello", token: tokenFor(privateJwk, "local-test-a"), meetingId: MEETING });
    b.send({ type: "hello", token: tokenFor(privateJwk, "local-test-b"), meetingId: MEETING });
    const welcomeA = await a.nextOrFail();
    const welcomeB = await b.nextOrFail();
    expect(welcomeA.type).toBe("welcome");
    expect(welcomeB.type).toBe("welcome");
    await a.nextOrFail(2000, (m) => m.type === "peer-joined");

    // An SDP description and an ICE candidate ride the relay verbatim.
    const isSignal = (m) => m.type === "signal";
    a.send({ type: "signal", to: "local-test-b", data: { description: { type: "offer", sdp: "v=0..." } } });
    a.send({ type: "signal", to: "local-test-b", data: { candidate: { candidate: "candidate:1", sdpMid: "0" } } });
    const desc = await b.nextOrFail(2000, isSignal);
    expect(desc).toEqual({ type: "signal", from: "local-test-a", data: { description: { type: "offer", sdp: "v=0..." } } });
    const cand = await b.nextOrFail(2000, isSignal);
    expect(cand).toEqual({ type: "signal", from: "local-test-a", data: { candidate: { candidate: "candidate:1", sdpMid: "0" } } });

    // State broadcast reaches the peer, not the sender.
    a.send({ type: "state", micOn: false, cameraOn: true });
    const stateOnB = await b.nextOrFail(2000, (m) => m.type === "remote-state");
    expect(stateOnB).toEqual({ type: "remote-state", from: "local-test-a", micOn: false, cameraOn: true });
    const nothingOnA = await a.next(400);
    expect(nothingOnA).toBeNull();

    a.close();
    b.close();
    child.kill();
  }, 15000);

  it("fails closed: bad signature, wrong issuer, expiry, outsider, no meeting, pre-hello traffic", async () => {
    const child = spawnOnPort(9307);
    await waitForReady(child);

    const expectAuthError = async (client, messagePart, closeCode) => {
      const err = await client.nextOrFail();
      expect(err.type).toBe("error");
      expect(err.code).toBe("auth");
      expect(err.message).toContain(messagePart);
      await client.closed; // the close code rides the async close handshake
      expect(client.closedCode).toBe(closeCode);
    };

    // Tampered signature (payload flips the subject after signing).
    const forged = tokenFor(privateJwk, "local-test-a").split(".");
    forged[1] = Buffer.from(
      JSON.stringify({ sub: "local-test-o", iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 600 }),
    ).toString("base64url");
    const sig = new WsClient("ws://127.0.0.1:9307");
    await sig.opened;
    sig.send({ type: "hello", token: forged.join("."), meetingId: MEETING });
    await expectAuthError(sig, "bad signature", 4004);

    // Untrusted issuer.
    const iss = new WsClient("ws://127.0.0.1:9307");
    await iss.opened;
    iss.send({ type: "hello", token: tokenFor(privateJwk, "local-test-a", { issuer: "https://evil.invalid" }), meetingId: MEETING });
    await expectAuthError(iss, "untrusted issuer", 4004);

    // Expired token.
    const exp = new WsClient("ws://127.0.0.1:9307");
    await exp.opened;
    exp.send({ type: "hello", token: tokenFor(privateJwk, "local-test-a", { atMinusNowS: 1200 }), meetingId: MEETING });
    await expectAuthError(exp, "token expired", 4004);

    // Valid token, subject not a participant of the meeting: the named
    // rejection H-14 renders in [data-testid="call-error"].
    const out = new WsClient("ws://127.0.0.1:9307");
    await out.opened;
    out.send({ type: "hello", token: tokenFor(privateJwk, "local-test-o"), meetingId: MEETING });
    await expectAuthError(out, "local-test-o is not a participant of meeting", 4006);

    // Unknown meeting id from a real member.
    const mtg = new WsClient("ws://127.0.0.1:9307");
    await mtg.opened;
    mtg.send({ type: "hello", token: tokenFor(privateJwk, "local-test-a"), meetingId: "no-such-meeting" });
    await expectAuthError(mtg, "is not a participant of meeting no-such-meeting", 4006);

    // hello without a meeting id.
    const nomeet = new WsClient("ws://127.0.0.1:9307");
    await nomeet.opened;
    nomeet.send({ type: "hello", token: tokenFor(privateJwk, "local-test-a"), meetingId: "" });
    await expectAuthError(nomeet, "no meeting id", 4005);

    // Traffic before hello is refused.
    const early = new WsClient("ws://127.0.0.1:9307");
    await early.opened;
    early.send({ type: "signal", to: "local-test-a", data: {} });
    await early.closed;
    expect(early.closedCode).toBe(4001);

    child.kill();
  }, 15000);

  it("refuses to start without a members file (fail closed)", async () => {
    const child = spawnServer([
      "--port=9308",
      "--variant=reference",
      `--jwks-file=${jwksPath}`,
    ]);
    servers.push(child);
    const exit = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    const [code, stderr] = await Promise.all([exit, new Promise((r) => child.stderr.on("data", (c) => r(c.toString())))]);
    expect(code).not.toBe(0);
    const errLine = JSON.parse(stderr.split("\n").find((l) => l.trim().length > 0));
    expect(errLine.ok).toBe(false);
    expect(errLine.error).toContain("fail closed");
  }, 15000);

  it("records client-initiated departures as 'left', network deaths as 'disconnected', and serves the log over HTTP", async () => {
    // H-10/H-11 evidence path (the mock relay's sessionEvents equivalent).
    // The old server never called recordDeparture, always broadcast reason
    // "disconnected", and exposed no events route — this test fails there.
    const child = spawnOnPort(9309);
    const ready = await waitForReady(child);
    const base = `http://127.0.0.1:${ready.port}`;

    const a = new WsClient("ws://127.0.0.1:9309");
    await a.opened;
    a.send({ type: "hello", token: tokenFor(privateJwk, "local-test-a"), meetingId: MEETING });
    expect((await a.next())?.type).toBe("welcome");

    const b = new WsClient("ws://127.0.0.1:9309");
    await b.opened;
    b.send({ type: "hello", token: tokenFor(privateJwk, "local-test-b"), meetingId: MEETING });
    expect((await b.next())?.type).toBe("welcome");

    // A leaves via bye: the server must close 4002, tell B the departure is
    // client-initiated ("left"), and record it.
    a.send({ type: "bye" });
    await a.closed;
    expect(a.closedCode).toBe(4002);
    const leftMsg = await b.nextOrFail(2000, (m) => m.type === "peer-left" && m.participantId === "local-test-a");
    expect(leftMsg?.reason).toBe("left");

    // B's socket dies without a bye: a network death ("disconnected").
    b.close();
    await b.closed;

    // The events log must show both departures with the right reasons.
    const poll = async () => (await (await fetch(`${base}/?events=1`)).json()).sessionEvents ?? [];
    let events = [];
    const deadline = Date.now() + 3000;
    do {
      events = await poll();
      if (events.length >= 2) break;
      await new Promise((r) => setTimeout(r, 200));
    } while (Date.now() < deadline);
    expect(events).toContainEqual(expect.objectContaining({ participant: "local-test-a", reason: "left" }));
    expect(events).toContainEqual(expect.objectContaining({ participant: "local-test-b", reason: "disconnected" }));

    // The plain health probe stays shaped as before (no events key).
    const health = await (await fetch(base)).json();
    expect(health).toEqual({ ok: true, variant: "reference", port: ready.port });

    child.kill();
  }, 15000);

  it("terminates a participant's socket on POST /drop without a bye (reference killPeerSocket hook)", async () => {
    const child = spawnOnPort(9302);
    await waitForReady(child);

    const b = new WsClient("ws://127.0.0.1:9302");
    await b.opened;
    b.send({ type: "hello", token: tokenFor(privateJwk, "local-test-b"), meetingId: MEETING });
    expect((await b.next())?.type).toBe("welcome");

    const res = await fetch("http://127.0.0.1:9302/drop?participant=local-test-b", { method: "POST" });
    expect(res.status).toBe(200);

    await b.closed;
    // terminate() is abrupt: no 4002 bye code, and the log records a network
    // death — the old server had no route, so this fails there.
    expect(b.closedCode).not.toBe(4002);

    const deadline = Date.now() + 3000;
    let events = [];
    do {
      events = (await (await fetch("http://127.0.0.1:9302/?events=1")).json()).sessionEvents ?? [];
      if (events.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    } while (Date.now() < deadline);
    expect(events).toContainEqual(expect.objectContaining({ participant: "local-test-b", reason: "disconnected" }));

    // Unknown participants fail with a named 404.
    const missing = await fetch("http://127.0.0.1:9302/drop?participant=nobody", { method: "POST" });
    expect(missing.status).toBe(404);

    child.kill();
  }, 15000);
});
