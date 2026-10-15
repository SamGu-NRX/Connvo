# CI blockers after merging alpha 7aabfb8

`pnpm lint --format json` reports 27 errors and 23 warnings at `69f0d86d78b032d3e70d220357fdb77d1a6513d3`. The strict Next rules are enabled. `pnpm type-check` and `pnpm validate-types` pass.

All 828 unit tests in 78 files pass on that tree. The remote performance job gets through compilation and TypeScript, then fails prerendering `/app/smart-connection`: `useSearchParams()` at `src/app/app/smart-connection/page.tsx:9` has no Suspense boundary. The queue page belongs to lane 1. [Exact CI failure](https://github.com/SamGu-NRX/Connvo/actions/runs/38703087688/job/116316423973).

Both the `test` job and every compatibility matrix entry run `pnpm type-check`. It invokes `tsc --noEmit` for the app and `tsc --noEmit -p tools/call-eval` for strict JavaScript checking. The type-validation job also runs that script, then full Convex codegen, the type tests, and `pnpm validate-types`. The performance job runs the 12 property tests and `pnpm build`, which includes Next's TypeScript check. Fixing only the app's 32 errors would leave the JavaScript check failing; both compilers now return zero.

The errors below require fixes before the `test` CI job can pass. Call UI, queue, and Andrew's landing page have separate owners. No lint rule was disabled to hide them.

- `src/app/app/dashboard/page.tsx`: 22 `react-hooks/set-state-in-effect`.
- `src/app/dev/auth-proof/auth-proof-client.tsx`: 50 `react-hooks/set-state-in-effect`.
- `src/app/page.tsx`: 277 `react-hooks/set-state-in-effect`, 417 `react/no-unescaped-entities`, 417 `react/no-unescaped-entities`.
- `src/app/videocall/[id]/page.tsx`: 145 `react-hooks/set-state-in-effect`, 271 `react-hooks/set-state-in-effect`, 465 `react-hooks/set-state-in-effect`.
- `src/components/call/CallRoom.tsx`: 111 `react-hooks/refs`.
- `src/components/history/MeetingList.tsx`: 134 `react-hooks/refs`.
- `src/components/meeting-notes/MeetingNotesPanel.tsx`: 73 `react-hooks/set-state-in-effect`.
- `src/components/mvp/user-card/schedule-modal.tsx`: 50 `react-hooks/purity`.
- `src/components/queue/SmartConnectionEngine.tsx`: 38 `react-hooks/set-state-in-effect`.
- `src/components/ui/macbook-scroll.tsx`: 49 `react-hooks/set-state-in-effect`.
- `src/components/video-meeting/toast.tsx`: 55 `react-hooks/set-state-in-effect`.
- `src/hooks/notes/notesConvexTransport.tsx`: 62 `react-hooks/set-state-in-effect`, 118 `react-hooks/refs`, 131 `react-hooks/refs`.
- `src/hooks/notes/useNotesLedger.ts`: 42 `react-hooks/purity`, 42 `react-hooks/purity`.
- `src/hooks/useLocalMedia.ts`: 101 `react-hooks/refs`, 124 `react-hooks/refs`, 329 `react-hooks/refs`, 332 `react-hooks/refs`.
- `src/lib/test-auth.test.ts`: 21 `react-hooks/globals`.
- `src/lib/test-auth.tsx`: 164 `react-hooks/set-state-in-effect`.
- `src/providers/StreamClientProvider.tsx`: 41 `react-hooks/set-state-in-effect`.
