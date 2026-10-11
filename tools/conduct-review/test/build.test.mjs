import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const distPath = join(root, 'dist/index.html');

function runBuild() {
  execFileSync('node', [join(root, 'build.mjs')], { cwd: root, stdio: 'pipe' });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('build is deterministic: two consecutive builds produce identical bytes', () => {
  runBuild();
  const first = sha256(distPath);
  runBuild();
  const second = sha256(distPath);
  assert.equal(first, second, 'two builds of the same sources must produce identical bytes');
});

test('committed dist is fresh: it matches a rebuild of the current sources', () => {
  assert.ok(existsSync(distPath), 'dist/index.html must exist (run node build.mjs and commit it)');
  const before = sha256(distPath);
  runBuild();
  assert.equal(sha256(distPath), before, 'dist must be rebuilt from current sources before commit');
});

test('built page has no remote resources or network affordances', () => {
  const html = readFileSync(distPath, 'utf8');
  for (const marker of ['http://', 'https://', '<script src=', '<link ', '@import', 'url(']) {
    assert.equal(html.includes(marker), false, `built page must not contain ${JSON.stringify(marker)}`);
  }
});

test('built bundle drives a full lifecycle and the export passes the validator', () => {
  const html = readFileSync(distPath, 'utf8');
  const m = html.match(/\/\*__ENGINE_BUNDLE_START__\*\/([\s\S]*?)\/\*__ENGINE_BUNDLE_END__\*\//);
  assert.ok(m, 'engine bundle markers must survive the build');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox, { filename: 'engine-bundle.js' });
  const { core, fixtures, validate } = sandbox.window.__ENGINE__;

  // Full lifecycle through the real built bytes, on the fixtures' fixed clock.
  let rec = core.createCase({
    caseId: 'case_syn_001',
    reporterId: fixtures.PEOPLE.reporter.id,
    subjectId: fixtures.PEOPLE.subject.id,
    meetingId: 'mtg_syn_001',
    category: 'communication_conduct',
    now: fixtures.TS.t0,
  });
  rec = core.updateDraft(rec, fixtures.PEOPLE.reporter.id, { statement: fixtures.SYNTHETIC_STATEMENT, category: 'communication_conduct', meetingId: 'mtg_syn_001' }, rec.revision, fixtures.TS.t1);
  rec = core.applyTransition(rec, 'submit', fixtures.PEOPLE.reporter.id, { expectedRevision: rec.revision, now: fixtures.TS.t2 });

  const reviewer = fixtures.PEOPLE.reviewerAuthorized.id;
  const grantor = fixtures.PEOPLE.reviewerGrantor.id;
  rec = core.grantReviewAuthorization(rec, { reviewerId: reviewer, grantedBy: grantor }, rec.revision, fixtures.TS.t3);
  rec = core.applyTransition(rec, 'triage', reviewer, { expectedRevision: rec.revision, now: fixtures.TS.t4 });
  rec.evidence = fixtures.evidenceWithFacts();
  rec = core.addSubjectResponse(rec, fixtures.PEOPLE.subject.id, { text: 'I did not intend the comment that way.' }, rec.revision, fixtures.TS.t5);
  rec = core.applyTransition(rec, 'close', reviewer, { expectedRevision: rec.revision, now: fixtures.TS.t6, outcome: 'documented_feedback', resolutionNote: 'Aligned on expectations; follow-up scheduled.' });

  // Pre-triage opacity, checked through the same bundle the page loads.
  const draftRec = fixtures.draftCaseWithEvidence();
  const preTriage = core.buildView(draftRec, 'subject');
  assert.equal(preTriage.exists, false, 'subject view must not exist before triage');

  const bundle = core.buildExport(rec, { reviewerId: reviewer, now: fixtures.TS.t6 });
  assert.equal(bundle.format, validate.EXPECTED_EXPORT_FORMAT);
  assert.equal(bundle.version, validate.EXPECTED_EXPORT_VERSION);
  const verdict = validate.validateExport(bundle, rec);
  assert.equal(verdict.ok, true, 'export must pass the independent validator: ' + verdict.error);
});
