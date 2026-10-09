/**
 * Contract tests: operation constructors and applyToDoc
 *
 * This file is test-only. It encodes the agreed contract table for the notes
 * OT layer (P06) against convex/notes/operations.ts:
 *
 *   1. Constructor contracts for createInsertOperation / createDeleteOperation /
 *      createRetainOperation (returned type, pass-through, metadata).
 *   2. applyToDoc valid and boundary cases (prepend, append, middle, retain
 *      passthrough, partial/full delete, empty-document interactions).
 *   3. applyToDoc invalid cases with EXACT error messages.
 *   4. validateOperation boolean contracts.
 *
 * A few cases assert validation contracts (integer/finite checks) that are not
 * yet implemented on main; their failures are the executable record of that
 * contract gap and are expected to turn green once the source catches up.
 *
 * Import hygiene: authorId fixtures use `as Id<"users">` from the generated
 * data model — never `as any`.
 *
 * Requirements: 8.2
 */

import { describe, it, expect } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Operation } from "@convex/types/entities/note";
import {
  createInsertOperation,
  createDeleteOperation,
  createRetainOperation,
  applyToDoc,
  validateOperation,
} from "./operations";

// Plain string asserted to the branded Id<"users"> type (never `as any`).
const AUTHOR_ID = "user_contract_test_author" as Id<"users">;

describe("Operation constructor contracts", () => {
  describe("createInsertOperation", () => {
    it("returns an insert operation with position and content passed through", () => {
      const op = createInsertOperation(5, "hello", AUTHOR_ID, 7);
      expect(op.type).toBe("insert");
      expect(op.position).toBe(5);
      expect(op.content).toBe("hello");
    });

    it("fills OperationWithMetadata fields (id, authorId, timestamp, sequence)", () => {
      const op = createInsertOperation(0, "x", AUTHOR_ID, 7);
      expect(typeof op.id).toBe("string");
      expect(op.id.length).toBeGreaterThan(0);
      expect(op.authorId).toBe(AUTHOR_ID);
      expect(typeof op.timestamp).toBe("number");
      expect(op.timestamp).toBeGreaterThan(0);
      expect(op.sequence).toBe(7);
    });

    it("generates a unique id per operation", () => {
      const a = createInsertOperation(0, "a", AUTHOR_ID, 1);
      const b = createInsertOperation(0, "a", AUTHOR_ID, 2);
      expect(a.id).not.toBe(b.id);
    });

    // Pins current behavior: constructors perform no trimming or validation —
    // inputs pass through verbatim.
    it("pins current behavior: content is stored verbatim (no trimming)", () => {
      const op = createInsertOperation(0, "  padded  ", AUTHOR_ID, 1);
      expect(op.content).toBe("  padded  ");
    });
  });

  describe("createDeleteOperation", () => {
    it("returns a delete operation with position and length passed through", () => {
      const op = createDeleteOperation(3, 5, AUTHOR_ID, 7);
      expect(op.type).toBe("delete");
      expect(op.position).toBe(3);
      expect(op.length).toBe(5);
    });

    it("fills OperationWithMetadata fields (id, authorId, timestamp, sequence)", () => {
      const op = createDeleteOperation(3, 5, AUTHOR_ID, 7);
      expect(typeof op.id).toBe("string");
      expect(op.id.length).toBeGreaterThan(0);
      expect(op.authorId).toBe(AUTHOR_ID);
      expect(typeof op.timestamp).toBe("number");
      expect(op.timestamp).toBeGreaterThan(0);
      expect(op.sequence).toBe(7);
    });
  });

  describe("createRetainOperation", () => {
    it("returns a retain operation with position and length passed through", () => {
      const op = createRetainOperation(2, 10, AUTHOR_ID, 7);
      expect(op.type).toBe("retain");
      expect(op.position).toBe(2);
      expect(op.length).toBe(10);
    });

    it("fills OperationWithMetadata fields (id, authorId, timestamp, sequence)", () => {
      const op = createRetainOperation(2, 10, AUTHOR_ID, 7);
      expect(typeof op.id).toBe("string");
      expect(op.id.length).toBeGreaterThan(0);
      expect(op.authorId).toBe(AUTHOR_ID);
      expect(typeof op.timestamp).toBe("number");
      expect(op.timestamp).toBeGreaterThan(0);
      expect(op.sequence).toBe(7);
    });
  });
});

describe("applyToDoc valid cases", () => {
  it("insert at 0 prepends", () => {
    expect(
      applyToDoc("world", { type: "insert", position: 0, content: "hello " }),
    ).toBe("hello world");
  });

  it("insert at doc.length appends", () => {
    expect(
      applyToDoc("hello", { type: "insert", position: 5, content: " world" }),
    ).toBe("hello world");
  });

  it("insert in the middle", () => {
    expect(
      applyToDoc("Hello world", {
        type: "insert",
        position: 5,
        content: " beautiful",
      }),
    ).toBe("Hello beautiful world");
  });

  it("retain passes the document through unchanged", () => {
    expect(applyToDoc("hello", { type: "retain", position: 2, length: 3 })).toBe(
      "hello",
    );
  });

  it("delete part of the document", () => {
    expect(
      applyToDoc("hello world", { type: "delete", position: 5, length: 6 }),
    ).toBe("hello");
  });

  it("delete the whole document", () => {
    expect(applyToDoc("abc", { type: "delete", position: 0, length: 3 })).toBe(
      "",
    );
  });

  describe("empty-document interactions", () => {
    it("insert into an empty document at position 0", () => {
      expect(
        applyToDoc("", { type: "insert", position: 0, content: "hi" }),
      ).toBe("hi");
    });

    // Pins actual behavior: retain on an empty document is a no-op that
    // returns the document unchanged (applyToDoc does not validate retain).
    it("retain on an empty document (position 0, length 0) returns the doc", () => {
      expect(applyToDoc("", { type: "retain", position: 0, length: 0 })).toBe(
        "",
      );
    });
  });
});

describe("applyToDoc invalid cases (exact error messages)", () => {
  it("insert without content throws 'Insert operation requires content'", () => {
    expect(() =>
      applyToDoc("abc", { type: "insert", position: 0 }),
    ).toThrow("Insert operation requires content");
  });

  it("insert with empty-string content throws 'Insert operation requires content'", () => {
    expect(() =>
      applyToDoc("abc", { type: "insert", position: 0, content: "" }),
    ).toThrow("Insert operation requires content");
  });

  it("insert with non-integer position 1.5 throws 'Invalid insert position: 1.5 (position must be an integer)'", () => {
    expect(() =>
      applyToDoc("abc", { type: "insert", position: 1.5, content: "x" }),
    ).toThrow("Invalid insert position: 1.5 (position must be an integer)");
  });

  it("insert with out-of-range position (doc.length + 1) throws 'Invalid insert position: 4'", () => {
    expect(() =>
      applyToDoc("abc", { type: "insert", position: 4, content: "x" }),
    ).toThrow("Invalid insert position: 4");
  });

  it("delete without length throws 'Delete operation requires length'", () => {
    expect(() =>
      applyToDoc("abc", { type: "delete", position: 1 }),
    ).toThrow("Delete operation requires length");
  });

  it("delete with zero length throws 'Delete operation requires length'", () => {
    expect(() =>
      applyToDoc("abc", { type: "delete", position: 1, length: 0 }),
    ).toThrow("Delete operation requires length");
  });

  it("delete with non-integer length 2.5 throws 'Invalid delete length: 2.5 (length must be an integer)'", () => {
    expect(() =>
      applyToDoc("abcde", { type: "delete", position: 1, length: 2.5 }),
    ).toThrow("Invalid delete length: 2.5 (length must be an integer)");
  });

  it("delete at position === doc.length throws 'Invalid delete position: 3'", () => {
    expect(() =>
      applyToDoc("abc", { type: "delete", position: 3, length: 1 }),
    ).toThrow("Invalid delete position: 3");
  });

  it("delete at a position beyond doc.length throws 'Invalid delete position: 5'", () => {
    expect(() =>
      applyToDoc("abc", { type: "delete", position: 5, length: 1 }),
    ).toThrow("Invalid delete position: 5");
  });

  it("delete at position 0 on an empty document throws 'Invalid delete position: 0'", () => {
    expect(() =>
      applyToDoc("", { type: "delete", position: 0, length: 1 }),
    ).toThrow("Invalid delete position: 0");
  });

  it("delete with length beyond the document end throws 'Delete operation exceeds document length'", () => {
    expect(() =>
      applyToDoc("abc", { type: "delete", position: 1, length: 5 }),
    ).toThrow("Delete operation exceeds document length");
  });

  it("unknown operation type throws 'Unknown operation type: corrupt'", () => {
    const unknownOp = { type: "corrupt", position: 0 } as unknown as Operation;
    expect(() => applyToDoc("abc", unknownOp)).toThrow(
      "Unknown operation type: corrupt",
    );
  });
});

describe("validateOperation boolean contracts", () => {
  it("accepts a valid insert", () => {
    expect(
      validateOperation({ type: "insert", position: 0, content: "hi" }),
    ).toBe(true);
  });

  it("accepts a valid delete", () => {
    expect(validateOperation({ type: "delete", position: 0, length: 2 })).toBe(
      true,
    );
  });

  it("accepts a valid retain, including zero length", () => {
    expect(validateOperation({ type: "retain", position: 0, length: 5 })).toBe(
      true,
    );
    expect(validateOperation({ type: "retain", position: 0, length: 0 })).toBe(
      true,
    );
  });

  it("rejects an insert with missing content", () => {
    expect(validateOperation({ type: "insert", position: 0 })).toBe(false);
  });

  it("rejects an insert with empty-string content", () => {
    expect(
      validateOperation({ type: "insert", position: 0, content: "" }),
    ).toBe(false);
  });

  it("rejects a fractional position (1.5)", () => {
    expect(
      validateOperation({ type: "insert", position: 1.5, content: "hi" }),
    ).toBe(false);
  });

  it("rejects a fractional delete length (2.5)", () => {
    expect(validateOperation({ type: "delete", position: 0, length: 2.5 })).toBe(
      false,
    );
  });

  it("rejects a zero delete length", () => {
    expect(validateOperation({ type: "delete", position: 0, length: 0 })).toBe(
      false,
    );
  });

  it("rejects a negative position", () => {
    expect(
      validateOperation({ type: "insert", position: -1, content: "hi" }),
    ).toBe(false);
  });

  it("rejects a negative delete length", () => {
    expect(validateOperation({ type: "delete", position: 0, length: -1 })).toBe(
      false,
    );
  });

  it("rejects a NaN position", () => {
    expect(
      validateOperation({ type: "insert", position: NaN, content: "hi" }),
    ).toBe(false);
  });

  it("rejects an Infinity position", () => {
    expect(
      validateOperation({ type: "insert", position: Infinity, content: "hi" }),
    ).toBe(false);
  });

  it("rejects a wrong type string", () => {
    const wrongType = {
      type: "corrupt",
      position: 0,
      content: "hi",
    } as unknown as Operation;
    expect(validateOperation(wrongType)).toBe(false);
  });

  it("rejects a retain with negative length", () => {
    expect(validateOperation({ type: "retain", position: 0, length: -1 })).toBe(
      false,
    );
  });
});
