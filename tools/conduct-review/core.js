/**
 * Connvo conduct-review — policy-first offline engine (synthetic data only).
 *
 * Zero dependencies. No clock reads (every call takes `now`), no randomness,
 * no I/O, no notifications, no irreversible operations: every transition is
 * reversible and every actor action is checked against role, state, and
 * per-case authorization, in that order.
 *
 * Disclosure is an allowlist, never a blocklist: `buildView` returns exactly
 * the fields a role may see in the record's current state — nothing more.
 */

export const STATES = ['draft', 'submitted', 'triaged', 'closed'];

export const CATEGORIES = ['general_conduct', 'communication_conduct', 'harassment_conduct'];

export const OUTCOMES = ['no_concern', 'documented_feedback', 'insufficient_evidence'];

export const TRANSITIONS = {
  submit: { from: 'draft', to: 'submitted', role: 'reporter' },
  withdraw_to_draft: { from: 'submitted', to: 'draft', role: 'reporter' },
  triage: { from: 'submitted', to: 'triaged', role: 'reviewer', requiresAuthorization: true },
  close: { from: 'triaged', to: 'closed', role: 'reviewer', requiresAuthorization: true },
  reopen_to_triaged: { from: 'closed', to: 'triaged', role: 'reviewer', requiresAuthorization: true },
};

export const DISCLOSURE_POLICY = {
  // reporter: sees their own report end to end; never evidence, never
  // reviewer identity, never the subject's response.
  reporter: {
    draft: ['caseId', 'state', 'stateLabel', 'notice', 'canEdit', 'statement', 'category', 'meetingId', 'availableActions'],
    submitted: ['caseId', 'state', 'stateLabel', 'notice', 'statement', 'category', 'meetingId', 'availableActions'],
    triaged: ['caseId', 'state', 'stateLabel', 'notice', 'statement', 'category', 'meetingId', 'availableActions'],
    closed: ['caseId', 'state', 'stateLabel', 'notice', 'statement', 'category', 'meetingId', 'outcome', 'outcomeNotice', 'availableActions'],
  },
  // subject: learns a report exists only once it is triaged, gets the
  // category and meeting (never the statement, never names), and may add
  // one response.
  subject: {
    draft: [],
    submitted: [],
    triaged: ['exists', 'caseId', 'state', 'stateLabel', 'notice', 'category', 'categoryNotice', 'meetingId', 'canRespond', 'responseRecorded', 'availableActions'],
    closed: ['exists', 'caseId', 'state', 'stateLabel', 'notice', 'category', 'categoryNotice', 'meetingId', 'canRespond', 'responseRecorded', 'outcome', 'outcomeNotice', 'availableActions'],
  },
  // reviewer: content only after an explicit per-case grant; otherwise a
  // bare queue card.
  reviewer: {
    draft: ['caseId', 'state', 'stateLabel', 'authorized', 'availableActions'],
    submitted: ['caseId', 'state', 'stateLabel', 'authorized', 'availableActions'],
    triaged: ['caseId', 'state', 'stateLabel', 'authorized', 'statement', 'statementNotice', 'evidence', 'subjectResponse', 'availableActions'],
    closed: ['caseId', 'state', 'stateLabel', 'authorized', 'statement', 'statementNotice', 'evidence', 'subjectResponse', 'outcome', 'resolutionNote', 'outcomeNotice', 'availableActions'],
  },
};

export const EXPORT_FORMAT = 'connvo.conduct-review.redacted-export';
export const EXPORT_VERSION = '1.0.0';

export class AccessError extends Error { constructor(m) { super(m); this.name = 'AccessError'; } }
export class StateError extends Error { constructor(m) { super(m); this.name = 'StateError'; } }
export class ConflictError extends Error { constructor(m) { super(m); this.name = 'ConflictError'; } }
export class ValidationError extends Error { constructor(m) { super(m); this.name = 'ValidationError'; } }
export class AuthorizationError extends Error { constructor(m) { super(m); this.name = 'AuthorizationError'; } }
export class ExportRefusalError extends Error { constructor(m) { super(m); this.name = 'ExportRefusalError'; } }

export function resolveActorRole(record, personId) {
  if (!record || typeof personId !== 'string') return null;
  if (record.reporterId === personId) return 'reporter';
  if (record.subjectId === personId) return 'subject';
  // Anyone else is on the reviewer side of the counterparty relationship —
  // what they may do is decided by the per-case grant (AuthorizationError),
  // not by role resolution.
  return 'reviewer';
}

export function isAuthorized(record, reviewerId) {
  return Array.isArray(record.reviewGrants) &&
    record.reviewGrants.some(function (g) { return g.reviewerId === reviewerId; });
}

function pushHistory(record, action, from, to, role, now) {
  if (typeof now !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(now)) throw new ValidationError('now must be an ISO timestamp string; the engine never reads a clock');
  record.history.push({ at: now, byRole: role, action: action, from: from, to: to });
}

function bumpRevision(record) {
  record.revision = record.revision + 1;
}

function assertExpectedRevision(record, expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null) throw new ConflictError('expectedRevision is required for every mutating call (optimistic concurrency)');
  if (record.revision !== expectedRevision) {
    throw new ConflictError('revision conflict: the record changed since you loaded it (expected ' + String(expectedRevision) + ', current ' + String(record.revision) + ')');
  }
}

/** Create a case in draft. The subject is not notified of anything — ever — by this engine. */
export function createCase(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('input object required');
  for (const k of ['caseId', 'reporterId', 'subjectId', 'meetingId', 'category']) {
    if (typeof input[k] !== 'string' || !input[k]) throw new ValidationError(k + ' must be a non-empty string');
  }
  if (CATEGORIES.indexOf(input.category) === -1) throw new ValidationError('unknown category: ' + input.category);
  if (typeof input.now !== 'string') throw new ValidationError('now must be an ISO timestamp string');
  var record = {
    caseId: input.caseId,
    reporterId: input.reporterId,
    subjectId: input.subjectId,
    meetingId: input.meetingId,
    category: input.category,
    state: 'draft',
    revision: 0,
    statement: '',
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    subjectResponse: null,
    reviewGrants: [],
    outcome: null,
    resolutionNote: null,
    history: [],
  };
  pushHistory(record, 'create', null, 'draft', 'reporter', input.now);
  return record;
}

/** Reporter-only draft edit. Guards: role → state → revision. */
export function updateDraft(record, actorId, patch, expectedRevision, now) {
  var role = resolveActorRole(record, actorId);
  if (role !== 'reporter') throw new AccessError('only the reporter can edit the draft');
  if (record.state !== 'draft') throw new StateError('the report is only editable in draft (current: ' + record.state + ')');
  assertExpectedRevision(record, expectedRevision);
  if (!patch || typeof patch !== 'object') throw new ValidationError('patch object required');
  if ('statement' in patch && typeof patch.statement !== 'string') throw new ValidationError('statement must be a string');
  if ('category' in patch && CATEGORIES.indexOf(patch.category) === -1) throw new ValidationError('unknown category: ' + String(patch.category));
  if ('meetingId' in patch && (typeof patch.meetingId !== 'string' || !patch.meetingId)) throw new ValidationError('meetingId must be a non-empty string');
  if ('statement' in patch) record.statement = patch.statement;
  if ('category' in patch) record.category = patch.category;
  if ('meetingId' in patch) record.meetingId = patch.meetingId;
  bumpRevision(record);
  pushHistory(record, 'update_draft', 'draft', 'draft', role, now);
  return record;
}

/** Per-case reviewer authorization, granted by a second reviewer. Grant-only; never self-served. */
export function grantReviewAuthorization(record, grant, expectedRevision, now) {
  if (!grant || typeof grant.reviewerId !== 'string' || !grant.reviewerId) throw new ValidationError('reviewerId required');
  if (typeof grant.grantedBy !== 'string' || !grant.grantedBy) throw new ValidationError('grantedBy (second reviewer) required');
  if (grant.reviewerId === record.reporterId || grant.reviewerId === record.subjectId) {
    throw new ValidationError('the reporter or subject of a case cannot be its reviewer');
  }
  assertExpectedRevision(record, expectedRevision);
  if (isAuthorized(record, grant.reviewerId)) throw new ValidationError('reviewer is already authorized for this case');
  record.reviewGrants.push({ reviewerId: grant.reviewerId, grantedBy: grant.grantedBy, at: now });
  bumpRevision(record);
  pushHistory(record, 'grant_authorization', record.state, record.state, 'reviewer', now);
  return record;
}

/** Subject adds their account, once, while the case is open. Visible to authorized reviewers only. */
export function addSubjectResponse(record, actorId, response, expectedRevision, now) {
  var role = resolveActorRole(record, actorId);
  if (role !== 'subject') throw new AccessError('only the subject can add their account');
  if (record.state !== 'triaged') throw new StateError('the subject account is open only while the case is triaged (current: ' + record.state + ')');
  if (record.subjectResponse) throw new ConflictError('the subject account was already shared (once only)');
  assertExpectedRevision(record, expectedRevision);
  if (!response || typeof response.text !== 'string' || !response.text.trim()) throw new ValidationError('a non-empty text is required');
  record.subjectResponse = { text: response.text, at: now };
  bumpRevision(record);
  pushHistory(record, 'subject_response', record.state, record.state, 'subject', now);
  return record;
}

/**
 * The only state machine entry. Guards run in a fixed order: actor role →
 * transition validity for the current state → per-case authorization →
 * revision conflict → transition-specific guards (evidence rules on close).
 */
export function applyTransition(record, action, actorId, options) {
  var t = TRANSITIONS[action];
  if (!t) throw new ValidationError('unknown transition: ' + String(action));
  var role = resolveActorRole(record, actorId);
  if (role !== t.role) throw new AccessError('transition ' + action + ' requires the ' + t.role + ' role');
  if (record.state !== t.from) throw new StateError('transition ' + action + ' is not valid from state ' + record.state);
  if (t.requiresAuthorization && !isAuthorized(record, actorId)) {
    throw new AuthorizationError('this reviewer has not been granted per-case authorization by a second reviewer');
  }
  assertExpectedRevision(record, options ? options.expectedRevision : undefined);

  if (action === 'close') {
    var opts = options || {};
    var outcome = opts.outcome;
    if (OUTCOMES.indexOf(outcome) === -1) throw new ValidationError('close requires an outcome among: ' + OUTCOMES.join(', '));
    var factEvidence = (record.evidence || []).filter(function (e) { return Array.isArray(e.facts) && e.facts.length > 0; });
    if (factEvidence.length === 0 && outcome !== 'insufficient_evidence') {
      throw new StateError('no independently collected evidence on file: close as insufficient_evidence instead of ' + outcome);
    }
    var hasConflict = factEvidence.length > 1 && new Set(factEvidence.map(function (e) { return e.facts.join('|'); })).size > 1;
    if (outcome === 'no_concern' && hasConflict && (!opts.resolutionNote || !String(opts.resolutionNote).trim())) {
      throw new StateError('evidence on file conflicts: a quiet no-concern closure requires a written resolution note');
    }
    record.outcome = outcome;
    record.resolutionNote = opts.resolutionNote ? String(opts.resolutionNote) : null;
  }

  var from = record.state;
  record.state = t.to;
  if (action !== 'close' && action !== 'reopen_to_triaged') { /* outcome fields persist only via close/reopen */ }
  if (action === 'reopen_to_triaged') { record.outcome = null; record.resolutionNote = null; }
  bumpRevision(record);
  pushHistory(record, action, from, t.to, role, options ? options.now : undefined);
  return record;
}

var STATE_LABELS = {
  draft: 'draft',
  submitted: 'submitted',
  triaged: 'triaged',
  closed: 'closed',
};

var STATE_NOTICES = {
  reporter: {
    draft: 'draft (only the reporter knows this report exists)',
    submitted: 'submitted — the review team can accept it for review',
    triaged: 'accepted for review — a reviewer with per-case authorization is looking at it',
    closed: 'closed — the outcome below is final for this proposal (it can be reopened by the review team)',
  },
  subject: {
    triaged: 'A report about one of your meetings was accepted for review. The reviewer sees the meeting and the category — not who is involved. You can add your account once, optionally.',
    closed: 'The review of the report about your meeting has closed. The outcome is shown below; no other case content is shared with you.',
  },
  reviewer: {},
};

/**
 * Actions the given actor may take right now, derived only from the policy
 * tables and the record — the UI never invents its own action list.
 */
export function allowedActions(record, actorId) {
  var role = resolveActorRole(record, actorId);
  var out = [];
  for (var name in TRANSITIONS) {
    var t = TRANSITIONS[name];
    if (t.role !== role || record.state !== t.from) continue;
    if (t.requiresAuthorization && !isAuthorized(record, actorId)) continue;
    out.push(name);
  }
  return out;
}

/** Computed view fields per role (in addition to the policy allowlist). */
export var DISCLOSURE_COMPUTED = {
  reporter: ['notice', 'canEdit', 'availableActions'],
  subject: ['notice', 'categoryNotice', 'canRespond', 'responseRecorded', 'outcomeNotice', 'availableActions'],
  reviewer: ['authorized', 'statementNotice', 'evidence', 'subjectResponse', 'availableActions'],
};

/** Exact-disclosure view: only allowlisted fields, computed per role × state. */
export function buildView(record, role) {
  if (!record || typeof role !== 'string') throw new ValidationError('record and role required');
  var stateFields = (DISCLOSURE_POLICY[role] || {})[record.state];
  if (!stateFields || stateFields.length === 0) {
    // Unknown role, or a state with no disclosure for this role (the subject
    // in draft/submitted): the view shows nothing, not even existence.
    return { exists: false };
  }
  var view = { state: record.state, stateLabel: STATE_LABELS[record.state] };
  for (var f of stateFields) {
    if (f === 'exists') { view.exists = true; continue; }
    view[f] = record[f];
  }

  // Computed, non-identity fields.
  if (role === 'reporter') {
    view.notice = STATE_NOTICES.reporter[record.state];
    view.canEdit = record.state === 'draft';
  }
  if (role === 'subject') {
    view.notice = STATE_NOTICES.subject[record.state] || null;
    view.categoryNotice = 'Review category: ' + record.category;
    view.canRespond = record.state === 'triaged' && !record.subjectResponse;
    view.responseRecorded = Boolean(record.subjectResponse);
    view.outcomeNotice = record.state === 'closed'
      ? 'Outcome: ' + record.outcome + '. This is the only case content shared with you.'
      : null;
  }
  if (role === 'reviewer') {
    // View-layer authorization reflects the demo's single reviewer seat:
    // per-person enforcement happens in applyTransition/buildExport, which
    // take explicit caller ids.
    view.authorized = Array.isArray(record.reviewGrants) && record.reviewGrants.length > 0;
    if (stateFields.indexOf('statement') !== -1) {
      view.statementNotice = 'an unverified account, not a finding — weigh it against independently collected evidence';
      view.evidence = (record.evidence || []).map(function (e) {
        return { at: e.at, facts: e.facts, collectedBy: '[reviewer]' };
      });
      view.subjectResponse = record.subjectResponse
        ? { text: record.subjectResponse.text, at: record.subjectResponse.at }
        : null;
    }
  }
  // The action list always comes from the engine's policy table — for the
  // demo's single reviewer seat, the first per-case grant is the seat.
  var seatId = role === 'reporter' ? record.reporterId
    : role === 'subject' ? record.subjectId
    : (view.authorized ? record.reviewGrants[0].reviewerId : null);
  if (seatId && stateFields.indexOf('availableActions') !== -1) {
    view.availableActions = allowedActions(record, seatId);
  }
  return view;
}

/** Identity-shaped substrings that must never survive into an export. */
var IDENTITY_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.]{2,}/g,   // emails
  /https?:\/\/\S+/g,               // urls
  /\+?\d[\d\s().-]{7,}\d/g,        // phone-like digit runs
  /\B@[a-z0-9_]{3,}/gi,            // @handles
  /\bper_[a-z0-9_]+\b/gi,          // person ids
  /\bcase_[a-z0-9_-]+\b/gi,        // case refs
  /\bmtg_[a-z0-9_-]+\b/gi,         // meeting refs
];

function scrubPatterns(text) {
  var out = String(text);
  for (var re of IDENTITY_PATTERNS) out = out.replace(new RegExp(re.source, re.flags), '[redacted]');
  return out;
}

function scrub(text, tokens) {
  var out = scrubPatterns(text);
  for (var t of tokens) {
    if (!t || t.length < 4) continue; // ignore ultra-short tokens to avoid mangling text
    while (out.indexOf(t) !== -1) out = out.replace(t, '[redacted]');
  }
  return out;
}

/** Deep scrub: every string in a value, at any nesting depth. */
function scrubValue(v, tokens) {
  if (typeof v === 'string') return scrub(v, tokens);
  if (Array.isArray(v)) return v.map(function (x) { return scrubValue(x, tokens); });
  if (v && typeof v === 'object') {
    var out = {};
    for (var k in v) out[k] = scrubValue(v[k], tokens);
    return out;
  }
  return v;
}

/**
 * Redacted export for an explicitly authorized reviewer. Fails closed: an
 * unauthorized caller gets a refusal; an unknown field in the export shape
 * is a hard error, never a silent pass-through. Identity tokens (names, ids,
 * emails, phones, urls, handles) are scrubbed from every string.
 */
export function buildExport(record, caller) {
  if (!caller || typeof caller.reviewerId !== 'string') throw new ExportRefusalError('export requires an explicit reviewer identity');
  if (!isAuthorized(record, caller.reviewerId)) {
    throw new ExportRefusalError('export refused: this reviewer has not been granted per-case authorization');
  }
  var allowed = new Set(['statement', 'evidence', 'subjectResponse', 'category', 'outcome', 'resolutionNote']);
  var requested = caller.fields || ['statement', 'evidence', 'subjectResponse', 'category', 'outcome', 'resolutionNote'];
  for (var f of requested) {
    if (!allowed.has(f)) throw new ExportRefusalError('export refused: unknown or disallowed field ' + String(f));
  }
  var identityTokens = caller.identityTokens || [];
  var content = {};
  for (var f2 of requested) {
    content[f2] = scrubValue(record[f2], identityTokens);
    if (f2 === 'evidence' && Array.isArray(content[f2])) {
      // Provenance and internal ids never survive; collectedBy is a role.
      content[f2] = content[f2].map(function (item) {
        var clean = {};
        for (var k in item) {
          if (k === 'id') continue;
          clean[k] = k === 'collectedBy' && typeof item[k] === 'string' && item[k].indexOf('per_') === 0 ? '[reviewer]' : item[k];
        }
        return clean;
      });
    }
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    caseRevision: record.revision,
    generatedAt: caller.now,
    state: record.state,
    content: content,
  };
}
