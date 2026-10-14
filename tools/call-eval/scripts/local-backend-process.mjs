// Threat model for watcher shutdown.
//
// rebuild() rewrites convex.json and convex-harness/. Any `convex dev` still
// watching this checkout pushes those files to the deployment it selected, which
// may be a cloud one if it started with inherited credentials. Nothing may
// change those files while such a process lives.
//
// In scope: inherited shell, tmux and process environment (BASH_ENV,
// NODE_OPTIONS, TZ, locale); leftover processes from any version of this tool,
// including versions that wrote no state file; a missing, stale or partial
// state file; tmux sessions with several windows; children forked while
// shutdown is in progress.
//
// Out of scope: deliberate tampering with the state file or the process table,
// an attacker who controls PATH, and code that is already executing as this user.
//
// Discovery does not trust the state file. Each round reads every pane of the
// session, finds Node processes running this checkout's watch wrapper or a
// Convex CLI `dev` from inside the checkout, and adds their process groups and
// descendants. The state file only adds processes whose recorded identity
// (PID and start time) still matches. Shutdown re-checks each identity just
// before signalling and repeats until nothing remains or a deadline passes.
//
// Known gap: between two rounds (about 100 ms), a watcher group could empty,
// its leader's PID go to a new process that starts a group and exits, and that
// group's members be taken for the watcher's. That needs PID reuse within one
// round and is not handled.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkedConvexEnvironment } from "./local-backend-core.mjs";

/**
 * All Convex commands share this boundary; neither npm nor a shell starts
 * between the checked environment and the CLI's Node process.
 * @param {{ node: string, cli: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, envLocalContent?: string | null, envContent?: string | null }} opts
 */
export function runConvexCommand({ node, cli, args, cwd, ...environment }) {
  return spawnSync(node, [cli, ...args], {
    cwd,
    env: checkedConvexEnvironment(environment),
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// ps formats start times with the caller's TZ and locale: under TZ=UTC and
// TZ=America/Los_Angeles, or LC_ALL=C and LC_ALL=de_DE.UTF-8, one live process
// prints different lstart text. Every observation uses this fixed environment
// so a refusal and its retry agree on identity.
const OBSERVER_ENV = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  TZ: "UTC",
  LC_ALL: "C",
};

const STATE_FORMAT = "connvo-call-eval-watchers";
// Version 1 was a bare array whose start times came from the caller's TZ and
// locale, so its identities cannot be compared with these.
const STATE_VERSION = 2;

/** @typedef {{ pid: number, parent: number, group: number, zombie: boolean, started: string, command: string }} ProcessRow */
/** @typedef {{ pid: number, group: number, started: string, command: string }} SavedProcess */

/** @returns {ProcessRow[]} */
function processTable() {
  const result = spawnSync(
    "ps",
    ["axww", "-o", "pid=,ppid=,pgid=,stat=,lstart=,command="],
    { env: OBSERVER_ENV, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `[backend] could not list processes (ps exit ${result.status}); refusing watched-file changes`,
    );
  return result.stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const match =
        /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d\d:\d\d:\d\d \d{4})\s*(.*)$/.exec(
          line,
        );
      if (!match)
        throw new Error(
          `[backend] unexpected ps row ${JSON.stringify(line.slice(0, 120))}; refusing watched-file changes`,
        );
      return {
        pid: Number(match[1]),
        parent: Number(match[2]),
        group: Number(match[3]),
        zombie: match[4].startsWith("Z"),
        started: match[5].replace(/\s+/g, " "),
        command: match[6],
      };
    });
}

/** @param {number[]} pids @returns {Map<number, string>} */
function workingDirectories(pids) {
  /** @type {Map<number, string>} */
  const dirs = new Map();
  if (!pids.length) return dirs;
  if (process.platform === "linux") {
    for (const pid of pids) {
      try {
        dirs.set(pid, readlinkSync(`/proc/${pid}/cwd`));
      } catch {
        // Exited, or owned by another user (out of scope).
      }
    }
    return dirs;
  }
  const result = spawnSync(
    "lsof",
    ["-a", "-d", "cwd", "-p", pids.join(","), "-Fpn"],
    { env: OBSERVER_ENV, encoding: "utf8" },
  );
  // lsof exits 1 when a listed process has already exited.
  if (result.error || (result.status !== 0 && result.status !== 1))
    throw new Error(
      `[backend] could not read process working directories (lsof exit ${result.status}); refusing watched-file changes`,
    );
  let pid = 0;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) dirs.set(pid, line.slice(1));
  }
  return dirs;
}

/**
 * Each candidate's argv[0] and the rest of its argv joined by spaces. macOS ps
 * prints argv[0] as `comm`, so the remainder is the command after that prefix;
 * Linux exposes the exact argv in /proc. A process whose command does not
 * start with its argv[0] (it rewrote its title) is skipped.
 * @param {ProcessRow[]} rows @returns {Map<number, { exe: string, rest: string }>}
 */
function argvOf(rows) {
  /** @type {Map<number, { exe: string, rest: string }>} */
  const argv = new Map();
  if (!rows.length) return argv;
  if (process.platform === "linux") {
    for (const row of rows) {
      try {
        const [exe = "", ...rest] = readFileSync(`/proc/${row.pid}/cmdline`, "utf8").split("\0").filter(Boolean);
        argv.set(row.pid, { exe, rest: rest.join(" ") });
      } catch {
        // Exited, or owned by another user (out of scope).
      }
    }
    return argv;
  }
  const result = spawnSync("ps", ["axww", "-o", "pid=,comm="], {
    env: OBSERVER_ENV, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`[backend] could not list process executables (ps exit ${result.status}); refusing watched-file changes`);
  /** @type {Map<number, string>} */
  const comm = new Map();
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+) (.*)$/.exec(line);
    if (match) comm.set(Number(match[1]), match[2].trimEnd());
  }
  for (const row of rows) {
    const exe = comm.get(row.pid);
    if (exe && (row.command === exe || row.command.startsWith(`${exe} `)))
      argv.set(row.pid, { exe, rest: row.command.slice(exe.length + 1) });
  }
  return argv;
}

// The Convex CLI entry point followed by `dev`: `convex/bin/main.js dev` (this
// tool since 59c98b7), `.bin/convex dev` and `npx convex dev` (earlier
// versions). Group 1 is the script Node runs.
const CONVEX_CLI = /^(.+?\/node_modules\/(?:convex\/bin\/main\.js|\.bin\/convex)) dev(?: |$)/;
const NPX_CONVEX = /^(.+?\/npx(?:-cli\.js)?) convex dev(?: |$)/;
const NODE = /^node(?:js)?$/;

/**
 * Processes that could watch this checkout, found without the state file, by
 * what they execute rather than by text in their command line. One is either
 * Node running this checkout's watch wrapper, or Node running a Convex CLI
 * entry script with `dev`, from a working directory inside the checkout. An
 * editor, pager or search whose arguments name these paths executes something
 * else, and a tmux server's command line (which repeats its first session's
 * command) belongs to tmux.
 * @param {ProcessRow[]} table @param {string} checkout
 */
export function checkoutWatchers(table, checkout) {
  const roots = new Set([path.resolve(checkout)]);
  try {
    roots.add(realpathSync(checkout));
  } catch {
    // A checkout that no longer exists can only be matched by its given path.
  }
  const inside = (/** @type {string} */ dir) =>
    [...roots].some((root) => dir === root || dir.startsWith(`${root}/`));
  const wrappers = [...roots].map(
    (root) => `${root}/tools/call-eval/scripts/local-backend-watch.mjs`,
  );
  // Text prefilter only; argv decides below.
  const candidates = table.filter(
    (row) => !row.zombie && (row.command.includes("local-backend-watch.mjs") || / dev(?: |$)/.test(row.command)),
  );
  const argv = argvOf(candidates);
  /** @type {ProcessRow[]} */
  const found = [];
  /** @type {Array<{ row: ProcessRow, script: string }>} */
  const clis = [];
  for (const row of candidates) {
    const args = argv.get(row.pid);
    if (!args || !NODE.test(path.basename(args.exe))) continue;
    if (wrappers.some((wrapper) => args.rest === wrapper || args.rest.startsWith(`${wrapper} `))) {
      found.push(row);
      continue;
    }
    const script = (CONVEX_CLI.exec(args.rest) ?? NPX_CONVEX.exec(args.rest))?.[1];
    if (script) clis.push({ row, script });
  }
  const cwd = workingDirectories(clis.map(({ row }) => row.pid));
  for (const { row, script } of clis) {
    const dir = cwd.get(row.pid);
    if (dir && inside(dir) && existsSync(path.resolve(dir, script))) found.push(row);
  }
  return found;
}

/** @param {string} file @returns {SavedProcess[]} */
function savedWatchers(file) {
  if (!existsSync(file)) return [];
  const refuse = (/** @type {string} */ reason) =>
    new Error(
      `[backend] REFUSING watched-file changes: ${file} ${reason}. Confirm that no Convex watcher for this checkout is running, then delete that file.`,
    );
  let saved;
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw refuse("is not valid JSON (an interrupted write?)");
  }
  if (Array.isArray(saved)) {
    // An empty version-1 list holds no identity to misread.
    if (saved.length === 0) return [];
    const pids = saved.map((row) => row?.pid).filter(Number.isInteger);
    throw refuse(
      `uses the version-1 format, whose start times depend on the caller's TZ and locale (PIDs ${pids.join(", ") || "unreadable"})`,
    );
  }
  if (
    saved?.format !== STATE_FORMAT ||
    saved.version !== STATE_VERSION ||
    !Array.isArray(saved.processes) ||
    saved.processes.some(
      (/** @type {any} */ row) =>
        !Number.isInteger(row?.pid) ||
        row.pid <= 1 ||
        !Number.isInteger(row.group) ||
        typeof row.started !== "string" ||
        !row.started,
    )
  )
    throw refuse(
      `is not a version-${STATE_VERSION} ${STATE_FORMAT} record`,
    );
  return saved.processes;
}

/** @param {string} file @param {ProcessRow[]} rows */
function saveWatchers(file, rows) {
  mkdirSync(path.dirname(file), { recursive: true });
  /** @type {SavedProcess[]} */
  const processes = rows.map(({ pid, group, started, command }) => ({
    pid,
    group,
    started,
    command: command.slice(0, 300),
  }));
  writeFileSync(
    `${file}.tmp`,
    JSON.stringify({ format: STATE_FORMAT, version: STATE_VERSION, processes }, null, 2),
  );
  renameSync(`${file}.tmp`, file);
}

/** @param {number} target a PID, or a negative process group ID @param {NodeJS.Signals} signal */
function deliverSignal(target, signal) {
  try {
    process.kill(target, signal);
  } catch (error) {
    // ESRCH: already gone. EPERM: not ours; it stays visible and blocks the rebuild.
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code !== "ESRCH" && code !== "EPERM") throw error;
  }
}

/** @param {ProcessRow} row */
const identity = (row) => `${row.pid}@${row.started}`;

/** @typedef {Map<number, string | null>} TrackedGroups group ID -> identity of its leader, or null if the leader was already gone */

/**
 * One discovery round, without I/O so recycled PIDs and groups can be tested
 * on synthetic tables. A process is a target if it is a pane of the session, a
 * saved process whose PID and start time still match, a checkout watcher, a
 * target from the last round with the same identity, a descendant of a
 * target, or a member of a tracked group.
 *
 * A group is tracked when its leader is a target. It carries into the next
 * round only if the last round found one of its members and its ID is not now
 * held by a different process: an emptied group can be refilled only by a new
 * process that got the leader's PID. Nothing in the caller's ancestry, or a
 * group containing it, is ever a target.
 * @param {{ table: ProcessRow[], self: number, panes: number[], saved: SavedProcess[], matched: ProcessRow[], previous: Map<string, ProcessRow>, groups: TrackedGroups }} round
 * @returns {{ found: Map<number, ProcessRow>, groups: TrackedGroups }}
 */
export function discoverWatchers({ table, self, panes, saved, matched, previous, groups: tracked }) {
  const byPid = new Map(table.map((row) => [row.pid, row]));
  if (!byPid.has(self))
    throw new Error("[backend] ps did not list this process; refusing watched-file changes");
  const shielded = new Set();
  for (let row = byPid.get(self); row && !shielded.has(row.pid); row = byPid.get(row.parent))
    shielded.add(row.pid);
  /** @type {Map<number, ProcessRow>} */
  const found = new Map();
  const add = (/** @type {ProcessRow | undefined} */ row) => {
    if (row && !row.zombie && row.pid > 1 && !shielded.has(row.pid)) found.set(row.pid, row);
  };
  for (const pid of panes) add(byPid.get(pid));
  for (const hint of saved) {
    const row = byPid.get(hint.pid);
    if (row?.started === hint.started) add(row);
  }
  for (const row of matched) add(row);
  for (const row of table) if (previous.has(identity(row))) add(row);

  /** @type {TrackedGroups} */
  const groups = new Map();
  const track = (/** @type {number} */ group, /** @type {string | null} */ leader) => {
    if (group > 1 && !groups.has(group) && !table.some((row) => row.group === group && shielded.has(row.pid)))
      groups.set(group, leader);
  };
  for (const [group, leader] of tracked) {
    const holder = byPid.get(group);
    if (holder && identity(holder) !== leader) continue;
    if ([...previous.values()].some((row) => row.group === group)) track(group, leader);
  }
  // A pane's first process leads its own group, so the pane PID names the
  // group even if that process exited between list-panes and ps.
  for (const pid of panes) {
    const row = byPid.get(pid);
    track(pid, row ? identity(row) : null);
  }
  for (let size = -1; size !== found.size; ) {
    size = found.size;
    for (const row of [...found.values()]) if (row.group === row.pid) track(row.group, identity(row));
    for (const row of table) if (found.has(row.parent) || groups.has(row.group)) add(row);
  }
  return { found, groups };
}

/**
 * What may be signalled, judged on a table taken just before signalling: a PID
 * only while the same process (PID and start time) holds it, a group only
 * while a target still belongs to it and no new process holds its ID.
 * @param {{ fresh: ProcessRow[], found: Map<number, ProcessRow>, groups: TrackedGroups }} opts
 * @returns {{ pids: number[], groups: number[] }}
 */
export function confirmedSignals({ fresh, found, groups }) {
  const targets = new Set([...found.values()].map(identity));
  const live = fresh.filter((row) => !row.zombie && targets.has(identity(row)));
  return {
    pids: live.map((row) => row.pid),
    groups: [...groups]
      .filter(([group, leader]) => {
        const holder = fresh.find((row) => row.pid === group);
        if (holder && identity(holder) !== leader) return false;
        return live.some((row) => row.group === group);
      })
      .map(([group]) => group),
  };
}

/**
 * Stop every process that could watch this checkout, then rebuild. Each round
 * persists what it found before signalling, so an interrupted or refused run
 * leaves a record for the retry. Refuses, naming the PIDs, if anything is
 * still alive at the deadline.
 * @param {{
 *   session: string,
 *   checkout: string,
 *   statePath: string,
 *   rebuild: () => void,
 *   tmuxArgs?: string[],
 *   env?: NodeJS.ProcessEnv,
 *   deadlineMs?: number,
 *   graceMs?: number,
 *   sendSignal?: (target: number, signal: NodeJS.Signals) => void,
 * }} opts `sendSignal` receives a PID or a negative group ID. Tests replace
 * it to model a process this user cannot signal.
 */
export async function rebuildWithoutWatcher({
  session,
  checkout,
  statePath,
  rebuild,
  tmuxArgs = [],
  env = process.env,
  deadlineMs = 10_000,
  graceMs = 1_500,
  sendSignal = deliverSignal,
}) {
  if (!checkout) throw new Error("[backend] rebuildWithoutWatcher needs the checkout path");
  /** @param {string[]} args */
  const tmux = (args) =>
    spawnSync("tmux", [...tmuxArgs, ...args], { env, encoding: "utf8" });
  const saved = savedWatchers(statePath);
  const start = Date.now();
  /** @type {Map<string, ProcessRow>} */
  let previous = new Map();
  /** @type {TrackedGroups} */
  let groups = new Map();
  for (;;) {
    const present = tmux(["has-session", "-t", `=${session}`]);
    if (present.status !== 0 && present.status !== 1)
      throw new Error("[backend] could not inspect the watcher tmux session");
    /** @type {number[]} */
    let panes = [];
    if (present.status === 0) {
      // -s: every pane in every window, not only the selected window.
      const listed = tmux(["list-panes", "-s", "-t", `=${session}`, "-F", "#{pane_pid}"]);
      if (listed.status !== 0)
        throw new Error("[backend] could not list watcher panes");
      panes = listed.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
      if (panes.some((pid) => !Number.isInteger(pid) || pid <= 1))
        throw new Error("[backend] invalid watcher pane PID");
    }
    const table = processTable();
    const round = discoverWatchers({
      table, self: process.pid, panes, saved, matched: checkoutWatchers(table, checkout), previous, groups,
    });
    const { found } = round;
    groups = round.groups;
    previous = new Map([...found.values()].map((row) => [identity(row), row]));

    if (found.size === 0 && present.status !== 0) {
      rmSync(statePath, { force: true });
      rebuild();
      return;
    }
    saveWatchers(statePath, [...found.values()]);
    if (present.status === 0 && tmux(["kill-session", "-t", `=${session}`]).status !== 0)
      throw new Error("[backend] could not stop the watcher tmux session");
    const elapsed = Date.now() - start;
    if (elapsed >= deadlineMs && found.size > 0) {
      const list = [...found.values()]
        .map((row) => `${row.pid} (${row.command.slice(0, 120)})`)
        .join("; ");
      throw new Error(
        `[backend] REFUSING watched-file changes: Convex watcher processes for this checkout survived shutdown: ${list}. Their identities are saved in ${statePath}. Stop them, then rerun.`,
      );
    }
    const signal = elapsed < graceMs ? "SIGTERM" : "SIGKILL";
    const confirmed = confirmedSignals({ fresh: processTable(), found, groups });
    for (const group of confirmed.groups) sendSignal(-group, signal);
    for (const pid of confirmed.pids) sendSignal(pid, signal);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
