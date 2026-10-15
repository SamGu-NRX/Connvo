# Harness self-proof

Command: `pnpm call-eval:self-proof -- --seeds=1..5 --variant-seeds=1 --variant-scenarios=target --fresh`
Wall time so far: 654.3 s (complete); peers run sequentially, scenario by scenario.
Host: darwin arm64, 12 CPUs, node v26.5.0. No Convex, no sign-in.

## reference

PASS: every run passed

| Scenario | Pass | Total |
|---|---|---|
| H-01 | 5 | 5 |
| H-02 | 5 | 5 |
| H-03 | 5 | 5 |
| H-04 | 5 | 5 |
| H-05 | 5 | 5 |
| H-06 | 5 | 5 |
| H-07 | 5 | 5 |
| H-08 | 5 | 5 |
| H-09 | 5 | 5 |
| H-10 | 5 | 5 |
| H-11 | 5 | 5 |
| H-12 | 5 | 5 |
| H-13 | 5 | 5 |

## reference-no-audio

PASS: fails exactly H-02 and H-03 (run on those scenarios only), because it never sends audio, so H-02 hears no tone, and H-03 cannot hear the tone come back after unmute

| Scenario | Pass | Total |
|---|---|---|
| H-02 | 0 | 1 |
| H-03 | 0 | 1 |

Failures:
- H-02 seed 1: H-02: A heard silence, expected 660±10 Hz from B
- H-03 seed 1: H-03: unmute did not restore the 440 Hz tone (last silence)

## reference-never-close

PASS: fails exactly H-11 and H-13 (run on those scenarios only), because leave() closes nothing, so H-11 finds live connections and the signaling session still open, and H-13's leave/rejoin cycles cannot get back to baseline (seen in all three full-scope runs on obv/connvo-36-child-handoff)

| Scenario | Pass | Total |
|---|---|---|
| H-11 | 0 | 1 |
| H-13 | 0 | 1 |

Failures:
- H-11 seed 1: H-11: wrapped connections not closed ({"live":1,"opened":1}, 1 pcs)
- H-13 seed 1: A: cycle 2: A rejoined not reached within 30000 ms

## reference-no-reconnect

PASS: fails exactly H-07 (run on those scenarios only), because a lost connection goes straight to failed, so H-07 never recovers

| Scenario | Pass | Total |
|---|---|---|
| H-07 | 0 | 1 |

Failures:
- H-07 seed 1: B: honest reconnecting during 3s drop not reached within 15000 ms

## Reference timings

- p95 time to first remote frame (H-01): 1004 ms (n=5); bar 3000 ms.
- p95 recovery after H-07's 10 s drop: 7064 ms (n=5); bar 8000 ms.
