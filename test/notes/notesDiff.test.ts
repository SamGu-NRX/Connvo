/**
 * Sibling-diff unit tests (docs/notes-ledger-f1/design.md §3).
 *
 * The #24 defect "equal-length replacements treated as no-ops" is pinned here:
 * a replacement must ALWAYS come out as a delete+insert sibling pair from one
 * base coordinate system.
 */

import { describe, expect, test } from "vitest";
import {
  applyOperations,
  applyToDoc,
  diffToSiblingOps,
} from "@/hooks/notes/notesDiff";

describe("diffToSiblingOps", () => {
  test("expresses an equal-length replacement as delete+insert (never a no-op)", () => {
    const ops = diffToSiblingOps("cat", "dog");
    expect(ops).toEqual([
      { type: "delete", position: 0, length: 3 },
      { type: "insert", position: 0, content: "dog" },
    ]);
    expect(applyOperations("cat", ops)).toBe("dog");
  });

  test("expresses a pure insertion as one insert at the shared prefix", () => {
    const ops = diffToSiblingOps("hello", "hello, world");
    expect(ops).toEqual([
      { type: "insert", position: 5, content: ", world" },
    ]);
  });

  test("expresses a pure deletion as one delete", () => {
    const ops = diffToSiblingOps("hello, world", "hello");
    expect(ops).toEqual([{ type: "delete", position: 5, length: 7 }]);
  });

  test("returns an empty sibling set for identical text", () => {
    expect(diffToSiblingOps("same", "same")).toEqual([]);
  });

  test("keeps an interior edit on one base coordinate system", () => {
    const base = "the quick brown fox";
    const next = "the slow brown fox";
    const ops = diffToSiblingOps(base, next);
    // Both ops share position 4 (the common prefix length) — one base.
    expect(ops).toEqual([
      { type: "delete", position: 4, length: 5 },
      { type: "insert", position: 4, content: "slow" },
    ]);
    expect(applyOperations(base, ops)).toBe(next);
  });

  test("keeps emoji (surrogate pairs) whole across replacements", () => {
    const ops = diffToSiblingOps("cat 🐱", "cat 🐶");
    expect(ops).toEqual([
      { type: "delete", position: 4, length: 2 },
      { type: "insert", position: 4, content: "🐶" },
    ]);
    expect(applyOperations("cat 🐱", ops)).toBe("cat 🐶");
  });

  test("replays multi-op sequences deterministically", () => {
    const doc = applyOperations("hello", [
      { type: "insert", position: 5, content: " world" },
      { type: "delete", position: 0, length: 1 },
    ]);
    expect(doc).toBe("ello world");
  });
});

describe("applyToDoc", () => {
  test("rejects out-of-bounds inserts instead of corrupting the document", () => {
    expect(() => applyToDoc("abc", { type: "insert", position: 9, content: "x" })).toThrow(
      /Invalid insert position/,
    );
  });

  test("rejects out-of-bounds deletes", () => {
    expect(() =>
      applyToDoc("abc", { type: "delete", position: 2, length: 5 }),
    ).toThrow(/Invalid delete range/);
  });
});
