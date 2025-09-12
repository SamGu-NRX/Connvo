/**
 * Operational Transform (OT) Infrastructure for Collaborative Notes
 *
 * This module implements a comprehensive operational transform system for
 * real-time collaborative text editing with conflict resolution.
 *
 * Requirements: 8.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns and types
 */

import { v } from "convex/values";

/**
 * Operation types for text editing
 */
export type OperationType = "insert" | "delete" | "retain";

/**
 * Core operation interface for operational transform
 */
export interface Operation {
  type: OperationType;
  position: number;
  content?: string; // Required for insert operations
  length?: number; // Required for delete and retain operations
}

/**
 * Validator for Operation objects
 */
export const operationValidator = v.object({
  type: v.union(v.literal("insert"), v.literal("delete"), v.literal("retain")),
  position: v.number(),
  content: v.optional(v.string()),
  length: v.optional(v.number()),
});

/**
 * Operation with metadata for tracking and conflict resolution
 */
export interface OperationWithMetadata extends Operation {
  id: string;
  authorId: string;
  timestamp: number;
  sequence: number;
  transformedFrom?: string[]; // IDs of operations this was transformed from
}

/**
 * Validator for OperationWithMetadata
 */
export const operationWithMetadataValidator = v.object({
  type: v.union(v.literal("insert"), v.literal("delete"), v.literal("retain")),
  position: v.number(),
  content: v.optional(v.string()),
  length: v.optional(v.number()),
  id: v.string(),
  authorId: v.string(),
  timestamp: v.number(),
  sequence: v.number(),
  transformedFrom: v.optional(v.array(v.string())),
});

/**
 * Document state with version tracking
 */
export interface DocumentState {
  content: string;
  version: number;
  lastRebasedAt: number;
  operations: OperationWithMetadata[];
}

/**
 * Creates a new insert operation
 */
export function createInsertOperation(
  position: number,
  content: string,
  authorId: string,
  sequence: number,
): OperationWithMetadata {
  return {
    type: "insert",
    position,
    content,
    id: generateOperationId(),
    authorId,
    timestamp: Date.now(),
    sequence,
  };
}

/**
 * Creates a new delete operation
 */
export function createDeleteOperation(
  position: number,
  length: number,
  authorId: string,
  sequence: number,
): OperationWithMetadata {
  return {
    type: "delete",
    position,
    length,
    id: generateOperationId(),
    authorId,
    timestamp: Date.now(),
    sequence,
  };
}

/**
 * Creates a new retain operation (for cursor positioning)
 */
export function createRetainOperation(
  position: number,
  length: number,
  authorId: string,
  sequence: number,
): OperationWithMetadata {
  return {
    type: "retain",
    position,
    length,
    id: generateOperationId(),
    authorId,
    timestamp: Date.now(),
    sequence,
  };
}

/**
 * Applies an operation to a document string
 */
export function applyToDoc(doc: string, operation: Operation): string {
  switch (operation.type) {
    case "insert":
      if (!operation.content) {
        throw new Error("Insert operation requires content");
      }
      if (operation.position < 0 || operation.position > doc.length) {
        throw new Error(`Invalid insert position: ${operation.position}`);
      }
      return (
        doc.slice(0, operation.position) +
        operation.content +
        doc.slice(operation.position)
      );

    case "delete":
      if (!operation.length) {
        throw new Error("Delete operation requires length");
      }
      if (operation.position < 0 || operation.position >= doc.length) {
        throw new Error(`Invalid delete position: ${operation.position}`);
      }
      if (operation.position + operation.length > doc.length) {
        throw new Error("Delete operation exceeds document length");
      }
      return (
        doc.slice(0, operation.position) +
        doc.slice(operation.position + operation.length)
      );

    case "retain":
      // Retain operations don't modify the document content
      return doc;

    default:
      throw new Error(`Unknown operation type: ${(operation as any).type}`);
  }
}

/**
 * Transforms operation A against operation B (operational transform core)
 * Returns the transformed version of operation A
 */
export function transformAgainst(opA: Operation, opB: Operation): Operation {
  // Insert vs Insert
  if (opA.type === "insert" && opB.type === "insert") {
    if (opA.position <= opB.position) {
      return opA; // A comes before B, no change needed
    } else {
      return {
        ...opA,
        position: opA.position + (opB.content?.length || 0),
      };
    }
  }

  // Insert vs Delete
  if (opA.type === "insert" && opB.type === "delete") {
    if (opA.position <= opB.position) {
      return opA; // A comes before B's deletion range
    } else if (opA.position > opB.position + (opB.length || 0)) {
      return {
        ...opA,
        position: opA.position - (opB.length || 0),
      };
    } else {
      // A is within B's deletion range, move to start of deletion
      return {
        ...opA,
        position: opB.position,
      };
    }
  }

  // Delete vs Insert
  if (opA.type === "delete" && opB.type === "insert") {
    if (opB.position <= opA.position) {
      return {
        ...opA,
        position: opA.position + (opB.content?.length || 0),
      };
    } else if (opB.position >= opA.position + (opA.length || 0)) {
      return opA; // B comes after A's deletion range
    } else {
      // B is within A's deletion range, extend deletion length
      return {
        ...opA,
        length: (opA.length || 0) + (opB.content?.length || 0),
      };
    }
  }

  // Delete vs Delete
  if (opA.type === "delete" && opB.type === "delete") {
    const aEnd = opA.position + (opA.length || 0);
    const bEnd = opB.position + (opB.length || 0);

    if (aEnd <= opB.position) {
      return opA; // A comes completely before B
    } else if (opA.position >= bEnd) {
      return {
        ...opA,
        position: opA.position - (opB.length || 0),
      };
    } else {
      // Overlapping deletions - complex case
      const overlapStart = Math.max(opA.position, opB.position);
      const overlapEnd = Math.min(aEnd, bEnd);
      const overlapLength = overlapEnd - overlapStart;

      if (opA.position < opB.position) {
        // A starts before B
        return {
          ...opA,
          length: (opA.length || 0) - overlapLength,
        };
      } else {
        // B starts before or at same position as A
        const newPosition = opB.position;
        const newLength = (opA.length || 0) - overlapLength;
        return {
          ...opA,
          position: newPosition,
          length: Math.max(0, newLength),
        };
      }
    }
  }

  // Retain operations
  if (opA.type === "retain") {
    if (opB.type === "insert") {
      if (opB.position <= opA.position) {
        return {
          ...opA,
          position: opA.position + (opB.content?.length || 0),
        };
      }
    } else if (opB.type === "delete") {
      if (opB.position + (opB.length || 0) <= opA.position) {
        return {
          ...opA,
          position: opA.position - (opB.length || 0),
        };
      }
    }
    return opA;
  }

  if (opB.type === "retain") {
    return opA; // Retain operations don't affect other operations
  }

  return opA;
}

/**
 * Transforms a pair of operations against each other
 * Returns [transformedA, transformedB]
 */
export function transformOperationPair(
  opA: Operation,
  opB: Operation,
): [Operation, Operation] {
  const transformedA = transformAgainst(opA, opB);
  const transformedB = transformAgainst(opB, opA);
  return [transformedA, transformedB];
}

/**
 * Composes two operations into a single operation where possible
 * Returns null if operations cannot be composed
 */
export function composeOperations(
  opA: Operation,
  opB: Operation,
): Operation | null {
  // Can only compose operations from the same author in sequence
  // Insert + Insert at adjacent positions
  if (
    opA.type === "insert" &&
    opB.type === "insert" &&
    opA.position + (opA.content?.length || 0) === opB.position
  ) {
    return {
      type: "insert",
      position: opA.position,
      content: (opA.content || "") + (opB.content || ""),
    };
  }

  // Delete + Delete at same position
  if (
    opA.type === "delete" &&
    opB.type === "delete" &&
    opA.position === opB.position
  ) {
    return {
      type: "delete",
      position: opA.position,
      length: (opA.length || 0) + (opB.length || 0),
    };
  }

  // Insert followed by Delete at same position (cancellation)
  if (
    opA.type === "insert" &&
    opB.type === "delete" &&
    opA.position === opB.position &&
    opA.content?.length === opB.length
  ) {
    // Operations cancel out
    return {
      type: "retain",
      position: opA.position,
      length: 0,
    };
  }

  return null; // Cannot compose
}

/**
 * Validates an operation for correctness
 */
export function validateOperation(operation: Operation): boolean {
  if (
    !operation.type ||
    !["insert", "delete", "retain"].includes(operation.type)
  ) {
    return false;
  }

  if (typeof operation.position !== "number" || operation.position < 0) {
    return false;
  }

  switch (operation.type) {
    case "insert":
      return (
        typeof operation.content === "string" && operation.content.length > 0
      );
    case "delete":
    case "retain":
      return typeof operation.length === "number" && operation.length > 0;
    default:
      return false;
  }
}

/**
 * Generates a unique operation ID
 */
function generateOperationId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculates the priority of an operation for conflict resolution
 * Higher priority operations are applied first in case of conflicts
 */
export function getOperationPriority(operation: OperationWithMetadata): number {
  // Priority based on timestamp (earlier operations have higher priority)
  // In case of same timestamp, use author ID for deterministic ordering
  return operation.timestamp * 1000 + operation.authorId.charCodeAt(0);
}

/**
 * Checks if two operations conflict (affect the same text region)
 */
export function operationsConflict(opA: Operation, opB: Operation): boolean {
  const aStart = opA.position;
  const aEnd = opA.position + (opA.type === "insert" ? 0 : opA.length || 0);
  const bStart = opB.position;
  const bEnd = opB.position + (opB.type === "insert" ? 0 : opB.length || 0);

  // Check for overlap
  return !(aEnd <= bStart || bEnd <= aStart);
}

/**
 * Transforms an operation against a list of operations
 */
export function transformAgainstOperations(
  operation: Operation,
  operations: Operation[],
): Operation {
  let transformed = operation;
  for (const op of operations) {
    transformed = transformAgainst(transformed, op);
  }
  return transformed;
}

/**
 * Applies a list of operations to a document in sequence
 */
export function applyOperations(doc: string, operations: Operation[]): string {
  let result = doc;
  for (const op of operations) {
    result = applyToDoc(result, op);
  }
  return result;
}

/**
 * Inverts an operation (creates the opposite operation)
 */
export function invertOperation(operation: Operation, doc: string): Operation {
  switch (operation.type) {
    case "insert":
      return {
        type: "delete",
        position: operation.position,
        length: operation.content?.length || 0,
      };
    case "delete":
      const deletedContent = doc.slice(
        operation.position,
        operation.position + (operation.length || 0),
      );
      return {
        type: "insert",
        position: operation.position,
        content: deletedContent,
      };
    case "retain":
      return operation; // Retain operations are their own inverse
    default:
      throw new Error(
        `Cannot invert operation type: ${(operation as any).type}`,
      );
  }
}

/**
 * Normalizes operations by removing no-ops and combining adjacent operations
 */
export function normalizeOperations(operations: Operation[]): Operation[] {
  const normalized: Operation[] = [];

  for (const op of operations) {
    // Skip no-op operations
    if (
      (op.type === "insert" && (!op.content || op.content.length === 0)) ||
      ((op.type === "delete" || op.type === "retain") &&
        (!op.length || op.length === 0))
    ) {
      continue;
    }

    // Try to compose with the last operation
    if (normalized.length > 0) {
      const lastOp = normalized[normalized.length - 1];
      const composed = composeOperations(lastOp, op);
      if (composed) {
        normalized[normalized.length - 1] = composed;
        continue;
      }
    }

    normalized.push(op);
  }

  return normalized;
}

/**
 * Serializes an operation to a string for storage/transmission
 */
export function serializeOperation(operation: OperationWithMetadata): string {
  return JSON.stringify(operation);
}

/**
 * Deserializes an operation from a string
 */
export function deserializeOperation(
  serialized: string,
): OperationWithMetadata {
  const parsed = JSON.parse(serialized);
  if (!validateOperation(parsed)) {
    throw new Error("Invalid serialized operation");
  }
  return parsed as OperationWithMetadata;
}

/**
 * Creates a diff between two document states as operations
 */
export function createDiff(oldDoc: string, newDoc: string): Operation[] {
  // Simple diff algorithm - can be enhanced with more sophisticated algorithms
  const operations: Operation[] = [];

  let i = 0;
  let j = 0;

  while (i < oldDoc.length || j < newDoc.length) {
    if (i >= oldDoc.length) {
      // Remaining characters are insertions
      operations.push({
        type: "insert",
        position: i,
        content: newDoc.slice(j),
      });
      break;
    } else if (j >= newDoc.length) {
      // Remaining characters are deletions
      operations.push({
        type: "delete",
        position: i,
        length: oldDoc.length - i,
      });
      break;
    } else if (oldDoc[i] === newDoc[j]) {
      // Characters match, continue
      i++;
      j++;
    } else {
      // Find the next matching character
      let found = false;
      for (let k = j + 1; k < newDoc.length && k - j < 100; k++) {
        if (oldDoc[i] === newDoc[k]) {
          // Insert the characters between j and k
          operations.push({
            type: "insert",
            position: i,
            content: newDoc.slice(j, k),
          });
          j = k;
          found = true;
          break;
        }
      }

      if (!found) {
        for (let k = i + 1; k < oldDoc.length && k - i < 100; k++) {
          if (oldDoc[k] === newDoc[j]) {
            // Delete the characters between i and k
            operations.push({
              type: "delete",
              position: i,
              length: k - i,
            });
            i = k;
            found = true;
            break;
          }
        }
      }

      if (!found) {
        // Replace character
        operations.push({
          type: "delete",
          position: i,
          length: 1,
        });
        operations.push({
          type: "insert",
          position: i,
          content: newDoc[j],
        });
        i++;
        j++;
      }
    }
  }

  return normalizeOperations(operations);
}
