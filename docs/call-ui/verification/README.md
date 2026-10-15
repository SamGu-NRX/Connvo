# Call UI acceptance evidence

For the integration lead. This branch remains a draft because live adaptive quality needs a transport-owned peer connection hook.

- `src/lib/call/network-quality.ts` implements interval stats, hysteresis, sender parameter updates, and cleanup. It has no runtime importer. The transport owner must attach one monitor to each peer connection, dispose it on peer teardown, and expose snapshots to the call UI. `transport.ts` and `p2p-transport.ts` remain unchanged under lane ownership rules. No network indicator currently claims to measure a live call.
- The initial polish matrix passed 12/15 cells; all three P-03 keyboard cells failed. `p-initial.json` retains those failures. The focus trace showed a cycle between Leave and the global toast. Call notifications now use a noninteractive live status. The unchanged P-03 scenario then passed all three seeds in `keyboard.json`.
- Mobile Lighthouse on the development build scored accessibility 100 and performance 50. Its 11.9-second LCP and 1,310ms blocking time are not a production benchmark. See `lighthouse.json`.
- WebKit lobby axe reported zero violations. The two-peer synthetic-media attempt did not deliver remote video: A stayed alone, B reached failed, and A's local synthetic canvas video stayed at readyState 0. This run does not establish Safari call support. See `webkit.json`.
- The real blur worker processed Chromium frames, stopped its output on disposal, preserved its input, and honored cancellation. WebKit reported unsupported and preserved its live input. See `blur-runtime.json`.
- The first H-01..H-06 run passed 17/18 cells. Seed 2 exceeded H-01's five-second first-frame bar at 7.9 seconds. `h-initial.json` retains that failure. All other cells passed.
- `type-baseline.json` compares the application compiler against the base through an in-memory compiler host. Alpha `35895b1` and this branch report the same 32 diagnostics, with no added diagnostic. The full `pnpm type-check` also reports 444 harness diagnostics after merging TURN.
- `pnpm lint` invokes `next lint`, which Next 16 no longer provides. Targeted ESLint uses `docs/call-ui/eslint.config.mjs`, the installed Next core-web-vitals rules in flat-config format. It passes for the changed production TypeScript files.

The browser fixtures use generated media. They prove rendering, state and connection behavior under automation; they do not establish real iPhone camera switching, permission prompts, physical audio playback, or low-end device performance. `check.mjs` also mounts the real side-panel component in an isolated fixture. That fixture verifies sheet behavior and preserves an unsaved textarea; it does not verify Convex notes persistence.

## Prep-for-prod source review

Scope: the lane's call page, capture hook, processing worker, responsive panel and picture-in-picture controls. A separate read-only reviewer found the first two issues below. Focused regression tests now cover both.

| Before | After | Reason |
| --- | --- | --- |
| Force-mounted Radix modal blocked the mobile call while closed | Native dialog enters the top layer only while open; the editor remains mounted | `prep-for-prod` accessibility and focus rules |
| Camera and quality changes briefly published raw video with blur enabled | Outgoing video pauses until the replacement processed track is ready | Blur must not silently reveal the background |
| Transparent lobby controls disappeared over bright pixels | Dark control backing | Readable controls over arbitrary video |
| Late signaling could publish old mute state or connect after leave | Attempt generation guards and publication from current capture state | Leave and current controls must remain authoritative |

Picture-in-picture uses an interruptible spring on pointer release, with an immediate corner change for keyboard and reduced-motion input. Sheet movement is limited to pointer opening and disabled under reduced motion. The layout uses `100dvh`, safe-area padding, 44px media controls, and 16px selects on phones. Physical iOS verification remains open.
