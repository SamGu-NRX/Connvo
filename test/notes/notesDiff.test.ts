import { describe, expect, test } from "vitest";
import {
  applyBatchOps,
  applyOperations,
  diffToSiblingOps,
  diffToHunks,
  transformHunksToSiblingOps,
} from "../../src/hooks/notes/notesDiff";

describe("diffToSiblingOps", () => {
  test("identical texts produce no ops", () => {
    expect(diffToSiblingOps("same", "same")).toEqual([]);
  });

  test("an equal-length replacement is a real delete+insert sibling pair", () => {
    const ops = diffToSiblingOps("cat", "car");
    expect(ops).toEqual([
      { type: "delete", position: 2, length: 1 },
      { type: "insert", position: 2, content: "r" },
    ]);
    expect(applyBatchOps("cat", ops)).toBe("car");
  });

  test("pure inserts and deletes round-trip", () => {
    expect(applyOperations("ab", diffToSiblingOps("ab", "XabY"))).toBe("XabY");
    expect(applyOperations("XabY", diffToSiblingOps("XabY", "ab"))).toBe("ab");
  });

  test("astral replacements are whole characters in UTF-16 coordinates", () => {
    const base = "a🐱b";
    const next = "x🐱y";
    const ops = diffToSiblingOps(base, next);
    expect(applyBatchOps(base, ops)).toBe(next);
    // No lone surrogates anywhere in the emitted ops: every element must
    // be a whole character, never a single surrogate code unit.
    for (const op of ops) {
      const text = op.type === "insert" ? (op.content ?? "") : "";
      for (const ch of text) {
        expect(/^[\uD800-\uDFFF]$/.test(ch)).toBe(false);
      }
    }
  });
});

describe("multi-hunk sibling diff (r2 W1/W3)", () => {
  test("all changed regions are emitted, not just one prefix/suffix collapse", () => {
    const base = "one two three";
    const next = "ONE two THREE";
    const hunks = diffToHunks(base, next);
    expect(hunks).toHaveLength(2);
    expect(applyBatchOps(base, transformHunksToSiblingOps(hunks, []))).toBe(
      next,
    );
  });

  test("hunks round-trip through the shared transform with no remote drift", () => {
    const base = "alpha bravo charlie delta";
    const next = "ALPHA bravo CHARLIE delta";
    const hunks = diffToHunks(base, next);
    expect(hunks.length).toBe(2);
    const ops = transformHunksToSiblingOps(hunks, []);
    expect(applyBatchOps(base, ops)).toBe(next);
  });

  test("a replacement hunk transforms as ONE unit against real remote ops", () => {
    // Local 'ab' -> 'ac'; remote 'ab' -> 'XabY'. The remote ops come from
    // the multi-hunk decomposition (the ledger's actual remote basis — a
    // collapsed sibling diff would degenerate into a whole-text
    // substitution and destroy the transform). The remote inserts must
    // never slide between the replacement's delete and insert siblings.
    const hunks = diffToHunks("ab", "ac");
    const remoteOps = transformHunksToSiblingOps(
      diffToHunks("ab", "XabY"),
      [],
    );
    const ops = transformHunksToSiblingOps(hunks, remoteOps);
    expect(applyOperations("XabY", ops)).toBe("XacY");
  });

  test("a pure-insert hunk carries the shared insert-position convention", () => {
    const hunks = diffToHunks("base", "base alpha");
    const remoteOps = diffToSiblingOps("base", "base bravo");
    const ops = transformHunksToSiblingOps(hunks, remoteOps);
    const serverText = applyOperations("base bravo", ops);
    expect(serverText).toContain("alpha");
    expect(serverText).toContain("bravo");
    // No delete over the remote word: pure inserts only.
    expect(ops.every((op) => op.type === "insert")).toBe(true);
  });
});
