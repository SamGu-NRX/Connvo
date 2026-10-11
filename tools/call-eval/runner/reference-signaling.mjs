/**
 * Reference-transport signaling lifecycle (runner side of the pinned CLI in
 * CONTRACT.md "Reference signaling server CLI"). When a run drives a
 * `reference` / `reference-*` transport through the real bench route
 * (--base-url), the runner spawns the eval-only signaling server itself and
 * feeds it the two verification inputs from the H-14 design note
 * (docs/plan/handoffs/connvo-call-harness-f1.md):
 *
 * - `--jwks-file`: the public JWKS the local backend minted
 *   (tools/call-eval/.local/keys/jwks.json, or CONNVO_LOCAL_TEST_JWKS_FILE);
 *   the server verifies the RS256 bearer token against it.
 * - `--members-file`: a manifest derived from out/state.json users — A/B/C
 *   are the seeded meeting's participants, O is the outsider and must NOT
 *   appear. The server fail-closes membership against it.
 *
 * Verification machinery only: scenario H-14 itself stays out of scope for
 * this shard (excluded from the wired suite in run.mjs).
 *
 * The spawned server's address is handed to the bench page as an additive
 * `?signal=` query param (the DOM contract's pinned params are untouched; the
 * mock bench ignores unknown params), so the page's reference client can find
 * the server without a config file.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = path.join(EVAL_DIR, "reference", "signaling-server.mjs");
export const STATE_PATH = path.join(EVAL_DIR, "out", "state.json");
export const DEFAULT_JWKS_PATH = path.join(EVAL_DIR, ".local", "keys", "jwks.json");
export const SIGNALING_PORT_MIN = 9301;
export const SIGNALING_PORT_MAX = 9310;

/** Transport name -> server --variant (CONTRACT.md "Bench route and transports"). */
const VARIANT_BY_TRANSPORT = {
  reference: "reference",
  "reference-no-audio": "no-audio",
  "reference-never-close": "never-close",
  "reference-no-reconnect": "no-reconnect",
  "reference-outsider-allowed": "outsider-allowed",
};

/** Returns the signaling variant for a reference transport, else null.
 *
 * @param {string} transport
 * @returns {string | null}
 */
export function referenceVariantFor(transport) {
  const variantByTransport = /** @type {Record<string, string>} */ (VARIANT_BY_TRANSPORT);
  return variantByTransport[transport] ?? null;
}

/**
 * H-14 design note: the manifest derives from state.json users. A/B/C are the
 * seeded meeting's participants; O (the outsider) is deliberately excluded.
 * Everything is read from the caller-provided state — no defaults hidden here.
 *
 * @param {{ meetingId?: unknown, users?: Record<string, { workosUserId?: unknown } | undefined> | undefined }} state
 * @returns {{ meetingId: string, members: string[] }}
 */
export function deriveMembersManifest(state) {
  if (!state || typeof state !== "object") {
    throw new Error("members derivation: state.json did not parse to an object");
  }
  if (!state.meetingId || typeof state.meetingId !== "string") {
    throw new Error("members derivation: state.json has no meetingId — run `pnpm call-eval:backend` first");
  }
  const members = [];
  for (const key of ["A", "B", "C"]) {
    const subject = state.users?.[key]?.workosUserId;
    if (!subject || typeof subject !== "string") {
      throw new Error(`members derivation: state.json users.${key}.workosUserId missing — re-run \`pnpm call-eval:backend\``);
    }
    members.push(subject);
  }
  if (state.users && state.users.O) {
    // Guard the design note's invariant explicitly: the outsider must not be
    // listed even if a future state.json grows a participants field.
    const outsider = state.users.O.workosUserId;
    if (typeof outsider === "string" && members.includes(outsider)) {
      throw new Error("members derivation: outsider O is listed as a participant — refusing to write the manifest");
    }
  }
  return { meetingId: state.meetingId, members };
}

/** Pinned CLI argv. membersPath omitted only for the outsider-allowed variant.
 *
 * @param {{ port: number, variant: string, jwksPath: string, membersPath?: string | null }} opts
 * @returns {string[]}
 */
export function buildSignalingArgs(opts) {
  const { port, variant, jwksPath, membersPath } = opts;
  if (!Number.isInteger(port) || port < SIGNALING_PORT_MIN || port > SIGNALING_PORT_MAX) {
    throw new Error(`signaling port must be an integer in [${SIGNALING_PORT_MIN}..${SIGNALING_PORT_MAX}], got ${port}`);
  }
  const args = [`--port=${port}`, `--variant=${variant}`, `--jwks-file=${jwksPath}`];
  if (membersPath) args.push(`--members-file=${membersPath}`);
  return args;
}

/** Resolves the JWKS path (env override, then the minted default); throws with
 * the fix hint when nothing exists.
 *
 * @returns {string}
 */
function resolveJwksPath() {
  if (process.env.CONNVO_LOCAL_TEST_JWKS_FILE) {
    if (fs.existsSync(process.env.CONNVO_LOCAL_TEST_JWKS_FILE)) return process.env.CONNVO_LOCAL_TEST_JWKS_FILE;
    throw new Error(`CONNVO_LOCAL_TEST_JWKS_FILE points at a missing file: ${process.env.CONNVO_LOCAL_TEST_JWKS_FILE}`);
  }
  if (fs.existsSync(DEFAULT_JWKS_PATH)) return DEFAULT_JWKS_PATH;
  throw new Error(
    `no JWKS found (looked for ${DEFAULT_JWKS_PATH}; CONNVO_LOCAL_TEST_JWKS_FILE unset) — ` +
      "run `pnpm call-eval:backend` first: it mints the RS256 keys the signaling server verifies tokens against",
  );
}

/** Parse the pinned single readiness line: {"ok":true,"port":<p>,"variant":"..."}.
 *
 * @param {string} line
 * @returns {{ ok: true, port: number, variant: string } | null}
 */
export function parseReadyLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.ok === true && Number.isInteger(parsed.port)) return parsed;
  } catch {
    /* not the readiness line */
  }
  return null;
}

/**
 * @param {import('node:child_process').ChildProcessByStdio<null, import('node:stream').Readable, import('node:stream').Readable>} child
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: true, port: number, variant: string }>}
 */
function waitForReady(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`signaling server not ready in ${timeoutMs} ms (stdout tail: ${out.slice(-300)})`));
    }, timeoutMs);
    /** @param {string} d */
    const onData = (d) => {
      out += d;
      for (const line of out.split("\n")) {
        const ready = parseReadyLine(line);
        if (ready) {
          clearTimeout(timer);
          resolve(ready);
          return;
        }
      }
      if (out.length > 16384) out = out.slice(-8192);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (/** @type {string} */ d) => {
      out += d;
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`signaling server exited before readiness (code ${code})`));
    });
  });
}

/**
 * Spawn one signaling server per run, trying each reserved port in order.
 * Resolves with the pinned readiness payload plus a stop() that kills the
 * child; rejects after the port range is exhausted (with the last error).
 *
 * @param {object} [opts]
 * @param {string} [opts.transport] reference transport name (variant source)
 * @param {string} [opts.statePath] out/state.json (members derivation source)
 * @param {string | null} [opts.membersPath] explicit manifest override (tests)
 * @param {string | null} [opts.jwksPath] explicit JWKS override (tests)
 * @param {number} [opts.readyTimeoutMs] per-attempt readiness budget
 * @param {(message: string) => void} [opts.log] progress logger
 * @returns {Promise<{
 *   port: number, variant: string, signalUrl: string,
 *   membersPath: string, jwksPath: string, stop: () => void,
 *   sessionEvents: () => Promise<Array<{ participant: string, reason: string, at: number }>>,
 *   dropParticipant: (participantId: string) => Promise<void>,
 * }>}
 */
export async function startReferenceSignaling({
  transport,
  statePath = STATE_PATH,
  membersPath = null,
  jwksPath = null,
  readyTimeoutMs = 4000,
  log = () => {},
} = {}) {
  const variant = transport ? referenceVariantFor(transport) : null;
  if (!variant) throw new Error(`"${transport}" is not a reference transport`);

  if (!jwksPath) jwksPath = resolveJwksPath();
  if (!membersPath) {
    if (!fs.existsSync(statePath)) {
      throw new Error(
        `state.json not found at ${statePath} — the members manifest derives from its seeded users. ` +
          "Run `pnpm call-eval:backend` first (H-14 verification machinery, handoff design note).",
      );
    }
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const manifest = deriveMembersManifest(state);
    const outDir = path.dirname(statePath);
    fs.mkdirSync(outDir, { recursive: true });
    membersPath = path.join(outDir, `members-${transport}.json`);
    fs.writeFileSync(membersPath, JSON.stringify(manifest, null, 2));
    log(`signaling members manifest for ${variant}: meeting "${manifest.meetingId}", ${manifest.members.length} participants -> ${membersPath}`);
  }

  // checkJs narrowing cannot prove the assignments above; this guard also
  // makes a null jwks/members path fail loudly instead of spawning the server
  // with a literal `--jwks-file=null` argv.
  if (typeof membersPath !== "string" || typeof jwksPath !== "string") {
    throw new Error("internal: members/JWKS paths must be resolved before the signaling server starts");
  }

  let lastError = null;
  for (let port = SIGNALING_PORT_MIN; port <= SIGNALING_PORT_MAX; port++) {
    const child = spawn(process.execPath, [SERVER_PATH, ...buildSignalingArgs({ port, variant, jwksPath, membersPath })], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const ready = await waitForReady(child, readyTimeoutMs);
      log(`reference signaling server up: variant=${ready.variant} ws://127.0.0.1:${ready.port}`);
      return {
        port: ready.port,
        variant: ready.variant,
        signalUrl: `ws://127.0.0.1:${ready.port}`,
        membersPath,
        jwksPath,
        // H-10/H-11 evidence: the server's GET /?events=1 returns its
        // in-memory departure log (the mock relay's sessionEvents
        // equivalent).
        // Fault hook, transport-uniform with the mock relay's
        // killPeerSocket (H-07's signaling drop on reference transports).
        dropParticipant: async (participantId) => {
          const res = await fetch(`http://127.0.0.1:${ready.port}/drop?participant=${encodeURIComponent(participantId)}`, { method: "POST" });
          if (!res.ok) throw new Error(`drop ${participantId}: HTTP ${res.status}`);
        },
        sessionEvents: async () => {
          const res = await fetch(`http://127.0.0.1:${ready.port}/?events=1`);
          const body = /** @type {{ sessionEvents?: Array<{ participant: string, reason: string, at: number }> }} */ (
            await res.json()
          );
          return Array.isArray(body.sessionEvents) ? body.sessionEvents : [];
        },
        stop() {
          try {
            child.kill();
          } catch {
            /* already dead */
          }
        },
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Port collisions and startup races are expected (ports are shared with
      // other eval runs); anything else is fatal on the first port tried.
      if (port === SIGNALING_PORT_MAX) break;
      log(`signaling port ${port} unavailable (${lastError.message.slice(0, 120)}) — trying next`);
    }
  }
  throw new Error(`no signaling port available in [${SIGNALING_PORT_MIN}..${SIGNALING_PORT_MAX}]: ${lastError?.message}`);
}
