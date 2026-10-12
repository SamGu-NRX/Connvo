# Call eval summary

Whole-run wall time: 313.6 s

| Scenario | Pass | Total |
|---|---|---|
| H-01 | 3 | 3 |
| H-02 | 3 | 3 |
| H-03 | 3 | 3 |
| H-04 | 3 | 3 |
| H-05 | 3 | 3 |
| H-06 | 3 | 3 |
| H-07 | 3 | 3 |
| H-08 | 3 | 3 |
| H-09 | 3 | 3 |
| H-10 | 3 | 3 |
| H-11 | 3 | 3 |
| H-12 | 3 | 3 |
| H-13 | 3 | 3 |

p95 time-to-first-remote-frame: 833 ms (n=3)
p95 H-07 10 s-drop recovery: 449 ms (n=3)

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
