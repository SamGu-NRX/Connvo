# resilience.ts — Module Analysis Draft

(All `resilience.ts:N` references are line numbers at commit 8d73d9b.)

## 1. Purpose

`convex/lib/resilience.ts` provides the backend's shared resilience toolkit for riding out failures in external services (GetStream video, transcription providers, WorkOS). It exports four building blocks that compose: `withRetry` (async retry with exponential backoff and optional jitter, gated by a retryable-error allowlist), `CircuitBreaker` (a closed/open/half-open state machine that fails fast while a service is unhealthy), `Semaphore` (a counting semaphore for bulkhead-style concurrency caps), and `ResilienceUtils` (composition helpers: retry-inside-breaker, timeout racing, bulkheading, and a health snapshot). Preset factories (`RetryPolicies`, `CircuitBreakerConfigs`) give tuned defaults per service class, and module-level singleton registries (`CircuitBreakers`, `Semaphores`) hold named instances for the app's real external dependencies. It contains no Convex `ctx` usage at all — it is pure orchestration over caller-supplied async operations.

## 2. How it works / data flow

The main path, as used in production today, is the Stream video-service flow in `convex/meetings/stream/index.ts`:

1. A Stream action wraps its external call: `withRetry(() => CircuitBreakers.getstream.execute(async () => { ... }), RetryPolicies.externalService())` (e.g. `convex/meetings/stream/index.ts:150-206`, repeated for token creation at 493-517 and two more sites at 687-723 and 896-925). The shared `getstream` breaker is the module-level singleton from `resilience.ts:308`, built on the `videoService` preset (`CircuitBreakerConfigs.videoService()` at 286: open at ≥30% failures with ≥3 requests in the window, 60s recovery).
2. `withRetry` (`resilience.ts:54-99`) loops `attempt = 1..maxAttempts`. On failure it checks `policy.retryableErrors` by case-sensitive substring against `error.message` / `error.name` (60-70); non-matching errors are rethrown immediately, matching errors keep looping. Between attempts it computes `min(baseDelayMs * backoffMultiplier ** (attempt - 1), maxDelayMs)` plus `Math.random() * jitterMs` and sleeps on a real `setTimeout` (76-96), logging `Retry attempt N/M ...` to the console first.
3. `CircuitBreaker.execute` (`resilience.ts:120-142`) consults the state machine: while `open` and before `nextRetryTime`, it throws `createError.externalServiceTimeout("Circuit breaker", recoveryTimeoutMs)` WITHOUT invoking the operation (122-130) — a `ConvexError` with code `EXTERNAL_SERVICE_TIMEOUT`, status 504 (defined in `convex/lib/errors.ts:135-142`). After the deadline it flips to `half-open` and proceeds. The operation's outcome is recorded by `onSuccess` (144-157) or `onFailure` (159-172); `shouldOpenCircuit` (174-183) opens the breaker only when `requestCount >= minimumThroughput` AND `failureCount / requestCount >= failureThreshold` over the current monitoring window, which `resetWindowIfNeeded` (190-198) lazily zeroes when older than `monitoringWindowMs`. A half-open success closes the circuit and clears the failure timestamps; a half-open failure reopens it.
4. `RetryPolicies.externalService()` (`resilience.ts:250-265`) supplies the allowlist (`"timeout"`, `"ECONNRESET"`, `"ENOTFOUND"`, `"ECONNREFUSED"`, `"500"`–`"504"`) that decides which Stream failures retry.

Key subtlety of this composition: **retry is OUTSIDE the breaker**, so each of the 4 attempts of `externalService` is a separate breaker request — one logical call can add up to 4 failure counts to the shared breaker. `ResilienceUtils.withResiliency` (`resilience.ts:321-329`) is the opposite composition (retry inside), counting N retries as ONE breaker request. The codebase contains both orders but only the stream one is live.

Everything lives in one in-memory module scope: `CircuitBreakers` (`307-312`) and `Semaphores` (`419-423`) instantiate at module load. In Convex, each function invocation runs in its own isolate, so this state is **per-isolate** — it persists only for the lifetime of one invocation's module instance and resets between invocations.

## 3. Exported surface

| Export | Line | Contract |
|---|---|---|
| `RetryPolicy` | 17-24 | Config for `withRetry`: attempts, backoff base/cap/multiplier, optional jitter, optional retryable-substring allowlist. |
| `CircuitBreakerConfig` | 29-35 | Config for `CircuitBreaker`: `failureThreshold` is a failure RATE (0-1, not a count), recovery timeout, monitoring window, minimum throughput. |
| `CircuitBreakerState` | 39 | `"closed" \| "open" \| "half-open"` lifecycle states. |
| `CircuitBreakerStatus` | 44-50 | Snapshot: state, window failure count, last failure time, next retry time (both optional). |
| `withRetry<T>` | 54-99 | Runs `operation` up to `maxAttempts` with exponential backoff + jitter; rethrows non-retryable errors immediately and the last error at exhaustion; `maxAttempts <= 0` throws a generic `Error` without running the operation. |
| `CircuitBreaker` | 106-208 | State-machine wrapper; `execute` (120) fails fast while open with `EXTERNAL_SERVICE_TIMEOUT`, probes in half-open; `getStatus` (200) returns a read-only snapshot. No single-probe lock in half-open. |
| `RetryPolicies` | 213-265 | Factories: `conservative` (217: 3 attempts, 1s→5s, 2x, 500ms jitter), `aggressive` (228: 5, 0.5s→10s, 1.5x, 1s), `realtime` (239: 2, 100ms→1s, 2x, 100ms), `externalService` (250: 4, 1s→8s, 2x, 500ms, transport-error allowlist). Fresh object per call. |
| `CircuitBreakerConfigs` | 272-302 | Factories: `externalApi` (276: 50% @ ≥5 req/min window, 30s recovery), `videoService` (286: 30% @ ≥3/2min, 60s), `transcriptionService` (296: 40% @ ≥4/90s, 45s). Fresh object per call. |
| `CircuitBreakers` | 307-312 | Module-level named breakers: `getstream` (308), `whisper` (309), `assemblyai` (310), `workos` (311). Per-isolate state. |
| `ResilienceUtils` | 317-382 | `withResiliency` (321: retry inside breaker), `withTimeout` (334: race a real timer; loser NOT cancelled; `timeoutMessage` param unused), `withBulkhead` (359: acquire/run/release in `finally`), `getSystemHealth` (374: status of all four named breakers). |
| `Semaphore` | 387-414 | Counting semaphore; `acquire` (395) FIFO-queues when exhausted; `release` (406) hands permits to waiters or increments; no upper bound — over-releasing inflates the total. |
| `Semaphores` | 419-423 | Module-level named semaphores: `videoOperations` (420: 10), `transcriptionOperations` (421: 5), `externalApiCalls` (422: 20). Per-isolate state; currently unused. |

## 4. Who uses it

`grep -rn "lib/resilience" convex src --include="*.ts"` matches exactly two importers (plus nothing in `src/`):

1. **`convex/meetings/stream/index.ts:26-30`** — imports `withRetry`, `RetryPolicies`, `CircuitBreakers`. This is the only live consumer. Every external Stream call (create call, create token, fetch recordings) runs through `withRetry(() => CircuitBreakers.getstream.execute(...), RetryPolicies.externalService())` — see `convex/meetings/stream/index.ts:150-206` and `convex/meetings/stream/index.ts:493-517`.

   ```ts
   // convex/meetings/stream/index.ts:150-152, 205-206
   const result = await withRetry<{ callId: string; call: StreamCall }>(
     async () => {
       return await CircuitBreakers.getstream.execute(async () => {
         ...
   }, RetryPolicies.externalService());
   ```

2. **`convex/meetings/lifecycle.ts:30-34`** — imports `withRetry`, `RetryPolicies`, `ResilienceUtils`, but **never uses any of them**: each symbol appears exactly once in the file (the import block itself; verified with `grep -c`), making the entire import block dead (see Inconsistencies #2).

The hint of a third importer is wrong: `convex/realtime/subscriptions.ts:25` imports `CircuitBreaker` **from `@convex/lib/batching`** (its import block spans lines 24-28), not from resilience. No file outside resilience.ts uses `Semaphore`, `Semaphores`, `ResilienceUtils.*`, `CircuitBreakerConfigs`, or the `CircuitBreaker` class itself.

## 5. Limitations and gotchas

- **Per-isolate state defeats deployment-wide breaking.** `CircuitBreakers` and `Semaphores` are module singletons, but Convex function invocations run in isolates that are typically fresh, so breaker state rarely survives between invocations. In practice the `getstream` breaker smooths repeated failures *within one action invocation* (and an action that fires many Stream calls benefits), but it cannot accumulate failures across invocations — `minimumThroughput: 3` within one invocation is rarely reached, so the breaker may never open where it is used today. Treat it as best-effort in-invocation resilience, not a service-level guard.
- **`retryableErrors` matches JSON text of ConvexErrors.** A `ConvexError` with an object payload exposes `.message` as the JSON-serialized payload (verified empirically: `new ConvexError({..., statusCode: 504}).message` is the JSON string, and `.name` is `"ConvexError"`). So the `"504"` entry matches a breaker-open error (statusCode embedded in JSON), while the `"timeout"` entry does NOT match plain-English "timed out". Matching is case-sensitive. Consequence: breaker-open errors from the shared `getstream` breaker ARE retried by `externalService` — burning ~8-15s of delays per invocation against an open breaker (the fail-fast throw does not itself count as a breaker failure, since it happens before the try block).
- **Non-retryable errors are only protected when the allowlist is set.** Without `retryableErrors` (as in `conservative`/`aggressive`/`realtime`), EVERY error retries — including validation errors and `ConvexError`s from permission checks. Callers should pick `externalService` (or define an allowlist) unless retry-everything is intended.
- **Timeouts do not cancel work.** `ResilienceUtils.withTimeout` leaves the losing operation running (no `AbortSignal`); its `timeoutMessage` parameter is silently ignored (see Inconsistencies #4).
- **No jitter seeding / `Math.random` in delays.** Retry timing is non-deterministic by design; tests that assert exact delays must stub `Math.random`.
- **`Semaphore` has no upper bound on permits.** Over-releasing inflates the count permanently (no error, no reset-to-constructor); a lost `release` starves the FIFO queue forever (no timeout, no cancellation).
- **Half-open is not single-probe.** Concurrent `execute` calls during half-open all run the operation; each failure re-opens and pushes `nextRetryTime` out.
- **Window reset can wipe the outcome that trips.** `resetWindowIfNeeded` runs after the increment and after the open decision; the counters that justified opening are immediately zeroed on the same tick if the window rolls, so post-trip `getStatus().failureCount` may read 0.
- **`console.log` on every retry** — noisy under sustained failure, but at least it is visible in Convex logs.

## 6. Inconsistencies

1. **`failureThreshold` means opposite things in the two same-named classes.** `resilience.ts:174-183` treats it as a failure RATE (`failureCount / requestCount >= 0.5`), while `convex/lib/batching.ts:341-357` (`CircuitBreaker`, constructor default `failureThreshold = 5`) treats it as a failure COUNT. Same class name, same repo, incompatible config semantics — a config object cannot be moved between them silently. Evidence: `resilience.ts:180-183` vs `batching.ts:348-357`. Suggested fix: rename in a follow-up (e.g. `failureRateThreshold` vs `failureCountThreshold`). Risk: safe to rename via a type-level refactor, but it touches files owned by other threads — record only here.
2. **Dead import block in `convex/meetings/lifecycle.ts:30-34`.** `withRetry`, `RetryPolicies`, `ResilienceUtils` are imported and never referenced (each `grep -c` count in that file is 1 — the import lines themselves). Evidence: `grep -n "withRetry\|RetryPolicies\|ResilienceUtils" convex/meetings/lifecycle.ts` → only lines 31-33. Suggested fix: delete the import block. Risk: safe.
3. **Four circuit-breaker implementations coexist.** `resilience.ts:106` (rate-based, minimum throughput, monitoring window), `convex/lib/batching.ts:341` (count-based), `convex/lib/performance.ts:285` (`PerformanceCircuitBreaker`, count-based + SLO latency threshold), and `convex/lib/monitoring.ts:266` (`withCircuitBreaker` over a module-level `Map` at 261, count-based). Divergent state machines (different recovery resets, different open conditions) invite drift; monitoring.ts's version even keeps global state keyed by operation name — also per-isolate, so equally defeated by isolate resets. Suggested fix: consolidate on one implementation (or clearly document which is canonical). Risk: risky — behavior differs subtly; needs a dedicated refactor task.
4. **`ResilienceUtils.withTimeout` accepts and ignores `timeoutMessage`** (`resilience.ts:334-338` — parameter with default `"Operation timed out"` is never referenced in the body; the rejection message always comes from `createError.externalServiceTimeout("Operation", timeoutMs)`). Evidence: reading the function body 334-350. Suggested fix: either thread the message into the error or drop the parameter. Risk: safe.
5. **`CircuitBreakers.whisper` / `assemblyai` / `workos` are instantiated but never used** (`resilience.ts:309-311`; `getSystemHealth` at 374-381 reports on all four, but no caller outside the module touches the latter three). Not harmful, but the "system health" name suggests coverage that does not exist. Risk: safe to leave; revisit if/when transcription/WorkOS callers adopt them.
6. **`Semaphores` registry is entirely unused** (`resilience.ts:419-423`; plus `Semaphore` class and `ResilienceUtils.withBulkhead` have no external callers — verified via symbol grep excluding resilience.ts itself). Dead public API surface with per-isolate semantics that cannot deliver the advertised cross-invocation concurrency caps. Risk: safe to leave; candidates for future consolidation.
7. **Retry-outside vs retry-inside breaker composition are both present.** The live stream pattern (retry wraps breaker — each attempt counts against the breaker) and `ResilienceUtils.withResiliency` (breaker wraps retry — one count) encode opposite semantics with no documentation of which is intended where; `lifecycle.ts` imports the unused helper that embodies the second pattern. Suggested fix: standardize once the intent is decided. Risk: behavioral — needs owner input.
