/**
 * Unit coverage for the runner-integration additions (selection, launch args,
 * bench-URL mapping, reference signaling machinery). The spawn tests run the
 * real pinned signaling-server CLI with a synthetic JWKS/members manifest —
 * no Convex backend involved (H-14 itself stays out of scope).
 */
import { describe, it, expect } from "vitest";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { generateKeyPairSync } from "node:crypto";

import { H_IDS, P_IDS, ALL_SCENARIOS, wiredScenarioIds } from "./run.mjs";
import { chromiumLaunchArgs } from "./peers.mjs";
import { benchPathFor, RunContext } from "./context.mjs";
import { turnAvailable } from "./turn.mjs";
import {
  referenceVariantFor,
  deriveMembersManifest,
  buildSignalingArgs,
  parseReadyLine,
  startReferenceSignaling,
} from "./reference-signaling.mjs";

/** Synthetic state.json in the local-backend shape (users keyed A/B/C/O).
 *
 * @param {string} [meetingId]
 * @returns {{ meetingId: string, users: Record<string, { workosUserId: string, email: string }> }}
 */
function syntheticState(meetingId = "seeded-meeting-1") {
  return {
    meetingId,
    users: {
      A: { workosUserId: "local-test-a", email: "a@connvo-local.test" },
      B: { workosUserId: "local-test-b", email: "b@connvo-local.test" },
      C: { workosUserId: "local-test-c", email: "c@connvo-local.test" },
      O: { workosUserId: "local-test-o", email: "o@connvo-local.test" },
    },
  };
}

/** A minimal valid RSA JWKS in the local-backend key shape.
 *
 * @returns {{ keys: object[] }}
 */
function syntheticJwks() {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  return { keys: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, kid: "test-1", alg: "RS256", use: "sig" }] };
}

/** Writes a synthetic state.json + JWKS into a fresh temp dir.
 *
 * @returns {{ dir: string, statePath: string, jwksPath: string }}
 */
function withTempStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "call-eval-sig-"));
  const statePath = path.join(dir, "state.json");
  fs.writeFileSync(statePath, JSON.stringify(syntheticState(), null, 2));
  const jwksPath = path.join(dir, "jwks.json");
  fs.writeFileSync(jwksPath, JSON.stringify(syntheticJwks(), null, 2));
  return { dir, statePath, jwksPath };
}

/**
 * @param {string} url
 * @returns {Promise<{ status: number | undefined, body: string }>}
 */
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(1500, () => {
      req.destroy(new Error("health probe timeout"));
    });
  });
}

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function portUnreachable(port) {
  for (let i = 0; i < 10; i++) {
    try {
      await getJson(`http://127.0.0.1:${port}/`);
      await new Promise((r) => setTimeout(r, 150));
    } catch {
      return true;
    }
  }
  return false;
}

/** True when nothing is listening on 127.0.0.1:port right now.
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function tcpPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: "127.0.0.1", port });
    s.on("connect", () => {
      s.destroy();
      resolve(false);
    });
    s.on("error", () => resolve(true));
  });
}

describe("wired scenario selection", () => {
  it("exposes all H ids including the explicit endpoint relay proof", () => {
    expect(H_IDS).toHaveLength(17);
    expect(H_IDS[0]).toBe("H-01");
    expect(H_IDS[15]).toBe("H-16");
    expect(H_IDS[16]).toBe("H-17");
    expect(P_IDS).toEqual(["P-01", "P-02", "P-03", "P-04", "P-05"]);
    expect(ALL_SCENARIOS).toHaveLength(22);
  });

  it("wires every H scenario except H-14", () => {
    const wired = wiredScenarioIds("H");
    expect(wired).toHaveLength(15);
    expect(wired).not.toContain("H-14");
    expect(wired).not.toContain("H-17");
    expect(wiredScenarioIds("H", { signaling: "convex" })).not.toContain("H-17");
    expect(wired).toContain("H-13");
    expect(wired).toContain("H-15");
    expect(wired).toContain("H-16");
  });

  it("wires all P checks and the combined suite", () => {
    expect(wiredScenarioIds("P")).toEqual(P_IDS);
    const all = wiredScenarioIds("ALL");
    expect(all).toHaveLength(20);
    expect(all).not.toContain("H-14");
  });
});

describe("peer launch args", () => {
  it("carries the four required flags plus the fixture capture flags", () => {
    const args = chromiumLaunchArgs("/tmp/v.y4m", "/tmp/a.wav");
    for (const required of [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--use-file-for-fake-video-capture=/tmp/v.y4m",
      "--use-file-for-fake-audio-capture=/tmp/a.wav",
    ]) {
      expect(args).toContain(required);
    }
  });
});

describe("bench URL mapping", () => {
  it("navigates the mock page without a base URL", () => {
    expect(benchPathFor("mock", null)).toBe("/mock-bench.html");
    expect(benchPathFor("reference", null)).toBe("/mock-bench.html");
  });

  it("navigates the per-transport bench route in integration mode", () => {
    expect(benchPathFor("reference", "http://localhost:3000")).toBe("/dev/call-bench/reference");
    expect(benchPathFor("reference-no-audio", "http://localhost:3000")).toBe("/dev/call-bench/reference-no-audio");
    expect(benchPathFor("mock", "http://localhost:3000")).toBe("/dev/call-bench/mock");
  });
});

describe("reference signaling machinery", () => {
  it("maps transport names to server variants", () => {
    expect(referenceVariantFor("reference")).toBe("reference");
    expect(referenceVariantFor("reference-no-audio")).toBe("no-audio");
    expect(referenceVariantFor("reference-never-close")).toBe("never-close");
    expect(referenceVariantFor("reference-no-reconnect")).toBe("no-reconnect");
    expect(referenceVariantFor("reference-outsider-allowed")).toBe("outsider-allowed");
    expect(referenceVariantFor("mock")).toBeNull();
  });

  it("derives the members manifest from state.json users with O excluded", () => {
    expect(deriveMembersManifest(syntheticState())).toEqual({
      meetingId: "seeded-meeting-1",
      members: ["local-test-a", "local-test-b", "local-test-c"],
    });
  });

  it("fails loudly instead of silently weakening membership", () => {
    expect(() => deriveMembersManifest({ users: {} })).toThrow(/meetingId/);
    expect(() => deriveMembersManifest({ meetingId: "m", users: { A: {} } })).toThrow(/users\.A\.workosUserId/);
    expect(() =>
      deriveMembersManifest({
        meetingId: "m",
        users: {
          A: { workosUserId: "local-test-a" },
          B: { workosUserId: "local-test-b" },
          C: { workosUserId: "local-test-o" },
          O: { workosUserId: "local-test-o" },
        },
      }),
    ).toThrow(/outsider/);
  });

  it("builds the pinned CLI argv", () => {
    const args = buildSignalingArgs({ port: 9301, variant: "reference", jwksPath: "/k.json", membersPath: "/m.json" });
    expect(args).toEqual(["--port=9301", "--variant=reference", "--jwks-file=/k.json", "--members-file=/m.json"]);
    const noMembers = buildSignalingArgs({ port: 9302, variant: "outsider-allowed", jwksPath: "/k.json" });
    expect(noMembers).toEqual(["--port=9302", "--variant=outsider-allowed", "--jwks-file=/k.json"]);
    expect(() => buildSignalingArgs({ port: 80, variant: "reference", jwksPath: "/k.json" })).toThrow(/9301/);
  });

  it("parses the pinned readiness line", () => {
    expect(parseReadyLine('{"ok":true,"port":9301,"variant":"reference"}')).toEqual({
      ok: true,
      port: 9301,
      variant: "reference",
    });
    expect(parseReadyLine("garbage")).toBeNull();
    expect(parseReadyLine('{"ok":false,"error":"x"}')).toBeNull();
  });

  it("spawns the real server, serves the health probe, and stops cleanly", async () => {
    const { statePath, jwksPath } = withTempStateDir();
    const handle = await startReferenceSignaling({ transport: "reference", statePath, jwksPath });
    try {
      expect(handle.variant).toBe("reference");
      expect(handle.port).toBeGreaterThanOrEqual(9301);
      expect(handle.port).toBeLessThanOrEqual(9310);
      expect(handle.signalUrl).toBe(`ws://127.0.0.1:${handle.port}`);
      const health = await getJson(`http://127.0.0.1:${handle.port}/`);
      expect(health.status).toBe(200);
      expect(JSON.parse(health.body)).toEqual({ ok: true, variant: "reference", port: handle.port });
      // The manifest was derived and written next to state.json.
      if (typeof handle.membersPath !== "string") throw new Error("backend start must produce a members manifest");
      const manifest = JSON.parse(fs.readFileSync(handle.membersPath, "utf8"));
      expect(manifest.members).toEqual(["local-test-a", "local-test-b", "local-test-c"]);
      expect(manifest.members).not.toContain("local-test-o");
    } finally {
      handle.stop();
    }
    expect(await portUnreachable(handle.port)).toBe(true);
  }, 20000);

  it("skips an occupied port and binds the next reserved one", async () => {
    if (!(await tcpPortFree(9301))) return; // someone else owns it: the spawn loop skips it anyway
    const blocker = net.createServer();
    await new Promise((resolve) => {
      blocker.listen(9301, "127.0.0.1", () => resolve(undefined));
    });
    try {
      const { statePath, jwksPath } = withTempStateDir();
      const handle = await startReferenceSignaling({ transport: "reference", statePath, jwksPath });
      try {
        expect(handle.port).toBeGreaterThan(9301);
        const health = await getJson(`http://127.0.0.1:${handle.port}/`);
        expect(health.status).toBe(200);
      } finally {
        handle.stop();
      }
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  }, 20000);

  it("wires the reference lifecycle into RunContext (integration mode)", async () => {
    if (!(await turnAvailable())) return; // fault path needs coturn; covered on hosts that have it
    const { statePath, jwksPath, dir } = withTempStateDir();
    // RunContext reads the JWKS through the machinery's own resolution; pass
    // the synthetic one via env so no real backend keys are required.
    const prevEnv = process.env.CONNVO_LOCAL_TEST_JWKS_FILE;
    process.env.CONNVO_LOCAL_TEST_JWKS_FILE = jwksPath;
    const ctx = new RunContext({ transport: "reference", baseUrl: "http://localhost:3000", signalingStatePath: statePath, warmUp: false });
    let signalPort = null;
    try {
      await ctx.start();
      expect(ctx.benchPath).toBe("/dev/call-bench/reference");
      expect(ctx.signalUrl).toMatch(/^ws:\/\/127\.0\.0\.1:93\d\d$/);
      expect(ctx.seededMeetingId).toBe("seeded-meeting-1");
      if (!ctx.signalUrl) throw new Error("RunContext did not expose a signal URL after start");
      signalPort = Number(new URL(ctx.signalUrl).port);
      // The reference server pins ONE meetingId per manifest: scenario joins
      // reuse the seeded meeting instead of per-scenario ids.
      expect(ctx.newMeeting("H-01")).toBe("seeded-meeting-1");
    } finally {
      await ctx.stop();
      if (prevEnv === undefined) delete process.env.CONNVO_LOCAL_TEST_JWKS_FILE;
      else process.env.CONNVO_LOCAL_TEST_JWKS_FILE = prevEnv;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(signalPort).not.toBeNull();
    expect(await portUnreachable(signalPort)).toBe(true);
  }, 30000);
});
