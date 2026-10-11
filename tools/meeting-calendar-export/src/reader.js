// Independent, minimal RFC 5545 reader used to VERIFY exporter output.
// Deliberately shares NO code with src/ics.js, so agreement between the two is evidence.

/** Unfold per RFC 5545 3.1: CRLF/LF followed by space or tab is removed. */
export function unfold(text) {
  return String(text).replace(/\r\n[ \t]|\n[ \t]/g, (m) => m.slice(m.length - 1));
}

/** Parse calendar text into content lines: { name, params, value }. */
export function parseLines(text) {
  return unfold(text)
    .split(/\r\n|\n|\r/)
    .filter((l) => l.length > 0)
    .map((line) => {
      const colon = line.indexOf(':');
      if (colon < 0) throw new Error(`malformed content line: ${JSON.stringify(line)}`);
      const head = line.slice(0, colon);
      const value = line.slice(colon + 1);
      const semi = head.indexOf(';');
      const name = (semi < 0 ? head : head.slice(0, semi)).toUpperCase();
      const params = {};
      if (semi >= 0) {
        for (const part of head.slice(semi + 1).split(';')) {
          const eq = part.indexOf('=');
          if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
        }
      }
      return { name, params, value };
    });
}

/** Extract VEVENT blocks as { uid, props } (props: property name -> value, last occurrence wins). */
export function parseEvents(text) {
  const events = [];
  let cur = null;
  for (const l of parseLines(text)) {
    if (l.name === 'BEGIN' && l.value.toUpperCase() === 'VEVENT') cur = { uid: null, props: {} };
    else if (l.name === 'END' && l.value.toUpperCase() === 'VEVENT' && cur) { events.push(cur); cur = null; }
    else if (cur) {
      if (l.name === 'UID') cur.uid = l.value;
      cur.props[l.name] = l.value;
    }
  }
  return events;
}
