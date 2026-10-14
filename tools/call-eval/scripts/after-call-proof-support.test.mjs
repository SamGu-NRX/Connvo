import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import {
  proofOutput,
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
  writeFileSync(path.join(out, "result.json"), JSON.stringify({ pass: true }));
  writeFileSync(
    path.join(out, "a11y-results.json"),
    JSON.stringify({
      states: [{ shots: ["tools/call-eval/out/after-call/recap.png"] }],
    }),
  );
  publishProof(repo, out, out);
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
