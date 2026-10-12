/**
 * --signaling=convex: calls on the real page signal over the local Convex
 * backend (convex/meetings/webrtc/mesh.ts) instead of the reference server.
 *
 * - Each scenario gets a fresh meeting from the internal eval mutation
 *   devEval/callMeeting:create (A host, B and C participants), so sessions
 *   and signals never carry over between scenarios.
 * - Closed call sessions come from devEval/callMeeting:sessionEvents.
 * - "Signaling gone" (H-07) takes the peer's browser offline and cuts its
 *   Convex WebSocket through a Playwright route, holding new connections
 *   shut until restored. Media is the shaper's job, as before.
 *
 * Both eval functions are internal, so they run through `convex run` from
 * the repository, which targets the deployment in .env.local (the local
 * anonymous backend tools/call-eval/scripts/local-backend.mjs starts).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONVEX_BIN = path.join(REPO, "node_modules", ".bin", "convex");

/**
 * The JSON value `convex run` printed, from the first opening bracket to the
 * last closing one (the CLI can print notices around it).
 * @param {string} stdout
 * @param {"{" | "["} open
 * @returns {unknown}
 */
export function parseRunOutput(stdout, open) {
  const close = open === "{" ? "}" : "]";
  const start = stdout.indexOf(open);
  const end = stdout.lastIndexOf(close);
  if (start === -1 || end < start) throw new Error(`convex run printed no JSON ${open === "{" ? "object" : "array"}: ${stdout.slice(0, 300)}`);
  return JSON.parse(stdout.slice(start, end + 1));
}

/**
 * The harness letter for a seeded local test user (local-test-a -> A).
 * Anything else is not a harness participant and is an error.
 * @param {string} workosUserId
 */
export function participantLetter(workosUserId) {
  const m = /^local-test-([a-z])$/.exec(workosUserId);
  if (!m) throw new Error(`session belongs to "${workosUserId}", not a seeded local test user`);
  return m[1].toUpperCase();
}

/**
 * @param {string} fn e.g. "devEval/callMeeting:create"
 * @param {Record<string, unknown>} args
 */
function convexRun(fn, args) {
  // Positional JSON args, no shell: nothing to quote.
  const r = spawnSync(CONVEX_BIN, ["run", fn, JSON.stringify(args)], { cwd: REPO, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) {
    throw new Error(`convex run ${fn} exited ${r.status ?? r.signal}: ${(r.stderr || r.stdout || "").slice(-600)}`);
  }
  return r.stdout ?? "";
}

/** @param {string} title */
export function createEvalMeeting(title) {
  const out = /** @type {{ meetingId?: string }} */ (parseRunOutput(convexRun("devEval/callMeeting:create", { title }), "{"));
  if (typeof out.meetingId !== "string") throw new Error(`devEval/callMeeting:create returned no meetingId`);
  return out.meetingId;
}

/**
 * Closed sessions in the meeting, oldest first, in the shape the relay and
 * the reference server report: { participant: "A", reason, at }.
 * @param {string} meetingId
 */
export function closedSessions(meetingId) {
  const rows = /** @type {Array<{ participant: string, reason: string, at: number }>} */ (
    parseRunOutput(convexRun("devEval/callMeeting:sessionEvents", { meetingId }), "[")
  );
  return rows.map((r) => ({ participant: participantLetter(r.participant), reason: r.reason, at: r.at }));
}

/**
 * The meeting's stored shared-notes text and version (internal
 * devEval/callMeeting:notes): the notes proof's server truth.
 * @param {string} meetingId
 * @returns {{ content: string, version: number }}
 */
export function storedNotes(meetingId) {
  return /** @type {{ content: string, version: number }} */ (
    parseRunOutput(convexRun("devEval/callMeeting:notes", { meetingId }), "{")
  );
}

/** The Convex sync socket: ws://<host>/api/<version>/sync. */
const SYNC_SOCKET = /\/api\/[^/]+\/sync$/;

/**
 * Routes one browser context's Convex WebSocket through Playwright so the
 * harness can cut it. Install before the page loads.
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function installSignalingCut(context) {
  let cut = false;
  /** @type {Set<{ page: import('@playwright/test').WebSocketRoute, server: import('@playwright/test').WebSocketRoute }>} */
  const live = new Set();
  await context.routeWebSocket(SYNC_SOCKET, (ws) => {
    if (cut) {
      // The network is down: the connection fails, and the client backs off
      // until the browser reports it is online again.
      void ws.close({ code: 1011, reason: "" });
      return;
    }
    const pair = { page: ws, server: ws.connectToServer() };
    live.add(pair);
    ws.onClose(() => {
      live.delete(pair);
      void pair.server.close();
    });
    pair.server.onClose(() => {
      live.delete(pair);
      void ws.close();
    });
  });
  return {
    async cut() {
      cut = true;
      await context.setOffline(true);
      for (const pair of [...live]) {
        live.delete(pair);
        await pair.server.close().catch(() => {});
        await pair.page.close({ code: 1011, reason: "" }).catch(() => {});
      }
    },
    async restore() {
      cut = false;
      // Going online fires the page's "online" event, on which the Convex
      // client reconnects at once instead of waiting out its backoff.
      await context.setOffline(false);
    },
    get isCut() {
      return cut;
    },
  };
}
