import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** @param {string} repo */
export function proofRevision(repo) {
  const status = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
    cwd: repo,
    encoding: "utf8",
  });
  const entries = status.split("\0").filter(Boolean);
  const dirtyPaths = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    dirtyPaths.push(entry.slice(3));
    if (/^[RC]|^.[RC]/.test(entry.slice(0, 2))) dirtyPaths.push(entries[++i]);
  }
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim(),
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
  };
}

/** @param {string} repo @param {{out?: string, shots?: string}} flags */
export function proofOutput(repo, flags) {
  const out = path.resolve(repo, flags.out ?? "tools/call-eval/out/after-call");
  const shots = path.resolve(repo, flags.shots ?? path.relative(repo, out));
  for (const dir of [out, shots])
    if (path.relative(repo, dir).split(path.sep)[0] === "docs")
      throw new Error(
        "Run output must stay outside docs; use --publish-docs to copy a passing run",
      );
  return { out, shots };
}

/** @param {string} text */
export function safeConsoleText(text) {
  return text.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted token]");
}

/** @typedef {{person:string, level:string, text:string, url:string, expected:boolean, source?:string, expectedReason?:string}} Diagnostic */
/** @param {Diagnostic} row @param {string | null} scenario */
export function expectedHistoryDiagnostic(row, scenario) {
  if (
    row.level !== "error" ||
    !/\/app\/meetings\/[^/]+$/.test(new URL(row.url).pathname)
  )
    return false;
  if (scenario === "injected-history-error")
    return /^(?:%o\s+%s )?Error: \[CONVEX Q\(history\/queries:getMeetingHistory\)\] Server Error\n  Called by client/.test(
      row.text,
    );
  return (
    scenario === "outsider-refusal" &&
    row.text.includes("[CONVEX Q(history/queries:getMeetingHistory)]") &&
    row.text.includes('"code":"FORBIDDEN"') &&
    row.text.includes('"statusCode":403') &&
    row.text.includes("Access denied: Not a meeting participant")
  );
}

/** @param {import('@playwright/test').Page} page @param {string} person @param {Diagnostic[]} rows @param {() => string | null} [scenario] */
export function recordBrowserConsole(
  page,
  person,
  rows,
  scenario = () => null,
) {
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    const row = {
      person,
      level: message.type(),
      text: safeConsoleText(message.text()),
      url: page.url().split("?")[0],
      source: message.location().url.split("?")[0],
      expected: false,
    };
    const reason = scenario();
    if (expectedHistoryDiagnostic(row, reason)) {
      row.expected = true;
      Object.assign(row, { expectedReason: reason });
    }
    rows.push(row);
  });
  page.on("pageerror", (error) =>
    rows.push({
      person,
      level: "pageerror",
      text: safeConsoleText(error.message),
      url: page.url().split("?")[0],
      expected: false,
    }),
  );
}

/** @param {Diagnostic[]} rows */
export function unexpectedErrors(rows) {
  return rows.filter(
    (row) => ["error", "pageerror"].includes(row.level) && !row.expected,
  );
}

/** Copy only passing, explicitly published evidence, with paths pointing to its copies.
 * @param {string} repo @param {string} out @param {string} shots
 */
export function publishProof(repo, out, shots) {
  const destination = path.join(repo, "docs/after-call/browser-proof");
  const result = JSON.parse(
    fs.readFileSync(path.join(out, "result.json"), "utf8"),
  );
  if (result.pass !== true)
    throw new Error("Refusing to publish a failed proof");
  fs.mkdirSync(destination, { recursive: true });
  for (const file of fs.readdirSync(shots))
    if (file.endsWith(".png"))
      fs.copyFileSync(path.join(shots, file), path.join(destination, file));
  if (fs.existsSync(path.join(out, "focus")))
    fs.cpSync(path.join(out, "focus"), path.join(destination, "focus"), {
      recursive: true,
    });
  const a11y = JSON.parse(
    fs.readFileSync(path.join(out, "a11y-results.json"), "utf8"),
  );
  for (const state of a11y.states)
    state.shots = state.shots.map((/** @type {string} */ file) =>
      path.posix.join("docs/after-call/browser-proof", path.basename(file)),
    );
  fs.writeFileSync(
    path.join(destination, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(destination, "a11y-results.json"),
    JSON.stringify(a11y, null, 2) + "\n",
  );
}
