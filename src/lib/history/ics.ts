/**
 * RFC 5545 .ics calendar export for after-call meeting history.
 *
 * Zero runtime dependencies: this module imports nothing (no convex, no libs).
 * Determinism: the same meeting record always renders byte-identical output —
 * UID, DTSTAMP are derived from the record itself, never from Date.now() or
 * randomness. That stability is what lets calendar clients replace an event
 * instead of duplicating it on re-export.
 */

const CRLF = "\r\n";

/** Stable per-deployment domain component of the event UID. */
const UID_DOMAIN = "connvo-history";

/** RFC 5545 §3.1.1: content lines MUST NOT be longer than 75 octets, excluding the CRLF. */
const LINE_OCTET_LIMIT = 75;

export interface CalendarExportInput {
  meetingId: string;
  title: string;
  description?: string | null;
  scheduledAt: number | null;
  durationMs?: number | null;
  state: "scheduled" | "cancelled";
  updatedAt: number;
}

/**
 * RFC 5545 §3.3.11 TEXT escaping.
 * Backslash first; then `;` and `,`; then CRLF / LF / CR each become the
 * literal two-character sequence `\n`. All unicode passes through untouched.
 */
export function escapeIcsText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\") {
      out += "\\\\";
    } else if (ch === ";") {
      out += "\\;";
    } else if (ch === ",") {
      out += "\\,";
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      // CRLF and lone CR both collapse to the `\n` escape.
      if (value[i + 1] === "\n") i++;
      out += "\\n";
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Format an epoch-ms instant as an RFC 5545 UTC DATE-TIME (YYYYMMDDTHHMMSSZ).
 * Sub-second precision is truncated by flooring, so a meeting scheduled at
 * 22:13:20.123 exports as 22:13:20.
 */
function formatIcsUtc(epochMs: number): string {
  const seconds = Math.floor(epochMs / 1000);
  // toISOString is always UTC: "YYYY-MM-DDTHH:MM:SS.sssZ".
  return new Date(seconds * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

let sharedTextEncoder: TextEncoder | null = null;
function utf8Octets(value: string): number {
  if (sharedTextEncoder === null) sharedTextEncoder = new TextEncoder();
  return sharedTextEncoder.encode(value).length;
}

/**
 * Fold one content line to ≤ 75 UTF-8 octets per physical line (§3.1.1).
 * Continuation lines start with a single space (which counts toward their
 * 75-octet budget). Splits only between code points, so multi-byte
 * characters are never torn in half.
 */
function foldContentLine(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  for (const ch of line) {
    const octets = utf8Octets(ch);
    if (currentOctets + octets > LINE_OCTET_LIMIT && current.length > 0) {
      parts.push(current);
      current = " " + ch;
      currentOctets = 1 + octets;
    } else {
      current += ch;
      currentOctets += octets;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/**
 * Build a complete VCALENDAR document for one meeting, or null when the
 * meeting has no scheduled time (nothing to put on a calendar; the caller
 * owns the UX for that case).
 *
 * `meetingId` is a system-generated Convex id (not user text), so it is used
 * verbatim in the UID. Every TEXT-valued user field (title, description) is
 * escaped per §3.3.11 and every line folded per §3.1.1.
 */
export function buildCalendarExport(input: CalendarExportInput): string | null {
  if (input.scheduledAt === null) return null;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Connvo//Meeting Export//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${input.meetingId}@${UID_DOMAIN}`,
    `DTSTAMP:${formatIcsUtc(input.updatedAt)}`,
    `DTSTART:${formatIcsUtc(input.scheduledAt)}`,
  ];

  // DTEND is only emitted when the caller actually knows the duration;
  // inventing one would put a lie on other people's calendars.
  if (input.durationMs != null) {
    lines.push(`DTEND:${formatIcsUtc(input.scheduledAt + input.durationMs)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(input.title)}`);
  if (input.description != null) {
    lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  }
  lines.push(`STATUS:${input.state === "cancelled" ? "CANCELLED" : "TENTATIVE"}`);
  lines.push("SEQUENCE:0", "END:VEVENT", "END:VCALENDAR");

  return lines
    .flatMap(foldContentLine)
    .map((part) => part + CRLF)
    .join("");
}
