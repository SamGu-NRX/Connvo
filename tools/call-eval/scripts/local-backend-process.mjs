// Threat model for watcher shutdown.
//
// rebuild() rewrites convex.json and convex-harness/. Any `convex dev` still
// watching this checkout pushes those files to the deployment it selected, which
// may be a cloud one if it started with inherited credentials. Nothing may
// change those files while such a process lives.
//
// In scope: inherited shell, tmux and process environment (BASH_ENV,
// NODE_OPTIONS, TZ, locale); leftover watchers from any version of this tool,
// including versions that wrote no state file, and `convex dev` started by hand
// in this checkout; a missing, stale or partial state file; tmux sessions with
// several windows; children forked while shutdown is in progress.
//
// Out of scope: adversarial code, meaning a process that spoofs its title or
// argv, tampering with the state file, or control of PATH. Also out of scope:
// a launcher that detaches with setsid or a double fork before it starts the
// watcher. Polling cannot contain that, and neither this tool nor the Convex
// CLI starts watchers that way.
//
// Discovery does not trust the state file. Each round reads every pane of the
// session, finds Node processes running this checkout's watch wrapper or a
// Convex CLI `dev` from inside the checkout, and adds their descendants and
// process groups. The state file only adds processes whose recorded identity
// (PID and start time) still matches. Anything this cannot classify fails
// closed: the rebuild is refused and the process is named. That covers a Node
// process in the checkout that mentions `convex` and `dev` but parses as no
// known watcher, and any member of a watcher's group that was never verified,
// unless it appeared since the last round while a verified member stayed alive
// (a fork). A group whose verified members are all gone is therefore refused,
// not signalled, which also covers a group ID taken over by a new process.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
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
// prints different lstart text. Every observation uses a fixed environment so
// a refusal and its retry agree on identity.
const OBSERVER_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

const STATE_FORMAT = "connvo-call-eval-watchers";
// Version 1 was a bare array whose start times came from the caller's TZ and
// locale, so its identities cannot be compared with these.
const STATE_VERSION = 2;

const WRAPPER = path.join("tools", "call-eval", "scripts", "local-backend-watch.mjs");

/** @typedef {{ pid: number, parent: number, group: number, zombie: boolean, started: string, command: string }} ProcessRow */
/** @typedef {{ pid: number, group: number, started: string, command: string }} SavedProcess */
/** @typedef {{ processes: SavedProcess[], groups: number[] }} SavedState */
/** @typedef {{ row: ProcessRow, reason: string }} Unclassified */
/** @typedef {{ env: Record<string, string>, deadline: number }} Observer */

/**
 * spawnSync bounded by the shutdown deadline. A tool that does not finish in
 * time refuses the rebuild rather than stretching the deadline.
 * @param {number} deadline @param {string} command @param {string[]} args @param {import("node:child_process").SpawnSyncOptions} options
 */
function bounded(deadline, command, args, options) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new DeadlineError(`the shutdown deadline passed before ${command} could run`);
  const result = spawnSync(command, args, {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options, timeout: remaining, killSignal: "SIGKILL",
  });
  if (/** @type {NodeJS.ErrnoException | undefined} */ (result.error)?.code === "ETIMEDOUT")
    throw new DeadlineError(`${command} did not finish before the shutdown deadline`);
  return { ...result, stdout: String(result.stdout ?? "") };
}

class DeadlineError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(`[backend] REFUSING watched-file changes: ${reason}`);
  }
}

/** @param {Observer} observer @returns {ProcessRow[]} */
function processTable(observer) {
  const result = bounded(observer.deadline, "ps", ["axww", "-o", "pid=,ppid=,pgid=,stat=,lstart=,command="], { env: observer.env });
  if (result.error || result.status !== 0)
    throw new Error(`[backend] could not list processes (ps exit ${result.status}); refusing watched-file changes`);
  return result.stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const match =
        /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d\d:\d\d:\d\d \d{4})\s*(.*)$/.exec(line);
      if (!match)
        throw new Error(`[backend] unexpected ps row ${JSON.stringify(line.slice(0, 120))}; refusing watched-file changes`);
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

/** @param {Observer} observer @param {number[]} pids @returns {Map<number, string>} */
function workingDirectories(observer, pids) {
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
  const result = bounded(observer.deadline, "lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-Fpn"], { env: observer.env });
  // lsof exits 1 when a listed process has already exited.
  if (result.error || (result.status !== 0 && result.status !== 1))
    throw new Error(`[backend] could not read process working directories (lsof exit ${result.status}); refusing watched-file changes`);
  let pid = 0;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) dirs.set(pid, line.slice(1));
  }
  return dirs;
}

/**
 * Each candidate's argv[0] and arguments. Linux keeps the exact boundaries
 * from /proc/<pid>/cmdline. macOS ps prints argv[0] as `comm` and the
 * arguments joined by spaces, so there `exact` is false and a path containing
 * spaces arrives in pieces. A process whose command does not start with its
 * argv[0] (it rewrote its title) is skipped.
 * @param {Observer} observer @param {ProcessRow[]} rows
 * @returns {Map<number, { exe: string, args: string[], exact: boolean }>}
 */
function argvOf(observer, rows) {
  /** @type {Map<number, { exe: string, args: string[], exact: boolean }>} */
  const argv = new Map();
  if (!rows.length) return argv;
  if (process.platform === "linux") {
    for (const row of rows) {
      try {
        const [exe = "", ...args] = readFileSync(`/proc/${row.pid}/cmdline`, "utf8").replace(/\0$/, "").split("\0");
        argv.set(row.pid, { exe, args, exact: true });
      } catch {
        // Exited, or owned by another user (out of scope).
      }
    }
    return argv;
  }
  const result = bounded(observer.deadline, "ps", ["axww", "-o", "pid=,comm="], { env: observer.env });
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
      argv.set(row.pid, { exe, args: row.command.slice(exe.length + 1).split(" ").filter(Boolean), exact: false });
  }
  return argv;
}

// Node options whose value is the next argument. Others are single arguments
// (`--trace-warnings`, `--inspect=127.0.0.1:0`).
const NODE_VALUE_OPTIONS = new Set([
  "-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions",
  "--input-type", "--title", "--env-file", "--env-file-if-exists", "--watch-path",
]);
// Inline code: no entry script.
const NODE_INLINE = /^(?:-e|--eval|-p|--print)(?:=|$)/;
// Entry scripts this tool has used, matched on the path's end so a deleted
// file can still be recognised.
const CLI_ENTRY = /\/(?:convex\/bin\/main\.js|\.bin\/convex)$/;
const NPX_ENTRY = /(?:^|\/)npx(?:-cli\.js)?$/;
const KNOWN_ENTRY = /(?:\/convex\/bin\/main\.js|\/\.bin\/convex|(?:^|\/)npx(?:-cli\.js)?|(?:^|\/)local-backend-watch\.mjs)$/;
const NODE = /^node(?:js)?$/;

/** @param {string} file */
const isFile = (file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/**
 * The script a Node invocation runs: skip Node's own options, resolve a
 * relative entry against the process's working directory, and canonicalise it.
 * A deleted entry keeps its lexical path. When ps split a spaced path into
 * pieces, the entry is the shortest run of pieces naming an existing file,
 * else the run ending in a known entry name.
 * @param {{ args: string[], exact: boolean }} argv @param {string | undefined} cwd
 * @returns {{ inline: true } | { inline: false, entry: string | null, raw: string, after: string[] }}
 */
export function nodeEntry({ args, exact }, cwd) {
  let start = 0;
  for (; start < args.length; start++) {
    const arg = args[start];
    if (arg === "--") {
      start++;
      break;
    }
    if (!arg.startsWith("-") || arg === "-") break;
    if (NODE_INLINE.test(arg)) return { inline: true };
    if (NODE_VALUE_OPTIONS.has(arg)) start++;
  }
  if (start >= args.length) return { inline: false, entry: null, raw: "", after: [] };
  const lexical = (/** @type {string} */ raw) =>
    path.isAbsolute(raw) ? path.normalize(raw) : cwd ? path.resolve(cwd, raw) : null;
  let end = start;
  if (!exact) {
    const span = (/** @type {number} */ last) => args.slice(start, last + 1).join(" ");
    let last = -1;
    for (let j = start; j < args.length && last < 0; j++) {
      const file = lexical(span(j));
      if (file && isFile(file)) last = j;
    }
    for (let j = start; j < args.length && last < 0; j++) if (KNOWN_ENTRY.test(args[j])) last = j;
    end = last < 0 ? start : last;
  }
  const raw = args.slice(start, end + 1).join(" ");
  let entry = lexical(raw);
  if (entry) {
    try {
      entry = realpathSync(entry);
    } catch {
      // Deleted after start: keep the lexical path.
    }
  }
  return { inline: false, entry, raw, after: args.slice(end + 1) };
}

/**
 * Processes that could watch this checkout, judged by what they execute: Node
 * running this checkout's watch wrapper (under any path alias), or Node
 * running a Convex CLI entry script with `dev` from a working directory inside
 * the checkout. An editor, pager or search whose arguments name these paths
 * executes something else and is ignored. A Node process in the checkout that
 * mentions `convex` and `dev` but parses as neither, or a Node process naming a
 * wrapper file that no longer exists, is returned as unclassified.
 * @param {ProcessRow[]} table @param {string} checkout
 * @param {Observer} [observer]
 * @returns {{ watchers: ProcessRow[], unclassified: Unclassified[] }}
 */
export function checkoutWatchers(table, checkout, observer = defaultObserver()) {
  const roots = new Set([path.resolve(checkout)]);
  try {
    roots.add(realpathSync(checkout));
  } catch {
    // A checkout that no longer exists can only be matched by its given path.
  }
  const inside = (/** @type {string | undefined} */ dir) =>
    !!dir && [...roots].some((root) => dir === root || dir.startsWith(`${root}/`));
  const wrappers = new Set([...roots].map((root) => path.join(root, WRAPPER)));
  for (const wrapper of [...wrappers]) {
    try {
      wrappers.add(realpathSync(wrapper));
    } catch {
      // No wrapper file in this checkout.
    }
  }
  const candidates = table.filter(
    (row) => !row.zombie && (row.command.includes("convex") || row.command.includes("local-backend-watch.mjs")),
  );
  const argv = argvOf(observer, candidates);
  const nodes = candidates.filter((row) => {
    const args = argv.get(row.pid);
    return args && NODE.test(path.basename(args.exe));
  });
  const cwd = workingDirectories(observer, nodes.map((row) => row.pid));
  /** @type {ProcessRow[]} */
  const watchers = [];
  /** @type {Unclassified[]} */
  const unclassified = [];
  for (const row of nodes) {
    const dir = cwd.get(row.pid);
    const parsed = nodeEntry(/** @type {{ args: string[], exact: boolean }} */ (argv.get(row.pid)), dir);
    if (!parsed.inline) {
      const named = parsed.entry ?? parsed.raw;
      if (parsed.entry && wrappers.has(parsed.entry)) {
        watchers.push(row);
        continue;
      }
      const cli =
        (CLI_ENTRY.test(named) && parsed.after[0] === "dev") ||
        (NPX_ENTRY.test(named) && parsed.after[0] === "convex" && parsed.after[1] === "dev");
      if (cli && inside(dir)) {
        watchers.push(row);
        continue;
      }
      if (path.basename(named) === "local-backend-watch.mjs" && !(parsed.entry && isFile(parsed.entry))) {
        unclassified.push({ row, reason: "runs a watch wrapper whose file is gone, so its checkout is unknown" });
        continue;
      }
    }
    if (inside(dir) && /convex/.test(row.command) && /(?:^|\s)dev(?:\s|$)/.test(row.command))
      unclassified.push({ row, reason: "Node in this checkout mentions convex and dev but is no known watcher" });
  }
  return { watchers, unclassified };
}

/** @param {string} [observerPath] @returns {Observer} */
function defaultObserver(observerPath = OBSERVER_PATH) {
  return { env: { PATH: observerPath, TZ: "UTC", LC_ALL: "C" }, deadline: Date.now() + 10_000 };
}

/** @param {string} file @returns {SavedState} */
function savedState(file) {
  if (!existsSync(file)) return { processes: [], groups: [] };
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
    if (saved.length === 0) return { processes: [], groups: [] };
    const pids = saved.map((row) => row?.pid).filter(Number.isInteger);
    throw refuse(
      `uses the version-1 format, whose start times depend on the caller's TZ and locale (PIDs ${pids.join(", ") || "unreadable"})`,
    );
  }
  const groups = saved?.groups ?? [];
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
    ) ||
    !Array.isArray(groups) ||
    groups.some((group) => !Number.isInteger(group) || group <= 1)
  )
    throw refuse(`is not a version-${STATE_VERSION} ${STATE_FORMAT} record`);
  return { processes: saved.processes, groups };
}

/** @param {string} file @param {ProcessRow[]} rows @param {Set<number>} groups */
function saveState(file, rows, groups) {
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
    JSON.stringify({ format: STATE_FORMAT, version: STATE_VERSION, processes, groups: [...groups] }, null, 2),
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

/**
 * One discovery round, without I/O so recycled PIDs and groups can be tested
 * on synthetic tables.
 *
 * Verified targets are panes of the session, saved processes whose identity
 * still matches, checkout watchers, last round's targets with the same
 * identity, and descendants of any of these. The group of every target is
 * tracked, and tracked groups carry to the next round while they have members.
 * Every live member of a tracked group must be a verified target, or must have
 * appeared since the last round while a member verified then is still alive,
 * which only a fork inside the group can produce. Any other member, the
 * caller or its ancestors in a tracked group, and processes `checkoutWatchers`
 * could not classify are returned as unclassified; the caller refuses.
 * @param {{
 *   table: ProcessRow[], self: number, panes: number[], saved: SavedProcess[],
 *   matched: ProcessRow[], unmatched?: Unclassified[],
 *   previous: Map<string, ProcessRow>, seen: Set<string> | null, groups: Set<number>,
 * }} round `previous` holds last round's targets, `seen` every identity in
 * last round's table (null before the first round).
 * @returns {{ found: Map<number, ProcessRow>, groups: Set<number>, unclassified: Unclassified[] }}
 */
export function discoverWatchers({ table, self, panes, saved, matched, unmatched = [], previous, seen, groups: carried }) {
  const byPid = new Map(table.map((row) => [row.pid, row]));
  if (!byPid.has(self))
    throw new Error("[backend] ps did not list this process; refusing watched-file changes");
  const shielded = new Set();
  for (let row = byPid.get(self); row && !shielded.has(row.pid); row = byPid.get(row.parent))
    shielded.add(row.pid);
  /** @type {Map<number, ProcessRow>} */
  const found = new Map();
  /** @type {Map<number, Unclassified>} */
  const unclassified = new Map();
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
  for (const item of unmatched) if (!found.has(item.row.pid) && !shielded.has(item.row.pid)) unclassified.set(item.row.pid, item);

  const groups = new Set(carried);
  for (const pid of panes) groups.add(pid);
  const live = table.filter((row) => !row.zombie);
  for (let size = -1; size !== found.size; ) {
    size = found.size;
    for (const row of live) if (found.has(row.parent)) add(row);
    for (const row of found.values()) groups.add(row.group);
    for (const group of groups) {
      const members = live.filter((row) => row.group === group);
      const anchored = members.some((row) => previous.has(identity(row)));
      for (const row of members) {
        if (found.has(row.pid) || unclassified.has(row.pid)) continue;
        if (shielded.has(row.pid))
          unclassified.set(row.pid, { row, reason: `shares watcher process group ${group} with this command or its parents` });
        else if (anchored && seen && !seen.has(identity(row))) add(row);
        else
          unclassified.set(row.pid, { row, reason: `is in watcher process group ${group} but was never verified as a watcher` });
      }
    }
  }
  for (const group of [...groups]) {
    if (!live.some((row) => row.group === group)) groups.delete(group);
    else if (group <= 1)
      for (const row of live.filter((member) => member.group === group))
        unclassified.set(row.pid, { row, reason: `is in process group ${group}, which cannot be signalled` });
  }
  return { found, groups, unclassified: [...unclassified.values()].filter((item) => !found.has(item.row.pid)) };
}

/**
 * What may be signalled, judged on a table taken just before signalling: a PID
 * only while the same process (PID and start time) holds it, and a group only
 * while one of those targets still belongs to it, so the group cannot have
 * been emptied and taken over.
 * @param {{ fresh: ProcessRow[], found: Map<number, ProcessRow>, groups: Set<number> }} opts
 * @returns {{ pids: number[], groups: number[] }}
 */
export function confirmedSignals({ fresh, found, groups }) {
  const targets = new Set([...found.values()].map(identity));
  const live = fresh.filter((row) => !row.zombie && targets.has(identity(row)));
  return {
    pids: live.map((row) => row.pid),
    groups: [...groups].filter((group) => group > 1 && live.some((row) => row.group === group)),
  };
}

/** @param {Iterable<ProcessRow>} rows */
const describe = (rows) => [...rows].map((row) => `${row.pid} (${row.command.slice(0, 120)})`).join("; ");

/**
 * Stop every process that could watch this checkout, then rebuild. Each round
 * persists its targets and groups before signalling, so an interrupted or
 * refused run leaves a record for the retry. Refuses, naming the PIDs, when a
 * process cannot be classified or anything is still alive at the deadline.
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
 *   observerPath?: string,
 * }} opts `sendSignal` receives a PID or a negative group ID; tests replace it
 * to model a process this user cannot signal. `observerPath` is the fixed PATH
 * for ps and lsof; tests point it at fake tools.
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
  observerPath = OBSERVER_PATH,
}) {
  if (!checkout) throw new Error("[backend] rebuildWithoutWatcher needs the checkout path");
  const start = Date.now();
  const observer = { ...defaultObserver(observerPath), deadline: start + deadlineMs };
  /** @param {string[]} args */
  const tmux = (args) => bounded(observer.deadline, "tmux", [...tmuxArgs, ...args], { env });
  const saved = savedState(statePath);
  /** @type {Map<string, ProcessRow>} */
  let previous = new Map();
  /** @type {Set<string> | null} */
  let seen = null;
  let groups = new Set(saved.groups);
  const survived = (/** @type {Iterable<ProcessRow>} */ rows) =>
    new Error(
      `[backend] REFUSING watched-file changes: Convex watcher processes for this checkout survived shutdown: ${describe(rows)}. Their identities are saved in ${statePath}. Stop them, then rerun.`,
    );
  for (;;) {
    try {
      if (shutdownRound()) return;
    } catch (error) {
      // Out of time while watchers were still alive: name them, not the tool.
      if (error instanceof DeadlineError && previous.size) throw survived(previous.values());
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /** @returns {boolean} true once the rebuild has run */
  function shutdownRound() {
    const present = tmux(["has-session", "-t", `=${session}`]);
    if (present.status !== 0 && present.status !== 1)
      throw new Error("[backend] could not inspect the watcher tmux session");
    /** @type {number[]} */
    let panes = [];
    if (present.status === 0) {
      // -s: every pane in every window, not only the selected window.
      const listed = tmux(["list-panes", "-s", "-t", `=${session}`, "-F", "#{pane_pid}"]);
      if (listed.status !== 0) throw new Error("[backend] could not list watcher panes");
      panes = listed.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
      if (panes.some((pid) => !Number.isInteger(pid) || pid <= 1))
        throw new Error("[backend] invalid watcher pane PID");
    }
    const table = processTable(observer);
    const scan = checkoutWatchers(table, checkout, observer);
    const round = discoverWatchers({
      table, self: process.pid, panes, saved: saved.processes, matched: scan.watchers, unmatched: scan.unclassified,
      previous, seen, groups,
    });
    const { found, unclassified } = round;
    groups = round.groups;
    previous = new Map([...found.values()].map((row) => [identity(row), row]));
    seen = new Set(table.map(identity));

    if (found.size === 0 && unclassified.length === 0 && present.status !== 0) {
      rmSync(statePath, { force: true });
      rebuild();
      return true;
    }
    saveState(statePath, [...found.values()], groups);
    if (unclassified.length)
      throw new Error(
        `[backend] REFUSING watched-file changes: cannot tell whether these processes watch this checkout: ${unclassified
          .map(({ row, reason }) => `${row.pid} (${row.command.slice(0, 120)}) ${reason}`)
          .join("; ")}.${found.size ? ` Watchers found: ${describe(found.values())}.` : ""} Stop them or wait for them to exit, then rerun. State: ${statePath}.`,
      );
    if (present.status === 0 && tmux(["kill-session", "-t", `=${session}`]).status !== 0)
      throw new Error("[backend] could not stop the watcher tmux session");
    const elapsed = Date.now() - start;
    if (elapsed >= deadlineMs && found.size > 0) throw survived(found.values());
    const signal = elapsed < graceMs ? "SIGTERM" : "SIGKILL";
    const confirmed = confirmedSignals({ fresh: processTable(observer), found, groups });
    for (const group of confirmed.groups) sendSignal(-group, signal);
    for (const pid of confirmed.pids) sendSignal(pid, signal);
    return false;
  }
}
