/**
 * Local coturn lifecycle for the H-07 / H-15 fault path. coturn listens on the
 * real TURN port; each participant's UDP shaper forwards a distinct port to
 * it, and relay-forced peers receive `turn:127.0.0.1:<their shaper port>`.
 *
 * coturn is spawned directly (no systemd in the sandbox). Loopback clients
 * need `--allow-loopback-peers` — without it coturn answers 403 Forbidden IP
 * and no allocation ever forms.
 */
import { spawn } from "node:child_process";
import dgram from "node:dgram";

export function turnAvailable() {
  return new Promise((resolve) => {
    try {
      const p = spawn("turnserver", ["--version"], { stdio: "pipe" });
      p.on("error", () => resolve(false));
      p.on("exit", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

export async function createTurn({
  port = 3478,
  realm = "connvo-eval",
  user = "eval-user",
  pass = "eval-pass",
} = {}) {
  const args = [
    "-n", // no config file; everything on the command line
    `--listening-port=${port}`,
    "--listening-ip=127.0.0.1",
    "--relay-ip=127.0.0.1",
    "--allow-loopback-peers",
    "--no-tls",
    "--no-dtls",
    "--no-cli",
    `-r${realm}`,
    `-u${user}:${pass}`,
  ];
  const proc = spawn("turnserver", args, { stdio: ["ignore", "pipe", "pipe"] });
  let logTail = "";
  proc.stdout.on("data", (d) => {
    logTail += d;
    if (logTail.length > 8192) logTail = logTail.slice(-4096);
  });
  proc.stderr.on("data", (d) => {
    logTail += d;
    if (logTail.length > 8192) logTail = logTail.slice(-4096);
  });

  // Wait until the UDP listener answers (or coturn dies trying).
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`turnserver exited early (code ${proc.exitCode}):\n${logTail.slice(-1000)}`);
    }
    const alive = await new Promise((resolve) => {
      const s = dgram.createSocket("udp4");
      const t = setTimeout(() => {
        s.close();
        resolve(false);
      }, 300);
      s.send(Buffer.alloc(20), port, "127.0.0.1", () => {});
      s.on("message", () => {
        clearTimeout(t);
        s.close();
        resolve(true);
      });
      s.on("error", () => {
        clearTimeout(t);
        try {
          s.close();
        } catch {
          /* already closed */
        }
        resolve(false);
      });
    });
    if (alive) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  return {
    port,
    user,
    pass,
    realm,
    stop() {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already dead */
      }
    },
  };
}

/** Relay-only RTCConfiguration pointing at one participant's shaper port. */
export function relayConfig(turn, shaperPort) {
  return {
    iceServers: [
      {
        urls: `turn:127.0.0.1:${shaperPort}?transport=udp`,
        username: turn.user,
        credential: turn.pass,
      },
    ],
    iceTransportPolicy: "relay",
  };
}
