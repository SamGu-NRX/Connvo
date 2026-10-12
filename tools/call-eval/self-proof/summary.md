# Harness self-proof

Command: `pnpm call-eval:self-proof -- --base-url=http://localhost:3311 --seeds=1..20`
Wall time so far: 13.9 s (complete); peers run sequentially, scenario by scenario.
Host: linux x64, 2 CPUs, node v20.20.2. No Convex, no sign-in.

## reference

PASS: every run passed

| Scenario | Pass | Total |
|---|---|---|
| H-01 | 20 | 20 |
| H-02 | 20 | 20 |
| H-03 | 20 | 20 |
| H-04 | 20 | 20 |
| H-05 | 20 | 20 |
| H-06 | 20 | 20 |
| H-07 | 20 | 20 |
| H-08 | 20 | 20 |
| H-09 | 20 | 20 |
| H-10 | 20 | 20 |
| H-11 | 20 | 20 |
| H-12 | 20 | 20 |
| H-13 | 20 | 20 |

## reference-no-audio

PASS: fails exactly H-02 and H-03, because it never sends audio, so H-02 hears no tone, and H-03 cannot hear the tone come back after unmute

| Scenario | Pass | Total |
|---|---|---|
| H-01 | 1 | 1 |
| H-02 | 0 | 1 |
| H-03 | 0 | 1 |
| H-04 | 1 | 1 |
| H-05 | 1 | 1 |
| H-06 | 1 | 1 |
| H-07 | 1 | 1 |
| H-08 | 1 | 1 |
| H-09 | 1 | 1 |
| H-10 | 1 | 1 |
| H-11 | 1 | 1 |
| H-12 | 1 | 1 |
| H-13 | 1 | 1 |

Failures:
- H-02 seed 1: H-02: A heard silence, expected 660±10 Hz from B
- H-03 seed 1: H-03: unmute did not restore the 440 Hz tone (last silence)

## reference-never-close

PASS: fails exactly H-11 and H-13, because leave() closes nothing, so H-11 finds live connections and the signaling session still open; with one identity scheme the stale session then blocks A's own cycle-2 rejoin, so H-13 fails too (same defect, second observable consequence; deterministic across three runs)

| Scenario | Pass | Total |
|---|---|---|
| H-01 | 1 | 1 |
| H-02 | 1 | 1 |
| H-03 | 1 | 1 |
| H-04 | 1 | 1 |
| H-05 | 1 | 1 |
| H-06 | 1 | 1 |
| H-07 | 1 | 1 |
| H-08 | 1 | 1 |
| H-09 | 1 | 1 |
| H-10 | 1 | 1 |
| H-11 | 0 | 1 |
| H-12 | 1 | 1 |
| H-13 | 0 | 1 |

Failures:
- H-11 seed 1: H-11: wrapped connections not closed ({"live":1,"opened":1}, 1 pcs)
- H-13 seed 1: A: cycle 2: A rejoined not reached within 30000 ms

## reference-no-reconnect

PASS: fails exactly H-07, because a lost connection goes straight to failed, so H-07 never recovers

| Scenario | Pass | Total |
|---|---|---|
| H-01 | 1 | 1 |
| H-02 | 1 | 1 |
| H-03 | 1 | 1 |
| H-04 | 1 | 1 |
| H-05 | 1 | 1 |
| H-06 | 1 | 1 |
| H-07 | 0 | 1 |
| H-08 | 1 | 1 |
| H-09 | 1 | 1 |
| H-10 | 1 | 1 |
| H-11 | 1 | 1 |
| H-12 | 1 | 1 |
| H-13 | 1 | 1 |

Failures:
- H-07 seed 1: B: honest reconnecting during 3s drop not reached within 15000 ms

## Reference timings

- p95 time to first remote frame (H-01): 4078 ms (n=20); bar 3000 ms.
- p95 recovery after H-07's 10 s drop: 7267 ms (n=20); bar 8000 ms.
