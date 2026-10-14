// Every subprocess here is a local probe. No Convex CLI or deployment runs:
// "watchers" are synthetic Node scripts, tmux servers are isolated with -L,
// and keys are synthetic strings.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import {
  createTmuxLauncher,
  checkedConvexEnvironment,
} from "./local-backend-core.mjs";
import {
  checkoutWatchers,
  confirmedSignals,
  discoverWatchers,
  nodeEntry,
  rebuildWithoutWatcher,
  runConvexCommand,
} from "./local-backend-process.mjs";

/** @type {string[]} */
const dirs = [];
/** @type {Array<() => void>} */
const cleanups = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      cleanup();
    } catch {
      // Best effort: the process or server is already gone.
    }
  }
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

// ------------------------------------------------------------ watcher shutdown

const J = JSON.stringify;

/** @param {import("vitest").TestContext["skip"]} skip */
function requireTmux(skip) {
  const error = spawnSync("tmux", ["-V"]).error;
  if (error && "code" in error && error.code === "ENOENT")
    skip("tmux is not on PATH; watcher shutdown needs an isolated server");
}

/** @param {string} file @returns {number[]} */
function readPids(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map(Number);
}

/** Alive and not a zombie, per ps. @param {number} pid */
function alive(pid) {
  const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  });
  return result.status === 0 && !result.stdout.trim().startsWith("Z");
}

/**
 * A temp checkout, a watched file, and a rebuild that records which synthetic
 * watchers were alive when it ran. Every synthetic process appends its PID to
 * `pids`, so cleanup kills them even when the code under test lets one escape.
 */
function watcherFixture() {
  const dir = fixture();
  const f = {
    dir,
    checkout: fixture(),
    watched: path.join(dir, "watched.txt"),
    observed: path.join(dir, "observed"),
    pids: path.join(dir, "pids"),
    forks: path.join(dir, "forks"),
    /** @type {string | null} */
    deleteAfterStart: null,
    statePath: path.join(dir, "out", "watcher-processes.json"),
    env: { HOME: dir, PATH: process.env.PATH },
    /** @type {number[][]} */
    liveAtRebuild: [],
    rebuild: () => {
      f.liveAtRebuild.push(readPids(f.pids).filter(alive));
      writeFileSync(f.watched, "after");
    },
  };
  writeFileSync(f.watched, "before");
  cleanups.push(() => {
    for (const pid of readPids(f.pids)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });
  return f;
}

/** @param {NodeJS.ProcessEnv} env */
function isolatedTmux(env) {
  const name = `connvo-test-${process.pid}-${randomUUID().slice(0, 8)}`;
  const tmuxArgs = ["-L", name, "-f", "/dev/null"];
  /** @param {string[]} args */
  const tmux = (args) =>
    spawnSync("tmux", [...tmuxArgs, ...args], { env, encoding: "utf8" });
  cleanups.push(() => {
    tmux(["kill-server"]);
    // tmux leaves the -L socket behind; env has no TMUX_TMPDIR, so it is in /tmp.
    rmSync(path.join("/tmp", `tmux-${process.getuid?.()}`, name), { force: true });
  });
  return { tmuxArgs, tmux };
}

/**
 * Source of a synthetic watcher. It records its PID, ignores the listed
 * signals, and writes `observed` if the watched file stops reading "before"
 * while it lives. With `forkOn`, those signals make it spawn `forkOn` and exit.
 * @param {ReturnType<typeof watcherFixture>} f
 * @param {{ ignore?: string[], forkOn?: string }} [opts]
 */
function watcherSource(f, { ignore = [], forkOn } = {}) {
  return `
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
appendFileSync(${J(f.pids)}, process.pid + '\\n');
for (const signal of ${J(ignore)}) process.on(signal, () => {});
${forkOn ? `for (const signal of ['SIGHUP', 'SIGTERM']) process.on(signal, () => {
  const child = spawn(process.execPath, [${J(forkOn)}], { stdio: 'ignore' });
  // Recorded by the parent, so a child killed before it starts still counts.
  appendFileSync(${J(f.pids)}, child.pid + '\\n');
  appendFileSync(${J(f.forks)}, child.pid + '\\n');
  process.exit(0);
});` : ""}
setInterval(() => {
  if (readFileSync(${J(f.watched)}, 'utf8') !== 'before') writeFileSync(${J(f.observed)}, 'observed');
}, 5);
`;
}

/** @param {string} file @param {string} source */
function writeScript(file, source) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

/** @param {string} file @param {number} count */
async function waitForPids(file, count) {
  return vi.waitFor(
    () => {
      const pids = readPids(file);
      if (pids.length < count) throw new Error(`waiting for ${count} PIDs`);
      return pids;
    },
    { timeout: 10_000, interval: 20 },
  );
}

/** Drops signals to `pid` and its group, like a process this user cannot signal. @param {number} pid */
function sparing(pid) {
  return (/** @type {number} */ target, /** @type {NodeJS.Signals} */ signal) => {
    if (Math.abs(target) === pid) return;
    try {
      process.kill(target, signal);
    } catch {
      // Already gone.
    }
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

it("stops an existing unsafe watcher before rebuilding, spares the tmux server, and restarts a clean pane", async ({
  skip,
}) => {
  requireTmux(skip);
  const f = watcherFixture();
  const started = path.join(f.dir, "old-started.json");
  const probe = path.join(f.dir, "new-probe.mjs");
  const output = path.join(f.dir, "new-result.json");
  const startup = path.join(f.dir, "startup.sh");
  // The old watcher sits where this checkout's Convex CLI would be.
  const oldCli = writeScript(
    path.join(f.checkout, "node_modules", "convex", "bin", "main.js"),
    `${watcherSource(f)}
writeFileSync(${J(started)}, JSON.stringify({unsafe:!!process.env.CONVEX_DEPLOY_KEY}));`,
  );
  writeFileSync(startup, "export CONVEX_DEPLOY_KEY=synthetic-startup-key\n");
  writeFileSync(
    probe,
    `
    import { readFileSync, writeFileSync } from 'node:fs';
    writeFileSync(process.argv[2], JSON.stringify({clean:!process.env.CONVEX_DEPLOY_KEY && !process.env.BASH_ENV,
      rebuilt:readFileSync(${J(f.watched)},'utf8')==='after'}));
    setInterval(()=>{},100);
  `,
  );
  const env = { ...f.env, CONVEX_DEPLOY_KEY: "synthetic-server-key", BASH_ENV: startup };
  const { tmuxArgs, tmux } = isolatedTmux(env);
  // Created first, so the tmux server's own command line names this checkout's
  // `convex/bin/main.js dev`. Shutdown must not mistake the server for a watcher.
  expect(tmux(["new-session", "-d", "-s", "watcher", "--", process.execPath, oldCli, "dev"]).status).toBe(0);
  expect(tmux(["new-session", "-d", "-s", "keeper", "--", "/bin/sleep", "30"]).status).toBe(0);
  expect(await vi.waitFor(() => JSON.parse(readFileSync(started, "utf8")))).toEqual({ unsafe: true });
  const stop = () =>
    rebuildWithoutWatcher({
      session: "watcher", checkout: f.checkout, statePath: f.statePath, tmuxArgs, env, graceMs: 200, rebuild: f.rebuild,
    });
  await stop();
  expect(f.liveAtRebuild).toEqual([[]]);
  expect(tmux(["has-session", "-t", "=watcher"]).status).toBe(1);
  expect(tmux(["has-session", "-t", "=keeper"]).status).toBe(0);
  const launcher = createTmuxLauncher({
    session: "watcher",
    file: path.join(f.dir, "unused.sh"),
    cwd: f.dir,
    callerEnv: checkedConvexEnvironment({ env: { HOME: f.dir, PATH: process.env.PATH } }),
    env: {},
    command: [
      process.execPath,
      path.join(path.dirname(fileURLToPath(import.meta.url)), "local-backend-watch.mjs"),
      probe,
      path.join(f.dir, "watch.log"),
      output,
    ],
  });
  expect(tmux(launcher.args).status).toBe(0);
  expect(await vi.waitFor(() => JSON.parse(readFileSync(output, "utf8")))).toEqual({ clean: true, rebuilt: true });
  // The pane's first process leads its own group, which reaches later children.
  const pane = Number(tmux(["list-panes", "-s", "-t", "=watcher", "-F", "#{pane_pid}"]).stdout.trim());
  expect(spawnSync("ps", ["-o", "pgid=", "-p", String(pane)], { encoding: "utf8" }).stdout.trim()).toBe(String(pane));
  await stop();
  expect(alive(pane)).toBe(false);
  expect(readFileSync(f.watched, "utf8")).toBe("after");
  await settle();
  expect(existsSync(f.observed)).toBe(false);
}, 30_000);

it("a TZ change between refusal and retry does not hide a surviving watcher", async ({ skip }) => {
  requireTmux(skip);
  const f = watcherFixture();
  const { tmuxArgs, tmux } = isolatedTmux(f.env);
  const script = writeScript(path.join(f.dir, "survivor.mjs"), watcherSource(f, { ignore: ["SIGHUP"] }));
  expect(tmux(["new-session", "-d", "-s", "watcher", "--", process.execPath, script]).status).toBe(0);
  const [pid] = await waitForPids(f.pids, 1);
  const attempt = () =>
    rebuildWithoutWatcher({
      session: "watcher", checkout: f.checkout, statePath: f.statePath, tmuxArgs, env: f.env,
      deadlineMs: 1_000, graceMs: 200, sendSignal: sparing(pid), rebuild: f.rebuild,
    });
  const tz = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    await expect(attempt()).rejects.toThrow();
    process.env.TZ = "America/Los_Angeles";
    await expect(attempt()).rejects.toThrow(`${pid} (`);
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
  expect(f.liveAtRebuild).toEqual([]);
  expect(readFileSync(f.watched, "utf8")).toBe("before");
  expect(alive(pid)).toBe(true);
}, 60_000);

/**
 * A tmux stand-in that reports no server, for tests whose session is gone
 * anyway; they then need no real tmux.
 * @param {ReturnType<typeof watcherFixture>} f
 */
function noTmux(f) {
  const bin = path.join(f.dir, "no-tmux");
  chmodSync(writeScript(path.join(bin, "tmux"), "#!/bin/sh\nexit 1\n"), 0o755);
  return { tmuxArgs: [], env: { ...f.env, PATH: `${bin}:/usr/bin:/bin` } };
}

/** @param {string} exe @param {string[]} args @param {string} cwd @param {NodeJS.ProcessEnv} [env] */
function orphan(exe, args, cwd, env) {
  const child = spawn(exe, args, { cwd, detached: true, stdio: "ignore", env });
  child.unref();
  cleanups.push(() => child.kill("SIGKILL"));
  return child;
}

/**
 * Ways a watcher for the checkout can be invoked, each started as an orphan
 * with no tmux session and no state file.
 * @type {Array<[string, (f: ReturnType<typeof watcherFixture>) => void]>}
 */
const ORPHANS = [
  ["node <checkout>/node_modules/convex/bin/main.js dev", (f) => {
    const cli = writeScript(path.join(f.checkout, "node_modules", "convex", "bin", "main.js"), watcherSource(f, { ignore: ["SIGHUP", "SIGTERM"] }));
    orphan(process.execPath, [cli, "dev", "--typecheck=disable"], f.checkout);
  }],
  ["a relative entry, node node_modules/convex/bin/main.js dev", (f) => {
    writeScript(path.join(f.checkout, "node_modules", "convex", "bin", "main.js"), watcherSource(f, { ignore: ["SIGHUP", "SIGTERM"] }));
    orphan(process.execPath, ["node_modules/convex/bin/main.js", "dev"], f.checkout);
  }],
  ["node --trace-warnings before the entry", (f) => {
    const cli = writeScript(path.join(f.checkout, "node_modules", "convex", "bin", "main.js"), watcherSource(f, { ignore: ["SIGHUP", "SIGTERM"] }));
    orphan(process.execPath, ["--trace-warnings", cli, "dev"], f.checkout);
  }],
  ["node --inspect=127.0.0.1:0 before the entry", (f) => {
    const cli = writeScript(path.join(f.checkout, "node_modules", "convex", "bin", "main.js"), watcherSource(f, { ignore: ["SIGHUP", "SIGTERM"] }));
    orphan(process.execPath, ["--inspect=127.0.0.1:0", cli, "dev"], f.checkout);
  }],
  ["node -r <hook>, an option that takes a value", (f) => {
    const cli = writeScript(path.join(f.checkout, "node_modules", "convex", "bin", "main.js"), watcherSource(f, { ignore: ["SIGHUP", "SIGTERM"] }));
    const hook = writeScript(path.join(f.dir, "hook.cjs"), "");
    orphan(process.execPath, ["-r", hook, cli, "dev"], f.checkout);
  }],
  ["an entry file deleted after start", (f) => {
    const cli = writeScript(path.join(f.checkout, "node_modules", "convex", "bin", "main.js"), watcherSource(f, { ignore: ["SIGHUP", "SIGTERM"] }));
    orphan(process.execPath, [cli, "dev"], f.checkout);
    // The test deletes it once the process has recorded its PID.
    f.deleteAfterStart = cli;
  }],
  ["the wrapper under a symlink alias of the checkout", (f) => {
    writeScript(path.join(f.checkout, "tools", "call-eval", "scripts", "local-backend-watch.mjs"), watcherSource(f, { ignore: ["SIGHUP", "SIGTERM"] }));
    const alias = path.join(f.dir, "alias");
    symlinkSync(f.checkout, alias);
    orphan(process.execPath, [path.join(alias, "tools", "call-eval", "scripts", "local-backend-watch.mjs"), "x", "log", "dev"], f.dir);
  }],
];

it.each(ORPHANS)("finds an orphaned watcher with no state file and the session gone: %s", async (_, start) => {
  const f = watcherFixture();
  start(f);
  const [pid] = await waitForPids(f.pids, 1);
  if (f.deleteAfterStart) rmSync(f.deleteAfterStart);
  await rebuildWithoutWatcher({
    session: "watcher", checkout: f.checkout, statePath: f.statePath, ...noTmux(f), graceMs: 200, rebuild: f.rebuild,
  });
  expect(f.liveAtRebuild).toEqual([[]]);
  expect(alive(pid)).toBe(false);
  await settle();
  expect(existsSync(f.observed)).toBe(false);
}, 30_000);

it("finds an old `npx convex dev` orphan when the state file holds []", async () => {
  const f = watcherFixture();
  mkdirSync(path.dirname(f.statePath), { recursive: true });
  writeFileSync(f.statePath, "[]");
  // Versions before 59c98b7 ran `npx convex dev` from the checkout; this npx
  // is a fake on a temp PATH.
  const body = writeScript(path.join(f.dir, "npx-body.mjs"), watcherSource(f, { ignore: ["SIGHUP", "SIGTERM"] }));
  const bin = path.join(f.dir, "bin");
  chmodSync(writeScript(path.join(bin, "npx"), `#!/usr/bin/env node\nimport(${J(body)});\n`), 0o755);
  orphan("npx", ["convex", "dev", "--typecheck=disable"], f.checkout, { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin` });
  const [pid] = await waitForPids(f.pids, 1);
  await rebuildWithoutWatcher({
    session: "watcher", checkout: f.checkout, statePath: f.statePath, ...noTmux(f), graceMs: 200, rebuild: f.rebuild,
  });
  expect(f.liveAtRebuild).toEqual([[]]);
  expect(alive(pid)).toBe(false);
  await settle();
  expect(existsSync(f.observed)).toBe(false);
}, 30_000);

it("a child forked on SIGHUP during shutdown never outlives a rebuild", async ({ skip }) => {
  requireTmux(skip);
  const f = watcherFixture();
  const { tmuxArgs, tmux } = isolatedTmux(f.env);
  const forked = writeScript(path.join(f.dir, "forked.mjs"), watcherSource(f));
  const forking = writeScript(path.join(f.dir, "forking.mjs"), watcherSource(f, { forkOn: forked }));
  expect(tmux(["new-session", "-d", "-s", "watcher", "--", process.execPath, forking]).status).toBe(0);
  await waitForPids(f.pids, 1);
  const attempt = () =>
    rebuildWithoutWatcher({
      session: "watcher", checkout: f.checkout, statePath: f.statePath, tmuxArgs, env: f.env, graceMs: 200, rebuild: f.rebuild,
    });
  // If the parent exits before a round sees the child, the child is in the
  // watcher's group with no verified member left: shutdown refuses and names it.
  const outcome = await attempt().then(() => null, (/** @type {Error} */ error) => error);
  expect(readPids(f.forks).length).toBeGreaterThan(0);
  if (outcome) {
    expect(f.liveAtRebuild).toEqual([]);
    const survivors = readPids(f.forks).filter(alive);
    expect(survivors.length).toBeGreaterThan(0);
    for (const pid of survivors) expect(outcome.message).toContain(`${pid} (`);
    // The saved group keeps refusing after the session is gone.
    await expect(attempt()).rejects.toThrow(`${survivors[0]} (`);
    for (const pid of survivors) process.kill(pid, "SIGKILL");
    await vi.waitFor(() => expect(survivors.filter(alive)).toEqual([]));
    await attempt();
  }
  expect(f.liveAtRebuild).toEqual([[]]);
  await settle();
  expect(readPids(f.pids).filter(alive)).toEqual([]);
  expect(existsSync(f.observed)).toBe(false);
}, 30_000);

it("finds a surviving watcher in an inactive tmux window", async ({ skip }) => {
  requireTmux(skip);
  const f = watcherFixture();
  const { tmuxArgs, tmux } = isolatedTmux(f.env);
  const hidden = writeScript(path.join(f.dir, "hidden.mjs"), watcherSource(f, { ignore: ["SIGHUP", "SIGTERM"] }));
  expect(tmux(["new-session", "-d", "-s", "watcher", "--", "/bin/sleep", "30"]).status).toBe(0);
  expect(tmux(["new-window", "-d", "-t", "=watcher", "--", process.execPath, hidden]).status).toBe(0);
  const [pid] = await waitForPids(f.pids, 1);
  // The selected window's panes do not include it.
  expect(tmux(["list-panes", "-t", "=watcher", "-F", "#{pane_pid}"]).stdout).not.toContain(String(pid));
  await rebuildWithoutWatcher({
    session: "watcher", checkout: f.checkout, statePath: f.statePath, tmuxArgs, env: f.env, graceMs: 200, rebuild: f.rebuild,
  });
  expect(f.liveAtRebuild).toEqual([[]]);
  expect(alive(pid)).toBe(false);
  await settle();
  expect(existsSync(f.observed)).toBe(false);
}, 30_000);

it("PID reuse: the survivor stays recognized under another locale, and a recycled PID is neither blocked on nor signalled", async ({
  skip,
}) => {
  requireTmux(skip);
  const f = watcherFixture();
  const { tmuxArgs, tmux } = isolatedTmux(f.env);
  const script = writeScript(path.join(f.dir, "survivor.mjs"), watcherSource(f, { ignore: ["SIGHUP"] }));
  expect(tmux(["new-session", "-d", "-s", "watcher", "--", process.execPath, script]).status).toBe(0);
  const [pid] = await waitForPids(f.pids, 1);
  /** @param {(target: number, signal: NodeJS.Signals) => void} [sendSignal] */
  const attempt = (sendSignal) =>
    rebuildWithoutWatcher({
      session: "watcher", checkout: f.checkout, statePath: f.statePath, tmuxArgs, env: f.env,
      deadlineMs: 1_000, graceMs: 200, sendSignal, rebuild: f.rebuild,
    });
  const locale = process.env.LC_ALL;
  try {
    process.env.LC_ALL = "C";
    await expect(attempt(sparing(pid))).rejects.toThrow();
    // ps prints German day and month names here; the survivor must still match.
    process.env.LC_ALL = "de_DE.UTF-8";
    await expect(attempt(sparing(pid))).rejects.toThrow(`${pid} (`);
  } finally {
    if (locale === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = locale;
  }
  expect(f.liveAtRebuild).toEqual([]);

  // The survivor exits and an unrelated process takes its PID in the record.
  process.kill(pid, "SIGKILL");
  await vi.waitFor(() => expect(alive(pid)).toBe(false));
  const bystander = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  bystander.unref();
  cleanups.push(() => bystander.kill("SIGKILL"));
  const saved = JSON.parse(readFileSync(f.statePath, "utf8"));
  for (const row of Array.isArray(saved) ? saved : saved.processes)
    if (row.pid === pid) row.pid = bystander.pid;
  writeFileSync(f.statePath, JSON.stringify(saved));
  await attempt();
  expect(f.liveAtRebuild).toEqual([[]]);
  expect(alive(/** @type {number} */ (bystander.pid))).toBe(true);
  expect(existsSync(f.statePath)).toBe(false);
}, 60_000);

it("a surviving orphan blocks every retry by PID until it exits", async ({ skip }) => {
  requireTmux(skip);
  const f = watcherFixture();
  const { tmuxArgs, tmux } = isolatedTmux(f.env);
  const script = writeScript(path.join(f.dir, "stubborn.mjs"), watcherSource(f, { ignore: ["SIGHUP"] }));
  expect(tmux(["new-session", "-d", "-s", "watcher", "--", process.execPath, script]).status).toBe(0);
  const [pid] = await waitForPids(f.pids, 1);
  /** @param {(target: number, signal: NodeJS.Signals) => void} [sendSignal] */
  const attempt = (sendSignal) =>
    rebuildWithoutWatcher({
      session: "watcher", checkout: f.checkout, statePath: f.statePath, tmuxArgs, env: f.env,
      deadlineMs: 1_000, graceMs: 200, sendSignal, rebuild: f.rebuild,
    });
  await expect(attempt(sparing(pid))).rejects.toThrow(`${pid} (`);
  expect(readFileSync(f.statePath, "utf8")).toContain(`"pid": ${pid}`);
  expect(tmux(["has-session", "-t", "=watcher"]).status).toBe(1);
  // The retry has no tmux session to rediscover, but the process still lives.
  await expect(attempt(sparing(pid))).rejects.toThrow(`${pid} (`);
  expect(f.liveAtRebuild).toEqual([]);
  process.kill(pid, "SIGKILL");
  await vi.waitFor(() => expect(alive(pid)).toBe(false));
  await attempt();
  expect(f.liveAtRebuild).toEqual([[]]);
  expect(existsSync(f.statePath)).toBe(false);
}, 60_000);

it.each([
  ["a version-1 record with PIDs", JSON.stringify([{ pid: 4242, parent: 1, started: "Wed Oct 14 12:00:00 2026" }]), "version-1 format, whose start times depend on the caller's TZ and locale (PIDs 4242)"],
  ["an unknown version", JSON.stringify({ format: "connvo-call-eval-watchers", version: 3, processes: [] }), "is not a version-2"],
  ["a partial write", '{"format":"connvo-call-eval-watchers","vers', "is not valid JSON"],
])("refuses to trust %s and does not rebuild", async (_, text, message) => {
  const f = watcherFixture();
  mkdirSync(path.dirname(f.statePath), { recursive: true });
  writeFileSync(f.statePath, text);
  await expect(
    rebuildWithoutWatcher({
      session: "watcher", checkout: f.checkout, statePath: f.statePath, tmuxArgs: isolatedTmux(f.env).tmuxArgs, env: f.env, rebuild: f.rebuild,
    }),
  ).rejects.toThrow(message);
  expect(f.liveAtRebuild).toEqual([]);
  expect(readFileSync(f.statePath, "utf8")).toBe(text);
});

it("does not target an editor, pager or search whose arguments name the wrapper or `convex dev`", async () => {
  const f = watcherFixture();
  const wrapper = writeScript(path.join(f.checkout, "tools", "call-eval", "scripts", "local-backend-watch.mjs"), "");
  const cli = writeScript(path.join(f.checkout, "node_modules", "convex", "bin", "main.js"), "");
  // Stand-ins that stay alive: shell scripts named like the real tools.
  const bin = path.join(f.dir, "bin");
  for (const name of ["vim", "less", "grep"]) chmodSync(writeScript(path.join(bin, name), "#!/bin/sh\nsleep 30\n"), 0o755);
  /** @type {Array<[string, string[]]>} */
  const commands = [
    [path.join(bin, "vim"), [wrapper]],
    [path.join(bin, "less"), [wrapper]],
    [path.join(bin, "grep"), ["-r", "convex dev", f.checkout]],
    [path.join(bin, "grep"), ["convex", "dev", cli, "dev"]],
    // Node running inline code that names the wrapper, without convex or dev.
    [process.execPath, ["-e", "setInterval(() => {}, 1000)", wrapper]],
  ];
  const bystanders = commands.map(([exe, args]) => /** @type {number} */ (orphan(exe, args, f.checkout).pid));
  await vi.waitFor(() => expect(bystanders.every(alive)).toBe(true));
  await settle();
  await rebuildWithoutWatcher({
    session: "watcher", checkout: f.checkout, statePath: f.statePath, ...noTmux(f), rebuild: f.rebuild,
  });
  expect(f.liveAtRebuild).toEqual([[]]);
  expect(bystanders.filter((pid) => !alive(pid))).toEqual([]);
}, 30_000);

it("refuses, without signalling it, a Node process in the checkout that mentions convex and dev but is no known watcher", async () => {
  const f = watcherFixture();
  const search = writeScript(path.join(f.dir, "search.mjs"), "setInterval(() => {}, 1000);\n");
  const pid = /** @type {number} */ (orphan(process.execPath, [search, "--mode", "convex", "dev"], f.checkout).pid);
  await vi.waitFor(() => expect(alive(pid)).toBe(true));
  await settle();
  await expect(
    rebuildWithoutWatcher({ session: "watcher", checkout: f.checkout, statePath: f.statePath, ...noTmux(f), rebuild: f.rebuild }),
  ).rejects.toThrow(`${pid} (`);
  expect(f.liveAtRebuild).toEqual([]);
  expect(alive(pid)).toBe(true);
}, 30_000);

it("refuses when a watcher's process group is led by a launcher that is not a watcher", async () => {
  const f = watcherFixture();
  const forked = writeScript(path.join(f.dir, "forked.mjs"), watcherSource(f));
  const cli = writeScript(path.join(f.checkout, "node_modules", "convex", "bin", "main.js"), watcherSource(f, { forkOn: forked }));
  // The launcher leads its own group and starts the watcher inside it.
  const launcher = writeScript(path.join(f.dir, "launcher.mjs"), `
import { spawn } from 'node:child_process';
for (const signal of ['SIGHUP', 'SIGTERM']) process.on(signal, () => {});
spawn(process.execPath, [${J(cli)}, 'dev'], { cwd: ${J(f.checkout)}, stdio: 'ignore' });
setInterval(() => {}, 1000);
`);
  const leader = /** @type {number} */ (orphan(process.execPath, [launcher], f.dir).pid);
  const [watcher] = await waitForPids(f.pids, 1);
  await expect(
    rebuildWithoutWatcher({ session: "watcher", checkout: f.checkout, statePath: f.statePath, ...noTmux(f), graceMs: 200, rebuild: f.rebuild }),
  ).rejects.toThrow(`${leader} (`);
  expect(f.liveAtRebuild).toEqual([]);
  // Refused before signalling: the watcher did not fork a child out of reach.
  expect(alive(watcher)).toBe(true);
  expect(readPids(f.forks)).toEqual([]);
}, 30_000);

it("refuses while a saved group has members and none of them was verified", async () => {
  const f = watcherFixture();
  const member = orphan(process.execPath, ["-e", "setInterval(() => {}, 1000)"], f.dir);
  const pid = /** @type {number} */ (member.pid);
  await vi.waitFor(() => expect(alive(pid)).toBe(true));
  mkdirSync(path.dirname(f.statePath), { recursive: true });
  // A refused run saved this group; its verified members have since exited.
  writeFileSync(f.statePath, JSON.stringify({ format: "connvo-call-eval-watchers", version: 2, processes: [], groups: [pid] }));
  await expect(
    rebuildWithoutWatcher({ session: "watcher", checkout: f.checkout, statePath: f.statePath, ...noTmux(f), rebuild: f.rebuild }),
  ).rejects.toThrow(`${pid} (`);
  expect(f.liveAtRebuild).toEqual([]);
  expect(alive(pid)).toBe(true);
}, 30_000);

it("refuses when ps hangs past the shutdown deadline", async () => {
  const f = watcherFixture();
  const tools = path.join(f.dir, "hung-tools");
  // exec, so the timeout's SIGKILL reaches the sleeping process itself.
  for (const name of ["ps", "lsof"]) chmodSync(writeScript(path.join(tools, name), "#!/bin/sh\nexec /bin/sleep 30\n"), 0o755);
  const begun = Date.now();
  await expect(
    rebuildWithoutWatcher({
      session: "watcher", checkout: f.checkout, statePath: f.statePath, ...noTmux(f), deadlineMs: 1_000, observerPath: tools, rebuild: f.rebuild,
    }),
  ).rejects.toThrow("did not finish before the shutdown deadline");
  expect(Date.now() - begun).toBeLessThan(5_000);
  expect(f.liveAtRebuild).toEqual([]);
}, 30_000);

it("matches a real Node watcher by what it executes", async () => {
  const f = watcherFixture();
  const cli = writeScript(path.join(f.checkout, "node_modules", "convex", "bin", "main.js"), "setInterval(() => {}, 1000);\n");
  const elsewhere = orphan(process.execPath, [cli, "dev"], f.dir);
  const inside = orphan(process.execPath, ["--trace-warnings", cli, "dev", "--typecheck=disable"], f.checkout);
  await vi.waitFor(() => expect([elsewhere.pid, inside.pid].every((pid) => alive(/** @type {number} */ (pid)))).toBe(true));
  await settle();
  const table = spawnSync("ps", ["axww", "-o", "pid=,ppid=,pgid=,stat=,lstart=,command="], {
    env: { PATH: "/usr/bin:/bin", TZ: "UTC", LC_ALL: "C" }, encoding: "utf8",
  }).stdout.split("\n").filter(Boolean).map((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3} \w{3} +\d+ [\d:]+ \d{4})\s*(.*)$/.exec(line);
    return { pid: Number(m?.[1]), parent: Number(m?.[2]), group: Number(m?.[3]), zombie: false, started: String(m?.[5]), command: String(m?.[6]) };
  });
  // Only the copy whose working directory is inside the checkout watches it.
  const { watchers, unclassified } = checkoutWatchers(table, f.checkout);
  expect(watchers.map((row) => row.pid)).toEqual([inside.pid]);
  expect(unclassified).toEqual([]);
});

it.each([
  ["options before the entry", ["--trace-warnings", "--inspect=127.0.0.1:0", "-r", "/hook.cjs", "/co/node_modules/convex/bin/main.js", "dev"], true, "/co/node_modules/convex/bin/main.js", ["dev"]],
  ["-- ends Node's options", ["--", "/co/x.mjs", "a"], true, "/co/x.mjs", ["a"]],
  ["a relative entry", ["node_modules/convex/bin/main.js", "dev"], true, "/co/node_modules/convex/bin/main.js", ["dev"]],
  ["a spaced path split by ps, file gone", ["/Programming", "Projects/co/node_modules/convex/bin/main.js", "dev"], false, "/Programming Projects/co/node_modules/convex/bin/main.js", ["dev"]],
])("parses the Node entry: %s", (_, args, exact, entry, after) => {
  const parsed = nodeEntry({ args: /** @type {string[]} */ (args), exact: /** @type {boolean} */ (exact) }, "/co");
  expect(parsed).toMatchObject({ inline: false, entry, after });
});

it("treats inline Node code as having no entry script", () => {
  expect(nodeEntry({ args: ["-e", "1", "/co/node_modules/convex/bin/main.js", "dev"], exact: true }, "/co")).toEqual({ inline: true });
});

// Synthetic process tables: PID and group reuse cannot be forced on a real system.
const START = "Wed Oct 14 12:00:00 2026";
const LATER = "Wed Oct 14 12:00:05 2026";
/** @param {number} pid @param {number} parent @param {number} group @param {string} [started] */
const row = (pid, parent, group, started = START) => ({ pid, parent, group, zombie: false, started, command: `synthetic ${pid}` });
const base = [row(1, 0, 1), row(100, 1, 100)];
/** @param {Partial<Parameters<typeof discoverWatchers>[0]>} input */
const discover = (input) =>
  discoverWatchers({ table: base, self: 100, panes: [], saved: [], matched: [], previous: new Map(), seen: null, groups: new Set(), ...input });
/** @param {Iterable<{ pid: number, started: string }>} rows */
const ids = (rows) => new Map([...rows].map((r) => [`${r.pid}@${r.started}`, /** @type {any} */ (r)]));
/** @param {{ unclassified: Array<{ row: { pid: number } }> }} result */
const refused = (result) => result.unclassified.map((item) => item.row.pid).sort((a, b) => a - b);

it("tracks a watcher's group and accepts a member forked while a verified member lives", () => {
  const first = discover({ table: [...base, row(500, 1, 500), row(501, 500, 500)], panes: [500] });
  expect([...first.found.keys()].sort()).toEqual([500, 501]);
  expect([...first.groups]).toEqual([500]);
  const seen = new Set([...base, row(500, 1, 500), row(501, 500, 500)].map((r) => `${r.pid}@${r.started}`));
  // 500 exited; 501 (verified last round) is still in the group, 602 is new.
  const next = discover({ table: [...base, row(501, 1, 500), row(602, 1, 500, LATER)], previous: ids(first.found.values()), seen, groups: first.groups });
  expect([...next.found.keys()].sort()).toEqual([501, 602]);
  expect(refused(next)).toEqual([]);
});

it("refuses a carried group that has members but no verified one", () => {
  const first = discover({ table: [...base, row(500, 1, 500)], panes: [500] });
  const seen = new Set([...base, row(500, 1, 500)].map((r) => `${r.pid}@${r.started}`));
  const previous = ids(first.found.values());
  // The leader exited and a child it forked is all that is left.
  const forked = discover({ table: [...base, row(601, 1, 500, LATER)], previous, seen, groups: first.groups });
  expect([...forked.found.keys()]).toEqual([]);
  expect(refused(forked)).toEqual([601]);
  // A new process took PID 500 and leads a new group 500.
  const recycled = discover({ table: [...base, row(500, 1, 500, LATER), row(602, 500, 500, LATER)], previous, seen, groups: first.groups });
  expect([...recycled.found.keys()]).toEqual([]);
  expect(refused(recycled)).toEqual([500, 602]);
  // A round that saw the group empty stops tracking it.
  const emptied = discover({ table: base, previous, seen, groups: first.groups });
  expect([...emptied.groups]).toEqual([]);
});

it("refuses an untracked launcher that leads a watcher's group", () => {
  const table = [...base, row(400, 1, 400), row(401, 400, 400)];
  const result = discover({ table, matched: [row(401, 400, 400)] });
  expect([...result.found.keys()]).toEqual([401]);
  expect([...result.groups]).toEqual([400]);
  expect(refused(result)).toEqual([400]);
});

it("refuses rather than signal a group containing the caller or its ancestors", () => {
  // The caller (100) runs inside pane 90's group.
  const table = [row(1, 0, 1), row(90, 1, 90), row(100, 90, 90), row(700, 90, 90)];
  const result = discover({ table, panes: [90], matched: [row(700, 90, 90)] });
  expect([...result.found.keys()]).toEqual([700]);
  expect(refused(result)).toEqual([90, 100]);
});

it("signals only targets whose PID and group still belong to the process that was found", () => {
  const found = new Map([[601, row(601, 1, 500)], [602, row(602, 1, 602)]]);
  const groups = new Set([500, 602]);
  // 602 now belongs to a different process, so neither it nor its group is signalled.
  const fresh = [...base, row(601, 1, 500), row(602, 1, 602, LATER)];
  expect(confirmedSignals({ fresh, found, groups })).toEqual({ pids: [601], groups: [500] });
});
