/**
 * Contract tests for compose, normalize, invert, and diff operations.
 *
 * Test-only file: this suite pins the OBSERVED contracts of
 * convex/notes/operations.ts (composeOperations, normalizeOperations,
 * invertOperation, createDiff, validateOperation) without modifying any source.
 * All pins were verified against runtime behavior; where the pin documents a
 * defect, the test asserts the actual current behavior and says so explicitly.
 *
 * Requirements: 8.2
 */

import { describe, it, expect } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import {
  Operation,
  createInsertOperation,
  createDeleteOperation,
  applyToDoc,
  applyOperations,
  composeOperations,
  createDiff,
  invertOperation,
  normalizeOperations,
  validateOperation,
} from "./operations";

const authorId = "p08contracttestauthor01" as Id<"users">;

const insert = (position: number, content: string): Operation => ({
  type: "insert",
  position,
  content,
});
const del = (position: number, length: number): Operation => ({
  type: "delete",
  position,
  length,
});
const retain = (position: number, length: number): Operation => ({
  type: "retain",
  position,
  length,
});

describe("composeOperations contracts", () => {
  it("merges adjacent inserts into one insert at opA's position with concatenated content", () => {
    const composed = composeOperations(insert(0, "ab"), insert(2, "cd"));
    expect(composed).toEqual({
      type: "insert",
      position: 0,
      content: "abcd",
    });
  });

  it("composes metadata-bearing ops and drops the metadata from the result", () => {
    const a = createInsertOperation(0, "ab", authorId, 1);
    const b = createInsertOperation(2, "cd", authorId, 2);
    const composed = composeOperations(a, b);
    expect(composed).toEqual({
      type: "insert",
      position: 0,
      content: "abcd",
    });
    // Pinned: the composed result is a bare Operation — no id/authorId/timestamp survive.
    expect(composed).not.toBeNull();
    expect("id" in composed!).toBe(false);
    expect("authorId" in composed!).toBe(false);
  });

  it("sums lengths when composing deletes at the same position", () => {
    const composed = composeOperations(del(2, 3), del(2, 4));
    expect(composed).toEqual({ type: "delete", position: 2, length: 7 });
  });

  it("fully cancels insert then delete of the same span into a zero-length retain no-op", () => {
    // Pinned shape: compose CAN produce a no-op (retain with length 0),
    // which validateOperation accepts and applyToDoc ignores.
    const composed = composeOperations(insert(2, "abc"), del(2, 3));
    expect(composed).toEqual({ type: "retain", position: 2, length: 0 });
    expect(validateOperation(composed!)).toBe(true);
    expect(applyToDoc("hello world", composed!)).toBe("hello world");
  });

  it("returns null for insert then delete at the same position with mismatched length", () => {
    // 3 inserted chars vs 2 deleted: not an exact cancellation.
    expect(composeOperations(insert(2, "abc"), del(2, 2))).toBeNull();
  });

  it("returns null for insert then delete at different positions", () => {
    expect(composeOperations(insert(2, "abc"), del(5, 3))).toBeNull();
  });

  it("returns null for delete then insert (replace semantics are not composed)", () => {
    // Pinned: composeOperations has no delete->insert branch, so a
    // replacement stays as two operations.
    expect(composeOperations(del(2, 3), insert(2, "ab"))).toBeNull();
  });

  it("returns null for adjacent-position inserts with a gap between them", () => {
    expect(composeOperations(insert(0, "ab"), insert(5, "cd"))).toBeNull();
  });

  it("returns null for inserts at the same position (same position, different targets)", () => {
    expect(composeOperations(insert(2, "ab"), insert(2, "cd"))).toBeNull();
  });

  it("returns null for deletes at different positions", () => {
    expect(composeOperations(del(0, 2), del(3, 2))).toBeNull();
  });

  it("never composes retain with anything", () => {
    expect(composeOperations(retain(0, 5), retain(5, 5))).toBeNull();
    expect(composeOperations(retain(0, 5), insert(5, "a"))).toBeNull();
    expect(composeOperations(insert(0, "a"), retain(1, 5))).toBeNull();
    expect(composeOperations(retain(0, 5), del(5, 2))).toBeNull();
    expect(composeOperations(del(0, 2), retain(2, 5))).toBeNull();
  });

  it("keeps every composable pair valid per validateOperation", () => {
    const composablePairs: Array<[Operation, Operation]> = [
      [insert(0, "ab"), insert(2, "cd")],
      [del(2, 3), del(2, 4)],
      [insert(2, "abc"), del(2, 3)],
    ];
    for (const [a, b] of composablePairs) {
      const composed = composeOperations(a, b);
      expect(composed).not.toBeNull();
      expect(validateOperation(composed!)).toBe(true);
    }
  });
});

describe("normalizeOperations contracts", () => {
  it("returns an empty array for an empty input", () => {
    expect(normalizeOperations([])).toEqual([]);
  });

  it("filters no-op operations: empty insert, zero delete, zero retain", () => {
    const normalized = normalizeOperations([
      insert(0, ""),
      del(0, 0),
      retain(0, 0),
    ]);
    expect(normalized).toEqual([]);
  });

  it("merges adjacent insert operations through composition", () => {
    const normalized = normalizeOperations([
      insert(0, "ab"),
      insert(2, "cd"),
    ]);
    expect(normalized).toEqual([insert(0, "abcd")]);
  });

  it("merges same-position delete operations through composition", () => {
    const normalized = normalizeOperations([del(0, 2), del(0, 3)]);
    expect(normalized).toEqual([del(0, 5)]);
  });

  it("preserves order and content of operations it cannot merge", () => {
    const normalized = normalizeOperations([insert(0, "a"), del(1, 2)]);
    expect(normalized).toEqual([insert(0, "a"), del(1, 2)]);
  });

  it("pins the cancellation chain shape: composed retain-0 survives, later ops still apply", () => {
    // insert xy, delete xy (cancels to retain-0), then insert Z.
    // Pinned: the retain-0 no-op REMAINS in the normalized list.
    const normalized = normalizeOperations([
      insert(2, "xy"),
      del(2, 2),
      insert(2, "Z"),
    ]);
    expect(normalized).toEqual([retain(2, 0), insert(2, "Z")]);
  });

  it("preserves net effect: applying normalized ops equals applying the originals", () => {
    const cases: Array<{ doc: string; ops: Operation[] }> = [
      {
        doc: "hello",
        ops: [insert(2, "xy"), del(2, 2), insert(2, "Z")],
      },
      {
        doc: "hello world",
        ops: [insert(5, " there"), del(0, 6), retain(0, 0)],
      },
      {
        doc: "ab",
        ops: [insert(2, "cd"), insert(4, "ef"), retain(0, 0)],
      },
      {
        doc: "abcdef",
        ops: [del(0, 2), del(0, 3)],
      },
      {
        doc: "xyz",
        ops: [insert(0, "a"), del(1, 2)],
      },
    ];
    for (const { doc, ops } of cases) {
      expect(applyOperations(doc, normalizeOperations(ops))).toBe(
        applyOperations(doc, ops),
      );
    }
  });
});

describe("invertOperation contracts", () => {
  it("round-trips an insert: apply op then inverse restores the original doc", () => {
    const doc = "Hello world";
    const op = insert(5, " beautiful");
    const after = applyToDoc(doc, op);
    expect(after).toBe("Hello beautiful world");
    const inverse = invertOperation(op, doc);
    expect(inverse).toEqual(del(5, 10)); // inverse delete length = inserted content length
    expect(applyToDoc(after, inverse)).toBe(doc);
  });

  it("round-trips a delete: inverse re-inserts exactly the sliced content", () => {
    const doc = "Hello beautiful world";
    const op = del(5, 10);
    const after = applyToDoc(doc, op);
    expect(after).toBe("Hello world");
    const inverse = invertOperation(op, doc);
    expect(inverse).toEqual(insert(5, " beautiful"));
    expect(applyToDoc(after, inverse)).toBe(doc);
  });

  it("round-trips a retain as its own inverse", () => {
    const doc = "Hello world";
    const op = retain(5, 3);
    expect(invertOperation(op, doc)).toEqual(op);
    expect(applyToDoc(applyToDoc(doc, op), invertOperation(op, doc))).toBe(doc);
  });

  it("round-trips an insert at position 0", () => {
    const doc = "Hello";
    const op = insert(0, "Hi ");
    const inverse = invertOperation(op, doc);
    expect(inverse).toEqual(del(0, 3));
    expect(applyToDoc(applyToDoc(doc, op), inverse)).toBe(doc);
  });

  it("round-trips an insert at the end of the doc", () => {
    const doc = "Hello";
    const op = insert(5, "!");
    const inverse = invertOperation(op, doc);
    expect(inverse).toEqual(del(5, 1));
    expect(applyToDoc(applyToDoc(doc, op), inverse)).toBe(doc);
  });

  it("slices the right content when inverting a delete at position 0", () => {
    const doc = "Hello";
    const op = del(0, 2);
    const inverse = invertOperation(op, doc);
    expect(inverse).toEqual(insert(0, "He"));
    expect(applyToDoc(applyToDoc(doc, op), inverse)).toBe(doc);
  });

  it("slices the right content when inverting a delete at the doc end", () => {
    const doc = "Hello";
    const op = del(3, 2);
    const inverse = invertOperation(op, doc);
    expect(inverse).toEqual(insert(3, "lo"));
    expect(applyToDoc(applyToDoc(doc, op), inverse)).toBe(doc);
  });

  it("round-trips a delete spanning a multibyte character (2 UTF-16 units)", () => {
    const doc = "\u{1F600}hi"; // 😀 + "hi": 3 code units
    const op = del(0, 2);
    const after = applyToDoc(doc, op);
    expect(after).toBe("hi");
    const inverse = invertOperation(op, doc);
    expect(inverse).toEqual(insert(0, "\u{1F600}"));
    expect(applyToDoc(after, inverse)).toBe(doc);
  });

  it("throws the exact message 'Cannot invert operation type: <t>' for unknown types", () => {
    // operation.type is a closed union, so an invalid runtime value must be
    // smuggled in; double-casting through unknown (never `as any`).
    const bogus = { type: "teleport", position: 0 } as unknown as Operation;
    expect(() => invertOperation(bogus, "Hello world")).toThrow(
      "Cannot invert operation type: teleport",
    );
  });
});

describe("createDiff contracts", () => {
  it("returns an empty array for identical content (no-op diff shape)", () => {
    expect(createDiff("Hello world", "Hello world")).toEqual([]);
  });

  it("produces a single insert op for a pure mid-document insertion", () => {
    expect(createDiff("Hello world", "Hello there world")).toEqual([
      insert(6, "there "),
    ]);
  });

  it("produces a single insert op for a pure insertion at the end", () => {
    expect(createDiff("abc", "abcdef")).toEqual([insert(3, "def")]);
  });

  it("produces a single delete op for a pure mid-document deletion", () => {
    expect(createDiff("abcdef", "af")).toEqual([del(1, 4)]);
  });

  it("produces a single delete op for a pure deletion at the end", () => {
    expect(createDiff("Hello", "")).toEqual([del(0, 5)]);
    expect(createDiff("Hello world", "Hello")).toEqual([del(5, 6)]);
  });

  it("pins replacement output as a separate delete+insert pair, not a composed op", () => {
    // Pinned: createDiff("ab" -> "ax") emits delete(1,1) then insert(1,"x");
    // normalizeOperations does not compose delete->insert.
    expect(createDiff("ab", "ax")).toEqual([del(1, 1), insert(1, "x")]);
  });

  it("treats an empty old document as one pure insert", () => {
    expect(createDiff("", "Hello")).toEqual([insert(0, "Hello")]);
  });

  it("treats an empty new document as one pure delete", () => {
    expect(createDiff("Hello", "")).toEqual([del(0, 5)]);
  });

  it("pins surrogate-pair-level unicode handling: emoji swap deletes and inserts single code units", () => {
    // Pinned: the diff operates on UTF-16 code units. Swapping 😀 (U+1F600)
    // for 😃 (U+1F603) shares the high surrogate, so the diff deletes the low
    // surrogate only — a lone-surrogate diff that still round-trips.
    const diff = createDiff("\u{1F600}", "\u{1F603}");
    expect(diff).toEqual([del(1, 1), insert(1, "\uDE03")]);
    expect(applyOperations("\u{1F600}", diff)).toBe("\u{1F603}");
  });

  it("round-trips every content pair in the table: apply(old, createDiff(old, new)) === new", () => {
    const pairs: Array<[string, string]> = [
      // plain
      ["Hello world", "Hello there world"],
      ["Hello world", "Hello"],
      // emoji (multibyte)
      ["Team \u{1F600} ready", "Team \u{1F600}\u{1F680} ready"],
      ["Hi \u{1F600}!", "Hi !"],
      ["\u{1F600}", "\u{1F603}"],
      // CJK
      [
        "\u3053\u3093\u306B\u3061\u306F\u4E16\u754C",
        "\u3053\u3093\u306B\u3061\u306F\u7F8E\u3057\u3044\u4E16\u754C",
      ],
      // multiline
      ["line1\nline2\nline3", "line1\nline2 edited\nline3"],
      // whitespace-heavy
      ["a   b", "a        b"],
      ["  leading and trailing  ", "  leading and trailing  " + "\t\n"],
    ];
    for (const [oldDoc, newDoc] of pairs) {
      expect(applyOperations(oldDoc, createDiff(oldDoc, newDoc))).toBe(newDoc);
    }
  });

  it("pins KNOWN BUG: a second deletion region after a length-changing region uses stale positions and does not round-trip", () => {
    // KNOWN BUG (operations.ts:730): createDiff emits positions in
    // original-document coordinates. After the first delete removes 2 chars,
    // the second delete's position 4 points at "ef" in the shrunken doc
    // instead of "dY", so applying the diff corrupts the text.
    // Asserting the ACTUAL (buggy) behavior; a fix belongs in source, not here.
    const diff = createDiff("abXcdYef", "acef");
    expect(diff).toEqual([del(1, 2), del(4, 2)]);
    expect(applyOperations("abXcdYef", diff)).toBe("acdY"); // expected "acef"
  });

  it("pins KNOWN BUG: a second insertion region after a length-changing region uses stale positions and does not round-trip", () => {
    // KNOWN BUG (operations.ts:738): same root cause for inserts — the second
    // insert's position 2 is not shifted by the 2 units the first insert added.
    // Asserting the ACTUAL (buggy) behavior; a fix belongs in source, not here.
    const diff = createDiff("a.c", "axb.yc");
    expect(diff).toEqual([insert(1, "xb"), insert(2, "y")]);
    expect(applyOperations("a.c", diff)).toBe("axyb.c"); // expected "axb.yc"
  });
});

describe("validateOperation contracts (supporting spot-checks)", () => {
  it("accepts a zero-length retain (the shape composeOperations produces on cancellation)", () => {
    expect(validateOperation(retain(2, 0))).toBe(true);
  });

  it("rejects empty inserts and zero-length deletes", () => {
    expect(validateOperation(insert(0, ""))).toBe(false);
    expect(validateOperation(del(0, 0))).toBe(false);
  });
});
