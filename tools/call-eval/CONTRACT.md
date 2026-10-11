# S0 harness contract (task `connvo-call-harness-f1`)

This file is the join point for the S0 sub-threads. Everything here is quoted or
derived from `docs/plan/CALL-PLAN.md` at alpha `ddc94d4`. Decisions D1–D6 are
settled — do not reopen them. Where this file and the plan disagree, the plan wins.

## DOM contract (verbatim from the plan)

> DOM contract, which any call page must meet:
> - `[data-call-phase]` on the call root, one of `idle|joining|connected|reconnecting|failed|left`;
> - `[data-testid="remote-media"][data-participant-id]` wrapping each remote ` `, with `data-audio-muted` and
>  `data-video-off`;
> - buttons with `data-testid` `toggle-mic`, `toggle-camera`, `leave-call`, `retry-media`.

(The plan's second bullet has an empty inline-code slot where the element name
was dropped in the source markdown; the tile wraps each remote `<video>`/`<audio>`
element pair. `data-audio-muted` / `data-video-off` are `"true" | "false"`.)

Bench conventions (S0-only, pinned here so runner and page agree):
- Rejection/error text renders in `[data-testid="call-error"]`; H-14's "named
  rejection" must be non-empty there. The `retry-media` button is present
  whenever the error is retryable (H-06).
- Local preview video: `[data-testid="local-video"]` (not asserted by H except
  via capture-track checks through the probe).
- Query params: `?as=<A|B|C|O>` identity, `?meeting=<id>`, `?name=<display
  name override>` (P-05 long names), `?delayJoin=<ms>` (simulated slow join,
  P-05), `?avatar=0` (render the missing-avatar case, P-05).

## H scenarios (pass conditions verbatim from the plan)

| ID | Scenario | Pass |
|---|---|---|
| H-01 | Both join | each decodes the other's barcode color within 5 s; remote frames advance at >= 15 fps over 5 s |
| H-02 | Audio | each receiver's analyser peak is the sender's tone +-10 Hz within 3 s |
| H-03 | Mic mute/unmute | remote `data-audio-muted` flips within 1 s; received tone energy falls below threshold; unmute restores both |
| H-04 | Camera off/on | remote `data-video-off` within 1 s; the sender's capture track is `ended` (camera released); on resumes frames |
| H-05 | Device switch | switching to the second fake camera keeps frames flowing without a failed phase |
| H-06 | Permission denied | context without media permission shows an actionable error; granting and `retry-media` joins |
| H-07 | Network drop | one peer offline 3 s, 10 s, 30 s: honest `reconnecting`, media resumes within 10 s of restore, no duplicate tiles |
| H-08 | Forced ICE restart | recovers within 10 s |
| H-09 | Peer reload | reloaded peer rejoins; no ghost participant after 10 s |
| H-10 | Tab killed | survivor shows the peer gone within 15 s |
| H-11 | Leave | all local tracks `ended`, all wrapped connections `closed`, no `getStats` traffic afterwards, server session closed |
| H-12 | Glare | simultaneous join in both orders, 20 seeds: always connects |
| H-13 | Churn | five leave/rejoin cycles: live connection and track counts return to baseline |
| H-14 | Outsider | a signed-in non-participant gets a named rejection and no media |
| H-15 | Lossy link | 5% and 15% loss with 300 ms delay, by a method `getStats` proves affects RTP: call stays connected, A/V recovers |
| H-16 | Three peers | informational: all pairs receive media |

Every scenario's pass condition MUST appear in code as a verbatim quoted string
from this table (see `PASS_CONDITIONS` in the runner), not paraphrased.

Polish checks (P), on the real call page (S0: the bench page, the only page
that implements the contract yet; S3 owns the production page):

> - P-01: lobby, connected, reconnecting, failed and ended states at 1440x900 and 390x844, screenshots committed;
> - P-02: axe shows no serious or critical violations in any state;
> - P-03: every control is reachable and operable by keyboard, with visible focus;
> - P-04: `prefers-reduced-motion` removes non-essential motion;
> - P-05: long names (40+ characters), missing avatar and a slow join (5 s) keep the layout intact.

## Runner contract

- One command runs H and P for any registered transport:
  `pnpm call-eval -- --transport=<name>[,<name>...] [--scenarios=H-01..H-13|H-01,H-07|all] [--seeds=1..20|<n>] [--suite=H|P|all]`
  Default: `--suite=H`, all H scenarios, seeds `1..5` (H-12 always 20 seeds).
- Output (plan-verbatim field set): `tools/call-eval/out/results.json` — one
  object per scenario x seed: `scenario`, `transport`, `seed`, `pass`,
  `measurements`, `failure` — plus `tools/call-eval/out/summary.md`.
  `results.json` is an array across all transports in the run.
- `summary.md` includes: per-transport per-scenario pass counts, p95
  time-to-first-remote-frame, p95 recovery after H-07's 10 s drop, wall time of
  the whole run, the H-15 method plus what was rejected and why, and the
  environment (node, chromium, convex versions).
- Init script (injected per browser context) wraps `RTCPeerConnection` and
  `getUserMedia` to count live connections and tracks:
  `window.__callProbe = { connections: { live, opened }, tracks: { live, created }, getStatsCalls: n, pcs: [...] }`.
  All receipt evidence comes from the DOM contract plus the probe; never from
  app internals.
- One Chromium instance per peer (D4), launched with
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=<fixture> --use-file-for-fake-audio-capture=<fixture>`
  plus the H-15 relay override injected through the wrapper
  (`RTCConfiguration` = `{ iceServers: [<local turn via shaper>], iceTransportPolicy: "relay" }`).
- H-15 loss/delay: Chromium's network emulation does not touch WebRTC UDP.
  The accepted method must be proven with `getStats` `packetsLost` / RTT deltas
  recorded in `measurements`. Rejected methods and reasons go in `summary.md`.

## Fixtures (D4, verbatim constraints)

> Each peer is its own Chromium instance launched with
> `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture= --use-file-for-fake-audio-capture=`. Each peer's video carries its peer ID as a color plus a frame-counter
> barcode; each peer's audio is a distinct tone (A 440 Hz, B 660 Hz, C 880 Hz). Receipt is decoded from the
> remote element, never inferred from UI state.

Pinned fixture spec (generator + decoders must match):
- Video: y4m (I420, `C420jpeg`), 320x240, 30 fps, 300 frames per file.
- Peer color fills the frame: A `rgb(205,35,35)`, B `rgb(35,150,85)`, C `rgb(45,85,175)`; second camera: `rgb(170,40,170)`.
- Frame-counter barcode: bottom band rows y=200..239; white `rgb(235,235,235)` background; left sentinel x=8..23 black; 12 data bits (MSB first) each 12 px wide starting x=24 (bit 1 = black `rgb(20,20,20)`, bit 0 = white); right sentinel x=168..183 black; counter = `frameNumber mod 4096`; counter increments once per frame.
- Audio: wav, 48 kHz, mono, 16-bit PCM, 60 s, sine at A 440 Hz / B 660 Hz / C 880 Hz, amplitude 0.6, 20 ms fades.
- Paths: `tools/call-eval/fixtures/peer-A.y4m`, `peer-B.y4m`, `peer-C.y4m`, `second-camera.y4m`, `peer-A.wav`, `peer-B.wav`, `peer-C.wav`. Generated on demand by `tools/call-eval/scripts/generate-fixtures.mjs` (committed outputs not required; runner regenerates when missing).

## Local backend, identities, auth (D1–D3)

- One command: `pnpm call-eval:backend` = `node tools/call-eval/scripts/local-backend.mjs`
  - provisions an anonymous local Convex deployment in a non-interactive shell (`npx convex dev --once`, no `CONVEX_DEPLOY_KEY`; D1),
  - pushes schema/functions, seeds users A, B, C and outsider O plus an active meeting with A–C as participants,
  - mints RS256 tokens (issuer `https://connvo-local-test.invalid`),
  - starts `next dev` with the eval env and writes `tools/call-eval/out/state.json`
    (`{ convexUrl, nextBaseUrl, meetingId, users: { A/B/C/O: { token, workosUserId, email } } }`).
- `convex/auth.config.ts` gains exactly one extra `customJwt` provider, present
  only when `CONNVO_LOCAL_TEST_JWKS` is set (a `data:` URI JWKS). With the env
  unset the provider list must be byte-for-byte what main returns — proven by a
  test (D2). Local runs set `WORKOS_CLIENT_ID` to a dummy value.
- Browser test auth: `NEXT_PUBLIC_CONNVO_TEST_AUTH=1` enables a test-only auth
  adapter; it throws at startup if `VERCEL_ENV === "production"` or
  `NODE_ENV === "production"` without an explicit local-build marker. WorkOS
  stays the default path (D3). Tokens are served to the browser by
  `src/app/api/test-auth/token/route.ts` (`GET ?user=A`), which carries the
  same production guards.
- Seeded identities: subjects `local-test-a`, `local-test-b`, `local-test-c`,
  `local-test-o`; emails `a@connvo-local.test`, etc. Tokens: RS256, 10-minute
  expiry, claims `sub`, `email`, `name`.

## Bench route and transports

- `src/app/dev/call-bench/[transport]/page.tsx` returns 404 unless
  `NEXT_PUBLIC_CONNVO_CALL_BENCH=1`. It mounts a transport by name from
  `src/lib/call/transports/index.ts`, owns minimal local-media handling
  (getUserMedia via the Chromium fake devices), and implements the DOM contract.
- Reference transport: `tools/call-eval/reference/`, its own local WebSocket
  signaling server (ports 9301–9310 reserved for eval), registered as
  `"reference"` in the registry. Its signaling authorizes the RS256 token and
  meeting membership, and fails closed (H-14).
- Broken variants are registered with suffixed names — `reference-no-audio`,
  `reference-never-close`, `reference-no-reconnect`, `reference-outsider-allowed` —
  each of which must fail exactly its scenario: no audio → H-02, never-close →
  H-11, no-reconnect → H-07, outsider-allowed → H-14.
- Self-proof: `"reference"` passes H-01..H-13 in 20 seeds through the bench
  route. The committed matrix lives at
  `tools/call-eval/self-proof/{results.json,summary.md}`.

## Ownership and forbidden files

- S0 owns: `tools/call-eval/**`, `src/lib/call/**` (new), `src/app/dev/call-bench/**` (new),
  `src/app/api/test-auth/**` (new), the env-gated provider in `convex/auth.config.ts`,
  the test auth adapter, vitest/tsconfig wiring for `tools/**`, `package.json` scripts.
- Forbidden: `convex/meetings/**` (P2P task owns it), `src/app/app/call/**` and
  production UI (UX task), landing/dashboard pages (Andrew's `newfeat`/PR #9/#13),
  CI workflows, authorization rules (only the env-gated test provider is added).
- Do not base on, merge or cherry-pick PRs #16, #22, #24, #25.

## Git protocol (every sub-thread)

- Clone fresh; `git config user.name 'Sam Gu' && git config user.email '127461594+SamGu-NRX@users.noreply.github.com'`.
- Branch per sub-thread from `obv/connvo-call-harness-f1`: `obv/call-harness/{backend,fixtures,runner,bench}`.
  Push to that branch only; the integrator merges into `obv/connvo-call-harness-f1`.
- Every commit message ends with
  `Co-authored-by: obvious-autobuild[bot] <262744130+obvious-autobuild[bot]@users.noreply.github.com>`.
  Sam Gu is the commit author; verify with `git log --format='%an <%ae>'` before pushing.
- Never force-push, rebase published history, or push another owner's branch.
- Gates before every push: `pnpm type-check` (no NEW errors vs baseline of 32
  pre-existing errors recorded in the PR) and `pnpm test:run` (baseline 240
  passing + one pre-existing unhandled error in `convex/matching/matching.test.ts`;
  no new failures). Sandboxes die — push after every verified step.

## Baseline at alpha `ddc94d4` (2026-10-11)

- `pnpm install --frozen-lockfile`: ok (pnpm 12.11.2; ignored build scripts: core-js, esbuild, protobufjs, sharp, unrs-resolver).
- `pnpm type-check`: exit 2 — 32 pre-existing TS errors (src/components/ui/chart.tsx 8, src/hooks/useTranscription.ts 5, src/hooks/useMeetingLifecycle.ts 4, src/hooks/usePostCallInsights.ts 3, src/hooks/useCollaborativeNotes.ts 3, test/test.setup.mts 2, test/convex/openapiExamples.test.ts 2, test/convex/setup.ts 1, src/hooks/usePreCallPrompts.ts 1, src/hooks/useInCallPrompts.ts 1, src/components/mvp/one-on-one-meeting.tsx 1, src/app/videocall/[id]/page.tsx 1).
- `pnpm test:run`: exit 1 — 17 files, 240/240 tests pass, 1 pre-existing unhandled error (convex/matching/matching.test.ts).
