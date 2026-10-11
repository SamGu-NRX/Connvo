/**
 * Deterministic offline build: bundles the engine modules (core, fixtures,
 * validate) into the UI template and writes dist/index.html.
 *
 * Guarantees:
 *  - No network, no clock, no randomness: the output bytes depend only on the
 *    input files, so two runs produce identical bytes (tested).
 *  - The bundle is plain concatenation with `import` lines dropped and
 *    `export` keywords stripped; the validator's module-private pattern table
 *    is renamed textually (VALIDATOR_IDENTITY_PATTERNS) so the two scopes
 *    merge without collisions.
 *  - The export contract (which names each module exposes to the page) is
 *    checked: a missing name fails the build instead of shipping broken.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

// The page-facing contract: exactly these names reach the UI.
const CONTRACT = {
  core: ['STATES', 'CATEGORIES', 'OUTCOMES', 'TRANSITIONS', 'DISCLOSURE_POLICY',
    'AccessError', 'StateError', 'ConflictError', 'ValidationError', 'AuthorizationError', 'ExportRefusalError',
    'resolveActorRole', 'isAuthorized', 'allowedActions', 'createCase', 'updateDraft',
    'grantReviewAuthorization', 'addSubjectResponse', 'applyTransition', 'buildView', 'buildExport',
    'EXPORT_FORMAT', 'EXPORT_VERSION'],
  fixtures: ['TS', 'PEOPLE', 'makePeople', 'makeReviewers', 'SYNTHETIC_STATEMENT',
    'evidenceWithFacts', 'conflictingEvidence', 'draftCaseWithEvidence',
    'missingEvidenceCase', 'conflictingEvidenceCase'],
  validate: ['validateExport', 'InvalidExportError', 'plantLeak', 'EXPECTED_EXPORT_FORMAT', 'EXPECTED_EXPORT_VERSION'],
};

// Concatenation order is fixed; validate last so its rename cannot shadow core.
const SOURCES = [
  ['core', 'core.js', (s) => s],
  ['fixtures', 'fixtures.js', (s) => s],
  ['validate', 'validate.js', (s) => s.replaceAll('IDENTITY_PATTERNS', 'VALIDATOR_IDENTITY_PATTERNS')],
];

let body = '';
for (const [name, file, transform] of SOURCES) {
  const raw = read(file);
  const stripped = transform(raw)
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export /gm, '');
  body += `\n/* ---- ${name} (${file}) ---- */\n${stripped}\n`;
}

for (const [mod, names] of Object.entries(CONTRACT)) {
  for (const n of names) {
    if (!new RegExp('\\b(?:const|let|var|function|class)\\s+' + n + '\\b').test(body)) {
      throw new Error(`build failed: contract name missing from bundle: ${mod}.${n}`);
    }
  }
}

const bundle =
  `window.__ENGINE__ = {\n` +
  Object.entries(CONTRACT).map(([mod, names]) => `  ${mod}: { ${names.join(', ')} }`).join(',\n') +
  `\n};`;

const template = read(join('ui', 'index.template.html'));
const START = '/*__ENGINE_BUNDLE_START__*/';
const END = '/*__ENGINE_BUNDLE_END__*/';
const startAt = template.indexOf(START);
const endAt = template.indexOf(END);
if (startAt === -1 || endAt === -1 || endAt < startAt) {
  throw new Error('build failed: engine bundle markers missing from the template');
}

const out = template.slice(0, startAt + START.length) + '\n' + body + '\n' + bundle + '\n' + template.slice(endAt);

mkdirSync(join(here, 'dist'), { recursive: true });
const distPath = join(here, 'dist/index.html');
writeFileSync(distPath, out);
process.stdout.write(`built ${distPath} (${out.length} bytes)\n`);
