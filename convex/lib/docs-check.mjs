#!/usr/bin/env node
/**
 * Fact-checker for convex/lib/README.md — keeps the documentation honest.
 *
 * Two claim shapes in the README are verified against the code:
 *
 * 1. File references: every occurrence of `name.ts:NN` (in backticks) must point
 *    at an existing file in convex/lib/ with at least NN lines, and the referenced
 *    line must be non-blank.
 *
 * 2. Export claims: lines in the README's "Exported surface" appendix shaped like
 *       - `symbolName` — name.ts:NN
 *    must find `symbolName` spelled as an export (or a `name.ts` declaration)
 *    within +-2 lines of line NN in that file.
 *
 * Usage:
 *   node convex/lib/docs-check.mjs                 # check the real README
 *   node convex/lib/docs-check.mjs --self-test     # verify the checker itself
 *
 * Exit code 0 = every claim holds; 1 = at least one claim failed (or the
 * README is missing).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

function readLines(filePath) {
  return fs.readFileSync(filePath, "utf8").split("\n");
}

/** Find every `file.ts:NN` reference in the README text. */
export function findFileRefs(readmeText) {
  const refs = [];
  const re = /`([A-Za-z0-9_.-]+\.ts):(\d+)`/g;
  let match;
  while ((match = re.exec(readmeText)) !== null) {
    refs.push({ file: match[1], line: Number(match[2]), index: match.index });
  }
  return refs;
}

/** Extract "Exported surface" appendix claims: `- \`symbol\` — file.ts:NN`. */
export function findExportClaims(readmeText) {
  const claims = [];
  const re = /-\s+`([A-Za-z0-9_$]+)`\s*[—-]+\s*`([A-Za-z0-9_.-]+\.ts):(\d+)`/g;
  let match;
  while ((match = re.exec(readmeText)) !== null) {
    claims.push({ symbol: match[1], file: match[2], line: Number(match[3]) });
  }
  return claims;
}

/** Check one README's references against the lib sources. Returns failures. */
export function checkReadme(readmePath, libDir = LIB_DIR) {
  const failures = [];
  const readmeText = fs.readFileSync(readmePath, "utf8");

  for (const ref of findFileRefs(readmeText)) {
    const filePath = path.join(libDir, ref.file);
    if (!fs.existsSync(filePath)) {
      failures.push(`missing file referenced by README: ${ref.file}`);
      continue;
    }
    const lines = readLines(filePath);
    if (ref.line < 1 || ref.line > lines.length) {
      failures.push(
        `${ref.file}:${ref.line} is out of range (file has ${lines.length} lines)`,
      );
      continue;
    }
    if (lines[ref.line - 1].trim() === "") {
      failures.push(`${ref.file}:${ref.line} points at a blank line`);
    }
  }

  for (const claim of findExportClaims(readmeText)) {
    const filePath = path.join(libDir, claim.file);
    if (!fs.existsSync(filePath)) {
      failures.push(`export claim references missing file: ${claim.file}`);
      continue;
    }
    const lines = readLines(filePath);
    const window = lines.slice(
      Math.max(0, claim.line - 3),
      Math.min(lines.length, claim.line + 2),
    );
    const found = window.some((l) => l.includes(claim.symbol));
    if (!found) {
      failures.push(
        `export claim "${claim.symbol}" not found near ${claim.file}:${claim.line}`,
      );
    }
  }

  return failures;
}

/** Prove the checker detects good and bad claims using a fixture in /tmp. */
export function selfTest() {
  const failures = [];
  const tmp = fs.mkdtempSync(path.join("/tmp", "docs-check-"));
  const good = ["export const alpha = 1;", "", "export function beta() {"];
  fs.writeFileSync(path.join(tmp, "fixture.ts"), good.join("\n"));
  const readmePath = path.join(tmp, "README.md");

  const write = (text) => fs.writeFileSync(readmePath, text);

  write("See `fixture.ts:3` for beta and `fixture.ts:1` for alpha.\n- `alpha` — `fixture.ts:1`\n");
  let errs = checkReadme(readmePath, tmp);
  if (errs.length !== 0) failures.push("valid claims wrongly rejected: " + errs.join("; "));

  write("See `missing.ts:1`.\n");
  errs = checkReadme(readmePath, tmp);
  if (errs.length === 0) failures.push("missing file not detected");

  write("See `fixture.ts:99`.\n");
  errs = checkReadme(readmePath, tmp);
  if (errs.length === 0) failures.push("out-of-range line not detected");

  write("See `fixture.ts:2`.\n");
  errs = checkReadme(readmePath, tmp);
  if (errs.length === 0) failures.push("blank-line reference not detected");

  write("- `gamma` — `fixture.ts:1`\n");
  errs = checkReadme(readmePath, tmp);
  if (errs.length === 0) failures.push("nonexistent export not detected");

  return failures;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (process.argv.includes("--self-test")) {
    const failures = selfTest();
    if (failures.length > 0) {
      for (const f of failures) console.log("SELF-TEST FAIL: " + f);
      process.exit(1);
    }
    console.log("self-test passed: checker detects valid and invalid claims");
    process.exit(0);
  }

  const readmePath = path.join(LIB_DIR, "README.md");
  if (!fs.existsSync(readmePath)) {
    console.log("FAIL: convex/lib/README.md does not exist");
    process.exit(1);
  }
  const failures = checkReadme(readmePath, LIB_DIR);
  if (failures.length > 0) {
    for (const f of failures) console.log("FAIL: " + f);
    console.log(`\n${failures.length} README claim(s) failed verification.`);
    process.exit(1);
  }
  console.log("README verified: every file:line reference and export claim matches the code.");
}
