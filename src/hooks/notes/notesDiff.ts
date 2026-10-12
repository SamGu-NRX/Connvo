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

/**
 * Apply a BATCH of sibling ops the way the server does: each op is
 * transformed against the stored transformed forms of the earlier ops in
 * the batch (they share one clientSequence frame), then applied. The
 * ledger's composed-view mirror and the composition checks use this —
 * a raw sequential apply would double-shift later hunks, the mirror image
 * of the emission bug this pairs with.
 */
export function applyBatchOps(doc: string, ops: NotesOperation[]): string {
  const applied: NotesOperation[] = [];
  for (const op of ops) {
    let live = op;
    for (const prior of applied) {
      live = transformAgainst(live, prior);
    }
    applied.push(live);
    doc = applyToDoc(doc, live);
  }
  return doc;
}

/**
 * One OT diamond step: carry `op` (clientSequence frame) across `prior`
 * (already applied, an earlier op of the same batch). Same conventions as
 * the hunk transform above: a remote insert strictly before — or
 * lexicographically first at a pure-insert collision — shifts the local
 * coordinates; deletes clip overlapping ranges.
 */
function transformAgainst(
  op: NotesOperation,
  prior: NotesOperation,
): NotesOperation {
  if (op.type === "insert") {
    const p = op.position;
    if (prior.type === "insert") {
      const q = prior.position;
      const len = (prior.content ?? "").length;
      // Same tie-break as the hunk transform: at an equal position the
      // lexicographically first content stays put, the other shifts.
      const shifts =
        p > q ||
        (p === q && (op.content ?? "") >= (prior.content ?? "") && len > 0);
      if (shifts) {
        return { ...op, position: p + len };
      }
      return op;
    }
    // prior is a delete [q, q+len): before it, inside it, or after it.
    const q = prior.position;
    const len = prior.length ?? 0;
    if (p <= q) return op;
    if (p >= q + len) return { ...op, position: p - len };
    // Inside the deleted range: the server preserves concurrently
    // inserted content (zero-length retain), so the insert clamps to the
    // range's start.
    return { ...op, position: q };
  }
  // op is a delete [p, p+len).
  const p = op.position;
  const len = op.length ?? 0;
  if (prior.type === "insert") {
    const q = prior.position;
    const ilen = (prior.content ?? "").length;
    if (q <= p) {
      return { ...op, position: p + ilen };
    }
    if (q >= p + len) return op;
    // Concurrent insert inside the deleted range: the server keeps it
    // (zero-length retain), so the delete must skip it — unrepresentable
    // as one simple op. Hunks are disjoint, so one decomposition can
    // never produce this; keep the range and let the reference suite
    // flag a caller bug.
    return op;
  }
  // Both deletes: clip the overlap out of the live range.
  const q = prior.position;
  const qlen = prior.length ?? 0;
  const qEnd = q + qlen;
  const pEnd = p + len;
  if (qEnd <= p) return { ...op, position: p - qlen };
  if (q >= pEnd) return op;
  const overlap = Math.min(pEnd, qEnd) - Math.max(p, q);
  const shift = Math.max(0, Math.min(qlen, p - q));
  return { ...op, position: p - shift, length: len - overlap };
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
  const nonEmpty = hunks.filter(
    (h) => h.removed.length > 0 || h.inserted.length > 0,
  );
  // Heal the walk's greedy splits: a kept run of at most one character
  // between two changed regions is almost always a coincidental letter
  // match inside ONE intended replacement ("world" -> "there" keeps the
  // 'r'), and splitting there leaves sibling ops whose record content no
  // longer names the edited word. A merged hunk composes identically and
  // keeps the replacement as one delete+insert pair. Bridges of two or
  // more kept characters are genuinely separate regions and stay split
  // (the S2 remote shape: two inserts around the whole of "ab").
  const merged: DiffHunk[] = [];
  for (const hunk of nonEmpty) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const bridgeStart = prev.position + prev.removed.length;
      const bridge = hunk.position - bridgeStart;
      if (bridge <= 1) {
        const gap = a.slice(bridgeStart, hunk.position).join("");
        prev.removed += gap + hunk.removed;
        prev.inserted += gap + hunk.inserted;
        continue;
      }
    }
    merged.push(hunk);
  }
  return merged;
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
  // ascending order at their clientSequence-frame positions. The positions
  // stay RAW (no folding of the batch's own deltas into later hunks): the
  // server transforms each incoming op against the stored transformed forms
  // of the SAME batch's earlier ops, so a pre-folded position would be
  // shifted twice (observed in the LightServer trace: delete(11) -> 10).
  const ordered = [...live]
    .map((h, idx) => ({ h, idx }))
    .sort((x, y) => x.h.start - y.h.start || x.idx - y.idx);
  const ops: NotesOperation[] = [];
  for (const { h } of ordered) {
    const rangeLen = h.end - h.start;
    if (rangeLen > 0) {
      ops.push({ type: "delete", position: h.start, length: rangeLen });
    }
    if (h.inserted !== "") {
      ops.push({ type: "insert", position: h.start, content: h.inserted });
    }
  }
  return ops;
}
