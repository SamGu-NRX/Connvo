# Call eval summary

Whole-run wall time: 17.4 s

| Scenario | Pass | Total |
|---|---|---|
| H-17 | 0 | 1 |

p95 time-to-first-remote-frame: n/a ms (n=0)
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
- H-17 seed 1 (p2p): A's media not live by the deadline: need the right colour and >= 15 fps over 1 s (last {"color":{"ok":false,"label":"none"},"fps":null,"firstAdvanceAt":null}) | diagnostics [{"peer":"A","phase":"left","error":null,"tiles":[],"pcs":["closed/closed/closed"],"transceivers":[[{"mid":null,"direction":"stopped","currentDirection":"stopped","senderKind":"audio","receiverKind":"audio"},{"mid":null,"direction":"stopped","currentDirection":"stopped","senderKind":"video","receiverKind":"video"},{"mid":null,"direction":"stopped","currentDirection":"stopped","senderKind":null,"receiverKind":"video"}]],"candidates":[],"configs":[],"probeConfig":null,"freshGather":{"found":["host","end"],"state":"complete"},"visibility":"visible","log":["1276 connect as A","1382 welcome []","2207 peer-joined B","2207 B build peer (local tracks: 1)","2213 B negotiationneeded (stable)","2380 B got offer in stable","2383 B applied offer; now have-remote-offer","2387 B negotiationneeded (stable)","2388 B gathering gathering","2390 B local candidate host","2395 B remote candidate added","2408 B gathering complete","2408 B local candidate end","2421 B remote candidate added"]},{"peer":"B","phase":"left","error":null,"tiles":[],"pcs":["closed/closed/closed"],"transceivers":[[{"mid":null,"direction":"stopped","currentDirection":"stopped","senderKind":"audio","receiverKind":"audio"},{"mid":null,"direction":"stopped","currentDirection":"stopped","senderKind":"video","receiverKind":"video"}]],"candidates":[],"configs":[],"probeConfig":null,"freshGather":{"found":["host","end"],"state":"complete"},"visibility":"visible","log":["984 connect as B","1139 welcome [A]","1139 A build peer (local tracks: 2)","1145 A negotiationneeded (stable)","1149 A sent offer","1151 A gathering gathering","1154 A local candidate host","1155 A local candidate host","1273 A gathering complete","1273 A local candidate end","1306 A got answer in have-local-offer","1310 A applied answer; now stable","1355 A remote candidate added"]}]
