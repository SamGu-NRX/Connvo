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
