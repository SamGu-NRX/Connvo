# Convex per-module import-load times — `before`
> **PROXY (pre-fix script):** produced by measure-module-loads.mjs before two review fixes — the `splitting: true` proxy excluded deferred SDK bytes from the entry's byte accounting and parse cost, and `loadavgStart` was sampled after the run (start == end in the header below). Directional evidence only; the umbrella re-measurement with the fixed script replaces this table.



Recorded 2026-10-11T21:43:04.574Z by `tools/call-eval/verification/measure-module-loads.mjs` (esbuild 0.25.4).

- node `v20.20.2`, 2 cpus, `linux x64`
- loadavg 1m/5m/15m: start `4.86 / 3.68 / 3.11`, end `4.86 / 3.68 / 3.11`
- 3 runs per module, fresh node process per run; values below are medians of `await import()` of the esbuild bundle (node startup excluded).
- 143 modules; 2 with bundle/import errors (see results.json — packages that will not evaluate under the node platform are expected to appear here).
- Sum of medians over error-free modules: **1.64 s** (upper bound on serial whole-tree load).

| module | median ms | min | max | entry KiB | closure KiB | top npm contributors (KiB) |
|---|---|---|---|---|---|---|
| meetings/webrtc/index.ts | 119.44 | 60.01 | 125.82 | 2884 | 2958 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| meetings/webrtc/rooms.ts | 112.22 | 78.75 | 141.26 | 2873 | 2946 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| types/_template.ts | 104.72 | 48.43 | 112.41 | 204 | 204 | convex 106 |
| lib/getstreamServer.ts | 67.5 | 58.05 | 108.31 | 2833 | 2833 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| meetings/stream/index.ts | 56.68 | 56.58 | 107.05 | 2868 | 2917 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| lib/videoProviders.ts | 55.12 | 51.18 | 57.62 | 2839 | 2839 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| types/index.ts | 44.68 | 34.97 | 57.23 | 174 | 174 | convex 106 |
| types/validators/index.ts | 41.64 | 38.22 | 184.2 | 167 | 167 | convex 106 |
| system/idempotency.ts | 31.6 | 7.54 | 32.02 | 76 | 76 | convex 106 |
| transcripts/initialization.ts | 25.49 | 13.24 | 54.85 | 75 | 75 | convex 106 |
| realtime/batchedOperations.ts | 25.47 | 21.66 | 28.61 | 48 | 119 | convex 106 |
| notes/offline.ts | 24.17 | 12.84 | 29.02 | 33 | 97 | convex 106 |
| monitoring/performanceQueries.ts | 22.17 | 5.57 | 31.3 | 30 | 94 | convex 106 |
| embeddings/actions.ts | 22.14 | 20.91 | 26.51 | 320 | 320 | openai 326, convex 106 |
| notes/index.ts | 22.12 | 14.99 | 23.58 | 57 | 123 | convex 106 |
| prompts/queries.ts | 20.7 | 16.59 | 41.81 | 17 | 76 | convex 106 |
| realtime/subscriptionManager.ts | 19.07 | 18.48 | 19.57 | 35 | 100 | convex 106 |
| prompts/scheduler.ts | 18.84 | 18.14 | 27.37 | 74 | 74 | convex 106 |
| realtime/subscriptions.ts | 18.41 | 10.42 | 31.52 | 33 | 97 | convex 106 |
| schema/interests.ts | 18.31 | 3.62 | 27.49 | 30 | 30 | convex 106 |
| notes/mutations.ts | 17.84 | 14.13 | 34.69 | 34 | 98 | convex 106 |
| transcripts/streaming.ts | 17.49 | 12.67 | 22.19 | 84 | 84 | convex 106 |
| schema/meetings.ts | 17.48 | 10.2 | 25.44 | 35 | 35 | convex 106 |
| types/validators/embedding.ts | 16.88 | 8.81 | 26.52 | 37 | 37 | convex 32 |
| schema/userSettings.ts | 16.77 | 11.62 | 22.19 | 29 | 29 | convex 106 |
| meetings/webrtc/signaling.ts | 16.26 | 16.18 | 21.39 | 37 | 101 | convex 106 |
| profiles/mutations.ts | 15.57 | 8 | 18.98 | 9 | 72 | convex 106 |
| transcripts/ingestion.ts | 15.39 | 10.94 | 23.32 | 39 | 104 | convex 106 |
| types/validators/meeting.ts | 15.01 | 11.34 | 15.1 | 44 | 44 | convex 32 |
| transcripts/queries.ts | 14.79 | 4.78 | 27.58 | 14 | 73 | convex 106 |
| schema/offline.ts | 14.72 | 2.79 | 34 | 31 | 31 | convex 106 |
| embeddings/index.ts | 14.35 | 13.52 | 20.79 | 353 | 353 | openai 326, convex 106 |
| realtime/subscriptionActions.ts | 13.53 | 4.62 | 14.71 | 12 | 59 | convex 106 |
| schema/messaging.ts | 13.02 | 2.62 | 15.24 | 30 | 30 | convex 106 |
| notes/queries.ts | 12.9 | 6.61 | 20.23 | 13 | 71 | convex 106 |
| insights/mutations.ts | 12.65 | 9.88 | 15.82 | 17 | 81 | convex 106 |
| prompts/actions.ts | 12.6 | 5.19 | 14.01 | 67 | 67 | convex 106 |
| insights/index.ts | 12.33 | 12.28 | 12.4 | 31 | 103 | convex 106 |
| settings/queries.ts | 11.74 | 4.17 | 31.84 | 7 | 65 | convex 106 |
| meetings/stream/webhooks.ts | 11.74 | 5.18 | 15.44 | 68 | 68 | convex 106 |
| insights/queries.ts | 11.54 | 5.22 | 14.57 | 18 | 77 | convex 106 |
| types/validators/matching.ts | 11.31 | 7.48 | 14.71 | 40 | 40 | convex 32 |
| matching/queue.ts | 11.26 | 10.93 | 28.58 | 29 | 93 | convex 106 |
| prompts/index.ts | 10.94 | 10.68 | 22.92 | 37 | 110 | convex 106 |
| schema/matching.ts | 10.79 | 3.02 | 16.56 | 31 | 31 | convex 106 |
| schema.ts | 10.42 | 9.24 | 18.11 | 51 | 51 | convex 106 |
| matching/index.ts | 10.21 | 9.89 | 12.31 | 66 | 139 | convex 106 |
| monitoring/bandwidthManager.ts | 10.02 | 9.12 | 10.51 | 25 | 96 | convex 106 |
| schema/transcripts.ts | 9.89 | 7.17 | 11.95 | 32 | 32 | convex 106 |
| profiles/queries.ts | 9.8 | 8.44 | 11.42 | 9 | 67 | convex 106 |
| system/rateLimit.ts | 9.75 | 3.52 | 16.36 | 63 | 63 | convex 106 |
| notes/operations.ts | 9.62 | 5.24 | 12.73 | 41 | 41 | convex 32 |
| types/validators/transcript.ts | 9.15 | 4.38 | 9.89 | 28 | 28 | convex 32 |
| insights/scheduler.ts | 9.11 | 5.87 | 13.26 | 70 | 70 | convex 106 |
| meetings/stateTracking.ts | 8.86 | 8.85 | 11.8 | 12 | 75 | convex 106 |
| types/validators/operationalTransform.ts | 8.81 | 6.87 | 10.65 | 41 | 41 | convex 32 |
| matching/analytics.ts | 8.8 | 8.17 | 16.16 | 66 | 139 | convex 106 |
| types/validators/pagination.ts | 8.07 | 2.5 | 24.55 | 26 | 26 | convex 32 |
| meetings/queries.ts | 8 | 7.66 | 8.51 | 36 | 94 | convex 106 |
| types/validators/responses.ts | 7.92 | 3.19 | 21.73 | 29 | 29 | convex 32 |
| types/validators/realTime.ts | 7.65 | 3.1 | 17.31 | 28 | 28 | convex 32 |
| embeddings/queries.ts | 7.35 | 7.2 | 23.08 | 86 | 86 | convex 106 |
| settings/mutations.ts | 7.24 | 4.05 | 9.29 | 7 | 70 | convex 106 |
| users/queries.ts | 7.2 | 5.89 | 20.64 | 16 | 75 | convex 106 |
| matching/engine.ts | 7.06 | 6.15 | 7.16 | 99 | 99 | convex 106 |
| meetings/stream/streamHelpers.ts | 6.96 | 3.79 | 7.36 | 65 | 65 | convex 106 |
| prompts/mutations.ts | 6.77 | 5.25 | 8.47 | 9 | 73 | convex 106 |
| auth/permissions.ts | 6.74 | 5.81 | 8.59 | 11 | 75 | convex 106 |
| meetings/lifecycle.ts | 6.65 | 5.99 | 13.87 | 34 | 98 | convex 106 |
| matching/scoring.ts | 6.52 | 5.99 | 11.37 | 97 | 97 | convex 106 |
| types/validators/webrtc.ts | 6.4 | 5.59 | 11.91 | 43 | 43 | convex 32 |
| insights/generation.ts | 6.26 | 3.79 | 12.25 | 58 | 58 | convex 106 |
| matching/scheduler.ts | 6.14 | 4.64 | 6.7 | 81 | 81 | convex 106 |
| interests/queries.ts | 5.68 | 3.49 | 6.24 | 66 | 66 | convex 106 |
| types/entities/meeting.ts | 5.62 | 0.96 | 8.86 | 0 | 0 | — |
| schema/users.ts | 5.55 | 5.32 | 12.85 | 31 | 31 | convex 106 |
| crons.ts | 5.39 | 3.83 | 5.47 | 41 | 41 | convex 106 |
| types/domain/index.ts | 5.36 | 4.47 | 7.45 | 2 | 2 | — |
| devEval/seed.ts | 5.31 | 4.18 | 5.87 | 64 | 64 | convex 106 |
| auth/guards.ts | 5.18 | 4.91 | 5.73 | 8 | 38 | convex 106 |
| monitoring/alerts.ts | 4.89 | 3.74 | 16.15 | 64 | 64 | convex 106 |
| users/mutations.ts | 4.8 | 4.77 | 6.62 | 21 | 85 | convex 106 |
| schema/legacy.ts | 4.62 | 2.37 | 5.33 | 29 | 29 | convex 106 |
| schema/webrtc.ts | 4.6 | 2.95 | 15.74 | 32 | 32 | convex 106 |
| schema/system.ts | 4.52 | 3.14 | 11.14 | 33 | 33 | convex 106 |
| http.ts | 4.44 | 3.03 | 6.85 | 54 | 54 | convex 106 |
| meetings/stream/streamHandlers.ts | 4.32 | 4.06 | 5.79 | 76 | 76 | convex 106 |
| embeddings/mutations.ts | 4.3 | 3.9 | 9.85 | 71 | 71 | convex 106 |
| types/entities/transcript.ts | 4.26 | 1.17 | 6.99 | 0 | 0 | — |
| meetings/postProcessing.ts | 4.16 | 2.94 | 11.8 | 48 | 48 | convex 106 |
| migrations/createMissingProfiles.ts | 4.14 | 3.61 | 5.12 | 63 | 63 | convex 106 |
| system/maintenance.ts | 3.98 | 3.92 | 32.82 | 51 | 51 | convex 106 |
| analytics/meetings.ts | 3.97 | 3.27 | 4.18 | 46 | 46 | convex 106 |
| lib/idempotency.ts | 3.74 | 2.35 | 7.45 | 37 | 37 | convex 106 |
| transcripts/aggregation.ts | 3.69 | 3.67 | 6.02 | 75 | 75 | convex 106 |
| audit/logging.ts | 3.68 | 3.66 | 5.4 | 67 | 67 | convex 106 |
| types/domain/realTime.ts | 3.54 | 1.84 | 6.71 | 0 | 0 | — |
| types/validators/system.ts | 3.5 | 3.24 | 9.33 | 29 | 29 | convex 32 |
| types/validators/messaging.ts | 3.43 | 2.51 | 19.73 | 26 | 26 | convex 32 |
| types/validators/prompt.ts | 3.33 | 3.13 | 6.28 | 29 | 29 | convex 32 |
| types/validators/note.ts | 3.19 | 3.02 | 8.47 | 28 | 28 | convex 32 |
| types/validators/user.ts | 3.18 | 3.03 | 5.05 | 28 | 28 | convex 32 |
| meetings/stream/cleanup.ts | 3.11 | 3.05 | 4.84 | 49 | 49 | convex 106 |
| schema/ai.ts | 3.08 | 2.74 | 5.24 | 32 | 32 | convex 106 |
| types/entities/system.ts | 2.96 | 2.5 | 13.89 | 0 | 0 | — |
| types/validators/common.ts | 2.75 | 2.53 | 9.87 | 31 | 31 | convex 106 |
| types/domain/operationalTransform.ts | 2.74 | 2.38 | 4.82 | 0 | 0 | — |
| lib/rateLimit.ts | 2.65 | 2.63 | 2.7 | 42 | 42 | convex 106 |
| lib/audit.ts | 2.59 | 2.38 | 3.06 | 30 | 30 | convex 106 |
| lib/batching.ts | 2.56 | 2.42 | 4.7 | 7 | 7 | — |
| types/entities/stream.ts | 2.55 | 1.16 | 6.56 | 0 | 0 | — |
| types/validators/stream.ts | 2.27 | 2.26 | 4.84 | 23 | 23 | convex 32 |
| types/entities/prompt.ts | 2.14 | 0.91 | 2.61 | 0 | 0 | — |
| lib/validators.ts | 2.02 | 1.9 | 2.23 | 22 | 22 | convex 32 |
| types/api/index.ts | 1.91 | 1.81 | 5.3 | 4 | 4 | — |
| types/utils.ts | 1.73 | 1.07 | 2.82 | 1 | 1 | — |
| lib/errors.ts | 1.64 | 1.39 | 1.81 | 10 | 10 | convex 32 |
| lib/resilience.ts | 1.51 | 1.45 | 1.6 | 17 | 17 | convex 32 |
| lib/rateLimiter.ts | 1.5 | 1.41 | 1.54 | 16 | 16 | convex 32 |
| lib/config.ts | 1.47 | 0.9 | 1.48 | 4 | 4 | — |
| environments/staging.ts | 1.47 | 0.87 | 1.59 | 1 | 1 | — |
| lib/performance.ts | 1.41 | 1.38 | 1.56 | 8 | 8 | — |
| types/domain/vectorSearch.ts | 1.35 | 0.98 | 2.6 | 2 | 2 | — |
| types/entities/embedding.ts | 1.33 | 1.24 | 12.09 | 2 | 2 | — |
| types/entities/matching.ts | 1.33 | 0.85 | 3.54 | 0 | 0 | — |
| types/entities/index.ts | 1.3 | 1.21 | 17.54 | 2 | 2 | — |
| lib/clientOptimizations.ts | 1.24 | 1.21 | 1.86 | 10 | 10 | — |
| lib/monitoring.ts | 1.22 | 1.02 | 1.22 | 6 | 37 | convex 106 |
| lib/queryOptimization.ts | 1.2 | 1.13 | 1.67 | 8 | 8 | — |
| types/api/pagination.ts | 1.13 | 0.88 | 7.23 | 3 | 3 | — |
| lib/alerting.ts | 1.11 | 0.97 | 3.58 | 10 | 10 | — |
| environments/production.ts | 1.11 | 0.88 | 2.5 | 1 | 1 | — |
| types/entities/messaging.ts | 1.08 | 1.02 | 7.02 | 0 | 0 | — |
| types/entities/note.ts | 1.03 | 0.82 | 5.73 | 0 | 0 | — |
| environments/local.ts | 1.02 | 0.75 | 1.83 | 1 | 1 | — |
| types/entities/user.ts | 0.92 | 0.76 | 1.07 | 0 | 0 | — |
| types/api/responses.ts | 0.91 | 0.74 | 3.35 | 1 | 1 | — |
| lib/utils.ts | 0.9 | 0.87 | 0.93 | 4 | 4 | — |
| lib/permissions.ts | 0.87 | 0.79 | 0.87 | 1 | 1 | — |
| lib/observability.ts | 0.86 | 0.77 | 0.96 | 0 | 0 | — |
| types/entities/webrtc.ts | 0.78 | 0.72 | 0.81 | 0 | 0 | — |

### Modules with bundle/import errors
- `auth.config.ts`: ERROR: Command failed: /usr/bin/node /home/user/work/lazy-out/before/timed-import.mjs /home/user/work/lazy-out/before/bundles/auth.config.ts/auth.config.mjs | ❌ WORKOS_CLIENT_ID environment variable is required but not set. |  | 🔧 TO FIX THIS ERROR: | 1. Go to https://dashboard.convex.dev | 2. Select your project and deployment
- `convex.config.ts`: ERROR: Command failed: /usr/bin/node /home/user/work/lazy-out/before/timed-import.mjs /home/user/work/lazy-out/before/bundles/convex.config.ts/convex.config.mjs | IMPORT_ERROR: Component definition does not have the required componentDefinitionPath property. This code only works in Convex runtime. | 

Slowest 10: meetings/webrtc/index.ts 119.44ms, meetings/webrtc/rooms.ts 112.22ms, types/_template.ts 104.72ms, lib/getstreamServer.ts 67.5ms, meetings/stream/index.ts 56.68ms, lib/videoProviders.ts 55.12ms, types/index.ts 44.68ms, types/validators/index.ts 41.64ms, system/idempotency.ts 31.6ms, transcripts/initialization.ts 25.49ms