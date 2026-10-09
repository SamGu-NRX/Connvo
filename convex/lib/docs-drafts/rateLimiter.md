# convex/lib/rateLimiter.ts — module analysis

All `file:line` references are valid at commit `8d73d9b` (origin/main).

## 1. Purpose

`convex/lib/rateLimiter.ts` provides DB-backed, fixed-window rate limiting for Convex functions: each call by a user against a named action is counted in a `rateLimits` row keyed by `(userId, action, windowStartMs)`, and callers can either read quota or have the limit enforced with a retryable 429-style error. It exists so server functions (today only transcript ingestion) can shed abusive or runaway client traffic; it also ships secondary helpers — read-only status checks, stale-row cleanup, a per-process token bucket, and IP/global wrappers — that are currently unused by any production caller.

## 2. How it works / data flow

Enforcement path (`enforceUserLimit`, convex/lib/rateLimiter.ts:67):

1. **Resolve policy** — `options.config` wins; otherwise `DEFAULT_RATE_LIMITS[action]` is used (convex/lib/rateLimiter.ts:76). Unknown action with no config throws a plain `Error` (line 78).
2. **Count the call** — private `checkRateLimit` (line 153) computes the fixed window start `floor(now / windowMs) * windowMs` (lines 159-160), looks up the row by the `by_user_action_window` index (lines 164-172, index defined at convex/schema/system.ts:88), and either patches `count + 1` (line 189) or inserts a fresh row with `count: 1` (line 196). A row already at `maxRequests` short-circuits to `allowed: false` without writing (lines 179-187), so the counter freezes at the max until the window rolls.
3. **React** — if `allowed` is false and `options.throws` is set, the function throws the `ConvexError` from `createError.rateLimitExceeded` (convex/lib/errors.ts:117) after enriching its `data` with `retryAfterSeconds`, `resetTime`, `windowStart`, `limit`, and `action` (lines 82-100); otherwise the `RateLimitResult` is returned with `allowed: false`.

Read path (`checkUserLimit`, line 111) runs the same index lookup but never writes; the result is computed from the stored count (lines 122-144). `getRateLimitStatus` (line 242) loops `checkUserLimit` over all `DEFAULT_RATE_LIMITS` keys (or a caller-supplied list) and, on a per-action failure, logs `console.warn` and substitutes a fabricated `allowed: true, remaining: 100` result (lines 257-266).

Maintenance path (`cleanupOldRateLimits`, line 221) scans the whole `rateLimits` table with a `.filter()` on `updatedAt < Date.now() - olderThanMs` (line 229 — no index exists for this), deletes matches one by one, and returns the count.

Convex's serialized mutations make the read-increment-write sequence in `checkRateLimit` safe from lost updates between concurrent callers (a conflicting mutation retries rather than interleaving).

## 3. Exported surface

| Export | Line | Contract |
|---|---|---|
| `RateLimitConfig` | 17 | `{ windowMs, maxRequests, keyPrefix? }` — window length ms, calls allowed per window; `keyPrefix` is never read by this module. |
| `DEFAULT_RATE_LIMITS` | 26 | Fallback policy per action name: `transcriptIngestion` 50/min, `noteOperations` 200/min, `promptGeneration` 10/5min, `matchingQueue` 5/min, `apiCalls` 60/min; unknown lookups return `undefined`. |
| `RateLimitResult` | 57 | `{ allowed, remaining, resetTime, windowStart }` — admission decision, post-decision quota, window end/start in epoch ms. |
| `enforceUserLimit` | 67 | Counts one call for `(action, userId)`, consumes quota, optionally throws a `ConvexError` with retry metadata; needs a MutationCtx. |
| `checkUserLimit` | 111 | Read-only quota report for `(action, userId)`; throws on unknown action with no config; no writes, safe in queries. |
| `checkRateLimit` (private) | 153 | Core counter read/increment; returns `allowed:false` without writing once the max is reached. |
| `cleanupOldRateLimits` | 221 | Full-scan deletes rows with `updatedAt` older than `olderThanMs` (default 24h); returns deleted count; nothing schedules it. |
| `getRateLimitStatus` | 242 | Read-only quota map across actions; swallows per-action failures into an `allowed:true, remaining:100` placeholder. |
| `withRateLimit` | 271 | Placeholder method decorator — enforces nothing, ignores its arguments, and makes the wrapped method async. |
| `BurstRateLimiter` | 292 | In-memory token bucket (capacity + tokens/sec refill); instance state dies with the Convex isolate. `consume` (305), `getTokens` (318). |
| `enforceIPLimit` | 343 | Delegates to `enforceUserLimit` with a synthetic `ip_<dots→underscores>` user id (line 350); never throws on exhaustion. |
| `enforceGlobalLimit` | 358 | Delegates to `enforceUserLimit` with the shared synthetic user id `"global"` (line 363); requires an explicit config. |

## 4. Who uses it

Exactly one production import site:

- `convex/transcripts/ingestion.ts:21` — `import { enforceUserLimit } from "@convex/lib/rateLimiter";`
- `convex/transcripts/ingestion.ts:125` — `await enforceUserLimit(ctx, "transcriptIngestion", participant.userId, { throws: true });` inside the `ingestTranscriptChunk` mutation, so every transcript chunk a participant pushes consumes one unit of a 50/minute budget and the client receives the retry metadata on overflow.

`convex/monitoring/bandwidthManager.ts:68` defines its own unrelated `checkUserLimit` method (in-memory, per-tier) — a name collision that shows up in greps but does not touch this module.

Everything else in `convex/lib/rateLimiter.ts` has no caller in `convex/` or `src/` as of 8d73d9b.

## 5. Limitations and gotchas

- **Fixed windows, not sliding.** A client can burst up to ~2x `maxRequests` around a boundary (spend the window, then again immediately after it rolls). The module header even claims "sliding window" — wrong (fixed in comments on this branch).
- **`keyPrefix` is dead configuration.** Every `DEFAULT_RATE_LIMITS` entry sets one (lines 30-50) but no function in this module reads it, so two actions share counters if they share a name.
- **Cleanup is unwired.** `cleanupOldRateLimits` is referenced by no cron (convex/crons.ts defines transcript, streaming-metrics, segment, and query-optimizer cleanups only), so `rateLimits` rows accumulate forever in a deployment that never calls it.
- **Synthetic ids vs. schema validation.** `enforceIPLimit`/`enforceGlobalLimit` cast `"ip_1_2_3_4"` / `"global"` to `Id<"users">` (lines 350, 363). The schema types `userId` as `v.id("users")` (convex/schema/system.ts:82); Convex validates writes against the schema, and whether such strings pass `v.id` on write has **not been verified against a live deployment** — both exports should be treated as unproven in production.
- **Silent failure masking.** `getRateLimitStatus` replaces per-action errors with an optimistic placeholder (lines 257-266); a broken DB path is indistinguishable from a healthy window in the returned map.
- **`withRateLimit` is a no-op.** It returns the original method wrapped in an async passthrough (lines 279-281); anything relying on it for protection is unprotected, and the wrapped method's return value silently becomes a Promise.
- **`BurstRateLimiter` cannot limit across requests.** All state is instance-local; Convex invokes functions in fresh isolates, so the bucket refills from scratch every call. Useful only within one long-lived process.
- **Full-table scan in cleanup.** `.filter()` on `updatedAt` (line 229) has no supporting index; cost grows with total rows retained.
- **Env-configured limits are not used here.** `appConfig.rateLimits` (convex/environments/*.ts, e.g. production transcriptIngestion 300/min) is a separate system that `enforceUserLimit` never consults.

## 6. Inconsistencies

1. **Misleading module docstring — "sliding window".** convex/lib/rateLimiter.ts:4 claims a sliding-window algorithm; the implementation is a fixed window (`Math.floor(now / config.windowMs) * config.windowMs`, lines 159-160). Evidence: windowStart math admits a full new quota per aligned slice. Fix: say "fixed-window". Risk: safe (comment-only; fixed on this branch).
2. **Dead `keyPrefix` in every config.** convex/lib/rateLimiter.ts:20 (declaration) and 30/35/40/45/50 (values) — never read in this module. The sibling `convex/lib/rateLimit.ts:86-88` does read its `keyPrefix`. Fix: either honor it when composing the counter key or drop the field from `DEFAULT_RATE_LIMITS`. Risk: risky to change silently — rows already stored use bare action names; honoring the prefix now would orphans existing counters.
3. **`withRateLimit` does nothing (and lies about it).** convex/lib/rateLimiter.ts:271-290 — the comment says "Rate limit decorator for functions" and the body admits it is "a placeholder"; it also converts the wrapped method to async. Evidence: no counter call in the wrapper (lines 280-288). Fix: implement or delete; at minimum the doc must say it enforces nothing (fixed on this branch). Risk: safe to delete — zero call sites.
4. **Same-named, differently-shaped exports in two lib modules.** `RateLimitConfig` (rateLimiter.ts:17 vs rateLimit.ts:22 — sibling adds `skipSuccessfulRequests`/`skipFailedRequests`), `RateLimitResult` (rateLimiter.ts:57 `{windowStart}` vs rateLimit.ts:33 `{totalHits}`), `BurstRateLimiter` (rateLimiter.ts:292 vs rateLimit.ts:414), and `withRateLimit` (rateLimiter.ts:271 decorator vs rateLimit.ts:332 higher-order function) collide across `convex/lib/rateLimiter.ts` and `convex/lib/rateLimit.ts`. Evidence: `grep -n "^export" convex/lib/rateLimit.ts`. Fix: merge the two modules or rename one family; `checkUserLimit`/`getRateLimitStatus` are also shadowed by `RateLimiter.getRateLimitStatus` (rateLimit.ts:209). Risk: risky (import churn across domains).
5. **Triplicated enforcement logic.** The counter read/increment flow exists three times: convex/lib/rateLimiter.ts:153 (`checkRateLimit`), convex/lib/rateLimit.ts:74 (`RateLimiter.checkRateLimit`), and internal mutations convex/system/rateLimit.ts:4 (`enforce`) plus a near-clone convex/system/idempotency.ts:153 (`enforceRateLimit`) — the last two duplicate each other's bodies almost line for line. Fix: keep one internal mutation and have both lib modules call it. Risk: risky (behavior differs subtly: sibling composes `keyPrefix`, error shapes differ).
6. **Divergent default limits for the same action names.** `DEFAULT_RATE_LIMITS.transcriptIngestion` = 50/min (rateLimiter.ts:28-32) vs sibling `RateLimitConfigs.TRANSCRIPT_INGESTION` = 50/min (rateLimit.ts:44-48) vs env `appConfig.rateLimits.transcriptIngestion` = 1000/600/300 per minute for local/staging/production (convex/environments/local.ts:19-23, staging.ts:19-23, production.ts:19-23). `noteOperations` is 200/min here vs 100/min in the sibling; `apiCalls` 60/min here vs 1000/min in the sibling. The production reality is the 50/min from this module (the only wired path), 6x stricter than the production env config promises. Evidence: grep of both files and the three env files. Fix: single source of truth for limits. Risk: risky (changing live limits affects real throttling).
7. **`getRateLimit` in config.ts is dead.** convex/lib/config.ts:44 — no caller in `convex/` or `src/` outside config.ts itself, so the per-environment limits it exposes never influence enforcement. Evidence: `grep -rn "getRateLimit\|appConfig.rateLimits" convex src`. Fix: wire `enforceUserLimit` through it or remove. Risk: safe to remove; wiring it changes production limits (see item 6).
8. **Type-swallowing casts for synthetic user ids.** convex/lib/rateLimiter.ts:350 and 363 cast non-id strings to `Id<"users">`. Evidence: schema requires `v.id("users")` (convex/schema/system.ts:82); Convex validates writes, so inserts may fail at runtime — unverified on a live deployment. Fix: give the `rateLimits` table a generic `key` field instead of `userId`, or validate the id before writing. Risk: risky (schema change).
9. **Swallowed errors in `getRateLimitStatus`.** convex/lib/rateLimiter.ts:257-266 catches everything, warns, and returns a fake `allowed: true` — violates the repo-wide expectation that errors surface. Evidence: catch block contents. Fix: rethrow or return an explicit `unknown`/`error` state per action. Risk: safe (no callers today).
10. **Mixed error styles.** `enforceUserLimit` throws a plain `Error` for missing config (lines 78, 119) but a `ConvexError` for the limit itself (line 100); callers catching one shape will miss the other. Fix: use `createError.*` for both. Risk: safe-ish (no caller relies on the plain-Error case today).
11. **Sibling owns a latent trap for the shared table.** `RateLimiter.checkRateLimit` composes `action` as `${keyPrefix}_${action}` (convex/lib/rateLimit.ts:86-88) while this module uses the bare action name — if both modules are ever used for one action, their counters double-book the same window and each under-reports the other's traffic. Not a bug today (single caller), but documented here because the fix belongs to the sibling file. Risk: risky.

7. **Cross-file test flake in the convex project (infrastructure, not this module).** `npx vitest run` can exit 1 with an "Unhandled Rejection: Write outside of transaction 10008;_scheduled_functions" from convex-test's DatabaseFake while ALL tests still pass; the reported origin file wanders between unrelated test files (`test/convex/schemaValidation.test.ts`, `convex/types/__tests__/performanceValidation.test.ts`, `convex/types/__tests__/monitoringTools.test.ts`) and it reproduces with `convex/lib/rateLimiter.test.ts` removed. Root cause candidates live in the project-wide vitest settings (`isolate: false`, single worker - vitest.config.ts) or in convex-test usage in the affected files; not in scope for this module. Risk: safe to leave for the lead; do not "fix" by weakening tests.
