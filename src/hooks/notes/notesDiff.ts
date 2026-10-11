/**
 * Sibling-operation diff (docs/notes-ledger-f1/design.md §3).
 *
 * A replacement is NEVER expressed as one compound "replace" op: it is a
 * delete + insert SIBLING PAIR computed from ONE base coordinate system.
 * Both ops are positioned against the same `base` text, so the server can
 * transform them independently against concurrent history — the failure in
 * the #24 defect report where equal-length replacements were silently
 * dropped as "no-ops" came from length-comparing diffs.
 */

import type { NotesOperation } from "./types";

/**
 * Diff `base` into `next` as sibling operations from one coordinate system.
 * Returns [] when the texts are identical (including when a caller diffs
 * the same text twice — never a spurious no-op batch).
 *
 * The scan works in CODE POINTS (never UTF-16 code units) so a replacement
 * of one astral character — an emoji, for instance — can never be split into
 * lone surrogates: positions and lengths are converted back to UTF-16
 * offsets only at the boundary, which is what the server and transports
 * speak.
 */
export function diffToSiblingOps(base: string, next: string): NotesOperation[] {
  if (base === next) return [];

  const basePoints = Array.from(base);
  const nextPoints = Array.from(next);
  const min = Math.min(basePoints.length, nextPoints.length);

  let prefixPoints = 0;
  while (
    prefixPoints < min &&
    basePoints[prefixPoints] === nextPoints[prefixPoints]
  ) {
    prefixPoints += 1;
  }

  let suffixPoints = 0;
  while (
    suffixPoints < min - prefixPoints &&
    basePoints[basePoints.length - 1 - suffixPoints] ===
      nextPoints[nextPoints.length - 1 - suffixPoints]
  ) {
    suffixPoints += 1;
  }

  // Convert the code-point boundaries to UTF-16 offsets once, here.
  const position = basePoints.slice(0, prefixPoints).join("").length;
  const removed = basePoints
    .slice(prefixPoints, basePoints.length - suffixPoints)
    .join("");
  const inserted = nextPoints
    .slice(prefixPoints, nextPoints.length - suffixPoints)
    .join("");

  const ops: NotesOperation[] = [];
  if (removed.length > 0) {
    ops.push({ type: "delete", position, length: removed.length });
  }
  if (inserted.length > 0) {
    ops.push({ type: "insert", position, content: inserted });
  }
  return ops;
}

/** Apply a single operation to a document string. Position arithmetic is
 * expressed in the coordinate system BEFORE the op runs (delete first). */
export function applyToDoc(doc: string, op: NotesOperation): string {
  if (op.type === "insert") {
    if (op.position < 0 || op.position > doc.length) {
      throw new Error(
        `Invalid insert position: ${op.position} (document length ${doc.length})`,
      );
    }
    return doc.slice(0, op.position) + op.content + doc.slice(op.position);
  }
  const count = op.length ?? 0;
  const end = op.position + count;
  if (op.position < 0 || end > doc.length) {
    throw new Error(
      `Invalid delete range: ${op.position}..${end} (document length ${doc.length})`,
    );
  }
  return doc.slice(0, op.position) + doc.slice(end);
}

/** Apply operations in order, replaying the sibling sequence. */
export function applyOperations(doc: string, ops: NotesOperation[]): string {
  return ops.reduce((acc, op) => applyToDoc(acc, op), doc);
}
