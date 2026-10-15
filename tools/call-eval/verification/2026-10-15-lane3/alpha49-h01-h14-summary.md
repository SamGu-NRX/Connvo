# Call eval summary

Whole-run wall time: 147.6 s

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
| H-11 | 1 | 1 |
| H-12 | 1 | 1 |
| H-13 | 1 | 1 |
| H-14 | 1 | 1 |

p95 time-to-first-remote-frame: 1333 ms (n=1)
p95 H-07 10 s-drop recovery: 325 ms (n=1)

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

Failures: none
