/**
 * Study policy for the post-call evidence experiment.
 *
 * Two instruments live here:
 *
 *  - Provenance: where each emitted action item came from. The production
 *    generator returns bare strings with no citations, so the study resolves
 *    each emission back to a transcript sentence or notes line. The theme
 *    under test: a quoted segment can still support the wrong conclusion,
 *    so every claim carries its source position for inspection.
 *
 *  - Conservative refusal: a study-side policy layered over the permissive
 *    baseline that refuses emissions without a resolvable, non-negated,
 *    non-hypothetical, current source. It demonstrates that refusal is
 *    feasible without touching production code. It is an interpretive
 *    instrument, not a production proposal — it shares the same brittle
 *    pattern-matching risks it measures.
 */
import type { StudySegment, StudyNotes } from "./adapter";

// ---------------------------------------------------------------------------
// Text normalization and matching
// ---------------------------------------------------------------------------

/** Checklist / speaker decorations stripped before comparing strings. */
export function normalizeText(input: string): string {
  let text = input.trim().toLowerCase();
  text = text.replace(/^[-*]\s*\[\s*[x ]?\s*\]\s*/, ""); // checklist marker
  text = text.replace(/^(action|todo|follow-up|followup):\s*/i, "");
  // strip a leading speaker prefix ("alice: ...") when the colon appears
  // before any space, so a short name/word precedes the claim itself
  const colon = text.indexOf(":");
  if (colon > 0 && colon < 30 && !text.slice(0, colon).includes(" ")) {
    text = text.slice(colon + 1).trim();
  }
  text = text.replace(/[.!?]+$/, "");
  text = text.replace(/\s+/g, " ");
  return text;
}

/**
 * True when either normalized string contains the other. Labels are written
 * slightly shorter than emissions; containment is the tolerant join.
 */
export function textsReferToSameClaim(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ---------------------------------------------------------------------------
// Provenance: resolve an emitted item to its source position
// ---------------------------------------------------------------------------

export type SourceKind = "transcript" | "notes" | "fabricated";

export interface SourcePosition {
  sourceKind: SourceKind;
  /** For transcript: segment index. For notes: line index (0-based). */
  segmentIndex?: number;
  sentenceIndex?: number;
  charStart?: number;
  charEnd?: number;
  quote: string;
  /** ms window for transcript sources */
  startMs?: number;
  endMs?: number;
}

export interface SentenceHit {
  sentence: string;
  sentenceIndex: number;
  charStart: number;
  charEnd: number;
}

/** Split a segment into sentences, preserving offsets (mirrors the
 * production generator's own `[.!?]+` split, but tracked). */
export function segmentSentences(text: string): SentenceHit[] {
  const hits: SentenceHit[] = [];
  const re = /[^.!?]+[.!?]*/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    if (raw.trim().length > 0) {
      hits.push({
        sentence: raw.trim(),
        sentenceIndex: index++,
        charStart: match.index + raw.indexOf(raw.trim()[0]),
        charEnd: match.index + raw.length,
      });
    }
  }
  return hits;
}

export interface MeetingSourceContext {
  segments: StudySegment[];
  notes: { version: number; content: string | null } | null;
}

/** Resolve one emitted action item to its most plausible source position. */
export function resolveProvenance(
  emitted: string,
  context: MeetingSourceContext,
): SourcePosition {
  const target = normalizeText(emitted);

  for (let s = 0; s < context.segments.length; s++) {
    const segment = context.segments[s];
    for (const hit of segmentSentences(segment.text)) {
      if (textsReferToSameClaim(target, hit.sentence)) {
        return {
          sourceKind: "transcript",
          segmentIndex: s,
          sentenceIndex: hit.sentenceIndex,
          charStart: hit.charStart,
          charEnd: hit.charEnd,
          quote: hit.sentence,
          startMs: segment.startMs,
          endMs: segment.endMs,
        };
      }
    }
  }

  if (context.notes?.content) {
    const lines = context.notes.content.split("\n");
    for (let l = 0; l < lines.length; l++) {
      const line = lines[l];
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (textsReferToSameClaim(target, trimmed)) {
        return {
          sourceKind: "notes",
          segmentIndex: l,
          quote: trimmed,
        };
      }
    }
  }

  return { sourceKind: "fabricated", quote: emitted };
}

// ---------------------------------------------------------------------------
// Conservative refusal policy (study-side, provisional)
// ---------------------------------------------------------------------------

export type RefusalReason =
  | "no-source"
  | "negation"
  | "question"
  | "hypothetical"
  | "stale-plan";

export type ConservativeVerdict =
  | { verdict: "kept" }
  | { verdict: "refused"; reason: RefusalReason };

const NEGATION =
  /\b(not|no longer|won't|don't|doesn't|didn't|can't|cannot|never|neither|nor)\b/i;
const QUESTION_START = /^(should|would|could|do|does|did|can|is|are|shall)\b/i;
const HYPOTHETICAL =
  /^(if\b.*\b(should|would|could|might)\b|\b(we would|we could|we might|maybe|perhaps|in theory)\b)/i;
const STALE_PLAN =
  /\b(earlier we|we agreed|we said|we planned|the plan was|previously agreed)\b/i;

/** Sentence-level evidence detectors used by the refusal policy. */
export function detectEvidence(sentence: string): {
  negation: boolean;
  question: boolean;
  hypothetical: boolean;
  stalePlan: boolean;
} {
  return {
    negation: NEGATION.test(sentence),
    question:
      sentence.trim().endsWith("?") ||
      (QUESTION_START.test(sentence.trim()) && !/\b(i|we)\s+(will|should)\b/i.test(sentence)),
    hypothetical: HYPOTHETICAL.test(sentence.trim()),
    stalePlan: STALE_PLAN.test(sentence),
  };
}

/**
 * Decide whether a permissive emission survives conservative refusal.
 * Order matters: fabricated sources are refused first, then sentence-level
 * evidence problems at the resolved position. Detectors run on the
 * normalized quote so speaker prefixes ("Bob: ...") cannot hide evidence.
 */
export function conservativeVerdict(
  emitted: string,
  position: SourcePosition,
): ConservativeVerdict {
  if (position.sourceKind === "fabricated") {
    return { verdict: "refused", reason: "no-source" };
  }
  const evidence = detectEvidence(normalizeText(position.quote));
  if (evidence.negation) return { verdict: "refused", reason: "negation" };
  if (evidence.stalePlan) return { verdict: "refused", reason: "stale-plan" };
  if (evidence.question) return { verdict: "refused", reason: "question" };
  if (evidence.hypothetical) {
    return { verdict: "refused", reason: "hypothetical" };
  }
  return { verdict: "kept" };
}

// ---------------------------------------------------------------------------
// Label classification (frozen fixture labels are the reference standard)
// ---------------------------------------------------------------------------

export type ClaimLabel = "supported" | "unsupported";

export interface LabeledTrigger {
  text: string;
  kind: "negation" | "correction" | "hypothetical" | "question" | "stale";
  note?: string;
}

export interface ClaimClassification {
  label: ClaimLabel;
  /** Frozen trigger kind when unsupported; undefined for supported. */
  unsupportedKind?: LabeledTrigger["kind"];
}

export function classifyAgainstLabels(
  emitted: string,
  labels: {
    supportedActionItems: Array<{ text: string }>;
    unsupportedTriggers: Array<LabeledTrigger>;
  },
): ClaimClassification {
  for (const trigger of labels.unsupportedTriggers) {
    if (textsReferToSameClaim(emitted, trigger.text)) {
      return { label: "unsupported", unsupportedKind: trigger.kind };
    }
  }
  for (const supported of labels.supportedActionItems) {
    if (textsReferToSameClaim(emitted, supported.text)) {
      return { label: "supported" };
    }
  }
  // Emitted but matching no label: fabricated fallback output or drift
  // between generator and fixtures. Count as unsupported — an emission the
  // frozen label set does not endorse.
  return { label: "unsupported", unsupportedKind: undefined };
}

/** Supported labels never covered by any emission (permissive recall misses). */
export function findMissedSupported(
  emittedUnique: string[],
  labels: { supportedActionItems: Array<{ text: string }> },
): Array<{ text: string }> {
  return labels.supportedActionItems.filter(
    (supported) =>
      !emittedUnique.some((emitted) =>
        textsReferToSameClaim(emitted, supported.text),
      ),
  );
}
