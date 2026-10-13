# Reproduction of defects (red run) — 2026-10-10

Command: `pnpm exec vitest run convex/auth/tenancy.test.ts convex/meetings/stream/webhook.test.ts --project convex`
Result: **9 failed / 1 passed (10 tests, 2 files)** — every targeted defect reproduces through actual registered Convex endpoints.

## Identity / tenancy (convex/auth/tenancy.test.ts — 4 failed, control passed)
| Test | Baseline behavior observed |
|---|---|
| rejects anonymous upsertUser | FAILED — promise resolved; an unauthenticated caller created a user doc (`10000;users`) |
| does not trust client-supplied org role/id | FAILED — `orgRole: "admin"` and `orgId: "attacker-org"` from the client were stored verbatim |
| rejects anonymous audit log reads | FAILED — anonymous `api.audit.logging.getAuditLogs` resolved with `{ logs: [] }` |
| rejects deactivated users with valid sessions | FAILED — a user with `isActive: false` resolved through a valid identity |
| control: authenticated self-upsert | PASSED (legitimate flow) |

## Stream webhook (convex/meetings/stream/webhook.test.ts — 5 failed, all via the real POST /webhooks/getstream route)
| Test | Baseline behavior observed |
|---|---|
| control: validly signed webhook accepted | FAILED with 500 — see defect W0 below |
| rejects webhooks without a signature header | FAILED — got 500 (verification is skipped when the header is absent; request still processed) |
| replaying session_ended schedules post-processing once | FAILED — each delivery unconditionally schedules `handleMeetingEnd` |
| unmapped call id returns success | FAILED — got 500 → Stream retries forever |
| recording_ready replay deduplication | FAILED — blind insert duplicates `meetingRecordings` rows |

**W0 (new defect found while reproducing, distinct from the five above):** the dispatcher forwards the raw payload — which always includes `type` — to internal mutations validated by `StreamWebhookPayloadV`, whose strict object validator rejects unknown field `type`. Every webhook event fails argument validation and returns 500; the pipeline has never worked end to end as shipped. Fix adds `type` to the payload validator.
