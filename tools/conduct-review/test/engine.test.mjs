/**
 * Engine tests: exact-disclosure matrix, guarded state machine, evidence
 * rules, redacted export, and the independent validator. All calls take the
 * fixture clock — the engine never reads a real clock.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES, CATEGORIES, OUTCOMES, TRANSITIONS, DISCLOSURE_POLICY, DISCLOSURE_COMPUTED,
  AccessError, StateError, ConflictError, ValidationError, AuthorizationError, ExportRefusalError,
  resolveActorRole, isAuthorized, allowedActions, createCase, updateDraft,
  grantReviewAuthorization, addSubjectResponse, applyTransition, buildView, buildExport,
} from '../core.js';
import {
  TS, PEOPLE, makePeople, SYNTHETIC_STATEMENT, evidenceWithFacts,
  conflictingEvidence, draftCaseWithEvidence, missingEvidenceCase, conflictingEvidenceCase,
} from '../fixtures.js';
import { validateExport, plantLeak, InvalidExportError } from '../validate.js';

function submittedCase() {
  const r = draftCaseWithEvidence();
  return applyTransition(r, 'submit', PEOPLE.reporter.id, { expectedRevision: r.revision, now: TS.t2 });
}

function triagedCase() {
  let r = submittedCase();
  r = grantReviewAuthorization(r, { reviewerId: PEOPLE.reviewerAuthorized.id, grantedBy: PEOPLE.reviewerGrantor.id }, r.revision, TS.t3);
  return applyTransition(r, 'triage', PEOPLE.reviewerAuthorized.id, { expectedRevision: r.revision, now: TS.t4 });
}

function closedCase() {
  const r = triagedCase();
  return applyTransition(r, 'close', PEOPLE.reviewerAuthorized.id, {
    expectedRevision: r.revision, now: TS.t6, outcome: 'no_concern', resolutionNote: 'statement and evidence agree; no independent concern',
  });
}

test('policy tables: states, categories, outcomes and transition graph are coherent', () => {
  assert.deepEqual(STATES, ['draft', 'submitted', 'triaged', 'closed']);
  assert.ok(CATEGORIES.includes('communication_conduct'));
  assert.ok(OUTCOMES.includes('insufficient_evidence'));
  for (const [name, t] of Object.entries(TRANSITIONS)) {
    assert.ok(STATES.includes(t.from) && STATES.includes(t.to), 'transition endpoints in STATES: ' + name);
  }
});

test('no transition is terminal: closed can be reopened by an authorized reviewer', () => {
  let r = closedCase();
  r = applyTransition(r, 'reopen_to_triaged', PEOPLE.reviewerAuthorized.id, { expectedRevision: r.revision, now: TS.t6 });
  assert.equal(r.state, 'triaged');
  assert.equal(r.outcome, null);
});

// ---- Exact disclosure matrix -------------------------------------------

test('subject is told nothing before triage: no existence, no category, no meeting', () => {
  for (const r of [draftCaseWithEvidence(), submittedCase()]) {
    const v = buildView(r, 'subject');
    assert.equal(v.exists, false, 'state ' + r.state);
    assert.ok(!('statement' in v) && !('category' in v) && !('meetingId' in v), 'state ' + r.state);
  }
});

test('subject view after triage: category and meeting, never the statement or names', () => {
  const v = buildView(triagedCase(), 'subject');
  assert.equal(v.exists, true);
  assert.equal(v.category, 'communication_conduct');
  assert.equal(v.meetingId, 'mtg_syn_001');
  assert.equal(v.canRespond, true);
  assert.ok(!('statement' in v), 'no statement for the subject');
  assert.ok(!('reporterId' in v) && !('evidence' in v), 'no provenance for the subject');
});

test('reporter never sees evidence, reviewer notes or the subject response, in any state', () => {
  for (const r of [submittedCase(), triagedCase(), closedCase()]) {
    const v = buildView(r, 'reporter');
    assert.ok(!('evidence' in v), 'state ' + r.state);
    assert.ok(!('subjectResponse' in v), 'state ' + r.state);
    assert.ok(!('reviewerId' in v), 'state ' + r.state);
    assert.equal(v.statement, r.statement, 'reporter always sees their own statement');
  }
});

test('unauthorized reviewer gets a queue card: case id and state only', () => {
  const v = buildView(submittedCase(), 'reviewer');
  assert.equal(v.authorized, false);
  assert.equal(v.caseId, 'case_syn_001');
  assert.ok(!('statement' in v) && !('evidence' in v), 'no content leaks without a per-case grant');
});

test('authorized reviewer sees the statement labeled unverified, evidence, and the subject response', () => {
  let r = triagedCase();
  r = addSubjectResponse(r, PEOPLE.subject.id, { text: 'My account of that meeting differs.' }, r.revision, TS.t5);
  const v = buildView(r, 'reviewer');
  assert.equal(v.authorized, true);
  assert.ok(v.statementNotice.includes('not a finding'));
  assert.equal(v.evidence.length, 1);
  assert.equal(v.evidence[0].collectedBy, '[reviewer]', 'evidence provenance is a role, not a person');
  assert.ok(!('id' in v.evidence[0]), 'evidence ids stay internal');
  assert.equal(v.subjectResponse.text, 'My account of that meeting differs.');
});

test('every role x state view returns exactly the allowlisted keys', () => {
  const cases = [draftCaseWithEvidence(), submittedCase(), triagedCase(), closedCase()];
  for (const r of cases) {
    for (const role of ['reporter', 'subject', 'reviewer']) {
      const v = buildView(r, role);
      const policy = DISCLOSURE_POLICY[role][r.state];
      const expected = new Set();
      if (policy.length === 0) {
        expected.add('exists'); // opaque: the subject before triage
      } else {
        expected.add('state');
        expected.add('stateLabel');
        for (const k of policy) expected.add(k);
        for (const k of DISCLOSURE_COMPUTED[role]) {
          // Reviewer content fields exist only when the state grants statement access.
          if (role === 'reviewer' && ['statementNotice', 'evidence', 'subjectResponse'].includes(k) && !policy.includes('statement')) continue;
          expected.add(k);
        }
      }
      assert.deepEqual(Object.keys(v).sort(), [...expected].sort(), role + '/' + r.state);
    }
  }
});

// ---- Guards --------------------------------------------------------------

test('guards run in order: role, then state, then authorization, then revision', () => {
  const s = submittedCase();
  assert.throws(() => applyTransition(s, 'triage', PEOPLE.subject.id, { expectedRevision: s.revision, now: TS.t4 }), AccessError, 'subject cannot triage');
  const r = draftCaseWithEvidence();
  assert.throws(() => applyTransition(r, 'submit', PEOPLE.subject.id, { expectedRevision: r.revision, now: TS.t2 }), AccessError, 'subject cannot submit');
  assert.throws(() => applyTransition(r, 'withdraw_to_draft', PEOPLE.reporter.id, { expectedRevision: r.revision, now: TS.t1 }), StateError, 'withdraw only makes sense after submit');
  assert.throws(() => applyTransition(r, 'reopen_to_triaged', PEOPLE.reviewerAuthorized.id, { expectedRevision: r.revision, now: TS.t1 }), StateError, 'reopen only from closed');
});

test('allowedActions reflects role, state and authorization', () => {
  const d = draftCaseWithEvidence();
  assert.deepEqual(allowedActions(d, PEOPLE.reporter.id), ['submit']);
  const s = submittedCase();
  assert.deepEqual(allowedActions(s, PEOPLE.reporter.id), ['withdraw_to_draft']);
  assert.deepEqual(allowedActions(s, PEOPLE.reviewerGrantor.id), [], 'ungranted reviewer: no actions');
  const g = grantReviewAuthorization(s, { reviewerId: PEOPLE.reviewerAuthorized.id, grantedBy: PEOPLE.reviewerGrantor.id }, s.revision, TS.t3);
  assert.deepEqual(allowedActions(g, PEOPLE.reviewerAuthorized.id), ['triage']);
  const t = triagedCase();
  assert.deepEqual(allowedActions(t, PEOPLE.reviewerAuthorized.id), ['close'], 'close is offered in every closure form');
  assert.deepEqual(allowedActions(closedCase(), PEOPLE.reviewerAuthorized.id), ['reopen_to_triaged']);
});

test('an ungranted reviewer cannot triage or close, even with a valid revision', () => {
  const s = submittedCase();
  assert.throws(() => applyTransition(s, 'triage', PEOPLE.reviewerGrantor.id, { expectedRevision: s.revision, now: TS.t4 }), AuthorizationError);
  const t = triagedCase();
  assert.throws(() => applyTransition(t, 'close', PEOPLE.reviewerGrantor.id, { expectedRevision: t.revision, now: TS.t6, outcome: 'no_concern' }), AuthorizationError);
});

test('stale or missing expectedRevision is a conflict, never a silent overwrite', () => {
  const s = submittedCase();
  assert.throws(() => applyTransition(s, 'withdraw_to_draft', PEOPLE.reporter.id, { expectedRevision: s.revision - 1, now: TS.t2 }), ConflictError);
  const d = draftCaseWithEvidence();
  assert.throws(() => updateDraft(d, PEOPLE.reporter.id, { statement: 'x' }, undefined, TS.t1), ConflictError);
});

test('reporter edits are draft-only and validated', () => {
  const r = draftCaseWithEvidence();
  assert.throws(() => updateDraft(r, PEOPLE.subject.id, { statement: 'hi' }, r.revision, TS.t1), AccessError);
  const s = submittedCase();
  assert.throws(() => updateDraft(s, PEOPLE.reporter.id, { statement: 'hi' }, s.revision, TS.t1), StateError);
  assert.throws(() => updateDraft(r, PEOPLE.reporter.id, { category: 'not_a_category' }, r.revision, TS.t1), ValidationError);
});

test('reviewer authorization: second-reviewer grant, never self-served, never the parties', () => {
  const r = draftCaseWithEvidence();
  assert.throws(() => grantReviewAuthorization(r, { reviewerId: PEOPLE.reporter.id, grantedBy: PEOPLE.reviewerGrantor.id }, r.revision, TS.t3), ValidationError, 'reporter cannot review their own case');
  assert.throws(() => grantReviewAuthorization(r, { reviewerId: PEOPLE.subject.id, grantedBy: PEOPLE.reviewerGrantor.id }, r.revision, TS.t3), ValidationError);
  const g = grantReviewAuthorization(r, { reviewerId: PEOPLE.reviewerAuthorized.id, grantedBy: PEOPLE.reviewerGrantor.id }, r.revision, TS.t3);
  assert.equal(isAuthorized(g, PEOPLE.reviewerAuthorized.id), true);
  assert.throws(() => grantReviewAuthorization(g, { reviewerId: PEOPLE.reviewerAuthorized.id, grantedBy: PEOPLE.reviewerGrantor.id }, g.revision, TS.t3), ValidationError, 'duplicate grant');
});

test('subject account: once only, only while triaged', () => {
  const t = triagedCase();
  const r1 = addSubjectResponse(t, PEOPLE.subject.id, { text: 'My account differs.' }, t.revision, TS.t5);
  assert.throws(() => addSubjectResponse(r1, PEOPLE.subject.id, { text: 'again' }, r1.revision, TS.t5), ConflictError);
  assert.throws(() => addSubjectResponse(submittedCase(), PEOPLE.subject.id, { text: 'early' }, submittedCase().revision, TS.t5), StateError);
  assert.throws(() => addSubjectResponse(t, PEOPLE.reporter.id, { text: 'not the subject' }, t.revision, TS.t5), AccessError);
});

// ---- Evidence rules on close ---------------------------------------------

test('missing evidence forces closure as insufficient_evidence', () => {
  const r = missingEvidenceCase();
  const s = applyTransition(r, 'submit', PEOPLE.reporter.id, { expectedRevision: r.revision, now: TS.t2 });
  const g = grantReviewAuthorization(s, { reviewerId: PEOPLE.reviewerAuthorized.id, grantedBy: PEOPLE.reviewerGrantor.id }, s.revision, TS.t3);
  const t = applyTransition(g, 'triage', PEOPLE.reviewerAuthorized.id, { expectedRevision: g.revision, now: TS.t4 });
  assert.throws(() => applyTransition(t, 'close', PEOPLE.reviewerAuthorized.id, { expectedRevision: t.revision, now: TS.t6, outcome: 'no_concern' }), StateError);
  const closed = applyTransition(t, 'close', PEOPLE.reviewerAuthorized.id, { expectedRevision: t.revision, now: TS.t6, outcome: 'insufficient_evidence' });
  assert.equal(closed.outcome, 'insufficient_evidence');
});

test('conflicting evidence blocks a quiet no-concern closure without a written note', () => {
  const r = conflictingEvidenceCase();
  const s = applyTransition(r, 'submit', PEOPLE.reporter.id, { expectedRevision: r.revision, now: TS.t2 });
  const g = grantReviewAuthorization(s, { reviewerId: PEOPLE.reviewerAuthorized.id, grantedBy: PEOPLE.reviewerGrantor.id }, s.revision, TS.t3);
  const t = applyTransition(g, 'triage', PEOPLE.reviewerAuthorized.id, { expectedRevision: g.revision, now: TS.t4 });
  assert.throws(() => applyTransition(t, 'close', PEOPLE.reviewerAuthorized.id, { expectedRevision: t.revision, now: TS.t6, outcome: 'no_concern' }), StateError);
  const closed = applyTransition(t, 'close', PEOPLE.reviewerAuthorized.id, { expectedRevision: t.revision, now: TS.t6, outcome: 'no_concern', resolutionNote: 'evidence conflict resolved in review discussion' });
  assert.equal(closed.outcome, 'no_concern');
});

test('close requires a known outcome', () => {
  const t = triagedCase();
  assert.throws(() => applyTransition(t, 'close', PEOPLE.reviewerAuthorized.id, { expectedRevision: t.revision, now: TS.t6, outcome: 'make_it_go_away' }), ValidationError);
});

// ---- Redacted export ------------------------------------------------------

test('export is refused for an ungranted caller and for unknown fields', () => {
  const t = triagedCase();
  assert.throws(() => buildExport(t, { reviewerId: PEOPLE.reviewerGrantor.id, now: TS.t6 }), ExportRefusalError);
  assert.throws(() => buildExport(t, { reviewerId: PEOPLE.reviewerAuthorized.id, now: TS.t6, fields: ['reporterId'] }), ExportRefusalError);
});

test('authorized export scrubs identity-shaped tokens and passes the independent validator', () => {
  const r = closedCase();
  const bundle = buildExport(r, { reviewerId: PEOPLE.reviewerAuthorized.id, now: TS.t6 });
  const text = JSON.stringify(bundle.content);
  assert.ok(!text.includes('casey.rivera@example.net'), 'no emails');
  assert.ok(!text.includes('+1 555 010 2233'), 'no phones');
  assert.ok(!text.includes('per_casey_rivera'), 'no person ids');
  assert.ok(!text.includes('mtg_syn_001'), 'no meeting refs in free text');
  const verdict = validateExport(bundle, r);
  assert.deepEqual(verdict, { ok: true });
});

test('the validator catches a planted leak and never echoes the value', () => {
  const r = closedCase();
  const bundle = buildExport(r, { reviewerId: PEOPLE.reviewerAuthorized.id, now: TS.t6 });
  const dirty = plantLeak(bundle, 'per_morgan_tan');
  const verdict = validateExport(dirty, r);
  assert.equal(verdict.ok, false);
  assert.ok(!verdict.error.includes('per_morgan_tan'), 'error must not echo the leaked token');
});

test('the validator rejects stale bundles, wrong format and unknown content fields', () => {
  const r = closedCase();
  const bundle = buildExport(r, { reviewerId: PEOPLE.reviewerAuthorized.id, now: TS.t6 });
  const stale = { ...bundle, caseRevision: bundle.caseRevision - 1 };
  assert.equal(validateExport(stale, r).ok, false);
  const wrongFormat = { ...bundle, format: 'other.format' };
  assert.equal(validateExport(wrongFormat, r).ok, false);
  const extra = { ...bundle, content: { ...bundle.content, history: 'should not be here' } };
  assert.equal(validateExport(extra, r).ok, false);
  assert.throws(() => validateExport('not an object', r), InvalidExportError);
});

test('history records roles and actions, never identities', () => {
  const r = closedCase();
  for (const h of r.history) {
    assert.ok(!JSON.stringify(h).includes('per_'), 'no person ids in history');
    assert.ok(['reporter', 'reviewer', 'subject'].includes(h.byRole));
  }
});
