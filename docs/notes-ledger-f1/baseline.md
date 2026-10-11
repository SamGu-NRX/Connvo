# Baseline @ alpha `ddc94d46109138b0f06508ac824d2d2f139768ca`

Recorded 2026-10-11 in the task sandbox (`pnpm install` clean, exit 0, pnpm 9.15.9, node v20.20.2).

## `pnpm type-check` — exit 2

**32 errors** (matches the count PR #24 recorded as the M1 baseline; composition below).

| File | Count | Codes |
|---|---|---|
| src/components/ui/chart.tsx | 7 | TS7006 ×3, TS2339 ×3, TS2344 |
| src/hooks/useTranscription.ts | 5 | TS2322 |
| src/hooks/useMeetingLifecycle.ts | 4 | TS2322 ×3, TS2345, TS2561 |
| src/hooks/usePostCallInsights.ts | 3 | TS2322 ×2, TS2339 |
| src/hooks/useCollaborativeNotes.ts | 3 | TS2322 ×3 (MeetingNote drift; `number \| undefined` → `number`; batch payload shape) |
| src/hooks/usePreCallPrompts.ts, useInCallPrompts.ts | 2 | TS2353 ×2 |
| test/test.setup.mts | 2 | TS2688 (vite/client), TS2339 (import.meta.glob) |
| test/convex/setup.ts | 1 | TS2722 |
| test/convex/openapiExamples.test.ts | 2 | TS2353 ×2 |
| src/components/mvp/one-on-one-meeting.tsx | 1 | TS2741 |
| src/app/videocall/[id]/page.tsx | 1 | TS7006 |

All 32 are pre-existing on the base. `src/hooks/useCollaborativeNotes.ts` is intentionally NOT modified by
this task (out-of-bounds call pages still import it); its 3 errors remain. The new code must add **zero** new
errors (bar: ≤32 total, no new codes, and no errors in new files).

## `pnpm test:run` — exit 1

**Test Files: 1 failed | 16 passed (17) — Tests: 1 failed | 239 passed (240) — 1 unhandled error.**

- Failing: `convex/types/__tests__/performanceValidation.test.ts > Performance Validation > Runtime Performance > ArrayBuffer operations are efficient` (185 ms) — pre-existing, performance-flavored.
- 1 unhandled error reported by vitest (convex-test@0.0.38 internals, `Write outside of transaction 10008;_scheduled_functions`) — the same pre-existing unhandled rejection PR #24 documented on the M1/M2 trees.

## CI triggers (verified in `.github/workflows/`)

- `ci.yml`: push → `[main, develop]`; pull_request → `[main]`.
- `type-validation.yml`: push → `[main, develop]`; pull_request → `[main, develop]`.

No workflow triggers on pushes to `obv/*` branches or PRs into `alpha`. Branch pushes and the draft PR are
therefore not workflow-producing operations; full local verification (type-check + test:run + new suites) runs
before every push regardless.
