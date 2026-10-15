# Call UI acceptance evidence

For the integration lead reviewing PR #46. The current source includes alpha `3055350`, including its lint repairs and the preceding Next 16.4.1, meeting-end and late-camera updates. Generated Convex files and `transport.ts` match alpha. The P2P change adds a peer observer callback and a stale-peer teardown guard outside the late-camera path.

## Source checks

- `sh docs/call-ui/check-source.sh` on `7fd8eb4`: 136 tests in 15 files, scoped ESLint and `pnpm type-check` pass. The obsolete lint configuration, compiler-baseline workaround and stale diagnostic report were removed after alpha repaired the root commands.
- `pnpm test:run`: 978 tests in 96 files pass after merging `3055350`.
- `pnpm exec eslint src convex tools test`: zero errors, 23 warnings after merging lane 8.
- `pnpm type-check`: zero errors.
- `NEXT_PUBLIC_CONNVO_TEST_AUTH=0 NEXT_PUBLIC_CONNVO_LOCAL_BUILD=0 ~/.long-run/bin/heavy pnpm build`: pass. This selects the production auth path; the initial build correctly refused the local test-auth configuration.

The refs repair publishes the stream identity through React state while capture callbacks keep an imperative ref. PiP commits its resize callback in a layout effect. No lint rule is disabled.

## Real call checks

On alpha `7fd8eb4`, the real Convex matrix passed H 18/18 and P 15/15 across seeds 1, 2 and 3. After merging `3055350`, the requested one-seed H-01..H-06 run passed 6/6 on the real Convex page. The real panel check passed again with shared prompts, persisted notes, keyboard checks at all three sizes and nine axe scans with zero violations. See `h-after-lint-merge.json` and `real-panel.json`.

`real-panel-check.mjs` uses the local Convex backend, real call route and two harness identities. It checks shared prompt actions, confirms notes in the second browser and reads the saved content from Convex. At 1440x900, 390x844 and 844x390 it checks accessible names, Tab access to prompts and notes, Escape focus restoration, retained text and scrolling geometry. The screenshots named `real-*` show this page, including the actual `MeetingNotesPanel` and live prompts card. Prompt selection uses the production bank fallback with no paid model request.

`network-check.mjs` also uses the real Convex call. The browser fixture retains its local TURN configuration through `setConfiguration`, so actual RTP crosses the UDP shaper. Native stats and sender APIs show a 250 kbps limit and 2× downscaling under 15% loss and 300 ms delay, then restoration of the original settings after recovery. Injecting a stats failure produces a neutral unavailable indicator. See `network-live.json`. The initial relay attempt and reference-signaling control are retained separately.

The first Convex polish run passed 12/15 cells. P-02 found contrast failures in the notes loading badge and counts during their entrance fade. The panel now owns entrance motion and its notes remain opaque. The second run on alpha `6c0ae81` passed H 18/18 and P 15/15. The final matrices identify their signaling mode and seeds in their JSON.

## Safari

The original `webkit-check.mjs` was run against plain alpha `6c0ae81045d02bcc9501221e39b00f5591ee93dd` and this branch. Both failed before Join. The Stream SDK's `webrtc-adapter` replaced the assignment-based synthetic `getUserMedia` override, so the check reached native capture and received `NotAllowedError`. The fixture now keeps its override stable. See `webkit-alpha.json` and `webkit-branch.json`.

With that fixture correction, the lobby plays, but automated WebKit still fails to connect two peers. The standalone HTML control in `webkit-capture-minimal.json` reproduces failed cross-page WebRTC with no app code, although same-page loopback and canvas detach/rebind play. The retained-consumer check then isolated a narrower unresolved app interaction. Both lobbies played at readyState 4, 640 pixels wide. Immediately after Join, the app and plain video played the same video track. After peer B failed, the app element was at readyState 0 while the plain element still played at time 32.6 seconds. This is not explained by the standalone ICE failure. It remains a synthetic-WebKit element/rebinding gap after peer failure/removal; no causal production fix was established within this round. See `webkit-retained-consumer.json`, captured at `0516229`.

Native Safari 26.6.2 passed a physical-camera call on source `0516229`, after the alpha merge. The lobby displayed the Mac camera, Safari displayed the moving Chromium peer, and Chromium decoded Safari video at readyState 4, 640x360 with advancing time and live audio/video tracks. Leave reached the camera-off state. `safari-native.json` records this run; the older numeric local-preview measurements are labeled separately in `safari-native-pre-7fd.json`. No production playback patch or Safari setting change was needed. This verifies native Mac Safari, not a physical iPhone.

The Chromium blur worker processes frames, disposes its output without stopping input, and honors cancellation. WebKit reports unsupported and preserves the live camera. See `blur-runtime.json`. Physical iPhone switching, permission prompts and low-end blur performance remain unverified.

## Interaction review

The real panel uses call colors for prompts and notes. The body scrolls independently, keeping the sheet heading and close button visible in landscape. The call frame cannot scroll when notes receive focus. Its keyboard check catches both regressions.

An independent source review found that a healthy peer could hide another peer's unavailable stats. Mixed-peer and stats-failure tests now prevent a false green indicator. The review found no new monitor lifecycle or late-camera interference.

Earlier checks and failures remain labeled in this directory. The original component-panel fixtures use an unsaved textarea and are not persistence evidence. The recovered before screenshots have no known capture SHA. `interaction.mp4` shows the earlier PiP/control behavior at `d53da574`; the new `real-*` screenshots supersede its panel appearance. Development Lighthouse scored accessibility 100 and performance 50, which is not a production performance benchmark.
