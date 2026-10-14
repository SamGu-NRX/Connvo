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

it.each([
  ["no state file", null],
  ["a state file holding []", "[]"],
])("finds an orphaned watcher with %s and the session gone", async (_, stateText) => {
  const f = watcherFixture();
  if (stateText !== null) {
    mkdirSync(path.dirname(f.statePath), { recursive: true });
    writeFileSync(f.statePath, stateText);
  }
  // No tmux server ever starts on this socket.
  const { tmuxArgs } = isolatedTmux(f.env);
  let child;
  if (stateText === null) {
    // Current shape: the wrapper's child, node
    // <checkout>/node_modules/convex/bin/main.js dev, run from the checkout.
    const cli = writeScript(
      path.join(f.checkout, "node_modules", "convex", "bin", "main.js"),
      watcherSource(f, { ignore: ["SIGHUP", "SIGTERM"] }),
    );
    child = spawn(process.execPath, [cli, "dev", "--typecheck=disable"], { cwd: f.checkout, detached: true, stdio: "ignore" });
  } else {
    // Versions before 59c98b7 ran `npx convex dev` from the checkout; this
    // npx is a fake on a temp PATH.
    const body = writeScript(path.join(f.dir, "npx-body.mjs"), watcherSource(f, { ignore: ["SIGHUP", "SIGTERM"] }));
    const bin = path.join(f.dir, "bin");
    const npx = writeScript(path.join(bin, "npx"), `#!/usr/bin/env node\nimport(${J(body)});\n`);
    chmodSync(npx, 0o755);
    child = spawn("npx", ["convex", "dev", "--typecheck=disable"], {
      cwd: f.checkout,
      detached: true,
      stdio: "ignore",
      env: { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin` },
    });
  }
  child.unref();
  const [pid] = await waitForPids(f.pids, 1);
  await rebuildWithoutWatcher({
    session: "watcher", checkout: f.checkout, statePath: f.statePath, tmuxArgs, env: f.env, graceMs: 200, rebuild: f.rebuild,
  });
  expect(f.liveAtRebuild).toEqual([[]]);
  expect(alive(pid)).toBe(false);
  await settle();
  expect(existsSync(f.observed)).toBe(false);
}, 30_000);

it("a child forked on SIGHUP during shutdown is stopped before the rebuild", async ({ skip }) => {
  requireTmux(skip);
  const f = watcherFixture();
  const { tmuxArgs, tmux } = isolatedTmux(f.env);
  const forked = writeScript(path.join(f.dir, "forked.mjs"), watcherSource(f));
  const forking = writeScript(path.join(f.dir, "forking.mjs"), watcherSource(f, { forkOn: forked }));
  expect(tmux(["new-session", "-d", "-s", "watcher", "--", process.execPath, forking]).status).toBe(0);
  await waitForPids(f.pids, 1);
  await rebuildWithoutWatcher({
    session: "watcher", checkout: f.checkout, statePath: f.statePath, tmuxArgs, env: f.env, graceMs: 200, rebuild: f.rebuild,
  });
  expect(f.liveAtRebuild).toEqual([[]]);
  await settle();
  expect(readPids(f.forks).length).toBeGreaterThan(0);
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
  const search = writeScript(path.join(f.dir, "search.mjs"), "setInterval(() => {}, 1000);\n");
  /** @type {Array<[string, string[]]>} */
  const commands = [
    [path.join(bin, "vim"), [wrapper]],
    [path.join(bin, "less"), [wrapper]],
    [path.join(bin, "grep"), ["-r", "convex dev", f.checkout]],
    [path.join(bin, "grep"), ["convex", "dev", cli, "dev"]],
    // Node itself, but running a different script.
    [process.execPath, [search, "convex dev", f.checkout, wrapper]],
    [process.execPath, ["-e", "setInterval(() => {}, 1000)", wrapper]],
  ];
  const bystanders = commands.map(([exe, args]) => {
    const child = spawn(exe, args, { cwd: f.checkout, detached: true, stdio: "ignore" });
    child.unref();
    cleanups.push(() => child.kill("SIGKILL"));
    return /** @type {number} */ (child.pid);
  });
  await vi.waitFor(() => expect(bystanders.every(alive)).toBe(true));
  await settle();
  await rebuildWithoutWatcher({
    session: "watcher", checkout: f.checkout, statePath: f.statePath, tmuxArgs: isolatedTmux(f.env).tmuxArgs, env: f.env, rebuild: f.rebuild,
  });
  expect(f.liveAtRebuild).toEqual([[]]);
  expect(bystanders.filter((pid) => !alive(pid))).toEqual([]);
}, 30_000);

it("matches a real Node watcher by what it executes", async () => {
  const f = watcherFixture();
  const cli = writeScript(path.join(f.checkout, "node_modules", "convex", "bin", "main.js"), "setInterval(() => {}, 1000);\n");
  const elsewhere = spawn(process.execPath, [cli, "dev"], { cwd: f.dir, detached: true, stdio: "ignore" });
  const inside = spawn(process.execPath, [cli, "dev", "--typecheck=disable"], { cwd: f.checkout, detached: true, stdio: "ignore" });
  for (const child of [elsewhere, inside]) {
    child.unref();
    cleanups.push(() => child.kill("SIGKILL"));
  }
  await vi.waitFor(() => expect([elsewhere.pid, inside.pid].every((pid) => alive(/** @type {number} */ (pid)))).toBe(true));
  await settle();
  const table = spawnSync("ps", ["axww", "-o", "pid=,ppid=,pgid=,stat=,lstart=,command="], {
    env: { PATH: "/usr/bin:/bin", TZ: "UTC", LC_ALL: "C" }, encoding: "utf8",
  }).stdout.split("\n").filter(Boolean).map((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3} \w{3} +\d+ [\d:]+ \d{4})\s*(.*)$/.exec(line);
    return { pid: Number(m?.[1]), parent: Number(m?.[2]), group: Number(m?.[3]), zombie: false, started: String(m?.[5]), command: String(m?.[6]) };
  });
  // Only the copy whose working directory is inside the checkout watches it.
  expect(checkoutWatchers(table, f.checkout).map((row) => row.pid)).toEqual([inside.pid]);
});

// Synthetic process tables: PID and group reuse cannot be forced on a real system.
const START = "Wed Oct 14 12:00:00 2026";
const LATER = "Wed Oct 14 12:00:05 2026";
/** @param {number} pid @param {number} parent @param {number} group @param {string} [started] */
const row = (pid, parent, group, started = START) => ({ pid, parent, group, zombie: false, started, command: `synthetic ${pid}` });
const base = [row(1, 0, 1), row(100, 1, 100)];
/** @param {Partial<Parameters<typeof discoverWatchers>[0]>} input */
const discover = (input) =>
  discoverWatchers({ table: base, self: 100, panes: [], saved: [], matched: [], previous: new Map(), groups: new Map(), ...input });

it("follows a watcher's group after the leader exits, but not a recycled group ID", () => {
  // Round 1: the pane process 500 leads group 500.
  const first = discover({ table: [...base, row(500, 1, 500)], panes: [500] });
  expect([...first.found.keys()]).toEqual([500]);
  const previous = new Map([...first.found.values()].map((r) => [`${r.pid}@${r.started}`, r]));
  // Leader gone, a child it forked is still in group 500: a target.
  const forked = discover({ table: [...base, row(601, 1, 500, LATER)], previous, groups: first.groups });
  expect([...forked.found.keys()]).toEqual([601]);
  // Group 500 emptied and a new process took PID 500 and led a new group 500.
  const recycled = discover({ table: [...base, row(500, 1, 500, LATER), row(602, 500, 500, LATER)], previous, groups: first.groups });
  expect([...recycled.found.keys()]).toEqual([]);
  expect([...recycled.groups.keys()]).toEqual([]);
  // A round that saw the group empty drops it, so a later refill is ignored.
  const emptied = discover({ table: base, previous, groups: first.groups });
  const refilled = discover({
    table: [...base, row(603, 1, 500, LATER)],
    previous: new Map([...emptied.found.values()].map((r) => [`${r.pid}@${r.started}`, r])),
    groups: emptied.groups,
  });
  expect([...refilled.found.keys()]).toEqual([]);
});

it("never targets the caller, its ancestors, or a group containing them", () => {
  // The caller (100) runs inside pane 90's group; 700 shares that group.
  const table = [row(1, 0, 1), row(90, 1, 90), row(100, 90, 90), row(700, 1, 90)];
  const result = discover({ table, panes: [90], saved: [{ pid: 100, group: 90, started: START, command: "x" }] });
  expect([...result.found.keys()]).toEqual([]);
  expect([...result.groups.keys()]).toEqual([]);
});

it("signals only targets whose PID and group still belong to the process that was found", () => {
  const found = new Map([[601, row(601, 1, 500)], [602, row(602, 1, 602)]]);
  const groups = new Map([[500, "500@" + START], [602, "602@" + START]]);
  const fresh = [...base, row(601, 1, 500), row(500, 1, 500, LATER), row(602, 1, 602, LATER)];
  // 602 now belongs to a different process; group 500's ID was taken by a new leader.
  expect(confirmedSignals({ fresh, found, groups })).toEqual({ pids: [601], groups: [] });
  expect(confirmedSignals({ fresh: [...base, row(601, 1, 500)], found, groups })).toEqual({ pids: [601], groups: [500] });
});
