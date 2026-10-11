/**
 * Test-only minimal ICS (RFC 5545) reader used to prove that exports
 * round-trip. Deliberately shares NO code with ./ics.ts — it must be able to
 * disagree with the writer, otherwise the two could be broken in the same
 * way. It understands generic unfolding, TEXT unescaping, VEVENT property
 * extraction, and UTC DATE-TIME parsing; nothing more.
 *
 * Import it from tests only.
 */

export interface IcsProperty {
  name: string;
  value: string;
}

export interface ParsedIcsEvent {
  /** All VEVENT properties in document order (for injection canaries). */
  properties: IcsProperty[];
  /** Raw (still-escaped) value of the first property with this name. */
  getRaw(name: string): string | null;
  /** How many properties with this name the VEVENT carries. */
  count(name: string): number;
  uid: string | null;
  dtstamp: string | null;
  dtstart: string | null;
  dtend: string | null;
  summary: string | null;
  description: string | null;
  status: string | null;
  sequence: string | null;
}

/** Remove line folding: CRLF followed by one space/tab collapses to nothing (§3.1). */
export function unfoldIcs(text: string): string {
  return text.replace(/\r\n[ \t]/g, "");
}

/** Inverse of RFC 5545 §3.3.11 escaping; scans left-to-right so an escaped backslash followed by n never turns into a newline. */
export function unescapeIcsText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === "n" || next === "N") {
        out += "\n";
        i++;
      } else if (next === "\\" || next === ";" || next === ",") {
        out += next;
        i++;
      } else {
        // A lone backslash is not something our writer emits; keep it verbatim.
        out += ch;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/** Parse an RFC 5545 UTC DATE-TIME (YYYYMMDDTHHMMSSZ) to epoch ms, or null. */
export function parseIcsUtc(value: string | null): number | null {
  if (value === null) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) return null;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

function firstUnescapedColon(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++; // skip the escaped character
      continue;
    }
    if (line[i] === ":") return i;
  }
  return -1;
}

/**
 * Parse a full VCALENDAR document into its single VEVENT's properties.
 * Throws on bare LF/CR line endings and on malformed content lines, so a
 * writer regression cannot silently parse as "empty".
 */
export function parseIcs(icsText: string): ParsedIcsEvent {
  const unfolded = unfoldIcs(icsText);
  const physicalLines = unfolded.split("\r\n");
  const hasBareLineEnding = physicalLines.some((line) => line.includes("\n") || line.includes("\r"));
  if (hasBareLineEnding) {
    throw new Error("ics contains a bare LF or CR line ending");
  }

  const eventLines: string[] = [];
  let inEvent = false;
  for (const line of physicalLines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      continue;
    }
    if (line === "END:VEVENT") {
      inEvent = false;
      continue;
    }
    if (inEvent && line.length > 0) eventLines.push(line);
  }

  const properties: IcsProperty[] = eventLines.map((line) => {
    const colon = firstUnescapedColon(line);
    if (colon < 0) {
      throw new Error(`malformed content line (no unescaped colon): ${line}`);
    }
    const name = line
      .slice(0, colon)
      .split(";")[0]
      .trim()
      .toUpperCase();
    return { name, value: line.slice(colon + 1) };
  });

  const getRaw = (name: string): string | null => {
    const found = properties.find((property) => property.name === name);
    return found ? found.value : null;
  };
  const getText = (name: string): string | null => {
    const raw = getRaw(name);
    return raw === null ? null : unescapeIcsText(raw);
  };

  return {
    properties,
    getRaw,
    count: (name: string) => properties.filter((property) => property.name === name).length,
    uid: getText("UID"),
    dtstamp: getRaw("DTSTAMP"),
    dtstart: getRaw("DTSTART"),
    dtend: getRaw("DTEND"),
    summary: getText("SUMMARY"),
    description: getText("DESCRIPTION"),
    status: getRaw("STATUS"),
    sequence: getRaw("SEQUENCE"),
  };
}
