// @ts-nocheck
// Known-input tests for the self-proof JSONL checkpoint: append/load
// round-trip, crash-truncated tail tolerance, mid-file corruption refusal,
// and section-scoped restoration (rows from a different invocation must not
// leak into another section's proof). Checking is disabled like the other
// tools/call-eval suites (checkJs budget).
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendCheckpoint,
  checkpointKey,
  checkpointKeys,
  loadCheckpoint,
  rowsForSection,
} from "./self-proof-checkpoint.mjs";

function row(overrides = {}) {
  return {
    scenario: "H-01",
    transport: "reference",
    seed: 1,
    pass: true,
    passCondition: "join <= 5000 ms",
    measurements: { timeToFirstRemoteFrameMs: 2400 },
    failure: null,
    ms: 5000,
    ...overrides,
  };
}

describe("self-proof checkpoint", () => {
  it("round-trips rows through append/load and skips nothing that was stored", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "connvo-selfproof-"));
    const file = path.join(dir, "checkpoint.jsonl");
    appendCheckpoint(file, row({ seed: 1 }));
    appendCheckpoint(file, row({ seed: 2, pass: false, failure: { message: "join over bar" } }));

    const rows = loadCheckpoint(file);
    expect(rows).toHaveLength(2);
    expect(rows[0].seed).toBe(1);
    expect(rows[0].pass).toBe(true);
    expect(rows[1].pass).toBe(false);
    expect(rows[1].failure.message).toBe("join over bar");
    expect(checkpointKeys(rows)).toEqual(
      new Set([checkpointKey("reference", "H-01", 1), checkpointKey("reference", "H-01", 2)]),
    );
  });

  it("drops a crash-truncated last line and keeps the complete prefix", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "connvo-selfproof-"));
    const file = path.join(dir, "checkpoint.jsonl");
    appendCheckpoint(file, row({ seed: 1 }));
    // Simulate a crash mid-append: the process died while writing row 2, so
    // the file ends WITHOUT a newline inside partial JSON.
    const raw = readFileSync(file, "utf8");
    writeFileSync(file, raw + '{"scenario":"H-01","transport":"re');

    const rows = loadCheckpoint(file);
    expect(rows).toHaveLength(1);
    expect(rows[0].seed).toBe(1);
  });

  it("self-heals a crash tail: the next append cuts the partial line and the file stays valid", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "connvo-selfproof-"));
    const file = path.join(dir, "checkpoint.jsonl");
    appendCheckpoint(file, row({ seed: 1 }));
    const raw = readFileSync(file, "utf8");
    writeFileSync(file, raw + '{"scenario":"H-01","tr'); // crash tail

    appendCheckpoint(file, row({ seed: 3 }));

    const rows = loadCheckpoint(file);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.seed)).toEqual([1, 3]);
  });

  it("refuses to resume on mid-file corruption", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "connvo-selfproof-"));
    const file = path.join(dir, "checkpoint.jsonl");
    appendCheckpoint(file, row({ seed: 1 }));
    appendCheckpoint(file, row({ seed: 2 }));
    const raw = readFileSync(file, "utf8").split("\n");
    writeFileSync(file, [raw[0], "!!!corrupted!!!", raw[2]].join("\n"));

    expect(() => loadCheckpoint(file)).toThrow(/corrupted at line 2/);
  });

  it("restores only rows inside the section's transport, planned seeds and scenarios", () => {
    const rows = [
      row({ scenario: "H-01", transport: "reference", seed: 1 }),
      row({ scenario: "H-02", transport: "reference", seed: 1 }),
      row({ scenario: "H-01", transport: "reference", seed: 2 }),
      row({ scenario: "H-01", transport: "reference-no-audio", seed: 1 }), // other variant
      row({ scenario: "H-01", transport: "reference", seed: 9 }), // outside planned seeds
      row({ scenario: "P-01", transport: "reference", seed: 1 }), // outside scenario set
    ];
    const restored = rowsForSection(rows, { transport: "reference", plannedSeeds: [1, 2] }, ["H-01", "H-02"]);
    expect(restored).toHaveLength(3);
    expect(restored.map((r) => r.scenario).sort()).toEqual(["H-01", "H-01", "H-02"]);
  });
});
