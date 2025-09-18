/**
 * Operational Transform (OT) Infrastructure for Collaborative Notes
 *
 * This module implements a comprehensive operational transform system for
 * real-time collaborative text editing with conflict resolution.
 *
 * Requirements: 8.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns and centralized types
 */

import { v } from "convex/values";
import type { Id } from "@convex/_generated/dataModel";
import type {
  Operation,
  OperationWithMetadata,
  OperationType,
} from "@convex/types/entities/note";
import { NoteV } from "@convex/types/validators/note";

// Re-export types from centralized location for backward compatibility
export type {
  Operation,
  OperationWithMetadata,
  OperationType,
} from "@convex/types/entities/note";

/**
 * Validator for Operation objects (use centralized validator)
 */
export const operationValidator = NoteV.operation;

/**
 * Validator for OperationWithMetadata (use centralized validator)
 */
export const operationWithMetadataValidator = NoteV.operationWithMetadata;

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
  authorId: Id<"users">,
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
  authorId: Id<"users">,
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
  authorId: Id<"users">,
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
      // If length is 0, it's a no-op
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
    if (opB.position < opA.position) {
      return {
        ...opA,
        position: opA.position + (opB.content?.length || 0),
      };
    } else if (opB.position === opA.position) {
      // When positions are equal, use lexicographic ordering of content for tie-breaking
      // The operation with lexicographically smaller content has priority
      if ((opB.content || "") < (opA.content || "")) {
        return {
          ...opA,
          position: opA.position + (opB.content?.length || 0),
        };
      } else {
        return opA; // A has priority, no change needed
      }
    } else {
      return opA; // A comes before B, no change needed
    }
  }

  // Insert vs Delete
  if (opA.type === "insert" && opB.type === "delete") {
    if (opA.position <= opB.position) {
      return opA; // A comes before B's deletion range
    } else if (opA.position >= opB.position + (opB.length || 0)) {
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
      // Overlapping deletions - calculate what A should delete after B is applied
      const overlapStart = Math.max(opA.position, opB.position);
      const overlapEnd = Math.min(aEnd, bEnd);
      const overlapLength = overlapEnd - overlapStart;

      if (opA.position < opB.position) {
        // A starts before B
        if (aEnd <= bEnd) {
          // A ends before or at the same place as B
          // A should delete everything before B starts, plus any part after B that A originally covered
          const beforeB = opB.position - opA.position;
          const afterB = Math.max(0, aEnd - bEnd);
          const newLength = beforeB + afterB;

          return {
            ...opA,
            length: newLength,
          };
        } else {
          // A extends beyond B
          // A should delete everything before B starts, plus everything after B ends
          const beforeB = opB.position - opA.position;
          const afterB = aEnd - bEnd;
          const newLength = beforeB + afterB;

          return {
            ...opA,
            length: newLength,
          };
        }
      } else if (opA.position === opB.position) {
        // A and B start at the same position
        if (aEnd <= bEnd) {
          // A is completely contained within B
          return {
            type: "retain",
            position: opA.position,
            length: 0,
          };
        } else {
          // A extends beyond B
          const newLength = aEnd - bEnd;
          return {
            ...opA,
            position: bEnd,
            length: newLength,
          };
        }
      } else {
        // A starts after B starts
        if (aEnd <= bEnd) {
          // A is completely contained within B
          return {
            type: "retain",
            position: opA.position,
            length: 0,
          };
        } else {
          // A extends beyond B
          const newLength = aEnd - bEnd;
          return {
            ...opA,
            position: opB.position,
            length: newLength,
          };
        }
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
      if (opB.position >= opA.position + (opA.length || 0)) {
        // Delete is after the retain range
        return opA;
      } else if (opB.position + (opB.length || 0) <= opA.position) {
        // Delete is completely before the retain position
        return {
          ...opA,
          position: opA.position - (opB.length || 0),
        };
      } else if (
        opB.position <= opA.position &&
        opB.position + (opB.length || 0) > opA.position
      ) {
        // Retain position falls within the delete range
        return {
          ...opA,
          position: opB.position,
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
      return typeof operation.length === "number" && operation.length > 0;
    case "retain":
      return typeof operation.length === "number" && operation.length >= 0;
    default:
      return false;
  }
}

/**
 * Generates a unique operation ID
 */
function generateOperationId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Calculates the priority of an operation for conflict resolution
 * Higher priority operations are applied first in case of conflicts
 */
export function getOperationPriority(operation: OperationWithMetadata): number {
  // Priority based on timestamp (earlier operations have higher priority)
  // In case of same timestamp, use author ID for deterministic ordering
  // Use a hash of the entire authorId for better distribution
  const authorHash =
    operation.authorId.split("").reduce((hash, char) => {
      return (hash << 5) - hash + char.charCodeAt(0);
    }, 0) & 0x7fffffff; // Ensure positive number
  return operation.timestamp * 1000000 + (authorHash % 1000000);
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
 * Transforms a list of operations to maintain consistency when applied in different orders
 * This is crucial for maintaining convergence in concurrent editing scenarios
 */
export function transformOperationSequence(
  operations: Operation[],
  againstOperations: Operation[],
): Operation[] {
  const transformed: Operation[] = [];

  for (let i = 0; i < operations.length; i++) {
    let op = operations[i];

    // Transform against all operations in the against sequence
    for (const againstOp of againstOperations) {
      op = transformAgainst(op, againstOp);
    }

    transformed.push(op);
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
  // Validate metadata fields
  if (!parsed.id || typeof parsed.id !== "string") {
    throw new Error("Missing or invalid id in serialized operation");
  }
  if (!parsed.authorId || typeof parsed.authorId !== "string") {
    throw new Error("Missing or invalid authorId in serialized operation");
  }
  if (typeof parsed.timestamp !== "number") {
    throw new Error("Missing or invalid timestamp in serialized operation");
  }
  if (typeof parsed.sequence !== "number") {
    throw new Error("Missing or invalid sequence in serialized operation");
  }
  return parsed as OperationWithMetadata;
}

/**
 * Applies operations in a specific order while maintaining consistency
 * This ensures convergence regardless of the order operations are applied
 */
export function applyOperationsWithTransformation(
  doc: string,
  operations: Operation[],
  referenceOperations?: Operation[],
): string {
  if (!referenceOperations || referenceOperations.length === 0) {
    return applyOperations(doc, operations);
  }

  // Transform each operation against all reference operations
  const transformedOps: Operation[] = [];

  for (let i = 0; i < operations.length; i++) {
    let op = operations[i];

    // Transform against reference operations
    for (const refOp of referenceOperations) {
      op = transformAgainst(op, refOp);
    }

    // Transform against previously transformed operations in this sequence
    for (const prevOp of transformedOps) {
      op = transformAgainst(op, prevOp);
    }

    transformedOps.push(op);
  }

  return applyOperations(doc, transformedOps);
}

/**
 * Ensures operational transform convergence by properly ordering and transforming operations
 */
export function ensureConvergence(
  doc: string,
  operationsA: Operation[],
  operationsB: Operation[],
): [string, string] {
  // Apply A then transform and apply B
  const docAfterA = applyOperations(doc, operationsA);
  const transformedB = transformOperationSequence(operationsB, operationsA);
  const result1 = applyOperations(docAfterA, transformedB);

  // Apply B then transform and apply A
  const docAfterB = applyOperations(doc, operationsB);
  const transformedA = transformOperationSequence(operationsA, operationsB);
  const result2 = applyOperations(docAfterB, transformedA);

  return [result1, result2];
}

/**
 * Creates a diff between two document states as operations
 */
export function createDiff(oldDoc: string, newDoc: string): Operation[] {
  // Improved diff algorithm with correct position calculations
  const operations: Operation[] = [];

  let i = 0; // Position in oldDoc
  let j = 0; // Position in newDoc

  while (i < oldDoc.length || j < newDoc.length) {
    if (i >= oldDoc.length) {
      // Remaining characters in newDoc are insertions
      operations.push({
        type: "insert",
        position: i,
        content: newDoc.slice(j),
      });
      break;
    } else if (j >= newDoc.length) {
      // Remaining characters in oldDoc are deletions
      operations.push({
        type: "delete",
        position: i,
        length: oldDoc.length - i,
      });
      break;
    } else if (oldDoc[i] === newDoc[j]) {
      // Characters match, advance both pointers
      i++;
      j++;
    } else {
      // Characters differ - determine if it's an insertion, deletion, or replacement
      let insertionFound = false;
      let deletionFound = false;
      let insertionLength = 0;
      let deletionLength = 0;

      // Look ahead to find if this is an insertion
      for (let k = j + 1; k < newDoc.length && k - j <= 50; k++) {
        if (oldDoc[i] === newDoc[k]) {
          // Found matching character - this suggests an insertion
          insertionFound = true;
          insertionLength = k - j;
          break;
        }
      }

      // Look ahead to find if this is a deletion
      for (let k = i + 1; k < oldDoc.length && k - i <= 50; k++) {
        if (oldDoc[k] === newDoc[j]) {
          // Found matching character - this suggests a deletion
          deletionFound = true;
          deletionLength = k - i;
          break;
        }
      }

      if (
        insertionFound &&
        (!deletionFound || insertionLength <= deletionLength)
      ) {
        // Prefer insertion if both are found and insertion is shorter or equal
        operations.push({
          type: "insert",
          position: i,
          content: newDoc.slice(j, j + insertionLength),
        });
        j += insertionLength;
      } else if (deletionFound) {
        // Handle deletion
        operations.push({
          type: "delete",
          position: i,
          length: deletionLength,
        });
        i += deletionLength;
      } else {
        // No clear pattern found - treat as replacement (delete + insert)
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
