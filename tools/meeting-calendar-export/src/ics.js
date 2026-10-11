// RFC 5545 primitives for the meeting-calendar exporter.
// Deterministic: no Date.now(), no locale — identical input yields byte-identical output.
const CRLF = '\r\n';

/** Epoch milliseconds -> RFC 5545 UTC date-time (YYYYMMDDTHHMMSSZ). Sub-second precision is truncated (floored). */
export function toIcsUtc(epochMs) {
  if (!Number.isFinite(epochMs) || epochMs < 0) throw new TypeError(`epochMs must be finite non-negative, got ${epochMs}`);
  const d = new Date(Math.floor(epochMs / 1000) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    p(d.getUTCFullYear(), 4) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z'
  );
}

/** RFC 5545 UTC date-time string -> epoch ms (whole seconds). */
export function parseIcsUtc(v) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v);
  if (!m) throw new TypeError(`not an ICS UTC date-time: ${JSON.stringify(v)}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** Escape a TEXT property value per RFC 5545 3.3.11. Replacement order matters. */
export function escapeText(v) {
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Inverse of escapeText (used by roundtrip verification). */
export function unescapeText(v) {
  let out = '';
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\') {
      const c = v[++i];
      if (c === 'n' || c === 'N') out += '\n';
      else if (c === ';' || c === ',' || c === '\\') out += c;
      else if (c !== undefined) out += c;
    } else out += v[i];
  }
  return out;
}

/** Fold a content line to at most 75 octets per RFC 5545 3.1 (continuations start with one space). Never splits a UTF-8 sequence. */
export function foldLine(line) {
  const enc = Buffer.from(line, 'utf8');
  if (enc.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < enc.length) {
    let end = Math.min(limit, enc.length);
    while (end > start && (enc[end] & 0xc0) === 0x80) end--;
    parts.push(enc.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines carry one leading space
  }
  return parts.join(CRLF + ' ');
}
