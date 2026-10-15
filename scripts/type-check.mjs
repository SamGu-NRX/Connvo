import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/bin/tsc");
let failed = false;
for (const args of [["--noEmit"], ["--noEmit", "-p", "tools/call-eval"]]) {
  const result = spawnSync(process.execPath, [compiler, ...args], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
