# Matching study run
gitSha: 42a54b5c05322c3ebc0d76aba2edc5017cd27536
manifestHash: 94c2ea95046201f1fa8f5bdecf44ed5a24a5d8c7667e6bae5dbf936280bf75b9

## Invariants
- [x] pair scoring exactly minScore does not match (strict >) — score=0.44464651314632997, matches=0
- [x] pair above minScore matches once threshold drops below it — score=0.44464651314632997, matches=1
- [x] compatible cross-shard pair cannot match at shardCount=4 — shards=2,0 score=0.7121175067888691 matches=0
- [x] same pair can match at shardCount=1 — matches=1
- [x] FIFO cap: with cap=2 and e1-e2 incompatible, zero matches (e3,e4 never scanned) — matches=0
- [x] FIFO cap widened: e3,e4 scanned and matched — matches=1
- [x] cleanup expires stale waiting entries — expired=2
- [x] expiry writes one auditLog per entry — logs=2
- [x] expired entries cannot be matched by a cycle — matches=0
- [x] DOCUMENTS MISSING GUARD: createMatch commits a pair whose availability windows already passed (finding, not a pass) — createMatch returned true for expired windows
- [x] second waiting entry per user is rejected
- [x] availableFrom in the past is rejected
- [x] retry cycle creates zero new matches — matched=0
- [x] no user in two simultaneous matches
- [x] every matchId has exactly two analytics rows with distinct userIds
- [x] derived match pairs agree with analytics matchId groups — pairs=1 analyticsGroups=1
- [x] matchedWith pointers mutual and paired — matchedRows=2 pairs=1
- [x] matches plateau: retry adds nothing — before=1 after=1
- [x] re-entry after match is allowed
- [x] no user in two simultaneous matches
- [x] every matchId has exactly two analytics rows with distinct userIds
- [x] derived match pairs agree with analytics matchId groups — pairs=23 analyticsGroups=23
- [x] matchedWith pointers mutual and paired — matchedRows=46 pairs=23
- [x] queue matched-state agrees with matches table under concurrent cycles — queueMatched=46 matches=23
- [x] concurrent cycles: exactly two analytics rows per matchId — bad=0
- [x] entry requires at least one interest and one role

## Quality
- quality-n4-s101: engine 1 pairs / 0.852 vs exact 2 / 1.306 (gaps 1/0.454) — COUNTEREXAMPLE
- quality-n6-s102: engine 1 pairs / 0.762 vs exact 3 / 2.394 (gaps 2/1.632) — COUNTEREXAMPLE
- quality-n8-s103: engine 2 pairs / 1.580 vs exact 3 / 2.359 (gaps 1/0.779) — COUNTEREXAMPLE
- quality-n8-s104-shard1: engine 4 pairs / 3.237 vs exact 4 / 3.237 (gaps 0/0.000)

## Load
- quality-n4-s101: n=4 matched=2 expired=1 cycles=1 wall p50=6.1ms p99=6.1ms
- quality-n6-s102: n=6 matched=2 expired=0 cycles=1 wall p50=8.5ms p99=8.5ms
- quality-n8-s103: n=8 matched=4 expired=1 cycles=1 wall p50=10.1ms p99=10.1ms
- quality-n8-s104-shard1: n=8 matched=8 expired=0 cycles=1 wall p50=48.8ms p99=48.8ms
- load-smoke-25-s201: n=25 matched=14 expired=10 cycles=10 wall p50=8.9ms p99=45.3ms
- load-smoke-50-s202: n=50 matched=44 expired=5 cycles=12 wall p50=8.2ms p99=369.1ms
- load-smoke-100-s203: n=100 matched=64 expired=35 cycles=13 wall p50=28.8ms p99=1293.4ms
- load-full-250-s301: n=250 matched=172 expired=77 cycles=18 wall p50=42.6ms p99=7771.1ms
- load-full-500-s302: n=500 matched=346 expired=153 cycles=19 wall p50=57.5ms p99=16424.1ms
- load-full-1000-s303: n=1000 matched=748 expired=251 cycles=19 wall p50=238.3ms p99=32843.4ms
