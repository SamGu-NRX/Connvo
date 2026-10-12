# Local Convex proof

Commit 68978320842fe1821d91fea647a1598a3de8726c, darwin arm64, 12 CPUs, node v26.5.0, load 7.87 9.07 9.00 at start, 6.52 8.69 8.86 at end.
Command: `pnpm call-eval:proof -- --evidence=tools/call-eval/verification/2026-10-12-local-convex-proof/cold`. Result: **PASS**.

| Stage | Result | Wall time |
|---|---|---|
| Backend: provision, env, push, seed, shape check, next dev | ready; push completed true; seed shape verified true | 12.5 s |
| A opens the meeting (expects read) | pass: OK: Eval harness smoke meeting | 0.8 s |
| B opens the meeting (expects read) | pass: OK: Eval harness smoke meeting | 0.3 s |
| O opens the meeting (expects refused) | pass: ERROR: [CONVEX Q(meetings/queries:getMeeting)] [Request ID: 7a43ca90195729d0] Server Error | 2.1 s |

Seeded meeting: `m973b3w70zyx98a315y0g9nv9s8g41nh`.
