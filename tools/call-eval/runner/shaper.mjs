/**
 * Harness-controlled UDP shaper (H-07 / H-15 fault mechanism).
 *
 * Chromium's network emulation (`Network.emulateNetworkConditions`,
 * `--host-resolver-rules`) and Playwright route interception shape the
 * browser's HTTP stack only — ICE/STUN/TURN and RTP ride Chromium's own UDP
 * sockets that CDP never touches. This shaper is the accepted alternative: a
 * user-space dgram proxy sitting in front of the local TURN server, with
 * seeded loss decisions and a fixed reordering-free delay queue. Scenarios
 * force every peer connection onto `iceTransportPolicy: "relay"` so ALL RTP
 * traverses coturn through this proxy.
 *
 * One shaper per participant (each gets its own listen port forwarding to the
 * shared coturn), so shaping is asymmetric by design — H-07 shapes only the
 * dropped participant.
 */
import dgram from "node:dgram";

/** Deterministic 32-bit PRNG so a seed reproduces a run's exact loss pattern. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createShaper({ seed = 1 } = {}) {
  const rng = mulberry32(seed);
  let socket = null; // client-facing listener
  let uplink = null; // coturn-facing socket
  let target = null; // { port, host }
  let client = null; // { address, port } — the participant's last source, learned per packet
  let profile = { lossPct: 0, delayMs: 0 }; // H-07: 100% loss; H-15: 5/15% + 300 ms
  const timers = new Set();
  const stats = { forwarded: 0, dropped: 0 };

  // One shaper serves one participant's browser: its STUN/TURN client socket
  // reaches coturn through here, so this proxy sees the participant's egress
  // on the listen socket and everything coturn sends back — replies from the
  // TURN port AND relayed media from allocation ports — on the uplink socket.
  // Routing by socket (not by source port) is what keeps coturn's replies out
  // of a loop: the reviewed bug forwarded every inbound datagram to coturn,
  // so replies never reached the browser and relay-only media was dead.
  function onClient(msg, rinfo) {
    client = { address: rinfo.address, port: rinfo.port };
    if (profile.lossPct > 0 && rng() * 100 < profile.lossPct) {
      stats.dropped++;
      return;
    }
    shapedSend(msg, target, uplink);
  }

  function onUplink(msg) {
    if (!client) {
      stats.dropped++; // reply before any client packet: nothing to route to
      return;
    }
    shapedSend(msg, client, socket);
  }

  function shapedSend(msg, dest, via) {
    const send = () => {
      if (!via) return;
      via.send(msg, dest.port, dest.address);
      stats.forwarded++;
    };
    if (profile.delayMs > 0) {
      const t = setTimeout(() => {
        timers.delete(t);
        send();
      }, profile.delayMs);
      timers.add(t);
    } else {
      send();
    }
  }

  return {
    /** Bind the proxy port; UDP to it is forwarded to the real TURN port. */
    start({ listenPort, targetPort, targetHost = "127.0.0.1" }) {
      target = { port: targetPort, host: targetHost };
      return new Promise((resolve, reject) => {
        socket = dgram.createSocket("udp4");
        uplink = dgram.createSocket("udp4");
        socket.on("message", onClient);
        uplink.on("message", onUplink);
        socket.on("error", reject);
        uplink.on("error", reject);
        socket.bind(listenPort, "127.0.0.1", () => {
          uplink.bind(0, "127.0.0.1", () => {
            socket.on("error", () => {}); // late errors: sweep logs only
            uplink.on("error", () => {});
            resolve(listenPort);
          });
        });
      });
    },
    /** Apply a shaping profile; lossPct 0 + delayMs 0 = passthrough. */
    applyProfile(next) {
      profile = { lossPct: next.lossPct ?? 0, delayMs: next.delayMs ?? 0 };
    },
    clear() {
      this.applyProfile({ lossPct: 0, delayMs: 0 });
    },
    stats() {
      return { ...stats };
    },
    stop() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      try {
        socket?.close();
      } catch {
        /* already closed */
      }
      try {
        uplink?.close();
      } catch {
        /* already closed */
      }
      socket = null;
      uplink = null;
    },
  };
}
