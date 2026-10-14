import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import {
  proofOutput,
  prepareProofOutput,
  proofRevision,
  publishProof,
  unexpectedErrors,
  expectedHistoryDiagnostic,
} from "./after-call-proof-support.mjs";
/** @type {string[]} */
const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "connvo-proof-"));
  dirs.push(dir);
  return dir;
}
it("defaults to disposable output and requires explicit publication for docs", () => {
  const repo = fixture();
  expect(proofOutput(repo, {})).toEqual({
    out: path.join(repo, "tools/call-eval/out/after-call"),
    shots: path.join(repo, "tools/call-eval/out/after-call"),
  });
  expect(() =>
    proofOutput(repo, { out: "docs/after-call/browser-proof" }),
  ).toThrow(/publish-docs/);
  const out = path.join(repo, "tools/call-eval/out/after-call");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "recap.png"), "synthetic image");
  writeFileSync(path.join(out, "old-run.png"), "not produced this run");
  writeFileSync(
    path.join(out, "result.json"),
    JSON.stringify({
      pass: true,
      captures: ["recap.png", "focus/current.png"],
    }),
  );
  writeFileSync(
    path.join(out, "a11y-results.json"),
    JSON.stringify({
      states: [{ shots: ["tools/call-eval/out/after-call/recap.png"] }],
    }),
  );
  const published = path.join(repo, "docs/after-call/browser-proof");
  mkdirSync(path.join(published, "focus"), { recursive: true });
  writeFileSync(path.join(published, "stale.png"), "old");
  writeFileSync(path.join(published, "focus/stale.png"), "old");
  writeFileSync(path.join(published, "keep.txt"), "not a capture");
  mkdirSync(path.join(out, "focus"));
  writeFileSync(path.join(out, "focus/current.png"), "new focus");
  publishProof(repo, out, out);
  expect(existsSync(path.join(published, "stale.png"))).toBe(false);
  expect(existsSync(path.join(published, "old-run.png"))).toBe(false);
  expect(existsSync(path.join(published, "focus/stale.png"))).toBe(false);
  expect(readFileSync(path.join(published, "focus/current.png"), "utf8")).toBe(
    "new focus",
  );
  expect(readFileSync(path.join(published, "keep.txt"), "utf8")).toBe(
    "not a capture",
  );
  expect(
    JSON.parse(
      readFileSync(
        path.join(repo, "docs/after-call/browser-proof/a11y-results.json"),
        "utf8",
      ),
    ).states[0].shots,
  ).toEqual(["docs/after-call/browser-proof/recap.png"]);
  expect(
    readFileSync(
      path.join(repo, "docs/after-call/browser-proof/recap.png"),
      "utf8",
    ),
  ).toBe("synthetic image");
  writeFileSync(path.join(out, "result.json"), JSON.stringify({ pass: false }));
  expect(() => publishProof(repo, out, out)).toThrow(
    "Refusing to publish a failed proof",
  );
});
it("records actual changed, renamed and untracked paths", () => {
  const repo = fixture();
  const git = (/** @type {string[]} */ args) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git(["init"]);
  writeFileSync(path.join(repo, "old name.txt"), "before");
  git(["add", "."]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  expect(proofRevision(repo).dirtyPaths).toEqual([]);
  git(["mv", "old name.txt", "new name.txt"]);
  writeFileSync(path.join(repo, "untracked.txt"), "new");
  expect(proofRevision(repo).dirtyPaths.sort()).toEqual([
    "new name.txt",
    "old name.txt",
    "untracked.txt",
  ]);
  expect(proofRevision(repo).dirty).toBe(true);
});
it("unexpected errors fail while recorded warnings and explicit expected errors remain distinguishable", () => {
  const rows = [
    {
      person: "A",
      level: "error",
      text: "unexpected",
      url: "about:blank",
      expected: false,
    },
    {
      person: "A",
      level: "warning",
      text: "warning",
      url: "about:blank",
      expected: false,
    },
  ];
  expect(unexpectedErrors(rows).map((row) => row.text)).toEqual(["unexpected"]);
  rows[0].expected = true;
  expect(unexpectedErrors(rows)).toEqual([]);
});

it("only the specific intentional history scenarios allow their errors", () => {
  const row = {
    person: "A",
    level: "error",
    text: "%o\n\n%s Error: [CONVEX Q(history/queries:getMeetingHistory)] Server Error\n  Called by client",
    url: "http://localhost:3043/app/meetings/synthetic",
    expected: false,
  };
  expect(expectedHistoryDiagnostic(row, "injected-history-error")).toBe(true);
  expect(expectedHistoryDiagnostic(row, null)).toBe(false);
  expect(
    expectedHistoryDiagnostic(
      { ...row, text: "unexpected app error" },
      "injected-history-error",
    ),
  ).toBe(false);
  expect(
    expectedHistoryDiagnostic(
      { ...row, url: "http://localhost:3043/app/call/synthetic" },
      "injected-history-error",
    ),
  ).toBe(false);
});

it("cleans the compile tree when source extraction fails before browser launch", () => {
  const temporaryRoot = fixture();
  const script = new URL(
    "../../../docs/after-call/ended-heading-proof.mjs",
    import.meta.url,
  );
  expect(() =>
    execFileSync(
      process.execPath,
      [fileURLToPath(script), "--source-ref=refs/connvo-test/nonexistent"],
      {
        env: { ...process.env, TMPDIR: temporaryRoot },
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  ).toThrow();
  expect(readdirSync(temporaryRoot)).toEqual([]);
});

it("resets the run focus directory before capture, then replaces published focus", () => {
  const repo = fixture();
  const output = prepareProofOutput(repo, {});
  const focus = path.join(output.out, "focus");
  mkdirSync(path.join(focus, "old-nested"), { recursive: true });
  writeFileSync(path.join(focus, "old-nested/recap-12.png"), "interrupted run");
  writeFileSync(path.join(output.out, "keep.txt"), "other output");
  prepareProofOutput(repo, {});
  expect(existsSync(focus)).toBe(false);
  expect(readFileSync(path.join(output.out, "keep.txt"), "utf8")).toBe(
    "other output",
  );
  mkdirSync(focus);
  writeFileSync(path.join(focus, "recap-01.png"), "current run");
  writeFileSync(
    path.join(output.out, "result.json"),
    JSON.stringify({
      pass: true,
      captures: ["focus/recap-01.png"],
    }),
  );
  writeFileSync(
    path.join(output.out, "a11y-results.json"),
    JSON.stringify({ states: [] }),
  );
  const published = path.join(repo, "docs/after-call/browser-proof/focus");
  mkdirSync(path.join(published, "old-nested"), { recursive: true });
  writeFileSync(
    path.join(published, "old-nested/recap-12.png"),
    "old published run",
  );
  publishProof(repo, output.out, output.shots);
  expect(readdirSync(published)).toEqual(["recap-01.png"]);
  expect(readFileSync(path.join(published, "recap-01.png"), "utf8")).toBe(
    "current run",
  );
});
