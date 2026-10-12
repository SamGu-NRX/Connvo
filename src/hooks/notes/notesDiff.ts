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

// ---------------------------------------------------------------------------
// Multi-hunk sibling diff + composite hunk transform (r2 W1/W3)
// ---------------------------------------------------------------------------

/** One changed region, in UTF-16 coordinates of the base text. */
export interface DiffHunk {
  /** Start of the changed region in `base`. */
  position: number;
  /** Text removed from `base` at `position`. */
  removed: string;
  /** Text inserted in its place. */
  inserted: string;
}

/** Either side longer than this falls back to the single-region diff. */
const MAX_DIFF_POINTS = 512;

/**
 * Diff `base` into `next` as ALL changed regions (a bounded LCS over code
 * points). Unlike a prefix/suffix collapse, an edit that touches two
 * separated regions produces two hunks, and a same-length replacement
 * produces exactly one contiguous hunk - which then transforms as ONE unit
 * (see transformHunksToSiblingOps), so a concurrent remote insert can never
 * slide between a deletion and its sibling insertion.
 */
export function diffToHunks(base: string, next: string): DiffHunk[] {
  if (base === next) return [];
  const a = Array.from(base);
  const b = Array.from(next);
  if (a.length > MAX_DIFF_POINTS || b.length > MAX_DIFF_POINTS) {
    // Unbounded inputs: fall back to one collapsed region (still correct,
    // just less granular).
    const single = diffToSiblingOps(base, next);
    if (single.length === 0) return [];
    const del = single.find((op) => op.type === "delete");
    const ins = single.find((op) => op.type === "insert");
    return [
      {
        position: (ins ?? del)!.position,
        removed: del ? base.slice(del.position, del.position + (del.length ?? 0)) : "",
        inserted: ins?.content ?? "",
      },
    ];
  }
  // LCS dynamic program over code points.
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  // Walk the optimal path, but take only LCS-preserving steps: skip `a[i]`
  // when that loses nothing (lcs[i+1][j] === lcs[i][j]) and prefer it, so a
  // changed region stays CONTIGUOUS — the walk drains the delete side
  // before seeking matches on the other side. A naive greedy seek instead
  // fragments one replacement into delete/insert islands and lets a
  // concurrent remote insert slip between the islands (the S2 shape).
  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  const utf16Of = (points: string[], from: number, to: number) =>
    points.slice(from, to).join("").length;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    // One changed region: consume until both walks re-converge on a match.
    const position = utf16Of(a, 0, i);
    let removed = "";
    let inserted = "";
    while (
      (i < m || j < n) &&
      !(i < m && j < n && a[i] === b[j])
    ) {
      if (i < m && lcs[i + 1]![j] === lcs[i]![j]) {
        removed += a[i]!;
        i += 1;
      } else {
        // Skipping a[i] would lose a match, so skipping b[j] is the free
        // step (lcs[i][j] is the max of the two neighbors).
        inserted += b[j]!;
        j += 1;
      }
    }
    hunks.push({ position, removed, inserted });
  }
  return hunks.filter((h) => h.removed.length > 0 || h.inserted.length > 0);
}

/**
 * Transform whole hunks against the remote sibling operations and
 * decompose into sibling ops (delete before insert per hunk, server
 * contract).
 *
 * `remoteOps` are expressed in the coordinate system the hunks were diffed
 * from (the shared basis). Each hunk moves as ONE unit: a remote insert at
 * or inside a replacement's deleted range is ABSORBED (the replacement's
 * text stays inside that range and the remote text follows it), never
 * slid between the hunk's delete and insert siblings. For pure-insert
 * hunks (empty range) colliding with a remote insert at the same point,
 * the tie is broken lexicographically by content - the same convention as
 * the shared transform the server runs.
 */
export function transformHunksToSiblingOps(
  hunks: DiffHunk[],
  remoteOps: NotesOperation[],
): NotesOperation[] {
  type Live = { start: number; end: number; inserted: string };
  const live: Live[] = hunks.map((h) => ({
    start: h.position,
    end: h.position + h.removed.length,
    inserted: h.inserted,
  }));
  for (const op of remoteOps) {
    if (op.type === "insert") {
      const p = op.position;
      const len = (op.content ?? "").length;
      for (const h of live) {
        if (p < h.start || (p === h.start && h.start === h.end && (op.content ?? "") < h.inserted && h.inserted !== "")) {
          // Remote insert strictly before the hunk (or lexicographically
          // first at a pure-insert collision): shift everything.
          h.start += len;
          h.end += len;
        } else if (p > h.end) {
          // Remote insert after the hunk: the local edit stays before it.
        } else if (h.start === h.end) {
          // Pure-insert collision, remote content sorts after (or equal):
          // local insert stays at its position, remote follows.
        } else {
          // Remote insert inside a replacement's deleted range: absorbed.
        }
      }
    } else {
      const p = op.position;
      const len = op.length ?? 0;
      const pEnd = p + len;
      for (const h of live) {
        if (pEnd <= h.start) {
          // Remote delete entirely before the hunk: shift left.
          h.start -= len;
          h.end -= len;
        } else if (p >= h.end) {
          // Remote delete after the hunk: untouched.
        } else {
          // Overlap: the remote delete consumes the intersecting part of
          // the hunk's range (absorb). Clip the hunk's range to what
          // survives, keeping its text anchored at the surviving start.
          const overlapStart = Math.max(p, h.start);
          const overlapEnd = Math.min(pEnd, h.end);
          const removedHere = overlapEnd - overlapStart;
          if (removedHere > 0) {
            h.end -= removedHere;
            if (h.start >= p) h.start = Math.max(p, h.start - removedHere);
          }
        }
      }
    }
  }
  // Decompose in transformed coordinates. Hunks are disjoint; emit them in
  // ascending transformed order, folding each hunk's net length change
  // into the positions of later hunks (sibling ops apply sequentially).
  const ordered = [...live]
    .map((h, idx) => ({ h, idx }))
    .sort((x, y) => x.h.start - y.h.start || x.idx - y.idx);
  const ops: NotesOperation[] = [];
  let delta = 0;
  for (const { h } of ordered) {
    const start = h.start + delta;
    const rangeLen = h.end - h.start;
    if (rangeLen > 0) {
      ops.push({ type: "delete", position: start, length: rangeLen });
    }
    if (h.inserted !== "") {
      ops.push({ type: "insert", position: start, content: h.inserted });
    }
    delta += h.inserted.length - rangeLen;
  }
  return ops;
}
