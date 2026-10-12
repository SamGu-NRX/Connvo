# Cutoff state — 04:50Z, run 4 in flight (deadline 05:00Z)

Run 4 (`9fc2b68` = f1e merged with umbrella 2c0c4fa, launched 04:43:45Z, load 36):
- 1/6 keys: ok (kid connvo-local-test-1)
- 2/6 deployment reuse: anonymous local backend UP on 127.0.0.1:3210
- 3/6 deployment env + guard: ok (anonymous:anonymous-connvo-int answering)
- 4/6 re-push + seed: IN FLIGHT at cutoff (slim harness tree, 25 entries; log: run4-backend-at-cutoff.log)
- Stages 5-6 (next dev + A/B/O browser proof): NOT REACHED by cutoff.

Full failing-witness chain for the session: 895b8ba (stage-4 540s push timeout under load 42)
plus this cutoff state. Sandbox was platform-reset twice (03:46, 03:55); every run's
markers here are from logs in this run's own directory.
