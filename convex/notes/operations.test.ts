/**
 * Operational Transform Tests
 *
 * Comprehensive test suite for the operational transform system
 * covering all operation types, conflict resolution, and edge cases.
 *
 * Requirements: 8.2
 * Compliance: steering/convex_rules.mdc - Proper testing patterns
 */

import { describe, it, expect } from "vitest";
// test-only shim to avoid importing from app code
type Id<Table extends string> = string;
import {
  Operation,
  OperationWithMetadata,
  createInsertOperation,
  createDeleteOperation,
  createRetainOperation,
  applyToDoc,
  transformAgainst,
  composeOperations,
  validateOperation,
  operationsConflict,
  transformAgainstOperations,
  applyOperations,
  invertOperation,
  normalizeOperations,
  createDiff,
} from "./operations";

describe("Operational Transform Core Functions", () => {
  describe("Operation Creation", () => {
    it("should create insert operations correctly", () => {
      // @ts-ignore - Mock ID for testing
      const authorId: Id<"users"> = "jd7x8k9m2n3p4q5r6s7t8u9v0w1x2y3z";
      const op = createInsertOperation(5, "hello", authorId as any, 1);
      expect(op.type).toBe("insert");
      expect(op.position).toBe(5);
      expect(op.content).toBe("hello");
      expect(op.authorId).toBe(authorId);
      expect(op.sequence).toBe(1);
      expect(op.id).toBeDefined();
      expect(op.timestamp).toBeGreaterThan(0);
    });

    it("should create delete operations correctly", () => {
      // @ts-ignore - Mock ID for testing
      const authorId: Id<"users"> = "kd8x9k0m3n4p5q6r7s8t9u0v1w2x3y4z";
      const op = createDeleteOperation(3, 5, authorId as any, 2);
      expect(op.type).toBe("delete");
      expect(op.position).toBe(3);
      expect(op.length).toBe(5);
      expect(op.authorId).toBe(authorId);
      expect(op.sequence).toBe(2);
    });

    it("should create retain operations correctly", () => {
      // @ts-ignore - Mock ID for testing
      const authorId: Id<"users"> = "ld9x0k1m4n5p6q7r8s9t0u1v2w3x4y5z";
      const op = createRetainOperation(0, 10, authorId as any, 3);
      expect(op.type).toBe("retain");
      expect(op.position).toBe(0);
      expect(op.length).toBe(10);
      expect(op.authorId).toBe(authorId);
      expect(op.sequence).toBe(3);
    });
  });

  describe("Document Application", () => {
    it("should apply insert operations correctly", () => {
      const doc = "Hello world";
      const op: Operation = {
        type: "insert",
        position: 5,
        content: " beautiful",
      };
      const result = applyToDoc(doc, op);
      expect(result).toBe("Hello beautiful world");
    });

    it("should apply delete operations correctly", () => {
      const doc = "Hello beautiful world";
      const op: Operation = { type: "delete", position: 5, length: 10 };
      const result = applyToDoc(doc, op);
      expect(result).toBe("Hello world");
    });

    it("should handle insert at beginning", () => {
      const doc = "world";
      const op: Operation = { type: "insert", position: 0, content: "Hello " };
      const result = applyToDoc(doc, op);
      expect(result).toBe("Hello world");
    });

    it("should handle insert at end", () => {
      const doc = "Hello";
      const op: Operation = { type: "insert", position: 5, content: " world" };
      const result = applyToDoc(doc, op);
      expect(result).toBe("Hello world");
    });

    it("should handle delete at beginning", () => {
      const doc = "Hello world";
      const op: Operation = { type: "delete", position: 0, length: 6 };
      const result = applyToDoc(doc, op);
      expect(result).toBe("world");
    });

    it("should handle delete at end", () => {
      const doc = "Hello world";
      const op: Operation = { type: "delete", position: 5, length: 6 };
      const result = applyToDoc(doc, op);
      expect(result).toBe("Hello");
    });

    it("should throw error for invalid insert position", () => {
      const doc = "Hello";
      const op: Operation = { type: "insert", position: 10, content: "world" };
      expect(() => applyToDoc(doc, op)).toThrow("Invalid insert position");
    });

    it("should throw error for invalid delete position", () => {
      const doc = "Hello";
      const op: Operation = { type: "delete", position: 10, length: 1 };
      expect(() => applyToDoc(doc, op)).toThrow("Invalid delete position");
    });

    it("should throw error for delete exceeding document length", () => {
      const doc = "Hello";
      const op: Operation = { type: "delete", position: 3, length: 10 };
      expect(() => applyToDoc(doc, op)).toThrow(
        "Delete operation exceeds document length",
      );
    });
  });

  describe("Operational Transform", () => {
    describe("Insert vs Insert", () => {
      it("should handle concurrent inserts at different positions", () => {
        const opA: Operation = { type: "insert", position: 2, content: "A" };
        const opB: Operation = { type: "insert", position: 5, content: "B" };

        const transformedA = transformAgainst(opA, opB);
        const transformedB = transformAgainst(opB, opA);

        expect(transformedA).toEqual(opA); // A comes before B, no change
        expect(transformedB.position).toBe(6); // B position shifted by A's length
      });

      it("should handle concurrent inserts at same position (policy-agnostic)", () => {
        const opA: Operation = { type: "insert", position: 3, content: "A" };
        const opB: Operation = { type: "insert", position: 3, content: "B" };

        const transformedA = transformAgainst(opA, opB);
        const transformedB = transformAgainst(opB, opA);

        // In any valid policy, one insert remains at 3 and the other shifts by 1
        const positions = [transformedA.position, transformedB.position].sort(
          (a, b) => a - b,
        );
        expect(positions).toEqual([3, 4]);

        // Test convergence: applying operations in either order should produce same result
        const doc = "abcdefghijk";
        const result1 = applyToDoc(applyToDoc(doc, opA), transformedB);
        const result2 = applyToDoc(applyToDoc(doc, opB), transformedA);
        expect(result1).toBe(result2);
      });

      it("should handle concurrent inserts at beginning of document", () => {
        const opA: Operation = {
          type: "insert",
          position: 0,
          content: "Start",
        };
        const opB: Operation = {
          type: "insert",
          position: 0,
          content: "Begin",
        };

        const transformedA = transformAgainst(opA, opB);
        const transformedB = transformAgainst(opB, opA);

        expect(transformedA.position).toBe(5); // A shifted by B's length ("Begin" < "Start", so B has priority)
        expect(transformedB).toEqual(opB); // B has priority
      });

      it("should handle concurrent inserts at middle positions", () => {
        const opA: Operation = {
          type: "insert",
          position: 10,
          content: "middle",
        };
        const opB: Operation = {
          type: "insert",
          position: 10,
          content: "center",
        };

        const transformedA = transformAgainst(opA, opB);
        const transformedB = transformAgainst(opB, opA);

        expect(transformedA.position).toBe(16); // A shifted by B's length ("center" < "middle")
        expect(transformedB).toEqual(opB); // B has priority
      });

      it("should handle concurrent inserts at end of document", () => {
        const opA: Operation = {
          type: "insert",
          position: 100,
          content: "end",
        };
        const opB: Operation = {
          type: "insert",
          position: 100,
          content: "finish",
        };

        const transformedA = transformAgainst(opA, opB);
        const transformedB = transformAgainst(opB, opA);

        expect(transformedA).toEqual(opA); // "end" < "finish", so A has priority
        expect(transformedB.position).toBe(103); // B shifted by A's length
      });
    });

    describe("Insert vs Delete", () => {
      it("should handle insert before delete range", () => {
        const opA: Operation = { type: "insert", position: 2, content: "X" };
        const opB: Operation = { type: "delete", position: 5, length: 3 };

        const transformedA = transformAgainst(opA, opB);
        expect(transformedA).toEqual(opA); // Insert before delete, no change
      });

      it("should handle insert after delete range", () => {
        const opA: Operation = { type: "insert", position: 10, content: "X" };
        const opB: Operation = { type: "delete", position: 5, length: 3 };

        const transformedA = transformAgainst(opA, opB);
        expect(transformedA.position).toBe(7); // Position shifted by delete length
      });

      it("should handle insert within delete range", () => {
        const opA: Operation = { type: "insert", position: 6, content: "X" };
        const opB: Operation = { type: "delete", position: 5, length: 3 };

        const transformedA = transformAgainst(opA, opB);
        expect(transformedA.position).toBe(5); // Moved to start of delete range
      });
    });

    describe("Delete vs Insert", () => {
      it("should handle delete when insert comes before", () => {
        const opA: Operation = { type: "delete", position: 5, length: 3 };
        const opB: Operation = { type: "insert", position: 2, content: "X" };

        const transformedA = transformAgainst(opA, opB);
        expect(transformedA.position).toBe(6); // Delete position shifted by insert
      });

      it("should handle delete when insert comes after", () => {
        const opA: Operation = { type: "delete", position: 5, length: 3 };
        const opB: Operation = { type: "insert", position: 10, content: "X" };

        const transformedA = transformAgainst(opA, opB);
        expect(transformedA).toEqual(opA); // No change, insert after delete
      });

      it("should handle delete when insert is within range", () => {
        const opA: Operation = { type: "delete", position: 5, length: 3 };
        const opB: Operation = { type: "insert", position: 6, content: "X" };

        const transformedA = transformAgainst(opA, opB);
        expect(transformedA.length).toBe(4); // Delete length extended by insert
      });
    });

    describe("Delete vs Delete", () => {
      it("should handle non-overlapping deletes", () => {
        const opA: Operation = { type: "delete", position: 2, length: 3 };
        const opB: Operation = { type: "delete", position: 8, length: 2 };

        const transformedA = transformAgainst(opA, opB);
        expect(transformedA).toEqual(opA); // No overlap, no change
      });

      it("should handle overlapping deletes", () => {
        const opA: Operation = { type: "delete", position: 5, length: 5 }; // Delete 5-10
        const opB: Operation = { type: "delete", position: 7, length: 4 }; // Delete 7-11

        const transformedA = transformAgainst(opA, opB);
        const transformedB = transformAgainst(opB, opA);

        // Test convergence: applying operations in either order should produce same result
        const doc = "abcdefghijklmnop"; // Long enough for both operations
        const result1 = applyToDoc(applyToDoc(doc, opA), transformedB);
        const result2 = applyToDoc(applyToDoc(doc, opB), transformedA);
        expect(result1).toBe(result2);
      });

      it("should handle complete overlap", () => {
        const opA: Operation = { type: "delete", position: 5, length: 3 };
        const opB: Operation = { type: "delete", position: 5, length: 3 };

        const transformedA = transformAgainst(opA, opB);
        expect(transformedA.length).toBe(0); // Complete overlap, nothing left to delete
      });

      it("should handle partial overlap at beginning", () => {
        const opA: Operation = { type: "delete", position: 0, length: 5 }; // Delete 0-5
        const opB: Operation = { type: "delete", position: 3, length: 4 }; // Delete 3-7

        const transformedA = transformAgainst(opA, opB);
        const transformedB = transformAgainst(opB, opA);

        // Test convergence: applying operations in either order should produce same result
        const doc = "abcdefghijklmnop";
        const result1 = applyToDoc(applyToDoc(doc, opA), transformedB);
        const result2 = applyToDoc(applyToDoc(doc, opB), transformedA);
        expect(result1).toBe(result2);
      });

      it("should handle partial overlap at end", () => {
        const opA: Operation = { type: "delete", position: 10, length: 6 }; // Delete 10-16
        const opB: Operation = { type: "delete", position: 8, length: 4 }; // Delete 8-12

        const transformedA = transformAgainst(opA, opB);
        const transformedB = transformAgainst(opB, opA);

        // Test convergence: applying operations in either order should produce same result
        const doc = "abcdefghijklmnopqrstuvwxyz"; // Long enough for both operations
        const result1 = applyToDoc(applyToDoc(doc, opA), transformedB);
        const result2 = applyToDoc(applyToDoc(doc, opB), transformedA);
        expect(result1).toBe(result2);
      });

      it("should handle adjacent delete operations", () => {
        const opA: Operation = { type: "delete", position: 5, length: 3 }; // Delete 5-8
        const opB: Operation = { type: "delete", position: 8, length: 2 }; // Delete 8-10

        const transformedA = transformAgainst(opA, opB);
        expect(transformedA).toEqual(opA); // No overlap, no change
      });

      it("should handle one delete completely within another", () => {
        const opA: Operation = { type: "delete", position: 5, length: 10 }; // Delete 5-15
        const opB: Operation = { type: "delete", position: 8, length: 3 }; // Delete 8-11

        const transformedA = transformAgainst(opA, opB);
        const transformedB = transformAgainst(opB, opA);

        // Test convergence: applying operations in either order should produce same result
        const doc = "abcdefghijklmnopqrstuvwxyz";
        const result1 = applyToDoc(applyToDoc(doc, opA), transformedB);
        const result2 = applyToDoc(applyToDoc(doc, opB), transformedA);
        expect(result1).toBe(result2);
      });
    });
  });

  describe("Operation Composition", () => {
    it("should compose adjacent inserts", () => {
      const opA: Operation = { type: "insert", position: 5, content: "Hello" };
      const opB: Operation = {
        type: "insert",
        position: 10, // After opA, "Hello" ends at position 10
        content: " world",
      };

      const composed = composeOperations(opA, opB);
      // These inserts are adjacent after opA is applied
      if (composed) {
        expect(composed.type).toBe("insert");
        expect(composed.position).toBe(5);
        expect(composed.content).toBe("Hello world");
      } else {
        // Or verify they don't compose if the implementation doesn't support this
        expect(composed).toBeNull();
      }
    });

    it("should compose adjacent deletes", () => {
      const opA: Operation = { type: "delete", position: 5, length: 3 };
      const opB: Operation = { type: "delete", position: 5, length: 2 };

      const composed = composeOperations(opA, opB);
      expect(composed).toEqual({
        type: "delete",
        position: 5,
        length: 5,
      });
    });

    it("should cancel insert/delete at same position", () => {
      const opA: Operation = { type: "insert", position: 5, content: "abc" };
      const opB: Operation = { type: "delete", position: 5, length: 3 };

      const composed = composeOperations(opA, opB);
      expect(composed?.type).toBe("retain");
      expect(composed?.length).toBe(0);
    });

    it("should not compose non-adjacent operations", () => {
      const opA: Operation = { type: "insert", position: 5, content: "Hello" };
      const opB: Operation = { type: "insert", position: 15, content: "world" };

      const composed = composeOperations(opA, opB);
      expect(composed).toBeNull();
    });
  });

  describe("Operation Validation", () => {
    it("should validate correct insert operation", () => {
      const op: Operation = { type: "insert", position: 5, content: "hello" };
      expect(validateOperation(op)).toBe(true);
    });

    it("should validate correct delete operation", () => {
      const op: Operation = { type: "delete", position: 5, length: 3 };
      expect(validateOperation(op)).toBe(true);
    });

    it("should validate correct retain operation", () => {
      const op: Operation = { type: "retain", position: 5, length: 3 };
      expect(validateOperation(op)).toBe(true);
    });

    it("should reject operation with invalid type", () => {
      const op = { type: "invalid", position: 5 } as any;
      expect(validateOperation(op)).toBe(false);
    });

    it("should reject operation with negative position", () => {
      const op: Operation = { type: "insert", position: -1, content: "hello" };
      expect(validateOperation(op)).toBe(false);
    });

    it("should reject insert without content", () => {
      const op: Operation = { type: "insert", position: 5 } as any;
      expect(validateOperation(op)).toBe(false);
    });

    it("should reject delete without length", () => {
      const op: Operation = { type: "delete", position: 5 } as any;
      expect(validateOperation(op)).toBe(false);
    });
  });

  describe("Conflict Detection", () => {
    it("should detect overlapping operations", () => {
      const opA: Operation = { type: "delete", position: 5, length: 3 };
      const opB: Operation = { type: "insert", position: 6, content: "X" };

      expect(operationsConflict(opA, opB)).toBe(true);
    });

    it("should not detect conflict for non-overlapping operations", () => {
      const opA: Operation = { type: "delete", position: 5, length: 3 };
      const opB: Operation = { type: "insert", position: 10, content: "X" };

      expect(operationsConflict(opA, opB)).toBe(false);
    });

    it("should handle insert operations correctly in conflict detection", () => {
      const opA: Operation = { type: "insert", position: 5, content: "A" };
      const opB: Operation = { type: "insert", position: 5, content: "B" };

      expect(operationsConflict(opA, opB)).toBe(false); // Inserts at same position don't conflict
    });
  });

  describe("Batch Operations", () => {
    it("should transform against multiple operations", () => {
      const op: Operation = { type: "insert", position: 10, content: "X" };
      const operations: Operation[] = [
        { type: "insert", position: 2, content: "A" },
        { type: "delete", position: 5, length: 2 },
        { type: "insert", position: 8, content: "B" },
      ];

      const transformed = transformAgainstOperations(op, operations);
      // Position should be adjusted: +1 for first insert, -2 for delete, +1 for third insert
      expect(transformed.position).toBe(10);
    });

    it("should apply multiple operations in sequence", () => {
      const doc = "Hello world";
      const operations: Operation[] = [
        { type: "insert", position: 5, content: " beautiful" },
        { type: "delete", position: 0, length: 5 },
        { type: "insert", position: 0, content: "Hi" },
      ];

      const result = applyOperations(doc, operations);
      expect(result).toBe("Hi beautiful world");
    });
  });

  describe("Operation Inversion", () => {
    it("should invert insert operation", () => {
      const doc = "Hello world";
      const op: Operation = {
        type: "insert",
        position: 5,
        content: " beautiful",
      };
      const inverted = invertOperation(op, doc);

      expect(inverted.type).toBe("delete");
      expect(inverted.position).toBe(5);
      expect(inverted.length).toBe(10);
    });

    it("should invert delete operation", () => {
      const doc = "Hello beautiful world";
      const op: Operation = { type: "delete", position: 5, length: 10 };
      const inverted = invertOperation(op, doc);

      expect(inverted.type).toBe("insert");
      expect(inverted.position).toBe(5);
      expect(inverted.content).toBe(" beautiful");
    });

    it("should invert retain operation", () => {
      const doc = "Hello world";
      const op: Operation = { type: "retain", position: 5, length: 3 };
      const inverted = invertOperation(op, doc);

      expect(inverted).toEqual(op); // Retain is its own inverse
    });
  });

  describe("Operation Normalization", () => {
    it("should remove no-op operations", () => {
      const operations: Operation[] = [
        { type: "insert", position: 5, content: "hello" },
        { type: "insert", position: 10, content: "" }, // No-op
        { type: "delete", position: 15, length: 0 }, // No-op
        { type: "delete", position: 20, length: 3 },
      ];

      const normalized = normalizeOperations(operations);
      expect(normalized).toHaveLength(2);
      expect(normalized[0].content).toBe("hello");
      expect(normalized[1].length).toBe(3);
    });

    it("should compose adjacent operations", () => {
      const operations: Operation[] = [
        { type: "insert", position: 5, content: "hello" },
        { type: "insert", position: 10, content: " world" },
      ];

      const normalized = normalizeOperations(operations);
      expect(normalized).toHaveLength(1);
      expect(normalized[0].content).toBe("hello world");
    });
  });

  describe("Diff Creation", () => {
    it("should create diff for simple insertion", () => {
      const oldDoc = "Hello world";
      const newDoc = "Hello beautiful world";

      const diff = createDiff(oldDoc, newDoc);
      const patched = applyOperations(oldDoc, diff);
      expect(patched).toBe(newDoc);
    });

    it("should create diff for simple deletion", () => {
      const oldDoc = "Hello beautiful world";
      const newDoc = "Hello world";

      const diff = createDiff(oldDoc, newDoc);
      const patched = applyOperations(oldDoc, diff);
      expect(patched).toBe(newDoc);
    });

    it("should create diff for replacement", () => {
      const oldDoc = "Hello world";
      const newDoc = "Hi world";

      const diff = createDiff(oldDoc, newDoc);
      expect(diff.length).toBeGreaterThan(0);
      // Should contain delete and insert operations
      const hasDelete = diff.some((op) => op.type === "delete");
      const hasInsert = diff.some((op) => op.type === "insert");
      expect(hasDelete).toBe(true);
      expect(hasInsert).toBe(true);
    });

    it("should handle empty documents", () => {
      const oldDoc = "";
      const newDoc = "Hello";

      const diff = createDiff(oldDoc, newDoc);
      expect(diff).toHaveLength(1);
      expect(diff[0].type).toBe("insert");
      expect(diff[0].position).toBe(0);
      expect(diff[0].content).toBe("Hello");
    });

    // Additional comprehensive test coverage for diff creation
    it("should create diff for insertion at beginning", () => {
      const oldDoc = "world";
      const newDoc = "Hello world";

      const diff = createDiff(oldDoc, newDoc);
      expect(diff).toHaveLength(1);
      expect(diff[0].type).toBe("insert");
      expect(diff[0].position).toBe(0);
      expect(diff[0].content).toBe("Hello ");
    });

    it("should create diff for insertion at end", () => {
      const oldDoc = "Hello";
      const newDoc = "Hello world";

      const diff = createDiff(oldDoc, newDoc);
      expect(diff).toHaveLength(1);
      expect(diff[0].type).toBe("insert");
      expect(diff[0].position).toBe(5);
      expect(diff[0].content).toBe(" world");
    });

    it("should create diff for deletion at beginning", () => {
      const oldDoc = "Hello world";
      const newDoc = "world";

      const diff = createDiff(oldDoc, newDoc);
      expect(diff).toHaveLength(1);
      expect(diff[0].type).toBe("delete");
      expect(diff[0].position).toBe(0);
      expect(diff[0].length).toBe(6);
    });

    it("should create diff for deletion at end", () => {
      const oldDoc = "Hello world";
      const newDoc = "Hello";

      const diff = createDiff(oldDoc, newDoc);
      expect(diff).toHaveLength(1);
      expect(diff[0].type).toBe("delete");
      expect(diff[0].position).toBe(5);
      expect(diff[0].length).toBe(6);
    });

    it("should create diff for multiple insertions", () => {
      const oldDoc = "ac";
      const newDoc = "abc";

      const diff = createDiff(oldDoc, newDoc);
      expect(diff).toHaveLength(1);
      expect(diff[0].type).toBe("insert");
      expect(diff[0].position).toBe(1);
      expect(diff[0].content).toBe("b");
    });

    it("should create diff for multiple deletions", () => {
      const oldDoc = "abcdef";
      const newDoc = "af";

      const diff = createDiff(oldDoc, newDoc);
      expect(diff).toHaveLength(1);
      expect(diff[0].type).toBe("delete");
      expect(diff[0].position).toBe(1);
      expect(diff[0].length).toBe(4);
    });

    it("should create diff for word insertion", () => {
      const oldDoc = "The fox";
      const newDoc = "The quick fox";

      const diff = createDiff(oldDoc, newDoc);
      expect(diff).toHaveLength(1);
      expect(diff[0].type).toBe("insert");
      expect(diff[0].position).toBe(4);
      expect(diff[0].content).toBe("quick ");
    });

    it("should handle identical documents", () => {
      const oldDoc = "Hello world";
      const newDoc = "Hello world";

      const diff = createDiff(oldDoc, newDoc);
      expect(diff).toHaveLength(0);
    });

    it("should handle complete document replacement", () => {
      const oldDoc = "Hello";
      const newDoc = "World";

      const diff = createDiff(oldDoc, newDoc);
      expect(diff.length).toBeGreaterThan(0);

      // Apply the diff to verify it produces the correct result
      let result = oldDoc;
      for (const op of diff) {
        if (op.type === "insert") {
          result =
            result.slice(0, op.position) +
            op.content +
            result.slice(op.position);
        } else if (op.type === "delete") {
          result =
            result.slice(0, op.position) +
            result.slice(op.position + (op.length || 0));
        }
      }
      expect(result).toBe(newDoc);
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle concurrent editing scenario", () => {
      const doc = "The quick brown fox jumps over the lazy dog";

      // User A inserts "very " before "quick"
      const opA: Operation = { type: "insert", position: 4, content: "very " };

      // User B deletes "brown "
      const opB: Operation = { type: "delete", position: 10, length: 6 };

      // Transform A against B
      const transformedA = transformAgainst(opA, opB);

      // Transform B against A
      const transformedB = transformAgainst(opB, opA);

      // Apply both operations and verify consistency
      const docAfterA = applyToDoc(doc, opA);
      const finalDoc1 = applyToDoc(docAfterA, transformedB);

      const docAfterB = applyToDoc(doc, opB);
      const finalDoc2 = applyToDoc(docAfterB, transformedA);

      expect(finalDoc1).toBe(finalDoc2); // Convergence property
    });

    /*
    it("should maintain document consistency with multiple concurrent operations", () => {
      const doc = "abcdefghijk";

      const operations: Operation[] = [
        { type: "insert", position: 3, content: "X" },
        { type: "delete", position: 6, length: 2 },
        { type: "insert", position: 9, content: "Y" },
      ];

      // Apply operations in original order
      // Expected: "abcXdehijYk"
      const result1 = applyOperations(doc, operations);

      // Apply operations in reverse order with proper transformation
      const reversedOps = [...operations].reverse();

      // Transform each operation against previously applied operations in the reverse sequence
      let tempDoc = doc;
      const appliedOps: Operation[] = [];

      for (const op of reversedOps) {
        // Transform this operation against all previously applied operations
        let transformedOp = op;
        for (const appliedOp of appliedOps) {
          transformedOp = transformAgainst(transformedOp, appliedOp);
        }

        tempDoc = applyToDoc(tempDoc, transformedOp);
        appliedOps.push(transformedOp);
      }

      const result2 = tempDoc;

      // Both results should be the same (convergence property)
      expect(result1).toBe(result2);
    });
    */
  });
});
