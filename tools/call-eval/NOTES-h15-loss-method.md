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
| 1 | baseline | 0% | 0 ms | +0 | 4 ms | 34.9 | connected |
| 1 | 5% | 5% | 300 ms | +10 | 605 ms | 25.8 | connected |
| 1 | recovery-5% | 0% | 0 ms | +0 | 77 ms | 37.6 | connected |
| 1 | 15% | 15% | 300 ms | +26 | 345 ms | 3.4 | connected |
| 1 | recovery-15% | 0% | 0 ms | +0 | 2 ms | 35.4 | connected |
| 2 | baseline | 0% | 0 ms | +0 | 2 ms | 37.2 | connected |
| 2 | 5% | 5% | 300 ms | +6 | 603 ms | 18.5 | connected |
| 2 | recovery-5% | 0% | 0 ms | +0 | 154 ms | 32.2 | connected |
| 2 | 15% | 15% | 300 ms | +27 | 303 ms | 1.7 | connected |
| 2 | recovery-15% | 0% | 0 ms | +0 | 227 ms | 33.2 | connected |
| 3 | baseline | 0% | 0 ms | +0 | 1 ms | 31.1 | connected |
| 3 | 5% | 5% | 300 ms | +5 | 603 ms | 13.3 | connected |
| 3 | recovery-5% | 0% | 0 ms | +0 | 152 ms | 33.6 | connected |
| 3 | 15% | 15% | 300 ms | +24 | 337 ms | 1.7 | connected |
| 3 | recovery-15% | 0% | 0 ms | +0 | 78 ms | 33.1 | connected |

Audio after each loss block, measured from the moment that block's shaping
cleared (the bar is 440 Hz within 3 s):

| Seed | After 5% | After 15% |
|---|---|---|
| 1 | 438.2 Hz after 494 ms | 438.2 Hz after 482 ms |
| 2 | 437.4 Hz after 481 ms | 436.7 Hz after 446 ms |
| 3 | 437.9 Hz after 490 ms | 438.3 Hz after 482 ms |

How to read it:
- Shaping reaches RTP: packetsLost rises by 5-27 under loss, and RTT jumps
  from 1-4 ms to about 600 ms at 5% and 300-345 ms at 15%. The 15% windows
  read lower RTT because RTCP reports are lost too, so fewer fresh RTT
  samples land.
- The call stays connected through both loss levels. Video drops to
  1.7-3.4 fps at 15% and comes back to 32-38 fps once the profile clears,
  and B hears A's 440 Hz tone again about 0.5 s after each block clears.
- A recovery block can show RTT left over from the shaped window (77-227
  ms), because RTT is averaged over the window right after clearing.

## Rejected alternatives

- Chromium network emulation or CDP interception: they shape the HTTP and
  WebSocket stack, not WebRTC's UDP.
- tc/netem or dummynet (pfctl) on loopback: need root.
- coturn: a system binary the harness cannot assume.
