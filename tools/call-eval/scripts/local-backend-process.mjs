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
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * An old pane may hold unchecked selectors. End it and wait for its process
 * tree before rebuilding anything its watcher can push. Failure leaves the
 * watched files untouched, including when a child ignores the pane's HUP.
 * @param {{ session: string, rebuild: () => void, tmuxArgs?: string[], env?: NodeJS.ProcessEnv }} opts
 */
export async function rebuildWithoutWatcher({
  session,
  rebuild,
  tmuxArgs = [],
  env = process.env,
}) {
  /** @param {string[]} args */
  const tmux = (args) =>
    spawnSync("tmux", [...tmuxArgs, ...args], { env, encoding: "utf8" });
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
    const processes = spawnSync("ps", ["-eo", "pid=,ppid="], {
      encoding: "utf8",
    });
    if (panes.status !== 0 || processes.status !== 0)
      throw new Error("[backend] could not inspect watcher processes");
    const pids = new Set(panes.stdout.trim().split(/\s+/).map(Number));
    if ([...pids].some((pid) => !Number.isInteger(pid) || pid <= 0))
      throw new Error("[backend] invalid watcher process identity");
    const rows = processes.stdout
      .trim()
      .split("\n")
      .map((row) => row.trim().split(/\s+/).map(Number));
    for (let count = -1; count !== pids.size; ) {
      count = pids.size;
      for (const [pid, parent] of rows) if (pids.has(parent)) pids.add(pid);
    }
    if (tmux(["kill-session", "-t", `=${session}`]).status !== 0)
      throw new Error("[backend] could not stop existing watcher");
    const deadline = Date.now() + 10_000;
    for (;;) {
      const live = [...pids].some((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ESRCH"
          )
            return false;
          throw error;
        }
      });
      if (!live) break;
      if (Date.now() >= deadline)
        throw new Error(
          "[backend] watcher did not stop; refusing watched-file changes",
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  rebuild();
}
