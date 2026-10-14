// Every subprocess here is a local probe. No Convex CLI or deployment runs.
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import {
  createTmuxLauncher,
  checkedConvexEnvironment,
} from "./local-backend-core.mjs";
import {
  rebuildWithoutWatcher,
  runConvexCommand,
} from "./local-backend-process.mjs";

/** @type {string[]} */
const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "connvo-process-"));
  dirs.push(dir);
  return dir;
}

it("a synthetic Bash startup hook cannot inject a key into later Convex commands", () => {
  const dir = fixture();
  const startup = path.join(dir, "startup.sh");
  const marker = path.join(dir, "startup-ran");
  const probe = path.join(dir, "cli-probe.mjs");
  const output = path.join(dir, "result.json");
  writeFileSync(
    startup,
    `export CONVEX_DEPLOY_KEY=synthetic-startup-key\ntouch '${marker}'\n`,
  );
  writeFileSync(
    probe,
    `
    import { writeFileSync } from 'node:fs';
    const hooks = ['BASH_ENV','ENV','NODE_OPTIONS','LD_PRELOAD','DYLD_INSERT_LIBRARIES'];
    writeFileSync(process.argv[2], JSON.stringify({
      noCredentials: !process.env.CONVEX_DEPLOY_KEY && !process.env.CONVEX_DEPLOYMENT_TOKEN,
      noHooks: hooks.every(key => process.env[key] === undefined),
      localSelected: process.env.CONVEX_DEPLOYMENT === 'local:anonymous-probe',
      argvLiteral: process.argv[3] === 'env set synthetic; never run a shell',
    }));
  `,
  );
  const env = {
    HOME: dir,
    PATH: process.env.PATH,
    BASH_ENV: startup,
    ENV: startup,
    NODE_OPTIONS: "--require=synthetic-hook",
    LD_PRELOAD: "synthetic-loader",
    DYLD_INSERT_LIBRARIES: "synthetic-loader",
    CONVEX_DEPLOYMENT: "local:anonymous-probe",
  };
  // Positive control sources the fixture with Bash builtins and touch only.
  const positive = spawnSync(
    "/bin/bash",
    ["-c", '. "$BASH_ENV"; test -n "$CONVEX_DEPLOY_KEY"'],
    {
      env: { HOME: dir, PATH: process.env.PATH, BASH_ENV: startup },
    },
  );
  expect(positive.status).toBe(0);
  expect(existsSync(marker)).toBe(true);
  rmSync(marker);
  const result = runConvexCommand({
    node: process.execPath,
    cli: probe,
    args: [output, "env set synthetic; never run a shell"],
    cwd: dir,
    env,
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({
    noCredentials: true,
    noHooks: true,
    localSelected: true,
    argvLiteral: true,
  });
  expect(existsSync(marker)).toBe(false);
});

it("pins absent credentials so a later dotenv load cannot inject them", () => {
  const dir = fixture();
  const probe = path.join(dir, "dotenv-probe.mjs");
  const output = path.join(dir, "result.json");
  const dotenvPath = new URL(
    "../../../node_modules/dotenv/lib/main.js",
    import.meta.url,
  ).href;
  writeFileSync(
    probe,
    `
    import { writeFileSync } from 'node:fs';
    import dotenv from ${JSON.stringify(dotenvPath)};
    dotenv.populate(process.env, {CONVEX_DEPLOY_KEY:'synthetic-file-key',CONVEX_DEPLOYMENT:'prod:synthetic-cloud'});
    writeFileSync(process.argv[2], JSON.stringify({
      noKey: process.env.CONVEX_DEPLOY_KEY === '',
      selectedLocal: process.env.CONVEX_DEPLOYMENT === 'anonymous:anonymous-probe',
    }));
  `,
  );
  const result = runConvexCommand({
    node: process.execPath,
    cli: probe,
    args: [output],
    cwd: dir,
    env: { HOME: dir, PATH: process.env.PATH },
    envLocalContent: "CONVEX_DEPLOYMENT=anonymous:anonymous-probe",
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({
    noKey: true,
    selectedLocal: true,
  });
});

it("stops an existing unsafe watcher before rebuilding and restarts a clean pane", async ({
  skip,
}) => {
  const tmuxError = spawnSync("tmux", ["-V"]).error;
  if (tmuxError && "code" in tmuxError && tmuxError.code === "ENOENT")
    skip("tmux is not on PATH; watcher reuse needs an isolated server");
  const dir = fixture();
  const socket = path.join(dir, "server.sock");
  const tmuxArgs = ["-S", socket, "-f", "/dev/null"];
  const watched = path.join(dir, "watched.txt");
  const started = path.join(dir, "old-started.json");
  const pushed = path.join(dir, "old-observed-change");
  const old = path.join(dir, "old-watcher.mjs");
  const probe = path.join(dir, "new-probe.mjs");
  const output = path.join(dir, "new-result.json");
  const startup = path.join(dir, "startup.sh");
  writeFileSync(watched, "before");
  writeFileSync(startup, "export CONVEX_DEPLOY_KEY=synthetic-startup-key\n");
  writeFileSync(
    old,
    `
    import { readFileSync, writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(started)}, JSON.stringify({unsafe:!!process.env.CONVEX_DEPLOY_KEY}));
    setInterval(()=>{if(readFileSync(${JSON.stringify(watched)},'utf8')!=='before')writeFileSync(${JSON.stringify(pushed)},'observed');},5);
  `,
  );
  writeFileSync(
    probe,
    `
    import { readFileSync, writeFileSync } from 'node:fs';
    writeFileSync(process.argv[2], JSON.stringify({clean:!process.env.CONVEX_DEPLOY_KEY && !process.env.BASH_ENV,
      rebuilt:readFileSync(${JSON.stringify(watched)},'utf8')==='after'}));
  `,
  );
  const env = {
    HOME: dir,
    PATH: process.env.PATH,
    CONVEX_DEPLOY_KEY: "synthetic-server-key",
    BASH_ENV: startup,
  };
  /** @param {string[]} args */
  const tmux = (args) => spawnSync("tmux", [...tmuxArgs, ...args], { env });
  try {
    expect(
      tmux(["new-session", "-d", "-s", "keeper", "--", "/bin/sleep", "30"])
        .status,
    ).toBe(0);
    expect(
      tmux(["new-session", "-d", "-s", "watcher", "--", process.execPath, old])
        .status,
    ).toBe(0);
    expect(
      await vi.waitFor(() => JSON.parse(readFileSync(started, "utf8"))),
    ).toEqual({ unsafe: true });
    await rebuildWithoutWatcher({
      session: "watcher",
      tmuxArgs,
      env,
      rebuild: () => {
        writeFileSync(watched, "after");
      },
    });
    expect(tmux(["has-session", "-t", "=watcher"]).status).toBe(1);
    const launcher = createTmuxLauncher({
      session: "watcher",
      file: path.join(dir, "unused.sh"),
      cwd: dir,
      callerEnv: checkedConvexEnvironment({
        env: { HOME: dir, PATH: process.env.PATH },
      }),
      env: {},
      command: [
        process.execPath,
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "local-backend-watch.mjs",
        ),
        probe,
        path.join(dir, "watch.log"),
        output,
      ],
    });
    expect(tmux(launcher.args).status).toBe(0);
    expect(
      await vi.waitFor(() => JSON.parse(readFileSync(output, "utf8"))),
    ).toEqual({ clean: true, rebuilt: true });
    expect(existsSync(pushed)).toBe(false);
    await rebuildWithoutWatcher({
      session: "watcher",
      tmuxArgs,
      env,
      rebuild: () => {
        writeFileSync(watched, "again");
      },
    });
    expect(readFileSync(watched, "utf8")).toBe("again");
  } finally {
    tmux(["kill-server"]);
  }
});

it("refuses to rebuild if an old watcher survives pane termination", async ({
  skip,
}) => {
  const tmuxError = spawnSync("tmux", ["-V"]).error;
  if (tmuxError && "code" in tmuxError && tmuxError.code === "ENOENT")
    skip("tmux is not on PATH; watcher shutdown needs an isolated server");
  const dir = fixture();
  const socket = path.join(dir, "server.sock");
  const tmuxArgs = ["-S", socket, "-f", "/dev/null"];
  const watched = path.join(dir, "watched.txt");
  const pidFile = path.join(dir, "watcher-pid.json");
  const old = path.join(dir, "stubborn-watcher.mjs");
  writeFileSync(watched, "before");
  writeFileSync(
    old,
    `
    import { writeFileSync } from 'node:fs';
    process.on('SIGHUP', () => {});
    writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({pid:process.pid}));
    setInterval(()=>{},100);
  `,
  );
  const env = { HOME: dir, PATH: process.env.PATH };
  /** @param {string[]} args */
  const tmux = (args) => spawnSync("tmux", [...tmuxArgs, ...args], { env });
  let pid;
  try {
    expect(
      tmux(["new-session", "-d", "-s", "keeper", "--", "/bin/sleep", "30"])
        .status,
    ).toBe(0);
    expect(
      tmux(["new-session", "-d", "-s", "watcher", "--", process.execPath, old])
        .status,
    ).toBe(0);
    ({ pid } = await vi.waitFor(() =>
      JSON.parse(readFileSync(pidFile, "utf8")),
    ));
    await expect(
      rebuildWithoutWatcher({
        session: "watcher",
        tmuxArgs,
        env,
        rebuild: () => {
          writeFileSync(watched, "unsafe change");
        },
      }),
    ).rejects.toThrow("watcher did not stop; refusing watched-file changes");
    expect(readFileSync(watched, "utf8")).toBe("before");
  } finally {
    if (pid !== undefined) process.kill(pid, "SIGTERM");
    tmux(["kill-server"]);
  }
}, 15_000);
