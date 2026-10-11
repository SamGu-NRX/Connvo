# H-15 loss/delay method

## Chosen mechanism

Harness-controlled user-space UDP shaping behind a local coturn:

1. The run context starts a local coturn (`turnserver --allow-loopback-peers`,
   port 3478) and a per-participant **UDP shaper** — a seeded Node `dgram`
   proxy bound to its own port that forwards every packet to coturn, adding
   deterministic per-packet loss (seeded PRNG) and delay (a timer wheel).
2. The scenario enables relay-only mode: the probe's RTCConfiguration
   override sets `iceTransportPolicy: "relay"` with `iceServers` pointing at
   the participant's shaper port. All RTP for that peer now flows through
   the shaper — loss and delay are applied to real media packets, not to
   HTTP/WS traffic.
3. The scenario mutates profiles at runtime
   (`ctx.shaperFor("B").applyProfile({ lossPct, delayMs })`) and measures
   proof with in-page `getStats()` deltas.

Why the config resolves per participant: shaping only peer B's path keeps
the control side (A) clean, so recovery is observable from B's stats while
A's tile count and phase prove the call survived.

## Proof (mock transport, seed 1)

Recorded by scenario_H_15 via `collectRtpStatsWindow` (inbound-video
`packetsLost`/`jitter`/RTT deltas over a windowed sample):

| block | loss | delay | packetsLost delta | RTT | outcome |
|---|---|---|---|---|---|
| baseline | 0% | 0 ms | 0 | ~1 ms | clean reference |
| 5% | 5% | 300 ms | +5 | ~602 ms | connected, frames stall then recover |
| recovery | 0% | 0 ms | 0 | ~1 ms | ~36.6 fps |
| 15% | 15% | 300 ms | +32 | ~603 ms | connected, frames stall then recover |
| recovery | 0% | 0 ms | 0 | ~1 ms | ~33.5 fps |

The >0 packetsLost delta and the RTT jumping to ~600 ms (two shaping hops:
delay applied on both the request and response path) prove the shaping
reaches RTP. Numbers above are from the original implementation's verified
mock run; the committed scenario re-measures them on every invocation and
fails loudly if the shaped blocks do not differ from baseline.

## Rejected alternatives

- **Chromium network emulation / CDP Network interception** — operates on
  the renderer's network stack (HTTP/WS), which does NOT carry WebRTC RTP;
  shaping there cannot affect media packets.
- **tc/netem on a loopback interface** — requires root (NET_ADMIN). The
  sandbox has passwordless sudo, so this is viable but unnecessary; the
  user-space shaper keeps the harness root-free and per-participant.
- **netns via unshare** — root again, and per-namespace shaping is global
  to the namespace rather than per-participant.

## Interactions

- The shaper is seeded per run (`seed` in RunContext), so H-15 runs are
  reproducible run-to-run for the same seed.
- H-07 uses the same mechanism at 100% loss for blackout windows, plus
  `relay.killPeerSocket(participant)` so the signaling path drops with the
  media path.
- coturn must be started with `--allow-loopback-peers` or it rejects the
  sandbox's loopback relaying with 403 Forbidden IP.
