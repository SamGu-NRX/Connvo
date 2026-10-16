# Connvo two-peer call eval harness (S0)

Transport-agnostic two-peer call harness for scoring call transports
(`docs/plan/CALL-PLAN.md`, step S0).

- `CONTRACT.md`: the DOM contract, H/P scenarios (pass conditions quoted
  verbatim), runner shape and fixtures spec. The plan wins where they differ.
- `reference/`: the eval-only reference transport and its WebSocket signaling
  server, registered as `reference`, plus the broken variants the self-proof
  uses (`reference-no-audio`, `reference-never-close`, `reference-no-reconnect`).
- `runner/`: scenarios, the in-page probe, the TURN relay and UDP shaper for
  H-07/H-15, and the orchestrator.
- `fixtures/`: per-peer media (y4m with peer color and frame-counter barcode;
  wav tones 440/660/880 Hz), generated on first run.
- `self-proof/`: the committed self-proof matrix.

## Self-proof (no Convex, no sign-in)

```sh
pnpm call-eval:self-proof -- --seeds=1..20 --variant-seeds=1
```

This starts `next dev` with `NEXT_PUBLIC_CONNVO_CALL_BENCH=1`, runs H-01..H-13
against `reference` through `/dev/call-bench/reference`, then runs the same
scenarios against each broken variant, which must fail exactly its scenario
(no-audio H-02, never-close H-11, no-reconnect H-07). It writes
`self-proof/results.json` and `summary.md` after every run, so a run cut short
still records exact counts. Nothing else needs to be running:

- the runner spawns the reference signaling server in bench mode, which makes
  its own RS256 key and mints the bench identities `A` and `B` at `POST /mint`;
- H-07 and H-15 route media through `runner/turn-relay.mjs`, an in-process
  TURN relay, so no coturn binary is needed.

Pass `--base-url=http://localhost:<port>` to reuse a running `next dev` that
already has the bench flag set.

## Other runs

```sh
pnpm call-eval -- --transport=mock --suite=all --seeds=1        # bundled mock page, no Next
pnpm call-eval -- --transport=reference --scenarios=H-07 --seeds=1..3 --base-url=http://localhost:3036
```

H-14 (outsider rejection) needs local Convex and belongs to the local-backend
work (`pnpm call-eval:backend`); it runs only when named with `--scenarios=H-14`.

## The full normal route: queue to call to cleanup (one command)

```sh
pnpm call-eval:call-route-proof            # [-- --port=3035] [--skip-backend]
```

`scripts/call-route-proof.mjs` boots (or reuses) the local backend, then drives
two isolated Chromium contexts through the shipped queue page: both join, the
match is accepted, both Joins navigate into the real call, and the proof
exchanges the synthetic video barcode and audio tone both ways, mutes each
mic and toggles the camera from both sides (remote tile attributes plus the
received tone), rejects a signed-in non-participant by name, forces a tab
reload and verifies recovery with no ghost tile, then leaves and verifies
cleanup: capture tracks and peer connections ended on both sides, no open
`webrtcSessions` rows in the meeting (eval-only
`devEval/callMeeting:openSessions`), closed sessions recorded for both
participants, and the meeting concluded. It writes
`out/call-route-proof/results-<ts>.json` plus a stable `results.json` and
exits non-zero if any check fails — including missing remote media or leaked
room state.

## The real call page over Convex

```sh
node tools/call-eval/scripts/local-backend.mjs --port=3035
pnpm call-eval -- --transport=p2p --page=real --signaling=convex \
  --base-url=http://localhost:3035 --scenarios=H-01..H-14 --seeds=1..3
```

`local-backend.mjs` starts the anonymous local Convex backend and `next dev`
with test sign-in and the real call page on. Each peer opens
`/app/call/<meeting>?as=<A|B|C|O>` signed in as that seeded user and signals
through `convex/meetings/webrtc/mesh.ts`
(`runner/convex-signaling.mjs`):

- every scenario gets a fresh meeting from the internal
  `devEval/callMeeting:create` (A host, B and C participants; O is not invited);
- H-07 takes the peer's browser offline and cuts its Convex WebSocket for the
  drop, then brings both back;
- H-05 picks a second camera from the page's device menu; Chromium has one
  fake camera, so `runner/second-camera.mjs` adds a canvas camera to the page;
- H-11 reads closed sessions from the internal `devEval/callMeeting:sessionEvents`.
