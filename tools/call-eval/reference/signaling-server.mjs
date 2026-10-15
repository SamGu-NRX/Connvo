#!/usr/bin/env node
/**
 * Reference WebSocket signaling server for the S0 eval bench.
 *
 * Pinned CLI (CONTRACT.md "Reference signaling server CLI"):
 *   node tools/call-eval/reference/signaling-server.mjs \
 *     --port=<9301..9310> \
 *     --variant=<reference|no-audio|never-close|no-reconnect|outsider-allowed> \
 *     [--jwks-file=<path>] [--members-file=<path>]
 *
 * Prints exactly one JSON line {"ok":true,"port":<p>,"variant":"..."} to
 * stdout when ready. JWKS from --jwks-file or CONNVO_LOCAL_TEST_JWKS_FILE.
 *
 * Auth (fail closed): the first message on every socket must be
 * {type:"hello", token, meetingId}; the token is an RS256 bearer JWT minted
 * by the test-auth route (issuer https://connvo-local-test.invalid). The
 * signature, issuer and expiry are always verified. Meeting membership is
 * verified against --members-file ({"meetingId":"...","members":["local-test-a",...]}
 * — the runner derives it from state.json's seeded users, A/B/C being the
 * seeded meeting's participants). The `outsider-allowed` variant skips ONLY
 * the membership check (H-14's broken variant); every other variant rejects
 * unknown meetings/subjects with a named auth error, which is what H-14
 * asserts on the reference transport.
 *
 *
 * Bench mode (--bench=1) is the self-sufficient eval default: the server
 * generates its own RS256 keypair in-process and mints the bench identities
 * (subjects A and B) at POST /mint, so a clean checkout runs the H scenarios
 * with no Convex backend, no JWKS file and no seeded state. The membership
 * check accepts any meeting id and only the fixed bench subjects. Eval-only,
 * loopback-only, per-run keys.
 * The no-audio / never-close / no-reconnect variants behave identically to
 * `reference` on the wire: their breakage lives in the client
 * (tools/call-eval/reference/client.mjs), which receives the same variant
 * name. The server accepts the flag so the runner's transport→variant
 * mapping is symmetric and the pinned CLI stays the single spawn surface.
 *
 * EVAL-ONLY: binds loopback only; never deployed.
 */

import http from "node:http";
import { createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { WebSocketServer } from "ws";

const LOCAL_TEST_ISSUER = "https://connvo-local-test.invalid";
const PORT_MIN = 9301;
const PORT_MAX = 9310;
const VARIANTS = [
  "reference",
  "no-audio",
  "never-close",
  "no-reconnect",
  "outsider-allowed",
];

/** @param {string} message @param {number} [code] @returns {never} */
function fail(message, code = 1) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(code);
}

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const arg = (/** @type {string} */ name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const port = Number(arg("port"));
const variant = arg("variant");
if (!port || !Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
  fail(`--port must be an integer in [${PORT_MIN}..${PORT_MAX}]`);
}
if (!variant || !VARIANTS.includes(variant)) {
  fail(`--variant must be one of: ${VARIANTS.join(", ")}`);
}

// Bench mode (--bench=1) is self-sufficient: the server mints the bench
// identities itself, so no JWKS is loaded.
const bench = arg("bench") === "1";
const jwksPath = bench ? null : (arg("jwks-file") ?? process.env.CONNVO_LOCAL_TEST_JWKS_FILE);
/** @type {import("node:crypto").KeyObject} */
let publicKey;
/** @type {import("node:crypto").KeyPairKeyObjectResult | null} */
let benchKeys = null;
if (bench) {
  benchKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  publicKey = benchKeys.publicKey;
} else {
  if (!jwksPath || !existsSync(jwksPath)) {
    fail(`JWKS not found (${jwksPath ?? "none given"}); pass --jwks-file or set CONNVO_LOCAL_TEST_JWKS_FILE`);
  }
  try {
    const jwks = JSON.parse(readFileSync(jwksPath, "utf8"));
    const jwk = jwks.keys.find((/** @type {import("node:crypto").JsonWebKey} */ k) => k.kty === "RSA");
    if (!jwk) fail("JWKS has no RSA key");
    publicKey = createPublicKey({ key: jwk, format: "jwk" });
  } catch (err) {
    fail(`JWKS unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Membership manifest: {"meetingId": "...", "members": ["local-test-a", ...]}.
// Optional only for the outsider-allowed variant; required (fail closed)
// otherwise so a runner wiring bug cannot silently pass outsiders.
const membersPath = arg("members-file");
let membership = null;
if (bench) {
  // One identity scheme end to end: the bench subjects ARE the harness ids
  // A/B — tokens, rooms, event logs and scenario lookups all use them. Any
  // meeting id is accepted; the runner's scenarios own the meeting ids.
  membership = { meetingId: null, members: ["A", "B", "C", "D"] };
} else if (membersPath) {
  try {
    membership = JSON.parse(readFileSync(membersPath, "utf8"));
    if (!membership?.meetingId || !Array.isArray(membership.members)) {
      fail("members-file must be {meetingId, members:[subject,...]}");
    }
  } catch (err) {
    fail(`members-file unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
} else if (variant !== "outsider-allowed") {
  fail("fail closed: --members-file is required unless --variant=outsider-allowed");
}

// ---------------------------------------------------------------- token
/** @param {unknown} token */
function verifyToken(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return { error: "malformed token" };
  const [headB64, payloadB64, sigB64] = parts;
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(headB64, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { error: "malformed token" };
  }
  if (header.alg !== "RS256") return { error: "algorithm not allowed" };
  const ok = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(`${headB64}.${payloadB64}`),
    publicKey,
    Buffer.from(sigB64, "base64url"),
  );
  if (!ok) return { error: "bad signature" };
  if (payload.iss !== LOCAL_TEST_ISSUER) return { error: "untrusted issuer" };
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
    return { error: "token expired" };
  }
  if (typeof payload.sub !== "string" || !payload.sub) return { error: "token has no subject" };
  return { subject: payload.sub, name: payload.name ?? payload.sub };
}

// ---------------------------------------------------------------- rooms
// meetingId -> Map<subject, socket>. One socket per subject; a re-hello
// replaces the old socket (peer reload, H-09) and everyone sees peer-left
// then peer-joined for the same participantId.
/** @type {Map<string, Map<string, import('ws').WebSocket>>} */
const rooms = new Map();

// Session events for the harness's H-10/H-11 evidence (mock-relay
// sessionEvents equivalent): one entry per terminal room departure. A bye
// marks the departure client-initiated ("left", the mock relay's session
// vocabulary); a bare close is a network death ("disconnected").
/** @type {Array<{ participant: string, reason: string, at: number }>} */
const sessionEvents = [];
/** @type {WeakMap<object, string>} */
const leaveReasonBySocket = new WeakMap();
/** Last ping per socket; only sockets that ever pinged are swept. */
/** @type {Map<import('ws').WebSocket, number>} */
const lastPingBySocket = new Map();
const HEARTBEAT_SWEEP_MS = 10000;
setInterval(() => {
  const now = Date.now();
  for (const [sock, at] of lastPingBySocket) {
    if (sock.readyState !== sock.OPEN) lastPingBySocket.delete(sock);
    else if (now - at > HEARTBEAT_SWEEP_MS) {
      lastPingBySocket.delete(sock);
      sock.terminate();
    }
  }
}, 2000).unref();
/** participant id -> its live socket; the reference killPeerSocket hook uses this. */
const socketsByParticipant = new Map();

/** @param {string} participant @param {string} reason */
function recordDeparture(participant, reason) {
  sessionEvents.push({ participant, reason, at: Date.now() });
  if (sessionEvents.length > 500) sessionEvents.splice(0, sessionEvents.length - 500);
}

/** @param {Map<string, import("ws").WebSocket> | undefined} room @param {object} message @param {import("ws").WebSocket | null} [exceptSocket] */
function broadcast(room, message, exceptSocket = null) {
  for (const sock of room?.values() ?? []) {
    if (sock !== exceptSocket && sock.readyState === sock.OPEN) {
      sock.send(JSON.stringify(message));
    }
  }
}

const server = http.createServer((req, res) => {
  // Health probe used by the runner before it points peers at the server.
  // GET /?events=1 also returns the session-event log (H-10/H-11 evidence
  // for the reference transports — the in-memory mock relay's equivalent).
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  // Fault hook, transport-uniform with the mock relay's killPeerSocket:
  // terminates the participant's socket WITHOUT a bye, so the close handler
  // records a network death ("disconnected") exactly as a tab kill would.
  if (req.method === "POST" && url.pathname === "/drop") {
    const who = url.searchParams.get("participant");
    const sock = who ? socketsByParticipant.get(who) : null;
    if (!sock) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: `no live socket for participant ${who ?? "?"}` }));
      return;
    }
    sock.terminate();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, dropped: who }));
    return;
  }
  // Bench identity minting: the bench page swaps its signal URL's ws scheme
  // for http and POSTs {user} here — no Convex, no JWKS file, no seeded
  // state. Fail closed: only the fixed bench subjects mint, and only in
  // bench mode.
  if (req.method === "OPTIONS" && url.pathname === "/mint") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-allow-private-network": "true",
    });
    res.end();
    return;
  }
  if (req.method === "POST" && url.pathname === "/mint") {
    /** @param {number} status @param {string} error */
    const deny = (status, error) => {
      res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ ok: false, error }));
    };
    if (!bench || !benchKeys) {
      deny(404, "mint requires --bench=1");
      return;
    }
    /** @type {Uint8Array[]} */
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let user = null;
      try {
        user = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.user ?? null;
      } catch {
        /* malformed body handled below */
      }
      if (!membership.members.includes(user)) {
        deny(403, `mint: unknown bench user ${JSON.stringify(user ?? null)}`);
        return;
      }
      const nowS = Math.floor(Date.now() / 1000);
      /** @param {object} o */
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const input = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ sub: user, iss: LOCAL_TEST_ISSUER, iat: nowS, exp: nowS + 600 })}`;
      const sig = cryptoSign("sha256", Buffer.from(input), benchKeys.privateKey).toString("base64url");
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ ok: true, subject: user, token: `${input}.${sig}` }));
    });
    return;
  }
  if (url.searchParams.get("events")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, variant, port: addr.port, sessionEvents }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, variant, port: addr.port }));
});

// A bind/port failure must exit with the pinned JSON error shape instead of
// an unhandled exception, so the runner's spawn can parse the failure.
server.on("error", (err) => {
  fail(`signaling server failed to start: ${err instanceof Error ? err.message : String(err)}`);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  /** Which subject this socket has authenticated as; null until hello. */
  /** @type {string | null} */
  let self = null;
  /** The meetingId this socket joined; null until hello. */
  /** @type {string | null} */
  let joinedMeeting = null;

  // A socket-level error (protocol violation, oversized frame, aborted
  // connection) must not crash the eval server; closing the socket lets the
  // close handler run the room cleanup and broadcast peer-left.
  socket.on("error", () => {
    try {
      socket.close();
    } catch {
      /* already dead */
    }
  });

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      socket.close(4000, "unparseable message");
      return;
    }

    if (msg.type !== "hello") {
      if (!self || !joinedMeeting) {
        socket.close(4001, "hello required");
        return;
      }
      const room = rooms.get(joinedMeeting);
      if (msg.type === "signal") {
        const target = room?.get(msg.to);
        if (target && target.readyState === target.OPEN) {
          target.send(JSON.stringify({ type: "signal", from: self, data: msg.data }));
        }
        return;
      }
      if (msg.type === "state") {
        broadcast(
          room,
          { type: "remote-state", from: self, micOn: !!msg.micOn, cameraOn: !!msg.cameraOn },
          socket,
        );
        return;
      }
      if (msg.type === "ping") {
        // Heartbeat (p2p transport). A socket that has pinged and then goes
        // silent is swept below, so a half-open peer leaves the room.
        lastPingBySocket.set(socket, Date.now());
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (msg.type === "bye") {
        leaveReasonBySocket.set(socket, "left"); // client-initiated: the close handler records "left"
        socket.close(4002, "bye");
        return;
      }
      socket.close(4003, "unknown message type");
      return;
    }

    // ---- hello: verify token, then membership (fail closed) ----
    const verdict = verifyToken(msg.token);
    if (verdict.error) {
      socket.send(JSON.stringify({ type: "error", code: "auth", message: `signaling rejected: ${verdict.error}` }));
      socket.close(4004, verdict.error);
      return;
    }
    const meetingId = String(msg.meetingId ?? "");
    if (!meetingId) {
      socket.send(JSON.stringify({ type: "error", code: "auth", message: "signaling rejected: no meeting id" }));
      socket.close(4005, "no meeting id");
      return;
    }
    if (bench) {
      const allowed = membership.members.includes(verdict.subject);
      if (!allowed) {
        socket.send(JSON.stringify({ type: "error", code: "auth", message: `signaling rejected: ${verdict.subject} is not a bench participant` }));
        socket.close(4006, "not a participant");
        return;
      }
    } else if (variant !== "outsider-allowed") {
      const allowed = membership && membership.meetingId === meetingId && membership.members.includes(verdict.subject);
      if (!allowed) {
        // Named rejection — H-14 renders this message in [data-testid="call-error"].
        socket.send(
          JSON.stringify({
            type: "error",
            code: "auth",
            message: `signaling rejected: ${verdict.subject} is not a participant of meeting ${meetingId}`,
          }),
        );
        socket.close(4006, "not a participant");
        return;
      }
    }

    // ---- authenticated: join (or replace) the room ----
    const room = rooms.get(meetingId) ?? new Map();
    rooms.set(meetingId, room);
    joinedMeeting = meetingId;

    const old = room.get(verdict.subject);
    if (old) {
      if (old !== socket && old.readyState === old.OPEN) old.close(4007, "replaced by re-join");
      broadcast(room, { type: "peer-left", participantId: verdict.subject, reason: "rejoined" }, socket);
    }
    self = verdict.subject;
    room.set(self, socket);
    socketsByParticipant.set(self, socket);

    const peers = [...room.keys()].filter((id) => id !== self);
    socket.send(JSON.stringify({ type: "welcome", selfId: self, peers }));
    broadcast(room, { type: "peer-joined", participantId: self }, socket);
  });

  socket.on("close", () => {
    if (self && joinedMeeting) {
      const room = rooms.get(joinedMeeting);
      if (room && room.get(self) === socket) {
        room.delete(self);
        // A bye marks the departure client-initiated ("left"); a bare close
        // is a network death ("disconnected"). The re-join replacement path
        // never reaches here — the room entry already names the replacing
        // socket.
        const reason = leaveReasonBySocket.get(socket) ?? "disconnected";
        recordDeparture(self, reason);
        broadcast(room, { type: "peer-left", participantId: self, reason });
        if (room.size === 0) rooms.delete(joinedMeeting);
      }
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  // Exactly one JSON line when ready (pinned).
  console.log(JSON.stringify({ ok: true, port: typeof server.address() === "object" && server.address() !== null ? port : null, variant, ...(bench ? { mint: true } : {}) }));
});
