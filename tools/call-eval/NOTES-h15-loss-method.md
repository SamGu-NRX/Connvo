# H-15 loss/delay method

## Mechanism

1. The run starts an in-process Node TURN relay (`runner/turn-relay.mjs`;
   no coturn) and, per participant, a seeded Node `dgram` shaper that
   forwards to it. The relay does the long-term credential handshake and
   signs its responses, which Chromium requires before it uses a relay.
2. The scenario forces relay-only ICE through the probe's RTCConfiguration
   override (`iceTransportPolicy: "relay"`, the participant's shaper port),
   so all of that participant's RTP passes through its shaper.
3. Only B's shaper is shaped. It applies loss and delay in both directions
   (one uplink socket per browser socket), so "5%" is 5% each way on B's
   link, and 300 ms delay each way shows up as about 600 ms of RTT.
4. Proof comes from in-page `getStats()`: the inbound video `packetsLost`
   delta and the candidate-pair RTT over each window.

## Replay at the Node relay (reference transport, seeds 1-3)

`pnpm call-eval -- --transport=reference --scenarios=H-15 --seeds=1..3 --base-url=...`,
3 of 3 passed. Raw records: `self-proof/h15-replay.json`.

| Seed | Block | Loss | Delay | packetsLost delta | RTT | B's fps of A | Phase |
|---|---|---|---|---|---|---|---|
| 1 | baseline | 0% | 0 ms | +0 | 2 ms | 35.8 | connected |
| 1 | 5% | 5% | 300 ms | +12 | 602 ms | 26.1 | connected |
| 1 | recovery-5% | 0% | 0 ms | +0 | 226 ms | 31.9 | connected |
| 1 | 15% | 15% | 300 ms | +29 | 603 ms | 3.7 | connected |
| 1 | recovery-15% | 0% | 0 ms | +3 | 1 ms | 37.5 | connected |
| 1 | tone after 15% | | | | | 437.6 Hz | |
| 2 | baseline | 0% | 0 ms | +0 | 2 ms | 28.9 | connected |
| 2 | 5% | 5% | 300 ms | +12 | 604 ms | 32.2 | connected |
| 2 | recovery-5% | 0% | 0 ms | +0 | 5 ms | 34.9 | connected |
| 2 | 15% | 15% | 300 ms | +31 | 431 ms | 3 | connected |
| 2 | recovery-15% | 0% | 0 ms | +3 | 2 ms | 35.2 | connected |
| 2 | tone after 15% | | | | | 437.6 Hz | |
| 3 | baseline | 0% | 0 ms | +0 | 1 ms | 40.3 | connected |
| 3 | 5% | 5% | 300 ms | +8 | 604 ms | 34.9 | connected |
| 3 | recovery-5% | 0% | 0 ms | +2 | 226 ms | 31.2 | connected |
| 3 | 15% | 15% | 300 ms | +33 | 453 ms | 27.8 | connected |
| 3 | recovery-15% | 0% | 0 ms | -12 | 189 ms | 36.9 | connected |
| 3 | tone after 15% | | | | | 437.3 Hz | |

How to read it:
- Shaping reaches RTP: packetsLost rises under loss and RTT jumps from
  1-2 ms to about 430-600 ms. The 15% windows read lower RTT than 600 ms
  because RTCP reports are lost too, so fewer fresh RTT samples land.
- The call stays connected through both loss levels; video drops to 3-4 fps
  at 15% on some seeds and recovers to 35+ fps once the profile clears, and
  B hears A's 440 Hz tone again within 3 s.
- A recovery block can show RTT left over from the shaped window (189-226
  ms), because RTT is averaged over the window right after clearing. A
  negative packetsLost delta (seed 3) is RTP's own counting: late packets
  that arrive after being counted lost reduce the total.

## Rejected alternatives

- Chromium network emulation or CDP interception: they shape the HTTP and
  WebSocket stack, not WebRTC's UDP.
- tc/netem or dummynet (pfctl) on loopback: need root.
- coturn: a system binary the harness cannot assume.
