/**
 * Independent export validator — deliberately does NOT import the engine's
 * redaction logic. It re-derives the identity lexicon from the raw record and
 * re-checks any export bundle against it. Fails closed: any doubt is a
 * failing verdict, never a warning.
 */

export const EXPECTED_EXPORT_FORMAT = 'connvo.conduct-review.redacted-export';
export const EXPECTED_EXPORT_VERSION = '1.0.0';

const ALLOWED_CONTENT_FIELDS = new Set([
  'statement', 'evidence', 'subjectResponse', 'category', 'outcome', 'resolutionNote',
]);

export class InvalidExportError extends Error { constructor(m) { super(m); this.name = 'InvalidExportError'; } }

/* Identity-shaped substrings, mirroring the engine's pattern list. */
const IDENTITY_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.]{2,}/g,
  /https?:\/\/\S+/g,
  /\+?\d[\d\s().-]{7,}\d/g,
  /\B@[a-z0-9_]{3,}/gi,
  /\bper_[a-z0-9_]+\b/gi,
  /\bcase_[a-z0-9_-]+\b/gi,
  /\bmtg_[a-z0-9_-]+\b/gi,
];

function collectRecordTokens(record) {
  const tokens = new Set();
  if (record.reporterId) tokens.add(record.reporterId);
  if (record.subjectId) tokens.add(record.subjectId);
  for (const g of record.reviewGrants || []) {
    if (g.reviewerId) tokens.add(g.reviewerId);
    if (g.grantedBy) tokens.add(g.grantedBy);
  }
  // Scan every string in the record, including statement and evidence free
  // text: contact details embedded in a statement are exactly what must not
  // survive into an export.
  const scan = (value) => {
    if (typeof value === 'string') {
      for (const re of IDENTITY_PATTERNS) {
        for (const m of value.match(new RegExp(re.source, re.flags)) || []) tokens.add(m);
      }
    } else if (Array.isArray(value)) {
      value.forEach(scan);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(scan);
    }
  };
  scan(record);
  return [...tokens].filter((t) => t.length >= 4);
}

function describeSource(token, record) {
  if (token === record.reporterId) return 'reporter identity';
  if (token === record.subjectId) return 'subject identity';
  return 'identity-shaped token';
}

/**
 * Validate an export bundle against the record it claims to come from.
 * Returns { ok: true } or { ok: false, error }. Error messages name the
 * problem and field, and never echo the offending value.
 */
export function validateExport(bundle, record) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new InvalidExportError('bundle must be an object');
  }
  if (bundle.format !== EXPECTED_EXPORT_FORMAT) {
    return { ok: false, error: 'format mismatch: expected ' + EXPECTED_EXPORT_FORMAT };
  }
  if (bundle.version !== EXPECTED_EXPORT_VERSION) {
    return { ok: false, error: 'version mismatch: expected ' + EXPECTED_EXPORT_VERSION };
  }
  if (bundle.caseRevision !== record.revision) {
    return { ok: false, error: 'stale bundle: built against revision ' + String(bundle.caseRevision) + ' but the record is at revision ' + String(record.revision) };
  }
  if (!bundle.content || typeof bundle.content !== 'object' || Array.isArray(bundle.content)) {
    return { ok: false, error: 'content must be an object' };
  }
  for (const k of Object.keys(bundle.content)) {
    if (!ALLOWED_CONTENT_FIELDS.has(k)) {
      return { ok: false, error: 'unknown field in export content: ' + k };
    }
  }
  for (const k of ['state', 'generatedAt', 'caseRevision']) {
    if (!(k in bundle)) {
      return { ok: false, error: 'missing bundle field: ' + k };
    }
  }

  // Leak scan: no identity-shaped token from the record may survive.
  const tokens = collectRecordTokens(record);
  const contentJson = JSON.stringify(bundle.content);
  for (const t of tokens) {
    if (contentJson.indexOf(t) !== -1) {
      return { ok: false, error: 'identity leak detected in export content (source: ' + describeSource(t, record) + ')' };
    }
  }
  // Shape scan, independent of the record: anything that LOOKS like an
  // identity (person/case/meeting id, email, url, phone, handle) fails even
  // if the raw record never contained it. ISO timestamps are stripped first
  // so digit-dash datetimes are not mistaken for phone numbers.
  const KINDS = ['email or url', 'url', 'phone-like number', 'handle', 'person id', 'case ref', 'meeting ref'];
  const probe = contentJson.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '');
  for (let i = 0; i < IDENTITY_PATTERNS.length; i++) {
    const re = new RegExp(IDENTITY_PATTERNS[i].source, IDENTITY_PATTERNS[i].flags.replace('g', ''));
    if (re.test(probe)) {
      return { ok: false, error: 'identity-shaped content detected (' + KINDS[i] + ')' };
    }
  }
  return { ok: true };
}

/** Test helper: plant a leak into a bundle so the validator must catch it. */
export function plantLeak(bundle, token) {
  const copy = JSON.parse(JSON.stringify(bundle));
  copy.content.statement = String(copy.content.statement || '') + ' ' + token;
  return copy;
}
