# Connvo hardening — baseline (branch obv/products-connvo-hardening-20261009-r1, base 8d73d9b)

Measured 2026-10-10 after `pnpm install --frozen-lockfile` (pnpm 12.11.2, lockfileVersion 9.0).
pnpm install succeeded; pnpm blocked postinstall build scripts for protobufjs@7.5.4, sharp@0.34.4, unrs-resolver@1.11.1 (default policy). Nothing below depends on them.

## Commands and counts
| Command | Result |
|---|---|
| `pnpm exec vitest run --project convex` | 17 files / 240 tests passed; 1 unhandled error after suite completion (insights.test.ts, "generates insights for each participant in a concluded meeting" — scheduled-invocation error surfacing outside the test, same class R5 saw in onboarding.test.ts) |
| `pnpm type-check` (tsc --noEmit) | exit 2 — 32 errors, 0 in convex/ (src/components/ui/chart.tsx 8, useTranscription 5, useMeetingLifecycle 4, usePostCallInsights 3, useCollaborativeNotes 3, test.setup.mts 2, openapiExamples.test.ts 2, +1 each in usePreCallPrompts, useInCallPrompts, one-on-one-meeting, videocall page, test/convex/setup.ts) |
| `pnpm lint` | broken repo-wide: `next lint` was removed in Next 16 ("Invalid project directory provided ... /Connvo/lint") — pre-existing, untouched here |
| `pnpm build` | pre-existing failure: module-scope NEXT_PUBLIC_CONVEX_URL throw (ConvexClientProvider.tsx:16-20), then useSearchParams-without-Suspense on 7 pages — rerun with placeholder config later in this branch; unrelated errors documented, not weakened |

Known pre-existing test flake: convex/transcripts/ingestion.test.ts:198 fails when wall clock places a +60s chunk across a 5-minute bucket (baseTime % 300000 > 240000); fixed on the transcripts slice merged after this baseline.
