// Per-run JSONL checkpoint for the self-proof matrix: every completed run is
// appended as one line BEFORE the proof is rewritten, so an interrupted run
// (the shared box recycles under load) loses at most the run in flight.
// Resume restores completed rows and the runner skips exactly those cells.
//
// Rows are plain JSON of the runner's result shape:
//   { scenario, transport, seed, pass, passCondition, measurements, failure, ms }
// failure is serialized to { message, stack } (an Error does not survive JSON).
//
// Truncation tolerance: a crash mid-append can leave a partial last line; the
// loader keeps every complete line and drops an incomplete tail, and the next
// append re-establishes the newline so the tail never glues onto a partial
// line.

import fs from "node:fs";
import path from "node:path";

/** @param {string} row Transported result row (plain JSON-able). */
function serializeRow(row) {
  return JSON.stringify({
    scenario: row.scenario,
    transport: row.transport,
    seed: row.seed,
    pass: row.pass,
    passCondition: row.passCondition ?? null,
    measurements: row.measurements ?? null,
    failure: row.failure ? { message: row.failure.message, stack: row.failure.stack ?? null } : null,
    ms: row.ms ?? null,
  });
}

/** @param {string} file Absolute checkpoint path (JSONL). */
export function appendCheckpoint(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A crash mid-append leaves a partial last line WITHOUT its newline. Cut
  // the partial tail off before appending, so the file stays valid JSONL and
  // the next load never sees a glued or malformed middle line.
  if (fs.existsSync(file)) {
    const stat = fs.statSync(file);
    if (stat.size > 0) {
      const fd = fs.openSync(file, "r");
      const len = Math.min(stat.size, 4096);
      let tail;
      try {
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, stat.size - len);
        tail = buf;
      } finally {
        fs.closeSync(fd);
      }
      if (tail[tail.length - 1] !== 0x0a) {
        const lastNewline = tail.lastIndexOf(0x0a);
        const keep = lastNewline === -1 ? 0 : stat.size - len + lastNewline + 1;
        fs.truncateSync(file, keep);
      }
    }
  }
  fs.appendFileSync(file, serializeRow(row) + "\n");
}

/** @param {string} file Absolute checkpoint path (JSONL). */
export function loadCheckpoint(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) return [];
  // A successful append always ends with a newline. A file that does NOT end
  // with one lost its last line mid-write: that final partial line is a
  // crash tail (dropped below). A malformed line ANYWHERE ELSE — including
  // one followed by a newline, which no crash of this appender can produce —
  // is real corruption, and resuming on unknown data would silently
  // under-count the matrix.
  const endsWithNewline = raw.endsWith("\n");
  const lines = raw.split("\n");
  if (endsWithNewline && lines[lines.length - 1] === "") lines.pop();
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const isCrashTail = !endsWithNewline && i === lines.length - 1;
    try {
      rows.push(JSON.parse(line));
    } catch {
      if (isCrashTail) continue;
      throw new Error(`checkpoint ${file} is corrupted at line ${i + 1}; delete it to restart the matrix from scratch`);
    }
  }
  return rows;
}

/** Key format for skip decisions: transport|scenario|seed. */
export function checkpointKey(transport, scenario, seed) {
  return `${transport}|${scenario}|${seed}`;
}

/** @param {Array<any>} rows Loaded checkpoint rows. */
export function checkpointKeys(rows) {
  return new Set(rows.map((r) => checkpointKey(r.transport, r.scenario, r.seed)));
}

/**
 * Restores prior rows into one matrix section: only rows inside the
 * section's transport, planned seeds and scenario set — rows from a
 * different invocation stay in the file but never enter this proof.
 *
 * @param {Array<any>} rows
 * @param {{ transport: string, plannedSeeds: number[] }} section
 * @param {string[]} scenarios
 */
export function rowsForSection(rows, section, scenarios) {
  const seedSet = new Set(section.plannedSeeds);
  const scenarioSet = new Set(scenarios);
  return rows.filter((r) => r.transport === section.transport && seedSet.has(r.seed) && scenarioSet.has(r.scenario));
}
