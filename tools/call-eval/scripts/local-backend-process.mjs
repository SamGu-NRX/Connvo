import {
  existsSync,
  mkdirSync,
  readFileSync,
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

/** @typedef {{ pid: number, parent: number, started: string }} ProcessIdentity */

/** @returns {ProcessIdentity[]} */
function processIdentities() {
  const result = spawnSync("ps", ["-eo", "pid=,ppid=,lstart="], {
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error("[backend] could not inspect watcher processes");
  return result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      if (!match) throw new Error("[backend] invalid watcher process identity");
      return {
        pid: Number(match[1]),
        parent: Number(match[2]),
        started: match[3].trim(),
      };
    });
}

/** @param {string} file @returns {ProcessIdentity[]} */
function pendingWatchers(file) {
  if (!existsSync(file)) return [];
  const rows = JSON.parse(readFileSync(file, "utf8"));
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) =>
        !Number.isInteger(row.pid) ||
        row.pid <= 0 ||
        !Number.isInteger(row.parent) ||
        typeof row.started !== "string" ||
        !row.started,
    )
  )
    throw new Error(
      "[backend] invalid persisted watcher identities; refusing watched-file changes",
    );
  return rows;
}

/**
 * Persist the process tree before killing its pane. A timeout or interrupted
 * caller must not lose a surviving watcher and rebuild under it on retry.
 * @param {{ session: string, statePath: string, rebuild: () => void, tmuxArgs?: string[], env?: NodeJS.ProcessEnv }} opts
 */
export async function rebuildWithoutWatcher({
  session,
  statePath,
  rebuild,
  tmuxArgs = [],
  env = process.env,
}) {
  /** @param {string[]} args */
  const tmux = (args) =>
    spawnSync("tmux", [...tmuxArgs, ...args], { env, encoding: "utf8" });
  const pending = pendingWatchers(statePath);
  const present = tmux(["has-session", "-t", `=${session}`]);
  if (present.status !== 0 && present.status !== 1)
    throw new Error("[backend] could not inspect existing watcher");
  if (present.status === 0) {
    const panes = tmux([
      "list-panes",
      "-t",
      `=${session}`,
      "-F",
      "#{pane_pid}",
    ]);
    const rows = processIdentities();
    if (panes.status !== 0)
      throw new Error("[backend] could not inspect watcher processes");
    const pids = new Set(panes.stdout.trim().split(/\s+/).map(Number));
    if ([...pids].some((pid) => !Number.isInteger(pid) || pid <= 0))
      throw new Error("[backend] invalid watcher process identity");
    for (let count = -1; count !== pids.size; ) {
      count = pids.size;
      for (const row of rows) if (pids.has(row.parent)) pids.add(row.pid);
    }
    pending.push(...rows.filter((row) => pids.has(row.pid)));
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(`${statePath}.tmp`, JSON.stringify(pending));
    renameSync(`${statePath}.tmp`, statePath);
    if (tmux(["kill-session", "-t", `=${session}`]).status !== 0)
      throw new Error("[backend] could not stop existing watcher");
  }
  const deadline = Date.now() + 10_000;
  while (pending.length) {
    const rows = processIdentities();
    const live = pending.some((saved) =>
      rows.some(
        (row) => row.pid === saved.pid && row.started === saved.started,
      ),
    );
    if (!live) break;
    if (Date.now() >= deadline)
      throw new Error(
        "[backend] watcher did not stop; refusing watched-file changes",
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  rmSync(statePath, { force: true });
  rebuild();
}
