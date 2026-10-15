# Call eval summary

Whole-run wall time: 118.2 s

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
| H-14 | 1 | 1 |

p95 time-to-first-remote-frame: 1528 ms (n=1)
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
- H-07 seed 1 (p2p): A: phase 'connected' not reached within 30000 ms | [{"peer":"A","phase":"joining","error":null,"tiles":["B"],"pcs":["stable/new/new"],"transceivers":[[{"mid":"0","direction":"sendrecv","currentDirection":"sendrecv","senderKind":"audio","receiverKind":"audio"},{"mid":"1","direction":"sendrecv","currentDirection":"sendrecv","senderKind":"video","receiverKind":"video"}]],"candidates":[{"local":[],"remote":[]}],"configs":[{"policy":"relay","servers":[["stun:stun.cloudflare.com:3478"]]}],"probeConfig":"{\"iceServers\":[{\"urls\":\"turn:127.0.0.1:3479?transport=udp\",\"username\":\"eval-user\",\"credential\":\"eval-pass\"}],\"iceTransportPolicy\":\"relay\"}","freshGather":{"found":["relay","end"],"state":"complete"},"visibility":"visible","log":["1030 connect as A","1121 welcome [B]","1121 B build peer (local tracks: 2)","1125 B negotiationneeded (stable)","1149 B got offer in stable","1150 B applied offer; now have-remote-offer","1155 B gathering gathering","1271 B gathering complete","1271 B local candidate end","7140 B got offer in stable","7140 B applied offer; now have-remote-offer","7142 B gathering gathering","7271 B gathering complete","7271 B local candidate end","13136 B got offer in stable","13136 B applied offer; now have-remote-offer","13138 B gathering gathering","13254 B gathering complete","13254 B local candidate end","19139 B got offer in stable","19140 B applied offer; now have-remote-offer","19141 B gathering gathering","19255 B gathering complete","19255 B local candidate end","25238 B got offer in stable","25239 B applied offer; now have-remote-offer","25241 B gathering gathering","25365 B gathering complete","25365 B local candidate end"]},{"peer":"B","phase":"connected","error":null,"tiles":["A"],"pcs":["stable/new/new"],"transceivers":[[{"mid":"0","direction":"sendrecv","currentDirection":"sendrecv","senderKind":"audio","receiverKind":"audio"},{"mid":"1","direction":"sendrecv","currentDirection":"sendrecv","senderKind":"video","receiverKind":"video"}]],"candidates":[{"local":[],"remote":[]}],"configs":[{"policy":"relay","servers":[["stun:stun.cloudflare.com:3478"]]}],"probeConfig":"{\"iceServers\":[{\"urls\":\"turn:127.0.0.1:3480?transport=udp\",\"username\":\"eval-user\",\"credential\":\"eval-pass\"}],\"iceTransportPolicy\":\"relay\"}","freshGather":{"found":["relay","end"],"state":"complete"},"visibility":"visible","log":["1258 A local candidate end","7125 A negotiationneeded (stable)","7126 A sent offer","7127 A gathering gathering","7182 A got answer in have-local-offer","7183 A applied answer; now stable","7240 A gathering complete","7240 A local candidate end","13125 A negotiationneeded (stable)","13126 A sent offer","13127 A gathering gathering","13153 A got answer in have-local-offer","13154 A applied answer; now stable","13241 A gathering complete","13241 A local candidate end","19123 A negotiationneeded (stable)","19124 A sent offer","19125 A gathering gathering","19157 A got answer in have-local-offer","19158 A applied answer; now stable","19242 A gathering complete","19242 A local candidate end","25124 A negotiationneeded (stable)","25125 A sent offer","25126 A gathering gathering","25240 A gathering complete","25240 A local candidate end","25278 A got answer in have-local-offer","25279 A applied answer; now stable","31047 peer-left A"]}]
