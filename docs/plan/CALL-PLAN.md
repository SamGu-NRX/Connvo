# Connvo call plan

Owner: the Connvo/LinkedUp lead (fleet). Task prompts quote this file by section ID. Integration branch: `alpha`
(cut from `main` at 8d73d9bbaf93). Nothing here merges to `main`.

**Why `alpha` starts at main (checked 2026-10-11, Sam's rule: cut from the definitive latest version).** Main
8d73d9bbaf93 is Andrew Wang's last merge (#11, 2025-11-17 07:59Z, bringing in "feat/goat" and "fix settings").
Andrew's `newfeat` (5d2eea1498, PR #9, still open) is two commits ahead only by a merge of main and its revert, both
at 06:42Z that day. Against main its tree mostly adds old `.kiro/` spec documents and lacks those later settings
fixes, so it is older, not newer. `kgu-continuation` (cc33929259, PR #13) only changes the landing page for kgu.one,
and `sg/docs` is 11 commits behind. No other branch carries newer app code. `newfeat`, the landing and the dashboard
stay Andrew's: build beside them, never write to them.

## Goal

Two real people open the same meeting in two browsers and talk: each sees and hears the other, mute and camera-off
show on the other side, a dropped network or a reloaded tab recovers on its own, leaving releases the camera and
every connection, and in-call notes survive all of that. Then the post-call summary and history work from the real
call. The bar is the harness below, not a demo.

## Constraints that hold until Sam decides

- **Meeting authorization.** #16 (current-token claims) versus #22 (stored flag) is open. Do not base on, merge or
  cherry-pick #16, #22, #24 or #25. Calls use main's existing rule: `assertMeetingAccess` requires an authenticated
  user with a `meetingParticipants` row (`convex/auth/guards.ts`). Neither candidate rule changes that participant
  check.
- **Production wiring.** `/app/call/[id]` keeps redirecting to the simulated page unless
  `NEXT_PUBLIC_CONNVO_REAL_CALL=1`. Production never sets it until Sam decides.
- **No paid providers, no secrets, no production Convex.** Stream needs keys we don't have, so it's out of round 1.
- PRs owned by Sam's SGU workspace (#14-#28) are read-only inputs.

## Decisions already made (don't ask again)

- **D1. Local backend.** Run Convex as an anonymous local deployment: in a non-interactive shell,
  `npx convex dev --once` with no `CONVEX_DEPLOY_KEY` provisions one (see docs.convex.dev/cli/agent-mode). The repo
  locks convex 1.28.0; if that CLI can't provision a local backend, a bump within 1.x is allowed in your branch, with
  the reason and the failing command in the PR.
- **D2. Test identities.** `convex/auth.config.ts` may gain one extra `customJwt` provider that exists only when
  `CONNVO_LOCAL_TEST_JWKS` is set (a `data:` URI JWKS; issuer `https://connvo-local-test.invalid`). With the env unset
  the provider list must be byte-for-byte what main returns, and a test must prove it. The harness mints RS256 tokens
  for seeded users. Local runs set `WORKOS_CLIENT_ID` to a dummy value.
- **D3. Client test auth.** The browser gets those tokens through a test-only auth adapter enabled by
  `NEXT_PUBLIC_CONNVO_TEST_AUTH=1`. It must throw at startup if `VERCEL_ENV === "production"` or
  `NODE_ENV === "production"` without an explicit local-build marker. WorkOS stays the default path.
- **D4. Media in tests.** Each peer is its own Chromium instance launched with
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=<y4m>
  --use-file-for-fake-audio-capture=<wav>`. Each peer's video carries its peer ID as a color plus a frame-counter
  barcode; each peer's audio is a distinct tone (A 440 Hz, B 660 Hz, C 880 Hz). Receipt is decoded from the
  remote element, never inferred from UI state.
- **D5. Transport seam.** Every transport implements `src/lib/call/transport.ts` (on `alpha`). Local capture is
  owned by the UI's local-media hook, not the transport: a transport never stops a track it didn't create, and
  `leave()` closes every connection it opened.
- **D6. Run heavy work in the Obvious sandbox**, not on Sam's Mac.

## Evals: the two-peer harness (H)

Lives in `tools/call-eval/`. It is transport-agnostic: an init script wraps `RTCPeerConnection` and `getUserMedia`
to count live connections and tracks, and everything else is read from the DOM contract below. One command runs a
scenario set for one transport and seed list and writes `tools/call-eval/out/<run>/results.json` (one object per
scenario x seed: `scenario`, `transport`, `seed`, `pass`, `measurements`, `failure`) plus `summary.md`.

DOM contract, which any call page must meet:
- `[data-call-phase]` on the call root, one of `idle|joining|connected|reconnecting|failed|left`;
- `[data-testid="remote-media"][data-participant-id]` wrapping each remote `<video>`, with `data-audio-muted` and
  `data-video-off`;
- buttons with `data-testid` `toggle-mic`, `toggle-camera`, `leave-call`, `retry-media`.

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

Polish checks (P), on the real call page:
- P-01: lobby, connected, reconnecting, failed and ended states at 1440x900 and 390x844, screenshots committed;
- P-02: axe shows no serious or critical violations in any state;
- P-03: every control is reachable and operable by keyboard, with visible focus;
- P-04: `prefers-reduced-motion` removes non-essential motion;
- P-05: long names (40+ characters), missing avatar and a slow join (5 s) keep the layout intact.

Harness self-proof (required before any variant is scored): a reference page in `tools/call-eval/reference/`
passes H-01..H-13, and named broken variants each fail exactly the scenarios they should: no audio fails H-02, a
transport that never closes fails H-11, no reconnect fails H-07.

**Pass bar for a transport:** H-01..H-14 pass in >= 19 of 20 seeds each; p95 time to first remote frame <= 3 s
locally; p95 recovery after H-07's 10 s drop <= 8 s; H-15 stays connected. P-01..P-05 pass for the page.

## Steps

- **S0, harness.** Build H and P with the self-proof. Task `connvo-call-harness-f1`.
- **S1, notes.** Rebuild #24's notes repair from main as a mounted `MeetingNotesPanel` (`meetingId`). Task
  `connvo-notes-ledger-f1`. Runs in parallel with S0.
- **S2, round 1: transports**, scored by H, after S0 is accepted:
  - **A. P2P over Convex signaling.** Perfect negotiation on the existing `convex/meetings/webrtc` tables, fixing
    their gaps: per-peer addressing, the unaddressed-signal hole, heartbeats and cleanup.
  - **B. Self-hosted LiveKit SFU.** `livekit-server --dev` locally; tokens minted by a Convex action from local dev
    keys only.
- **S3, call UX**, after S0: lobby and devices, in-call tiles and controls, reconnecting and failed states, notes
  panel mount, leave, then the post-call summary from the real meeting. Built against the seam, so it works with
  either transport.
- **S4, council.** Score A and B with H. Pick the transport; graft the other's useful ideas; merge the winner, UX and
  notes to `alpha`; run the integrated app and critique it.
- **S5, round 2** on what's still failing: TURN and relay-only paths, mobile Safari constraints, bandwidth adaptation
  and the polish gaps from S4.
- **S6, production wiring.** Only after Sam's authorization decision.

## Stop rule

Stop a direction when two consecutive rounds don't move its H pass rate or p95 numbers. Stop the project's local
work when the pass bar is met on `alpha` for the chosen transport and P-01..P-05 pass. Record the reason here.
