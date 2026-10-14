// Threat model for watcher shutdown.
//
// rebuild() rewrites convex.json and convex-harness/. Any `convex dev` still
// watching this checkout pushes those files to the deployment it selected, which
// may be a cloud one if it started with inherited credentials. Nothing may
// change those files while such a process lives.
//
// In scope: inherited shell, tmux and process environment (BASH_ENV,
// NODE_OPTIONS, TZ, locale); leftover watchers from any version of this tool,
// including versions that wrote no state file, and a Convex CLI `dev` started
// by hand from inside this checkout; a missing, stale or partial state file;
// tmux sessions with several windows; children forked while shutdown is in
// progress, including while discovery is still reading a process.
//
// Out of scope: adversarial code, meaning a process that spoofs its title or
// argv, tampering with the state file, or control of PATH. Also out of scope:
// a launcher that detaches with setsid or a double fork before it starts the
// watcher (polling cannot contain that, and neither this tool nor the Convex
// CLI starts watchers that way), and processes owned by another user.
//
// Discovery does not trust the state file. Each round reads every pane of the
// session and resolves the entry script of every Node process this user owns,
// then adds descendants and process groups. The state file only adds processes
// whose recorded identity (PID and start time) still matches. Anything this
// cannot classify fails closed: the rebuild is refused and the process named.
// That covers a Node process in the checkout that mentions `convex` and `dev`
// but parses as no known watcher; any member of a watcher's group that was
// never verified, unless it appeared since the last round while a verified
// member stayed alive (a fork); and a Node process that exits before its
// working directory could be read, whose group is re-scanned and refused if a
// new member appears. A group whose verified members are all gone is refused,
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

/** @typedef {{ pid: number, parent: number, group: number, uid: number, exe: string, zombie: boolean, started: string, command: string }} ProcessRow */
/** @typedef {{ pid: number, group: number, started: string, command: string }} SavedProcess */
/** @typedef {Map<number, Set<string>>} Suspects group ID -> identities of its members when a Node process in it exited unread */
/** @typedef {{ processes: SavedProcess[], groups: number[], suspects: Suspects }} SavedState */
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

const LSTART = "[A-Z][a-z]{2} [A-Z][a-z]{2} +\\d{1,2} \\d\\d:\\d\\d:\\d\\d \\d{4}";

/**
 * One ps snapshot. `exe` is the executable name (ucomm), which a process
 * cannot change by setting its title; `command` is its argv joined by spaces,
 * or its title.
 * @param {Observer} [observer] @returns {ProcessRow[]}
 */
export function processTable(observer = defaultObserver()) {
  const result = bounded(observer.deadline, "ps", ["axww", "-o", "pid=,ppid=,pgid=,uid=,stat=,ucomm=,lstart=,command="], { env: observer.env });
  if (result.error || result.status !== 0)
    throw new Error(`[backend] could not list processes (ps exit ${result.status}); refusing watched-file changes`);
  const pattern = new RegExp(`^\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(-?\\d+)\\s+(\\S+)\\s+(.*?)\\s+(${LSTART})\\s*(.*)$`);
  return result.stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const match = pattern.exec(line);
      if (!match)
        throw new Error(`[backend] unexpected ps row ${JSON.stringify(line.slice(0, 120))}; refusing watched-file changes`);
      return {
        pid: Number(match[1]),
        parent: Number(match[2]),
        group: Number(match[3]),
        uid: Number(match[4]),
        zombie: match[5].startsWith("Z"),
        exe: match[6].trim(),
        started: match[7].replace(/\s+/g, " "),
        command: match[8],
      };
    });
}

/** Identities among `rows` that are still running; a zombie has exited. @param {Observer} observer @param {ProcessRow[]} rows */
function stillRunning(observer, rows) {
  if (!rows.length) return new Set();
  const result = bounded(observer.deadline, "ps", ["-o", "pid=,stat=,lstart=", "-p", rows.map((row) => row.pid).join(",")], { env: observer.env });
  // ps exits 1 when a listed process has exited; the rest are still printed.
  if (result.error || (result.status !== 0 && result.status !== 1))
    throw new Error(`[backend] could not recheck processes (ps exit ${result.status}); refusing watched-file changes`);
  const alive = new Set();
  for (const line of result.stdout.split("\n")) {
    const match = new RegExp(`^\\s*(\\d+)\\s+(\\S+)\\s+(${LSTART})`).exec(line);
    if (match && !match[2].startsWith("Z")) alive.add(`${match[1]}@${match[3].replace(/\s+/g, " ")}`);
  }
  return alive;
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
        // Exited; the caller decides what that means.
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
 * A Node process's arguments. On macOS they come from the same snapshot as
 * the row: `command` begins with argv[0], whose last component is the
 * executable name, and the rest is the arguments joined by spaces, so `exact`
 * is false and a path containing spaces arrives in pieces. Linux reads exact
 * boundaries from /proc/<pid>/cmdline. Null when the process set a title
 * (macOS) and `undefined` when it exited before /proc could be read (Linux).
 * @param {ProcessRow} row @returns {{ args: string[], exact: boolean } | null | undefined}
 */
function argvOf(row) {
  if (process.platform === "linux") {
    try {
      const [, ...args] = readFileSync(`/proc/${row.pid}/cmdline`, "utf8").replace(/\0$/, "").split("\0");
      return { args, exact: true };
    } catch {
      return undefined;
    }
  }
  const pieces = row.command.split(" ").filter(Boolean);
  for (let end = 0; end < pieces.length; end++) {
    const name = path.basename(pieces.slice(0, end + 1).join(" "));
    // ucomm is cut to 16 characters.
    if (name === row.exe || (row.exe.length >= 15 && name.startsWith(row.exe)))
      return { args: pieces.slice(end + 1), exact: false };
  }
  return null;
}

// Node options whose value is the next argument. Others are single arguments
// (`--trace-warnings`, `--inspect=127.0.0.1:0`).
const NODE_VALUE_OPTIONS = new Set([
  "-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions",
  "--input-type", "--title", "--env-file", "--env-file-if-exists", "--watch-path",
]);
// Inline code: no entry script.
const NODE_INLINE = /^(?:-e|--eval|-p|--print)(?:=|$)/;
// Entry scripts this tool has used, matched on the canonical path's end. A
// deleted file keeps its literal path, so it is recognised only under one of
// these names.
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
 * relative entry against the process's working directory, and canonicalise it
 * with realpath. A deleted entry keeps its lexical path. When ps split a
 * spaced path into pieces, the entry is the shortest run of pieces naming an
 * existing file, else the run ending in a known entry name.
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

const NEEDS_CWD = Symbol("needs the working directory");
const WATCHER = Symbol("watcher");
const HARMLESS = Symbol("harmless");

/**
 * Classify one Node process. Without `cwd`, answers NEEDS_CWD whenever the
 * working directory could change the answer.
 * @param {ProcessRow} row @param {{ args: string[], exact: boolean } | null} argv
 * @param {string | undefined} cwd
 * @param {{ wrappers: Set<string>, inside: (dir: string) => boolean }} checkout
 * @returns {typeof NEEDS_CWD | typeof WATCHER | typeof HARMLESS | string} a string is the reason it is unclassified
 */
function classify(row, argv, cwd, checkout) {
  const mentions = /convex/.test(row.command) && /(?:^|\s)dev(?:\s|$)/.test(row.command);
  const ambiguous = () =>
    !mentions ? HARMLESS : cwd === undefined ? NEEDS_CWD : checkout.inside(cwd)
      ? "Node in this checkout mentions convex and dev but is no known watcher" : HARMLESS;
  // A process that set its title (macOS) is judged on that text alone.
  if (!argv) return ambiguous();
  const parsed = nodeEntry(argv, cwd);
  if (parsed.inline) return ambiguous();
  if (parsed.raw && !parsed.entry) return NEEDS_CWD;
  const named = parsed.entry ?? parsed.raw;
  if (parsed.entry && checkout.wrappers.has(parsed.entry)) return WATCHER;
  const cli =
    (CLI_ENTRY.test(named) && parsed.after[0] === "dev") ||
    (NPX_ENTRY.test(named) && parsed.after[0] === "convex" && parsed.after[1] === "dev");
  if (cli) return cwd === undefined ? NEEDS_CWD : checkout.inside(cwd) ? WATCHER : HARMLESS;
  if (path.basename(named) === "local-backend-watch.mjs" && !(parsed.entry && isFile(parsed.entry)))
    return "runs a watch wrapper whose file is gone, so its checkout is unknown";
  return ambiguous();
}

/**
 * Processes that could watch this checkout, judged by the script they run:
 * Node running this checkout's watch wrapper, or Node running the Convex CLI
 * entry with `dev` from a working directory inside the checkout. A symlink or
 * a renamed path to either is followed only while its target exists; once the
 * file is deleted, only the literal names in KNOWN_ENTRY are recognised.
 * Every Node process this user owns is resolved; an editor, pager or search
 * whose arguments name these paths runs something else and is ignored.
 *
 * Returns the watchers, the processes it could not classify, and `vanished`:
 * Node processes whose working directory it needed but which exited before it
 * could be read. Those are never taken as absent; the caller re-scans their
 * groups.
 * @param {ProcessRow[]} table @param {string} checkout @param {Observer} [observer]
 * @returns {{ watchers: ProcessRow[], unclassified: Unclassified[], vanished: ProcessRow[] }}
 */
export function checkoutWatchers(table, checkout, observer = defaultObserver()) {
  const roots = new Set([path.resolve(checkout)]);
  try {
    roots.add(realpathSync(checkout));
  } catch {
    // A checkout that no longer exists can only be matched by its given path.
  }
  const wrappers = new Set([...roots].map((root) => path.join(root, WRAPPER)));
  for (const wrapper of [...wrappers]) {
    try {
      wrappers.add(realpathSync(wrapper));
    } catch {
      // No wrapper file in this checkout.
    }
  }
  const scope = {
    wrappers,
    inside: (/** @type {string} */ dir) => [...roots].some((root) => dir === root || dir.startsWith(`${root}/`)),
  };
  const uid = process.getuid?.();
  /** @type {ProcessRow[]} */
  const watchers = [];
  /** @type {Unclassified[]} */
  const unclassified = [];
  /** @type {ProcessRow[]} */
  const vanished = [];
  /** @type {Array<{ row: ProcessRow, argv: { args: string[], exact: boolean } | null }>} */
  const pending = [];
  /** @param {ProcessRow} row @param {ReturnType<typeof classify>} verdict */
  const record = (row, verdict) => {
    if (verdict === WATCHER) watchers.push(row);
    else if (typeof verdict === "string") unclassified.push({ row, reason: verdict });
  };
  for (const row of table) {
    if (row.zombie || row.uid !== uid || !NODE.test(row.exe)) continue;
    const argv = argvOf(row);
    if (argv === undefined) {
      vanished.push(row);
      continue;
    }
    const verdict = classify(row, argv, undefined, scope);
    if (verdict === NEEDS_CWD) pending.push({ row, argv });
    else record(row, verdict);
  }
  const cwd = workingDirectories(observer, pending.map(({ row }) => row.pid));
  const unread = pending.filter(({ row }) => !cwd.has(row.pid));
  const running = stillRunning(observer, unread.map(({ row }) => row));
  for (const { row, argv } of pending) {
    const dir = cwd.get(row.pid);
    if (dir !== undefined) record(row, classify(row, argv, dir, scope));
    else if (running.has(identity(row))) unclassified.push({ row, reason: "its working directory could not be read" });
    else vanished.push(row);
  }
  return { watchers, unclassified, vanished };
}

/** @param {string} [observerPath] @returns {Observer} */
function defaultObserver(observerPath = OBSERVER_PATH) {
  return { env: { PATH: observerPath, TZ: "UTC", LC_ALL: "C" }, deadline: Date.now() + 10_000 };
}

/** @param {string} file @returns {SavedState} */
function savedState(file) {
  if (!existsSync(file)) return { processes: [], groups: [], suspects: new Map() };
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
    if (saved.length === 0) return { processes: [], groups: [], suspects: new Map() };
    const pids = saved.map((row) => row?.pid).filter(Number.isInteger);
    throw refuse(
      `uses the version-1 format, whose start times depend on the caller's TZ and locale (PIDs ${pids.join(", ") || "unreadable"})`,
    );
  }
  const groups = saved?.groups ?? [];
  const suspects = saved?.suspects ?? [];
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
    groups.some((group) => !Number.isInteger(group) || group <= 1) ||
    !Array.isArray(suspects) ||
    suspects.some(
      (/** @type {any} */ item) =>
        !Number.isInteger(item?.group) || !Array.isArray(item.members) || item.members.some((/** @type {any} */ id) => typeof id !== "string"),
    )
  )
    throw refuse(`is not a version-${STATE_VERSION} ${STATE_FORMAT} record`);
  return {
    processes: saved.processes,
    groups,
    suspects: new Map(suspects.map((/** @type {any} */ item) => [item.group, new Set(item.members)])),
  };
}

/** @param {string} file @param {ProcessRow[]} rows @param {Set<number>} groups @param {Suspects} suspects */
function saveState(file, rows, groups, suspects) {
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
    JSON.stringify(
      {
        format: STATE_FORMAT,
        version: STATE_VERSION,
        processes,
        groups: [...groups],
        suspects: [...suspects].map(([group, members]) => ({ group, members: [...members] })),
      },
      null,
      2,
    ),
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

/** @param {{ pid: number, started: string }} row */
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
 * which only a fork inside the group can produce.
 *
 * A vanished process (a Node process that exited before discovery could read
 * it) makes its group a suspect: its children in this table are refused now,
 * and next round any member that was not in the group this round is refused
 * unless verified. A suspect with no new member has settled and is dropped.
 * Everything refused is returned as unclassified.
 * @param {{
 *   table: ProcessRow[], self: number, panes: number[], saved: SavedProcess[],
 *   matched: ProcessRow[], unmatched?: Unclassified[], vanished?: ProcessRow[],
 *   previous: Map<string, ProcessRow>, seen: Set<string> | null, groups: Set<number>, suspects?: Suspects,
 * }} round `previous` holds last round's targets, `seen` every identity in
 * last round's table (null before the first round), `suspects` the groups
 * that last round's vanished processes left.
 * @returns {{ found: Map<number, ProcessRow>, groups: Set<number>, unclassified: Unclassified[], suspects: Suspects, unresolved: boolean }}
 * `suspects` holds the groups still to re-scan or to keep refusing; `unresolved` means this round saw new vanished processes.
 */
export function discoverWatchers({
  table, self, panes, saved, matched, unmatched = [], vanished = [], previous, seen, groups: carried, suspects: carriedSuspects = new Map(),
}) {
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
  const refuse = (/** @type {ProcessRow} */ row, /** @type {string} */ reason) => {
    if (!unclassified.has(row.pid)) unclassified.set(row.pid, { row, reason });
  };
  for (const pid of panes) add(byPid.get(pid));
  for (const hint of saved) {
    const row = byPid.get(hint.pid);
    if (row?.started === hint.started) add(row);
  }
  for (const row of matched) add(row);
  for (const row of table) if (previous.has(identity(row))) add(row);
  for (const item of unmatched) if (!shielded.has(item.row.pid)) refuse(item.row, item.reason);

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
        if (shielded.has(row.pid)) refuse(row, `shares watcher process group ${group} with this command or its parents`);
        else if (anchored && seen && !seen.has(identity(row))) add(row);
        else refuse(row, `is in watcher process group ${group} but was never verified as a watcher`);
      }
    }
  }
  for (const group of [...groups]) {
    if (!live.some((row) => row.group === group)) groups.delete(group);
    else if (group <= 1) for (const row of live.filter((member) => member.group === group)) refuse(row, `is in process group ${group}, which cannot be signalled`);
  }

  /** @type {Suspects} */
  const suspects = new Map();
  for (const [group, before] of carriedSuspects) {
    const arrivals = live.filter((row) => row.group === group && !before.has(identity(row)) && !found.has(row.pid));
    for (const row of arrivals)
      refuse(row, `appeared in process group ${group} after a Node process there exited before it could be classified`);
    // Keep refusing on retry until the arrivals are gone.
    if (arrivals.length) suspects.set(group, before);
  }
  for (const gone of vanished) {
    if (shielded.has(gone.pid)) continue;
    for (const row of live)
      if (row.parent === gone.pid && !found.has(row.pid))
        refuse(row, `is a child of Node process ${gone.pid}, which exited before it could be classified`);
    const members = suspects.get(gone.group) ?? new Set();
    for (const row of live) if (row.group === gone.group) members.add(identity(row));
    members.add(identity(gone));
    suspects.set(gone.group, members);
  }
  return {
    found,
    groups,
    unclassified: [...unclassified.values()].filter((item) => !found.has(item.row.pid)),
    suspects,
    unresolved: vanished.some((gone) => !shielded.has(gone.pid)),
  };
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
 * persists its targets, groups and suspect groups before signalling, so an
 * interrupted or refused run leaves a record for the retry. Refuses, naming
 * the PIDs, when a process cannot be classified or anything is still alive or
 * unresolved at the deadline.
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
 * for ps and lsof; tests point it at fake or delayed tools.
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
  let suspects = saved.suspects;
  const survived = (/** @type {Iterable<ProcessRow>} */ rows) =>
    new Error(
      `[backend] REFUSING watched-file changes: Convex watcher processes for this checkout survived shutdown: ${describe(rows)}. Their identities are saved in ${statePath}. Stop them, then rerun.`,
    );
  const unsettled = () =>
    new Error(
      `[backend] REFUSING watched-file changes: Node processes in process groups ${[...suspects.keys()].join(", ")} kept exiting before they could be classified. State: ${statePath}. Rerun when they have stopped.`,
    );
  for (;;) {
    try {
      if (shutdownRound()) return;
    } catch (error) {
      // Out of time: name what was still alive or unresolved, not the tool.
      if (error instanceof DeadlineError && previous.size) throw survived(previous.values());
      if (error instanceof DeadlineError && suspects.size) throw unsettled();
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
      vanished: scan.vanished, previous, seen, groups, suspects,
    });
    const { found, unclassified } = round;
    groups = round.groups;
    suspects = round.suspects;
    previous = new Map([...found.values()].map((row) => [identity(row), row]));
    seen = new Set(table.map(identity));

    if (found.size === 0 && unclassified.length === 0 && !round.unresolved && present.status !== 0) {
      rmSync(statePath, { force: true });
      rebuild();
      return true;
    }
    saveState(statePath, [...found.values()], groups, suspects);
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
    if (elapsed >= deadlineMs && round.unresolved) throw unsettled();
    const signal = elapsed < graceMs ? "SIGTERM" : "SIGKILL";
    const confirmed = confirmedSignals({ fresh: processTable(observer), found, groups });
    for (const group of confirmed.groups) sendSignal(-group, signal);
    for (const pid of confirmed.pids) sendSignal(pid, signal);
    return false;
  }
}
