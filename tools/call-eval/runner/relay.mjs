/**
 * Minimal RFC6455 WebSocket signaling relay for the S0 harness (no deps: `ws`
 * is not in the tree and adding it would exceed the pinned devDependency set).
 * The relay attaches to the mock HTTP server, validates participants, routes
 * perfect-negotiation signals, tracks heartbeats, and exposes the H-07/H-11
 * fault hooks (kill a peer's signaling socket; session-closed events).
 *
 * Page -> relay messages:
 *   { type: "join", meeting, participant, name? }
 *   { type: "signal", to, payload }        // SDP/ICE, relayed verbatim
 *   { type: "state", state }               // mute/camera flags, broadcast
 *   { type: "heartbeat" }
 * Relay -> page messages:
 *   { type: "present", participant }       // peer joined (incl. rejoin)
 *   { type: "peers", participants }        // existing peers at join time
 *   { type: "signal", from, payload }
 *   { type: "state", participant, state }
 *   { type: "left", participant }
 *   { type: "reject", reason }             // named rejection (H-14), then close
 *   { type: "bye" }                        // relay shutting down
 */
import crypto from "node:crypto";
import http from "node:http";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

/** Parse one complete client frame (masked, small text payloads). */
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return null;
  const payload = Buffer.allocUnsafe(len);
  if (masked) {
    const mask = buf.subarray(off, off + 4);
    const data = buf.subarray(off + 4, off + 4 + len);
    for (let i = 0; i < len; i++) payload[i] = data[i] ^ mask[i % 4];
  } else {
    buf.copy(payload, 0, off + maskLen, off + maskLen + len);
  }
  return { fin, opcode, payload, total: off + maskLen + len };
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Attach the relay to an existing HTTP server (shares the mock page's port). */
export function attachRelay(httpServer, { participants = ["A", "B", "C"], trace = process.env.CALL_EVAL_RELAY_TRACE === "1" } = {}) {
  const sessions = new Map(); // participant -> { ws, meeting, lastHeartbeat, name }
  const sessionEvents = []; // { participant, reason, at } for H-11 evidence
  const sockets = new Set();

  const log = (...args) => {
    if (trace) console.log("[relay]", ...args);
  };

  function send(ws, obj) {
    try {
      ws.write(encodeFrame(0x1, Buffer.from(JSON.stringify(obj))));
    } catch {
      /* socket died mid-write; heartbeat sweep will clean up */
    }
  }

  function broadcast(obj, exceptParticipant = null) {
    for (const [pid, sess] of sessions) {
      if (pid !== exceptParticipant) send(sess.ws, obj);
    }
  }

  function closeSession(participant, reason) {
    const sess = sessions.get(participant);
    if (!sess) return;
    sessions.delete(participant);
    sessionEvents.push({ participant, reason, at: Date.now() });
    broadcast({ type: "left", participant });
    log("session closed", participant, reason);
  }

  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    for (const [pid, sess] of sessions) {
      if (now - sess.lastHeartbeat > 5000) closeSession(pid, "heartbeat-timeout");
    }
  }, 1000);

  httpServer.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (!key || (req.headers.upgrade || "").toLowerCase() !== "websocket") {
      socket.destroy();
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    sockets.add(socket);
    let acc = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      acc = Buffer.concat([acc, chunk]);
      for (;;) {
        const frame = decodeFrame(acc);
        if (!frame) break;
        acc = acc.subarray(frame.total);
        if (frame.opcode === 0x8) {
          // close
          socket.end();
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(encodeFrame(0xa, Buffer.alloc(0))); // ping -> pong
          continue;
        }
        if (frame.opcode !== 0x1) continue;
        let msg;
        try {
          msg = JSON.parse(frame.payload.toString("utf8"));
        } catch {
          continue;
        }
        try {
          handle(msg, socket);
        } catch (err) {
          log("handler error", err?.message);
        }
      }
    });

    const cleanup = () => {
      sockets.delete(socket);
      for (const [pid, sess] of sessions) {
        if (sess.ws === socket) {
          // A dropped socket without a leave is a NETWORK failure, not a
          // clean exit: H-07 depends on presence persisting until the
          // heartbeat sweep (or rejoin) resolves it. Only an explicit
          // "leave" message closes a session immediately.
          sess.ws = null;
          sess.disconnectedAt = Date.now();
        }
      }
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);

    function handle(msg, sock) {
      switch (msg.type) {
        case "join": {
          const { meeting, participant, name } = msg;
          if (!participants.includes(participant)) {
            send(sock, {
              type: "reject",
              reason: `participant "${participant}" is not a participant of meeting "${meeting}"`,
            });
            log("rejected", participant, meeting);
            socket.end();
            return;
          }
          const prev = sessions.get(participant);
          if (prev && prev.ws && prev.ws !== sock) prev.ws.end();
          sessions.set(participant, { ws: sock, meeting, lastHeartbeat: Date.now(), name: name || participant });
          send(sock, { type: "peers", participants: [...sessions.keys()].filter((p) => p !== participant) });
          broadcast({ type: "present", participant }, participant);
          log("joined", participant, "meeting", meeting, "peers", [...sessions.keys()].join(","));
          break;
        }
        case "signal": {
          const target = sessions.get(msg.to);
          if (target?.ws) send(target.ws, { type: "signal", from: msg.from, payload: msg.payload });
          else log("signal dropped: no session for", msg.to);
          break;
        }
        case "state": {
          broadcast({ type: "state", participant: msg.from, state: msg.state }, msg.from);
          break;
        }
        case "heartbeat": {
          for (const [pid, sess] of sessions) {
            if (sess.ws === sock) sess.lastHeartbeat = Date.now();
          }
          break;
        }
        case "leave": {
          for (const [pid, sess] of sessions) {
            if (sess.ws === sock) closeSession(pid, "left");
          }
          socket.end();
          break;
        }
        default:
          break;
      }
    }
  });

  return {
    /** H-07: hard-close a peer's signaling socket without any presence update. */
    killPeerSocket(participant) {
      const sess = sessions.get(participant);
      if (!sess?.ws) return false;
      try {
        sess.ws.destroy(); // RST — no close frame, no "left" broadcast
      } catch {
        /* already gone */
      }
      sess.ws = null;
      sess.disconnectedAt = Date.now();
      log("killed signaling socket for", participant);
      return true;
    },
    sessionEvents() {
      return sessionEvents.slice();
    },
    sessionCount() {
      return sessions.size;
    },
    reset() {
      for (const [pid, sess] of sessions) {
        try {
          if (sess.ws) send(sess.ws, { type: "bye" });
          sess.ws?.destroy();
        } catch {
          /* ignore */
        }
      }
      sessions.clear();
      sessionEvents.length = 0;
    },
    close() {
      clearInterval(heartbeatInterval);
      this.reset();
      for (const s of sockets) {
        try {
          s.destroy();
        } catch {
          /* ignore */
        }
      }
      sockets.clear();
    },
  };
}
