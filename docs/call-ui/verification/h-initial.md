# Call eval summary

Whole-run wall time: 292.0 s

| Scenario | Pass | Total |
|---|---|---|
| H-01 | 2 | 3 |
| H-02 | 3 | 3 |
| H-03 | 3 | 3 |
| H-04 | 3 | 3 |
| H-05 | 3 | 3 |
| H-06 | 3 | 3 |

p95 time-to-first-remote-frame: 3480 ms (n=2)
p95 H-07 10 s-drop recovery: n/a ms (n=0)

## H-15 loss/delay method

Chosen: In-process Node TURN relay (runner/turn-relay.mjs) with all media forced relay-only through one participant's user-space UDP shaper (seeded Node dgram proxy adding loss/delay in both directions)
- Rejected: Chromium network emulation / CDP Network interception — does not touch WebRTC UDP
- Rejected: tc/netem or dummynet (pfctl) on loopback — needs root
- Rejected: coturn — a system binary the harness cannot assume; replaced by the in-process relay
- Rejected: netns via unshare — root again; same rejection
See tools/call-eval/NOTES-h15-loss-method.md for the proof numbers and interactions.

## Environment

- node: v26.5.0
- chromium: chromium
- turn: in-process Node relay (runner/turn-relay.mjs)
- platform: darwin arm64

Failures:
- H-01 seed 2 (p2p): H-01: time to first remote frame exceeded the 5 s bar (A 7901 ms, B 7907 ms)
