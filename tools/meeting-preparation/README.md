# tools/meeting-preparation

Offline pre-call preparation workspace for Connvo (L3 task
`obv/products-l3-meeting-preparation-20261010`, based on the hardening branch
`obv/products-connvo-hardening-20261009-r1`). Self-contained: no imports from
`src/` or `convex/`, no network calls, no production navigation.

## What it is

A local page that helps a participant prepare for an upcoming meeting:

- binds **one synthetic upcoming meeting** (fixed timestamp, state
  `scheduled`) and an **explicit permitted profile projection** to editable
  agenda items and source notes;
- lets the user **agree an agenda** (each proposal → agreed only by an
  explicit action; proposals are suggestions, never inferred consent and
  never promised outcomes), **record open questions**, and **save a local
  preparation document** (a download, built entirely in the browser);
- never shows or exports a note about the other participant unless the
  **fixture contract** explicitly marks it shareable (`shareability:
  "shared"` with a `contractRationale`).

## Permission model (mirrors the hardening base)

`src/contract.ts` mirrors production's `getProfileByUserIdPublic`
(`convex/profiles/queries.ts`): exactly `displayName, bio, goals, languages,
experience, field, jobTitle, company` may be projected to another
participant; `age, gender, linkedinUrl` are sensitive fields that are
excluded for privacy and are never displayed, exported, or read by the
exported-document reader. Visibility is tenancy-bounded (self / same-org /
shared meeting); a stranger gets `not-visible`.

## Commands

```sh
npm test            --prefix tools/meeting-preparation   # vitest suites
npm run build       --prefix tools/meeting-preparation   # esbuild -> dist/
npm run test:browser --prefix tools/meeting-preparation  # build + Playwright walk
```

`npm test` also regenerates `results/fixture-inventory.json` and
`results/export-reader-checks.json` (committed evidence).

## Layout

- `src/contract.ts` — fixture contract: source types, shareability, statuses, permitted/excluded profile fields, labels, disclaimer
- `src/fixtures.ts` — synthetic meeting, participants, internal profiles, visibility grants, initial agenda, exact counts
- `src/projection.ts` — fail-closed permitted projection
- `src/workspace.ts` — agenda agreement, open questions, private notes (state model)
- `src/export.ts` — preparation-document builder + serializer
- `src/reader.ts` — independent exported-document reader (own validators)
- `src/index.ts`, `src/ui.ts`, `page/index.html` — the offline page
- `tests/` — vitest suites; `tests/browser/walk.mjs` — Playwright keyboard/reduced-motion walk with axe
- `evidence/` — committed screenshots and axe results
- `results/` — committed count inventories

## Verification record

Updated per milestone; see the task's draft PR for the Handoff section.
