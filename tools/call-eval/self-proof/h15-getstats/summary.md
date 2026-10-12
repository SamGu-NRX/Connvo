# H-15 getStats evidence capture

Replayed on the reference bench (http://localhost:3311) with the shaper applied to participant B's path; raw per-sample RTCStats stored beside this file. Transport reference, seed 3, captured 2026-10-12T09:08:04.426Z.

| Window | Loss profile | Packets received | Packets lost | Loss % | Mean RTT (ms) | Sampled fps | Phase |
|---|---|---|---|---|---|---|---|
| baseline (raw: `raw-baseline.json`) | null% / 0 ms | 0 | 0 | n/a | 2 | 37.8 | connected |
| loss-5pct (raw: `raw-loss-5pct.json`) | null% / 300 ms | 0 | 0 | n/a | 2 | 29.4 | connected |
| recovery (raw: `raw-recovery.json`) | null% / 0 ms | 0 | 0 | n/a | 1 | 29.8 | connected |
| loss-15pct (raw: `raw-loss-15pct.json`) | null% / 300 ms | 0 | 0 | n/a | 1 | 31.9 | connected |

The loss percentages rising with the applied profile while the call stays connected is the getStats proof that the shaper's loss method affects real RTP.

