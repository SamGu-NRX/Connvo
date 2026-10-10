/**
 * Independent reader for exported preparation documents.
 *
 * Deliberately shares NO code with export.ts or workspace.ts: it validates
 * the serialized shape with its own checks and its own copies of the
 * vocabulary lists, so it never trusts the writer. The tests cross-check
 * that the reader's copies agree with contract.ts (drift guard in both
 * directions).
 *
 * Privacy rules enforced here:
 * - any object key named age / gender / linkedinUrl anywhere in the
 *   document (forbidden-key), including nested notes and participants;
 * - any unexpected key (unknown-key), so private data cannot ride along
 *   under a different name at the validated levels;
 * - the canonical disclaimer must be present verbatim.
 */

export const READER_SOURCE_TYPES = [
  "self-profile",
  "peer-public-profile",
  "shared-meeting-context",
  "participant-note",
] as const;

export const READER_AGENDA_STATUSES = ["proposed", "agreed", "set-aside"] as const;

export const READER_OPEN_QUESTION_STATUSES = ["open", "parked"] as const;

/** Sensitive keys that must never appear anywhere in an exported document. */
export const READER_FORBIDDEN_KEYS = ["age", "gender", "linkedinUrl"] as const;

export const READER_ERROR_CODES = [
  "not-json",
  "bad-kind",
  "bad-version",
  "bad-disclaimer",
  "bad-meeting",
  "bad-participants",
  "bad-agenda",
  "bad-notes",
  "bad-open-questions",
  "unknown-key",
  "forbidden-key",
] as const;
export type ReaderErrorCode = (typeof READER_ERROR_CODES)[number];

export const READER_EXPECTED_DISCLAIMER =
  "Agenda topics marked as proposals are suggestions only. " +
  "Agreement is recorded only when each participant explicitly agrees. " +
  "This document records no consent and promises no outcome.";

export type ReadResult =
  | { ok: true; document: Record<string, unknown> }
  | { ok: false; code: ReaderErrorCode; detail?: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively collects forbidden key paths (object keys only, not text). */
export function forbiddenKeyScan(value: unknown, prefix = ""): string[] {
  const hits: string[] = [];
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if ((READER_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
        hits.push(path);
      }
      hits.push(...forbiddenKeyScan(child, path));
    }
  } else if (Array.isArray(value)) {
    value.forEach((child, index) => {
      hits.push(...forbiddenKeyScan(child, `${prefix}[${index}]`));
    });
  }
  return hits;
}

function keyViolations(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): ReadResult | null {
  for (const key of Object.keys(obj)) {
    if (allowed.has(key)) continue;
    if ((READER_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      return { ok: false, code: "forbidden-key", detail: key };
    }
    return { ok: false, code: "unknown-key", detail: key };
  }
  return null;
}

const PARTICIPANT_KEYS = new Set(["displayName", "role", "visibilityBasis"]);
const AGENDA_KEYS = new Set(["title", "status", "label", "notes"]);
const NOTE_KEYS = new Set(["text", "sourceType"]);
const QUESTION_KEYS = new Set(["text", "status"]);

export function readPreparationDocument(raw: string): ReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: "not-json" };
  }
  if (!isPlainObject(parsed)) return { ok: false, code: "not-json" };

  if (parsed["kind"] !== "connvo-meeting-preparation") {
    return { ok: false, code: "bad-kind" };
  }
  if (parsed["version"] !== 1) {
    return { ok: false, code: "bad-version" };
  }
  if (parsed["disclaimer"] !== READER_EXPECTED_DISCLAIMER) {
    return { ok: false, code: "bad-disclaimer" };
  }

  const allowedTop = new Set([
    "kind",
    "version",
    "generatedAt",
    "disclaimer",
    "meeting",
    "participants",
    "agenda",
    "openQuestions",
    "counts",
  ]);
  for (const key of Object.keys(parsed)) {
    if (!allowedTop.has(key)) return { ok: false, code: "unknown-key", detail: key };
  }

  const meeting = parsed["meeting"];
  if (
    !isPlainObject(meeting) ||
    typeof meeting["title"] !== "string" ||
    typeof meeting["state"] !== "string" ||
    typeof meeting["scheduledAt"] !== "number"
  ) {
    return { ok: false, code: "bad-meeting" };
  }

  const participants = parsed["participants"];
  if (!Array.isArray(participants)) return { ok: false, code: "bad-participants" };
  for (const participant of participants) {
    if (
      !isPlainObject(participant) ||
      typeof participant["displayName"] !== "string" ||
      typeof participant["role"] !== "string" ||
      typeof participant["visibilityBasis"] !== "string"
    ) {
      return { ok: false, code: "bad-participants" };
    }
    const violation = keyViolations(participant, PARTICIPANT_KEYS);
    if (violation) return violation;
  }

  const agenda = parsed["agenda"];
  if (!Array.isArray(agenda)) return { ok: false, code: "bad-agenda" };
  for (const item of agenda) {
    if (!isPlainObject(item) || typeof item["title"] !== "string" || typeof item["label"] !== "string") {
      return { ok: false, code: "bad-agenda" };
    }
    if (!(READER_AGENDA_STATUSES as readonly string[]).includes(item["status"] as string)) {
      return { ok: false, code: "bad-agenda" };
    }
    const violation = keyViolations(item, AGENDA_KEYS);
    if (violation) return violation;
    const notes = item["notes"];
    if (!Array.isArray(notes)) return { ok: false, code: "bad-notes" };
    for (const note of notes) {
      if (!isPlainObject(note) || typeof note["text"] !== "string") {
        return { ok: false, code: "bad-notes" };
      }
      if (!(READER_SOURCE_TYPES as readonly string[]).includes(note["sourceType"] as string)) {
        return { ok: false, code: "bad-notes" };
      }
      const noteViolation = keyViolations(note, NOTE_KEYS);
      if (noteViolation) return noteViolation;
    }
  }

  const questions = parsed["openQuestions"];
  if (!Array.isArray(questions)) return { ok: false, code: "bad-open-questions" };
  for (const question of questions) {
    if (!isPlainObject(question) || typeof question["text"] !== "string") {
      return { ok: false, code: "bad-open-questions" };
    }
    if (!(READER_OPEN_QUESTION_STATUSES as readonly string[]).includes(question["status"] as string)) {
      return { ok: false, code: "bad-open-questions" };
    }
    const violation = keyViolations(question, QUESTION_KEYS);
    if (violation) return violation;
  }

  // Defense in depth: sweep the whole parsed document for forbidden keys.
  const leaks = forbiddenKeyScan(parsed);
  if (leaks.length > 0) {
    return { ok: false, code: "forbidden-key", detail: leaks.join(",") };
  }

  return { ok: true, document: parsed };
}
