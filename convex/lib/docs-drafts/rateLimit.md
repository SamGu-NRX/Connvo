# convex/lib/rateLimit.ts — analysis draft (Fleet 038, part rateLimit)

Line references are valid at commit `8d73d9b` (origin/main). All claims verified by
reading the code and grepping callers in this session.

## 1. Purpose

`convex/lib/rateLimit.ts` provides a database-backed, fixed-window rate limiter for
Convex mutations and actions. Every check reads or writes a counter row in the
shared `rateLimits` table (keyed by userId + action key + window bucket) inside the
caller's transaction, so counters are consistent for all callers of a deployment.
The module also ships read-only status inspection, a full-scan cleanup helper, an
aggregate-stats helper, a legacy method decorator, a middleware factory, and two
aspirational classes (`BurstRateLimiter`, `DistributedRateLimiter`). It was written
against "Requirements: 19.3" (header, rateLimit.ts:6), but the module currently has
**zero consumers** — the repo's real rate limiting goes through the sibling
`convex/lib/rateLimiter.ts` (see section 4), which duplicates most of this logic.
Treat this file as effectively dead scaffolding superseded by `rateLimiter.ts`.

## 2. How it works / data flow

The main path is `RateLimiter.checkRateLimit` (rateLimit.ts:78):

1. **Bucket the clock.** `windowStart = Math.floor(now / config.windowMs) *
   config.windowMs` (rateLimit.ts:86) — a fixed window aligned to `windowMs`
   multiples since the epoch. This is *not* a sliding window despite the original
   header wording (rateLimit.ts:4, fixed in doc comments).
2. **Build the storage key.** `key = keyPrefix ? \`${keyPrefix}_${action}\` : action`
   (rateLimit.ts:87).
3. **Look up the counter row** in `rateLimits` via the composite index
   `by_user_action_window` on `(userId, action, windowStartMs)`
   (rateLimit.ts:91-98; schema at convex/schema/system.ts:81, index at :88) using
   `.unique()`, which throws if two rows ever match.
4. **Increment or deny.** Existing row below `maxRequests` → `ctx.db.patch` count+1
   (rateLimit.ts:129-133); no row → `ctx.db.insert` with `count: 1`
   (rateLimit.ts:135-143); row at/over the limit → return `allowed: false` with no
   write. Both write paths happen inside the caller's mutation transaction, so a
   thrown error rolls the increment back.
5. **Result.** `{ allowed, remaining, resetTime (window end), totalHits }`
   (`RateLimitResult`, rateLimit.ts:33).

Derived paths:

- `enforceRateLimit` (rateLimit.ts:160) calls `checkRateLimit` and throws the 429
  `ConvexError` from `createError.rateLimitExceeded` (convex/lib/errors.ts:117,
  metadata `{ action, limit }`) when denied.
- `enforceFromAction` (rateLimit.ts:178) is the ActionCtx path: actions cannot
  write, so it forwards the built key and config to the internal mutation
  `internal.system.rateLimit.enforce` via `ctx.runMutation` (rateLimit.ts:184-194),
  implemented in convex/system/rateLimit.ts:7 (same counter algorithm). It maps
  `{ remaining, resetAt }` back into a `RateLimitResult` and derives `totalHits`
  as `maxRequests - remaining`. Any error from the mutation is rethrown as the 429
  ConvexError (see inconsistency 7).
- `getRateLimitStatus` (rateLimit.ts:209) repeats steps 1-3 read-only (QueryCtx-safe)
  and reports `allowed = currentCount < maxRequests` without writing
  (.unique() at rateLimit.ts:227).
- `cleanupExpiredLimits` (rateLimit.ts:243) full-scans `rateLimits` with
  `.filter(windowStartMs < cutoff)` (rateLimit.ts:252) and deletes each expired row,
  returning the count.
- `getRateLimitStats` (rateLimit.ts:266) full-scans with
  `.filter(windowStartMs >= since)` (rateLimit.ts:279) and aggregates totalRequests,
  uniqueUsers, top-10 actions, and a heuristic `rateLimitHits` (row count >= 50,
  rateLimit.ts:302; the code's own TODO at :295 admits the limitation).
- `withRateLimit(config)` (rateLimit.ts:332) is a legacy descriptor decorator: it
  assumes `args[0]` is the Convex ctx, resolves the user from
  `ctx.auth.getUserIdentity()` (rateLimit.ts:346) preferring `identity.userId` and
  falling back to a `users` lookup by `workosUserId` via the `by_workos_id` index
  (rateLimit.ts:365-368), then calls `enforceRateLimit` (rateLimit.ts:374). The
  enforcement sits in a try/catch that only warns (rateLimit.ts:389-392) and the
  original method runs unconditionally (rateLimit.ts:395) — see inconsistency 2.
- `createRateLimitMiddleware(config)` (rateLimit.ts:405) binds a config into a
  `(ctx, userId, action) => enforceRateLimit(...)` closure (rateLimit.ts:407).
- `BurstRateLimiter.checkBurstLimit` (rateLimit.ts:418) reads the row stored under
  key `burst_${action}` (rateLimit.ts:428) with `.first()` (rateLimit.ts:434) and
  compares `count` against `burstSize` — no write, no token consumption ("Simplified
  burst logic" comment at rateLimit.ts:447).
- `DistributedRateLimiter.checkDistributedLimit` (rateLimit.ts:462) casts the raw
  `key` string to `Id<"users">` (rateLimit.ts:470, self-described "Simplified
  placeholder") and forwards to `checkRateLimit` with action `"distributed"`.
  Nothing distributed exists; Convex transactions are already serialized.

## 3. Exported surface

| Export | Line (8d73d9b) | Contract |
|---|---|---|
| `RateLimitConfig` | rateLimit.ts:22 | `{ maxRequests, windowMs, keyPrefix?, skipSuccessfulRequests?, skipFailedRequests? }`; the `skip*` flags are never read (inconsistency 4). |
| `RateLimitResult` | rateLimit.ts:33 | `{ allowed, remaining, resetTime, totalHits }`; `resetTime` = end of current fixed window; `totalHits` includes the check's own increment. |
| `RateLimitConfigs` | rateLimit.ts:43 | Preset per-minute limits: TRANSCRIPT_INGESTION 50, NOTE_OPERATIONS 100, MEETING_ACTIONS 20, API_CALLS 1000, SEARCH_QUERIES 100; each with a `keyPrefix`. |
| `RateLimiter.checkRateLimit` | rateLimit.ts:78 | Records one hit for (user, keyPrefix+action) in the current fixed window; denies without writing at the limit; throws on duplicate counter rows (`.unique()`, rateLimit.ts:98). |
| `RateLimiter.enforceRateLimit` | rateLimit.ts:160 | Throws 429 `ConvexError` (code `RATE_LIMIT_EXCEEDED`) when exhausted; returns the result otherwise. |
| `RateLimiter.enforceFromAction` | rateLimit.ts:178 | MutationCtx-free enforcement for actions via `internal.system.rateLimit.enforce`; maps `{ remaining, resetAt }` → `RateLimitResult`; rethrows every failure as the 429 error. |
| `RateLimiter.getRateLimitStatus` | rateLimit.ts:209 | Read-only quota check; same bucket math; never writes. |
| `RateLimiter.cleanupExpiredLimits` | rateLimit.ts:243 | Deletes rows with `windowStartMs` older than `olderThanMs` (default 24h) via full scan; returns deleted count. |
| `RateLimiter.getRateLimitStats` | rateLimit.ts:266 | Read-only aggregates over trailing `timeRangeMs` (default 1h); `rateLimitHits` is the count>=50 heuristic. |
| `withRateLimit` | rateLimit.ts:332 | Legacy decorator; resolves user from identity (userId or workosUserId lookup); **never blocks** — logs failures and always runs the method (inconsistency 2). |
| `createRateLimitMiddleware` | rateLimit.ts:405 | Binds a config into a preconfigured `enforceRateLimit` closure. |
| `BurstRateLimiter.checkBurstLimit` | rateLimit.ts:418 | Read-only comparison of stored `burst_<action>` count vs `burstSize`; consumes nothing (inconsistency 6). |
| `DistributedRateLimiter.checkDistributedLimit` | rateLimit.ts:462 | Placeholder delegating to `checkRateLimit` with an unsafe `key as Id<"users">` cast (inconsistency 5). |

## 4. Who uses it

**Nobody.** `grep -rn "lib/rateLimit" convex src test --include="*.ts"` matches only
the auto-generated registry `convex/_generated/api.d.ts:201`
(`"lib/rateLimit": typeof lib_rateLimit;`), which Convex generates for every file
under `convex/` — it is not a hand-written consumer. Zero imports exist in `src/`,
`convex/` domains, or tests. Indirectly, `enforceFromAction` is the only caller of
the internal mutation `internal.system.rateLimit.enforce`
(convex/system/rateLimit.ts:7), which therefore is also transitively dead.

The file that *does* real rate limiting imports the sibling module:
`convex/transcripts/ingestion.ts:21`
(`import { enforceUserLimit } from "@convex/lib/rateLimiter";`, called at
ingestion.ts:125). Note `convex/monitoring/bandwidthManager.ts:68` defines its own
unrelated `checkUserLimit` method — not an import of either lib module.

For the lead's README: this module should be documented as **superseded/dead**;
`convex/lib/rateLimiter.ts` (enforceUserLimit/checkUserLimit, DEFAULT_RATE_LIMITS)
plus `convex/system/rateLimit.ts` are the live paths.

## 5. Limitations and gotchas

- **Fixed window, not sliding** (despite the original header text): a burst that
  straddles a window boundary can admit up to 2× `maxRequests` in a short real-time
  span — the classic fixed-window weakness.
- **`withRateLimit` cannot deny anything**: the enforcement try/catch
  (rateLimit.ts:389-392) swallows the 429 `ConvexError` and `originalMethod.apply`
  (rateLimit.ts:395) runs unconditionally. It increments counters and warns; that is
  all.
- **Duplicate counter rows are fatal, not healed**: `.unique()` (rateLimit.ts:98)
  throws if two `rateLimits` rows ever share (userId, action, windowStartMs); there
  is no dedup/repair path.
- **`enforceFromAction` error semantics**: any internal-mutation failure — outage,
  validator rejection, or genuine exhaustion — surfaces as the same 429 error.
  Retry logic keyed on the code will back off during infrastructure failures.
- **`rateLimitHits` in `getRateLimitStats` is a guess** (count >= 50,
  rateLimit.ts:302): over-counts for API_CALLS (limit 1000) and under-counts
  elsewhere; `maxRequests` is not persisted with the row (TODO at rateLimit.ts:295).
- **Full-table scans in cleanup/stats** (rateLimit.ts:252, :279): the table's only
  index is the composite `by_user_action_window` (convex/schema/system.ts:88), so
  there is no range index on `windowStartMs` alone. Fine for a scheduled cleanup
  mutation; do not call the stats helper per-request.
- **Dev-only console noise**: `checkRateLimit` and `checkBurstLimit` `console.log` a
  JSON blob on every check when `NODE_ENV !== "production"` (rateLimit.ts:100,
  :436); the decorator's catch warns unconditionally, including in production
  (rateLimit.ts:391).
- **Unsafe-cast shims would fail schema validation if ever called**: the
  `key as Id<"users">` cast (rateLimit.ts:470) inserts a `userId` that violates
  `v.id("users")` (convex/schema/system.ts:82) — the fake-DB tests cover the logic,
  but real Convex would reject the insert.
- **Doc-comments-only fix here**: tests were added this session
  (`convex/lib/rateLimit.test.ts`, hand-rolled fake ctx/db, hermetic, 25 tests);
  no runtime behavior was changed.

## 6. Inconsistencies

1. **Misleading "sliding window" docs.** rateLimit.ts:4 (header) and :72-73 (class
   doc) said "sliding window", but the implementation buckets time with
   `Math.floor(now / windowMs) * windowMs` (rateLimit.ts:86) — a fixed window.
   Evidence: the math at :86 and the boundary reset semantics. Fix: reword the docs.
   **Status: fixed in this branch (comment-only).** Risk: safe.
2. **`withRateLimit` can never block a request.** The catch at rateLimit.ts:389-392
   swallows the `rateLimitExceeded` ConvexError and only warns; :395 then calls
   `originalMethod.apply` unconditionally. A decorated method with an exhausted
   limit still executes; the decorator is a counter-incrementer, not a guard.
   Suggested fix: rethrow the ConvexError (or match it) instead of warning, or
   delete the decorator. Risk: **risky** (changes runtime behavior for any future
   adopter; zero callers today).
3. **`withRateLimit` is unusable as a decorator in this repo.** Its descriptor
   signature (rateLimit.ts:333-338) is the legacy `experimentalDecorators` form, but
   `tsconfig.json` has no `experimentalDecorators` flag, so `@`-syntax application
   would not typecheck; no file applies it. Suggested fix: delete, or rewrite as a
   plain wrapper function. Risk: safe (dead code).
4. **Dead config options.** `RateLimitConfig.skipSuccessfulRequests` /
   `skipFailedRequests` (rateLimit.ts:26-27) are declared but never read anywhere in
   the module (grep: declaration only). Suggested fix: remove the fields or
   implement the filtering. Risk: safe (type-level removal).
5. **`DistributedRateLimiter` is neither distributed nor safe.** rateLimit.ts:458-473:
   `checkDistributedLimit` casts an arbitrary string to `Id<"users">`
   (:470, contradicts the module's own note at :16 "Avoid unsafe casts") and would
   violate the `rateLimits.userId` validator `v.id("users")`
   (convex/schema/system.ts:82) at runtime on insert. Nothing is distributed — it
   forwards to the same single-table counter (:468-471); Convex serializes
   transactions, so the name oversells it. Suggested fix: delete, or accept a real
   `Id<"users">` parameter. Risk: safe today (no callers), **risky** if adopted as-is.
6. **`BurstRateLimiter` never consumes tokens.** rateLimit.ts:414-456: despite
   token-bucket vocabulary, `checkBurstLimit` takes a read-only `QueryCtx`, reads the
   `burst_${action}` row (:428, .first() at :434) and never writes; the count only
   becomes nonzero if some other component maintains that key (nothing does).
   `bucketSize`/`refillRate` (:422-424) are never used; the in-file comment admits
   "Simplified burst logic" (:447). Suggested fix: implement consumption in a
   mutation or delete. Risk: safe today (no callers).
7. **`enforceFromAction` converts every failure into a rate-limit error.**
   rateLimit.ts:178-207: the catch after the `runMutation` (:186) rethrows any error
   — deployment outage, validator rejection — as `createError.rateLimitExceeded`.
   Evidence: catch block at ~:197-203; contrast with the internal mutation's own
   tagged message (`RATE_LIMIT_EXCEEDED: ...`, convex/system/rateLimit.ts:33) which
   is discarded. Suggested fix: match the tagged message and rethrow non-limit
   errors. Risk: safe-ish (error typing only, but behavior-visible).
8. **Heuristic `rateLimitHits`.** rateLimit.ts:302 counts any row with `count >= 50`
   as a rate-limit hit regardless of the action's real limit; the TODO at :295
   acknowledges `maxRequests` is not stored with rows. A window with 60 hits counts
   as "exhausted" even under API_CALLS (limit 1000). Suggested fix: persist
   `maxRequests` (schema change). Risk: **risky** (schema change).
9. **Triplicated fixed-window counter.** The same get-or-insert/increment algorithm
   over the same table and index exists in `convex/lib/rateLimit.ts:78`
   (`checkRateLimit`), `convex/lib/rateLimiter.ts:153` (private `checkRateLimit`),
   and `convex/system/rateLimit.ts:7` (`enforce`). Three copies to keep in sync; the
   only live caller (`convex/transcripts/ingestion.ts:125`) uses the rateLimiter.ts
   copy. Suggested fix: consolidate on one implementation (the internal mutation is
   the natural canonical one) and delete the rest. Risk: **risky** (consumer
   migration; sibling file).
10. **Same-name exports with different behavior across the two lib modules.**
    `RateLimitConfig` (rateLimit.ts:22 vs rateLimiter.ts:17 — extra dead `skip*`
    fields here), `RateLimitResult` (rateLimit.ts:33 with `totalHits` vs
    rateLimiter.ts:57 with `windowStart`), `withRateLimit` (real-but-non-blocking
    decorator at rateLimit.ts:332 vs a no-op placeholder at rateLimiter.ts:271),
    `BurstRateLimiter` (DB-backed read-only class vs in-memory token-bucket class),
    and `getRateLimitStatus` (single-action with required config at rateLimit.ts:209
    vs multi-action with default presets at rateLimiter.ts:242). Also `keyPrefix` is
    honored here (rateLimit.ts:87) but silently ignored by the sibling's
    `checkRateLimit` (rateLimiter.ts:153-177 uses the raw `action`; its
    `DEFAULT_RATE_LIMITS` prefixes are dead). Evidence: both files read in full.
    Suggested fix: consolidate modules; until then, document that
    `lib/rateLimit` ≠ `lib/rateLimiter`. Risk: safe to document; **risky** to merge
    (key-layout compatibility).
11. **Sibling bug (not owned, not fixed): unsafe synthetic user IDs in
    `convex/lib/rateLimiter.ts`.** `enforceIPLimit` casts `ip_${ip}` and
    `enforceGlobalLimit` casts `"global"` to `Id<"users">` (rateLimiter.ts:343-366);
    inserting those into `rateLimits.userId` violates `v.id("users")`
    (convex/schema/system.ts:82) at runtime. No callers exist today (grep). Also
    note its private `checkRateLimit` ignores `config.keyPrefix` (see item 10).
    Suggested fix: separate key column or dedicated table. Risk: safe today.
12. **Hot-path dev logging.** rateLimit.ts:100-112 and :436-446 `console.log` a
    `JSON.stringify` blob on every check in non-production — noisy and wasteful for
    a per-request utility; the decorator's catch warns unconditionally (:391),
    including in production. Suggested fix: structured/gated logging or removal.
    Risk: safe.
13. **Unindexed scans for cleanup/stats.** rateLimit.ts:252 and :279 use
    `.filter()` over the whole `rateLimits` table; the only index is composite
    `by_user_action_window` (convex/schema/system.ts:88). Acceptable for scheduled
    cleanup; the stats helper would be unsafe per-request. Suggested fix: add a
    `by_windowStartMs` index if stats/cleanup frequency grows. Risk: safe (schema
    addition, additive).
