#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkedConvexEnvironment,
  selectedLocalBackend,
} from "./local-backend-core.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const environment = checkedConvexEnvironment({
  env: process.env,
  envLocalContent: readFileSync(path.join(root, ".env.local"), "utf8"),
});
const target = selectedLocalBackend({ cwd: root, env: environment });
const response = await fetch(`${target.url}/instance_name`, {
  signal: AbortSignal.timeout(5000),
  redirect: "error",
});
if (!response.ok || (await response.text()).trim() !== target.name) {
  throw new Error(
    "Full codegen refused: the selected anonymous backend did not answer with its expected identity",
  );
}

// Keep the harness watcher on its own functions directory while analyzing all app modules.
const temporary = mkdtempSync(
  path.join(root, "tools/call-eval/.local/codegen-"),
);
try {
  const config = JSON.parse(
    readFileSync(path.join(root, "convex.json"), "utf8"),
  );
  config.functions = path.relative(temporary, path.join(root, "convex"));
  writeFileSync(path.join(temporary, "convex.json"), JSON.stringify(config));
  for (const name of ["package.json", ".convex", "node_modules"]) {
    symlinkSync(
      path.join(root, name),
      path.join(temporary, name),
      process.platform === "win32" && name !== "package.json"
        ? "junction"
        : undefined,
    );
  }
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/convex/bin/main.js"),
      "codegen",
      "--typecheck",
      "enable",
    ],
    {
      cwd: temporary,
      env: environment,
      stdio: "inherit",
      timeout: 120000,
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true });
}
