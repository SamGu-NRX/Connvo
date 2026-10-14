// Keep the watcher attached to its tmux pane and log without a shell pipeline.
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { checkedConvexEnvironment } from "./local-backend-core.mjs";

const [cli, log, ...args] = process.argv.slice(2);
if (!cli || !log) throw new Error("watcher requires a CLI path and log path");
const fd = openSync(log, "a", 0o600);
const child = spawn(process.execPath, [cli, ...args], {
  env: checkedConvexEnvironment({ env: process.env }),
  stdio: ["ignore", fd, fd],
});
/** @type {NodeJS.Signals[]} */
const signals = ["SIGHUP", "SIGINT", "SIGTERM"];
for (const signal of signals) process.on(signal, () => child.kill(signal));
child.on("error", () => {
  closeSync(fd);
  process.exit(1);
});
child.on("exit", (code) => {
  closeSync(fd);
  process.exit(code ?? 1);
});
