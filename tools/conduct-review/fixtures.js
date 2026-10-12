/**
 * Synthetic fixtures — every person, id, email and note here is invented.
 * The clock is fixed: no test or build ever reads the real time.
 */

import { createCase, updateDraft } from './core.js';

export const TS = {
  t0: '2026-10-10T19:00:00.000Z', // case created
  t1: '2026-10-10T19:03:00.000Z', // draft statement written
  t2: '2026-10-10T19:06:00.000Z', // submitted
  t3: '2026-10-10T19:10:00.000Z', // per-case reviewer authorization granted
  t4: '2026-10-10T19:20:00.000Z', // triaged
  t5: '2026-10-10T19:35:00.000Z', // subject account shared
  t6: '2026-10-10T19:50:00.000Z', // closed
};

export const PEOPLE = {
  reporter: { id: 'per_casey_rivera', name: 'Casey Rivera', email: 'casey.rivera@example.net', phone: '+1 555 010 2233' },
  subject: { id: 'per_jordan_lee', name: 'Jordan Lee' },
  reviewerAuthorized: { id: 'per_priya_rao', name: 'Priya Rao' },
  reviewerGrantor: { id: 'per_marco_diaz', name: 'Marco Diaz' },
  witness: { id: 'per_morgan_tan', name: 'Morgan Tan' },
};

/** Fresh deep copies, so a test can never mutate another test's people. */
export function makePeople() {
  return JSON.parse(JSON.stringify(PEOPLE));
}

export function makeReviewers() {
  var p = makePeople();
  return { grantor: p.reviewerGrantor, authorized: p.reviewerAuthorized };
}

export const SYNTHETIC_STATEMENT =
  'During our coffee chat in meeting mtg_syn_001, Jordan Lee repeatedly talked over me and ' +
  'dismissed my questions, and the meeting became unproductive for me. Morgan Tan was also in ' +
  'the meeting and may have seen part of it. I am asking for a reviewer to look at this; I am ' +
  'not asking for any specific action. If needed you can reach me at casey.rivera@example.net ' +
  'or +1 555 010 2233.';

/** Reviewer-collected evidence entry. `facts` carry what was independently observed. */
export function evidenceWithFacts() {
  return [
    {
      id: 'ev_syn_001',
      collectedBy: PEOPLE.reviewerAuthorized.id,
      at: TS.t4,
      facts: ['Meeting notes from mtg_syn_001 independently confirm the described exchange took place as reported.'],
    },
  ];
}

/** Two evidence entries whose facts contradict each other. */
export function conflictingEvidence() {
  return [
    {
      id: 'ev_syn_001',
      collectedBy: PEOPLE.reviewerAuthorized.id,
      at: TS.t4,
      facts: ['Meeting notes from mtg_syn_001 independently confirm the described exchange took place as reported.'],
    },
    {
      id: 'ev_syn_002',
      collectedBy: PEOPLE.reviewerGrantor.id,
      at: TS.t4,
      facts: ['A separate attendee present for the whole meeting recalls no such exchange and describes the discussion as calm.'],
    },
  ];
}

/**
 * Draft case with a statement and evidence on file, built through the real
 * engine calls so the history reads exactly like a lived-in case.
 */
export function draftCaseWithEvidence(options) {
  var opts = options || {};
  var p = makePeople();
  var rec = createCase({
    caseId: opts.caseId || 'case_syn_001',
    reporterId: p.reporter.id,
    subjectId: p.subject.id,
    meetingId: opts.meetingId || 'mtg_syn_001',
    category: opts.category || 'communication_conduct',
    now: TS.t0,
  });
  rec = updateDraft(rec, p.reporter.id, { statement: SYNTHETIC_STATEMENT, category: opts.category || 'communication_conduct', meetingId: opts.meetingId || 'mtg_syn_001' }, rec.revision, TS.t1);
  // Default to one collected evidence entry; pass evidence: [] to model a
  // case with nothing independently collected.
  rec.evidence = opts.evidence !== undefined ? opts.evidence : evidenceWithFacts();
  return rec;
}

/** A case with nothing independently collected — must close as insufficient evidence. */
export function missingEvidenceCase() {
  return draftCaseWithEvidence({ evidence: [] });
}

/** A case whose two evidence entries contradict each other. */
export function conflictingEvidenceCase() {
  return draftCaseWithEvidence({ evidence: conflictingEvidence() });
}
