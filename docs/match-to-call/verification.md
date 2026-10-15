# Queue-to-call verification

The two-browser proof passed at `4c28ad84a38da59d01711ab48a27bad4d5ee1375` on 2026-10-15, after merging alpha `7aabfb8bc54709cfb5d105a2536438da0153c24e`. Generated bindings were taken from alpha and regenerated with installed Convex 1.46, using Node 24. [The result](browser-proof.json) records eight checks, including one shared meeting with exactly A and B as participants, each peer decoding the other fixture's color and advancing frame counter, leaving, and queue reentry. The browsers used local test identities and synthetic camera/audio fixtures. This does not verify production WorkOS login or physical devices.

## Checks

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --project convex convex/matching/callQueue.test.ts convex/matching/matching.test.ts convex/meetings/webrtc/mesh.test.ts convex/meetings/webrtc/ice.test.ts convex/prompts/live.test.ts` | 69 passed |
| `pnpm exec vitest run --project in-call test/in-call/match-queue.test.tsx test/in-call/stream-optional.test.tsx test/in-call/convex-provider-owner.test.tsx test/in-call/convexProviderTestAuth.test.tsx test/in-call/callRoomIceLoading.test.tsx test/in-call/conversation-prompts.test.tsx` | 37 passed |
| `pnpm exec vitest run --project frontend src/proxy-test-auth.test.ts` | 8 passed |
| `~/.long-run/bin/heavy pnpm exec tsx tools/call-eval/scripts/match-queue-proof.ts --port=3101` | 8 checks passed, 24 captures, zero queue-scoped axe violations |
| `~/.long-run/bin/heavy pnpm exec tsx tools/call-eval/scripts/queue-component-shots.ts --port=3101` | 8 component fixture captures |
| `pnpm type-check` | Fails. Alpha 7aabfb8 and this branch each have 32 app errors and 444 call-eval errors. Comparing file, line, column and error-code locations found zero added or removed diagnostics. Message text differs only in temporary paths and type ordering. |
| `pnpm lint` | Fails because the pinned Next 16 CLI has no `next lint` command. |

All 114 selected tests passed. Direct ESLint using `eslint-config-next/core-web-vitals` passes the changed queue code, tests, and browser scripts. The changed Stream wrapper retains one existing `react-hooks/set-state-in-effect` error, also reproduced on base `f504304bc10d43c5fe6ccf5c0062e593ac809b8c`. The Convex wrapper retains an existing dependency warning. Neither lint finding comes from the new wrapper guards.

Mobile Lighthouse ran against `http://localhost:3101/app/match-queue?as=O` with `--form-factor=mobile --only-categories=performance,accessibility --chrome-flags=--headless`. It scored 68 performance and 100 accessibility. [Selected measurements](ui-checks.json) identify the development-server limitation. Keyboard focus, Tab and Shift+Tab between invitation actions, reduced motion, and dark hover contrast passed in the browser proof.

## Evidence

- `screenshots/before-mock-*` are historical captures recovered from the interrupted attempt at base `f504304`. They show the mock partner and cannot use the new real-user fixture.
- The 24 live captures use shipped routes at the proof commit. Both sizes are 1440×900 and 390×844.
- The eight `component-*` captures use the real `QueueView` in the app shell with explicit loading, idle, signed-out, and ready fixtures. Their temporary route is removed after capture. They are not live authentication or meeting transitions.
- `queue-to-call.mp4` is the full normal-speed recording of the successful automated journey for peer A. It includes viewport changes, acceptance, the lobby, connected media and queue reentry. Raw recordings and generated camera fixtures are removed after verification.

## Remaining limits

- Real calls require the existing `NEXT_PUBLIC_CONNVO_REAL_CALL=1` gate. This branch does not change deployment settings.
- All professional entry points share one professional pool. Mentorship, investment, collaboration, and B2B intent are not separate filters.
- Matching scans the waiting pool and compares candidate pairs. Production-scale load and retention have not been measured.
- Invitation and availability defaults are 60 seconds and 15 minutes. They are policy choices without usage calibration.
- The existing mobile navigation overlaps the redundant footer in taller queue states. Queue controls remain readable. The shared navigation is outside this lane's changes.
- Root and app layouts previously mounted two auth owners for one Convex client. The shared wrapper now suppresses a nested owner, and the regression verifies that removing it preserves authentication. The two protected layout-provider files and server authorization rules remain unchanged.
