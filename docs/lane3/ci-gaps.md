# Remaining CI blockers

`pnpm exec eslint src convex tools test --format json` reports 12 errors and 23 warnings after the Next 16.4.1 upgrade. `pnpm type-check` passes both compilers, full Convex codegen and its 101 validator checks pass, and the production build passes. No lint rule was disabled.

The `test` job remains blocked at `pnpm lint`, before its tests and build. These errors are in call UI, queue behavior, and Andrew's landing page. Sam's queue exception authorized the minimal search-parameter Suspense boundary; it did not transfer queue behavior or the other owners' code.

- `src/app/page.tsx`: line 277 `react-hooks/set-state-in-effect`, line 417 `react/no-unescaped-entities`, line 417 `react/no-unescaped-entities`.
- `src/components/call/CallRoom.tsx`: line 111 `react-hooks/refs`.
- `src/components/meeting-notes/MeetingNotesPanel.tsx`: line 73 `react-hooks/set-state-in-effect`.
- `src/components/meeting/CollaborativeNotesEditor.tsx`: line 59 `react-hooks/set-state-in-effect`, line 67 `react-hooks/set-state-in-effect`.
- `src/components/queue/LiveMatchQueue.tsx`: line 158 `react-hooks/set-state-in-effect`.
- `src/hooks/useLocalMedia.ts`: line 101 `react-hooks/refs`, line 124 `react-hooks/refs`, line 329 `react-hooks/refs`, line 332 `react-hooks/refs`.

## Commands each CI job runs

| Job | Local validation |
| --- | --- |
| `test` | `pnpm type-check`, `pnpm lint`, `pnpm test:run`, anonymous backend startup, `pnpm build` |
| Validate Types and Consistency | `pnpm type-check`, anonymous backend startup, `pnpm convex:codegen`, `pnpm test:types`, `pnpm validate-types` |
| Cross-Platform Type Compatibility, Node 20/22 on Windows/macOS/Ubuntu | `pnpm type-check` and `pnpm test:run convex/types/__tests__/typeAlignment.test.ts` |
| Type Performance Validation | `pnpm test:run convex/types/__tests__/propertyBasedTests.test.ts --reporter=verbose`, anonymous backend startup, `pnpm build` |

`pnpm type-check` invokes `tsc --noEmit` for the app and `tsc --noEmit -p tools/call-eval` for strict JavaScript. Fixing only alpha's 32 app errors would have left the JavaScript check failing. Both now return zero.

The build uses the anonymous backend URL exported from its checked state file. The local codegen wrapper validates that the selected deployment is this checkout's loopback backend, then generates against the complete Convex function tree. Cloud deploy jobs retain direct `pnpm exec convex codegen` and `pnpm exec convex deploy` commands. No production deploy was run by this lane.
