# Connvo conduct review — offline proposal

A self-contained proposal for a communication-conduct review flow: a
zero-dependency state engine with exact role-based disclosure, and a fully
offline demo page built from it. **All data on the page and in the fixtures is
synthetic** — every person, id, timestamp and note is invented. No real
transcripts, credentials, or personal data are used anywhere.

## What is here

```
core.js               state machine: draft → submitted → triaged → closed (all
                      transitions reversible), per-case reviewer authorization
                      granted by a second reviewer, optimistic-revision
                      conflicts, evidence-conflict and missing-evidence
                      closure guards, role-by-state disclosure allowlists
                      (buildView), redacted export builder (buildExport).
fixtures.js           synthetic people, fixed clock (TS), and case fixtures.
validate.js           independent, fail-closed export validator: token scan
                      against the raw record plus a shape scan (identity-shaped
                      content fails even if the record never contained it).
ui/index.template.html  offline demo page template (reporter / subject /
                      reviewer role views, keyboard-accessible tabs, reduced
                      motion, responsive to 375px).
build.mjs             deterministic bundler: engine → dist/index.html.
test/engine.test.mjs  engine, disclosure, export, and validator tests.
test/build.test.mjs   build determinism, dist freshness, no-remote checks, and
                      a lifecycle smoke test run against the real built bytes.
dist/index.html       the built page (committed; must stay fresh — tested).
```

## Run

```
node --test "test/*.test.mjs"     # from this directory (or: npm test)
node build.mjs                    # rebuild dist/index.html after editing
```

## Design rules

- **Every engine call takes an explicit clock.** Nothing reads `Date.now()`;
  time is always a parameter, so behavior is fully deterministic.
- **Views are allowlists, not filters.** `buildView` emits exactly the fields
  the disclosure policy grants per role and state — the UI cannot leak by
  rendering more, because there is nothing more to render.
- **The reporter's statement is unverified.** Views label it as such and keep
  it separate from independently collected evidence.
- **Exports are redacted and independently validated.** Ids, emails, URLs,
  phones and handles are scrubbed (recursively, including evidence fact
  arrays); the validator re-derives the identity tokens from the raw record
  and fails closed on any match, plus a shape scan for identity-like content.
- **The page is offline.** No remote resources, no fetch, no clock: the build
  test asserts the built page contains none of `http://`, `https://`,
  `<script src=`, `<link `, `@import`, `url(`.
- **The build is byte-deterministic** — two runs produce identical bytes
  (sha256-checked in tests), and `dist` must be rebuilt before commit
  (freshness test).

## States and policy

`draft → submitted → triaged → closed`, with `reopen_to_submitted` from
triage/closed (reopen guard: no missing-evidence close), `withdraw_to_draft`
from submitted, and `reopen_to_triaged` from closed. The reporter edits only
in draft; the subject can be told a case exists only after triage and may add
exactly one response; a reviewer may read only with per-case authorization
granted by a second reviewer. Closing with conflicting evidence requires a
resolution note; closing with missing evidence is refused.
