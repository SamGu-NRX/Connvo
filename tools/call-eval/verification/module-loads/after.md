# Convex per-module import-load times — `after`

Recorded 2026-10-11T22:28:53.647Z by `tools/call-eval/verification/measure-module-loads.mjs` (esbuild 0.25.4).

- node `v20.20.2`, 2 cpus, `linux x64`
- loadavg 1m/5m/15m: start `2.94 / 10.03 / 17.23`, end `2.94 / 10.03 / 17.23`
- 3 runs per module, fresh node process per run; values below are medians of `await import()` of the esbuild bundle (node startup excluded).
- 143 modules; 2 with bundle/import errors (see results.json — packages that will not evaluate under the node platform are expected to appear here).
- Sum of medians over error-free modules: **0.60 s** (upper bound on serial whole-tree load).

| module | median ms | min | max | entry KiB | closure KiB | top npm contributors (KiB) |
|---|---|---|---|---|---|---|
| types/_template.ts | 22.93 | 22.52 | 24.12 | 204 | 204 | convex 106 |
| types/index.ts | 21.29 | 20.92 | 21.37 | 174 | 174 | convex 106 |
| types/validators/index.ts | 20.56 | 19.79 | 26.71 | 167 | 167 | convex 106 |
| embeddings/index.ts | 10.7 | 8.15 | 13.28 | 108 | 358 | openai 326, convex 106 |
| realtime/batchedOperations.ts | 9.59 | 8.98 | 9.98 | 48 | 119 | convex 106 |
| embeddings/queries.ts | 9.5 | 7.09 | 10.05 | 86 | 86 | convex 106 |
| meetings/webrtc/index.ts | 9.46 | 9.41 | 11.24 | 53 | 2958 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| matching/analytics.ts | 9.35 | 9.29 | 13.57 | 66 | 139 | convex 106 |
| matching/index.ts | 9.3 | 9.28 | 9.47 | 66 | 139 | convex 106 |
| meetings/webrtc/rooms.ts | 8.75 | 8.7 | 13.85 | 43 | 2947 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| schema.ts | 8.57 | 6.37 | 9.46 | 51 | 51 | convex 106 |
| transcripts/ingestion.ts | 8.45 | 7.96 | 12.3 | 39 | 104 | convex 106 |
| meetings/queries.ts | 8.36 | 8.01 | 9.49 | 36 | 94 | convex 106 |
| matching/queue.ts | 8.2 | 7.74 | 30.89 | 29 | 93 | convex 106 |
| meetings/webrtc/signaling.ts | 8.15 | 8 | 9.83 | 37 | 101 | convex 106 |
| users/queries.ts | 8.1 | 4.99 | 8.82 | 16 | 75 | convex 106 |
| matching/engine.ts | 7.63 | 7.28 | 9.56 | 99 | 99 | convex 106 |
| auth/permissions.ts | 7.22 | 6.79 | 7.47 | 11 | 75 | convex 106 |
| matching/scoring.ts | 7.11 | 7.05 | 7.17 | 97 | 97 | convex 106 |
| prompts/index.ts | 6.9 | 6.8 | 7.03 | 37 | 110 | convex 106 |
| embeddings/actions.ts | 6.85 | 6.51 | 8.34 | 75 | 325 | openai 326, convex 106 |
| notes/index.ts | 6.8 | 6.74 | 7.04 | 57 | 123 | convex 106 |
| insights/index.ts | 6.63 | 6.03 | 6.97 | 31 | 103 | convex 106 |
| realtime/subscriptionManager.ts | 6.31 | 6.29 | 6.4 | 35 | 100 | convex 106 |
| notes/offline.ts | 6.25 | 5.77 | 7.75 | 33 | 97 | convex 106 |
| realtime/subscriptions.ts | 6.24 | 5.95 | 6.45 | 33 | 97 | convex 106 |
| monitoring/performanceQueries.ts | 6.24 | 6.03 | 9.71 | 30 | 94 | convex 106 |
| types/validators/webrtc.ts | 6.18 | 6.16 | 7.72 | 43 | 43 | convex 32 |
| transcripts/initialization.ts | 6.13 | 4.22 | 16.71 | 75 | 75 | convex 106 |
| realtime/subscriptionActions.ts | 6.04 | 4.9 | 7.24 | 12 | 59 | convex 106 |
| profiles/queries.ts | 5.97 | 4.39 | 8.76 | 9 | 67 | convex 106 |
| types/validators/meeting.ts | 5.89 | 5.8 | 6.31 | 44 | 44 | convex 32 |
| notes/mutations.ts | 5.79 | 5.72 | 6.39 | 34 | 98 | convex 106 |
| monitoring/bandwidthManager.ts | 5.63 | 5.56 | 6.46 | 25 | 96 | convex 106 |
| notes/queries.ts | 5.59 | 5.09 | 6.6 | 13 | 71 | convex 106 |
| prompts/queries.ts | 5.48 | 5.27 | 5.5 | 17 | 76 | convex 106 |
| transcripts/aggregation.ts | 5.34 | 4.42 | 7.53 | 75 | 75 | convex 106 |
| types/validators/matching.ts | 5.33 | 5.21 | 5.37 | 40 | 40 | convex 32 |
| meetings/lifecycle.ts | 5.32 | 5.21 | 5.35 | 34 | 98 | convex 106 |
| types/validators/operationalTransform.ts | 5.31 | 5.27 | 5.34 | 41 | 41 | convex 32 |
| insights/mutations.ts | 5.28 | 5.18 | 5.29 | 17 | 81 | convex 106 |
| insights/queries.ts | 5.21 | 5.09 | 5.34 | 18 | 77 | convex 106 |
| schema/interests.ts | 5.11 | 2.69 | 5.39 | 30 | 30 | convex 106 |
| meetings/stream/index.ts | 5.08 | 5.05 | 5.58 | 38 | 2917 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| types/validators/system.ts | 5.01 | 4.18 | 5.07 | 29 | 29 | convex 32 |
| prompts/mutations.ts | 4.96 | 4.53 | 5.94 | 9 | 73 | convex 106 |
| types/validators/embedding.ts | 4.95 | 4.84 | 5.11 | 37 | 37 | convex 32 |
| types/validators/user.ts | 4.87 | 2.77 | 5.08 | 28 | 28 | convex 32 |
| transcripts/queries.ts | 4.83 | 4.82 | 5 | 14 | 73 | convex 106 |
| users/mutations.ts | 4.7 | 4.66 | 5.71 | 21 | 85 | convex 106 |
| meetings/stateTracking.ts | 4.48 | 4.36 | 4.63 | 12 | 75 | convex 106 |
| matching/scheduler.ts | 4.36 | 4.26 | 4.42 | 81 | 81 | convex 106 |
| types/validators/prompt.ts | 4.34 | 3.5 | 12.97 | 29 | 29 | convex 32 |
| profiles/mutations.ts | 4.25 | 4.16 | 4.28 | 9 | 72 | convex 106 |
| embeddings/mutations.ts | 4.16 | 3.95 | 4.71 | 71 | 71 | convex 106 |
| transcripts/streaming.ts | 4.15 | 4.15 | 4.2 | 84 | 84 | convex 106 |
| notes/operations.ts | 4.1 | 3.64 | 6.51 | 41 | 41 | convex 32 |
| system/idempotency.ts | 4.1 | 3.98 | 4.28 | 76 | 76 | convex 106 |
| meetings/stream/streamHandlers.ts | 4.08 | 3.94 | 4.32 | 76 | 76 | convex 106 |
| settings/queries.ts | 3.89 | 3.87 | 3.97 | 7 | 65 | convex 106 |
| prompts/scheduler.ts | 3.89 | 3.86 | 4 | 74 | 74 | convex 106 |
| audit/logging.ts | 3.89 | 3.75 | 5.46 | 67 | 67 | convex 106 |
| monitoring/alerts.ts | 3.88 | 3.71 | 5.31 | 64 | 64 | convex 106 |
| settings/mutations.ts | 3.85 | 3.85 | 3.93 | 7 | 70 | convex 106 |
| prompts/actions.ts | 3.84 | 3.83 | 4.15 | 67 | 67 | convex 106 |
| meetings/stream/streamHelpers.ts | 3.8 | 3.74 | 5.33 | 65 | 65 | convex 106 |
| schema/meetings.ts | 3.78 | 3.66 | 3.81 | 35 | 35 | convex 106 |
| meetings/stream/webhooks.ts | 3.59 | 3.54 | 3.59 | 68 | 68 | convex 106 |
| devEval/seed.ts | 3.55 | 3.46 | 4.22 | 64 | 64 | convex 106 |
| interests/queries.ts | 3.53 | 3.4 | 4.1 | 66 | 66 | convex 106 |
| types/validators/realTime.ts | 3.51 | 3.03 | 8.07 | 28 | 28 | convex 32 |
| migrations/createMissingProfiles.ts | 3.49 | 3.26 | 4.78 | 63 | 63 | convex 106 |
| system/rateLimit.ts | 3.49 | 3.45 | 3.87 | 63 | 63 | convex 106 |
| insights/scheduler.ts | 3.44 | 3.44 | 4.3 | 70 | 70 | convex 106 |
| schema/userSettings.ts | 3.34 | 2.8 | 3.62 | 29 | 29 | convex 106 |
| meetings/stream/cleanup.ts | 3.31 | 3.23 | 4.36 | 49 | 49 | convex 106 |
| crons.ts | 3.27 | 3.16 | 3.5 | 41 | 41 | convex 106 |
| schema/ai.ts | 3.15 | 2.83 | 3.67 | 32 | 32 | convex 106 |
| insights/generation.ts | 3.14 | 3.12 | 3.43 | 58 | 58 | convex 106 |
| http.ts | 3.13 | 3.03 | 3.46 | 54 | 54 | convex 106 |
| types/validators/common.ts | 3.02 | 2.58 | 3.2 | 31 | 31 | convex 106 |
| schema/system.ts | 3.01 | 2.93 | 3.38 | 33 | 33 | convex 106 |
| schema/transcripts.ts | 2.99 | 2.96 | 3.17 | 32 | 32 | convex 106 |
| auth/guards.ts | 2.99 | 2.84 | 3.24 | 8 | 38 | convex 106 |
| types/validators/transcript.ts | 2.94 | 2.8 | 2.99 | 28 | 28 | convex 32 |
| schema/webrtc.ts | 2.93 | 2.79 | 14.79 | 32 | 32 | convex 106 |
| system/maintenance.ts | 2.93 | 2.84 | 4.7 | 51 | 51 | convex 106 |
| schema/matching.ts | 2.91 | 2.85 | 2.95 | 31 | 31 | convex 106 |
| meetings/postProcessing.ts | 2.84 | 2.81 | 3.05 | 48 | 48 | convex 106 |
| schema/messaging.ts | 2.81 | 2.67 | 3.32 | 30 | 30 | convex 106 |
| analytics/meetings.ts | 2.78 | 2.74 | 3.02 | 46 | 46 | convex 106 |
| types/validators/stream.ts | 2.77 | 2.53 | 3.26 | 23 | 23 | convex 32 |
| types/validators/responses.ts | 2.77 | 2.58 | 3.69 | 29 | 29 | convex 32 |
| types/validators/note.ts | 2.75 | 2.62 | 2.76 | 28 | 28 | convex 32 |
| schema/users.ts | 2.71 | 2.48 | 2.73 | 31 | 31 | convex 106 |
| schema/offline.ts | 2.62 | 2.58 | 2.72 | 31 | 31 | convex 106 |
| lib/audit.ts | 2.6 | 2.54 | 2.62 | 30 | 30 | convex 106 |
| lib/rateLimit.ts | 2.59 | 2.59 | 3.42 | 42 | 42 | convex 106 |
| types/validators/messaging.ts | 2.53 | 2.52 | 2.69 | 26 | 26 | convex 32 |
| lib/idempotency.ts | 2.5 | 2.4 | 2.77 | 37 | 37 | convex 106 |
| types/validators/pagination.ts | 2.45 | 2.31 | 7.21 | 26 | 26 | convex 32 |
| schema/legacy.ts | 2.33 | 2.32 | 2.59 | 29 | 29 | convex 106 |
| lib/getstreamServer.ts | 2.17 | 1.96 | 2.84 | 2 | 2834 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| lib/performance.ts | 1.99 | 1.78 | 2.33 | 8 | 8 | — |
| lib/validators.ts | 1.95 | 1.87 | 2.41 | 22 | 22 | convex 32 |
| lib/batching.ts | 1.77 | 1.72 | 1.83 | 7 | 7 | — |
| lib/observability.ts | 1.66 | 1.06 | 1.7 | 0 | 0 | — |
| lib/videoProviders.ts | 1.6 | 1.53 | 1.74 | 8 | 2840 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| lib/resilience.ts | 1.46 | 1.38 | 1.67 | 17 | 17 | convex 32 |
| lib/rateLimiter.ts | 1.39 | 1.35 | 1.42 | 16 | 16 | convex 32 |
| lib/errors.ts | 1.18 | 1.1 | 1.25 | 10 | 10 | convex 32 |
| lib/utils.ts | 1.13 | 0.97 | 1.24 | 4 | 4 | — |
| lib/clientOptimizations.ts | 1.1 | 1.01 | 6.63 | 10 | 10 | — |
| types/entities/matching.ts | 1.09 | 0.9 | 1.29 | 0 | 0 | — |
| lib/monitoring.ts | 1.04 | 0.83 | 1.07 | 6 | 37 | convex 106 |
| lib/queryOptimization.ts | 1.03 | 1.02 | 1.13 | 8 | 8 | — |
| types/domain/realTime.ts | 1.02 | 0.87 | 1.24 | 0 | 0 | — |
| types/domain/index.ts | 1.02 | 0.82 | 1.19 | 2 | 2 | — |
| types/api/index.ts | 1.01 | 0.87 | 1.21 | 4 | 4 | — |
| lib/config.ts | 0.94 | 0.9 | 0.95 | 4 | 4 | — |
| lib/alerting.ts | 0.93 | 0.93 | 0.94 | 10 | 10 | — |
| environments/staging.ts | 0.93 | 0.87 | 1.01 | 1 | 1 | — |
| types/entities/transcript.ts | 0.91 | 0.79 | 7.6 | 0 | 0 | — |
| types/api/pagination.ts | 0.9 | 0.87 | 0.99 | 3 | 3 | — |
| types/entities/meeting.ts | 0.88 | 0.81 | 0.99 | 0 | 0 | — |
| environments/local.ts | 0.88 | 0.76 | 0.93 | 1 | 1 | — |
| types/entities/webrtc.ts | 0.87 | 0.86 | 1.44 | 0 | 0 | — |
| environments/production.ts | 0.86 | 0.85 | 1.01 | 1 | 1 | — |
| types/entities/index.ts | 0.86 | 0.79 | 0.89 | 2 | 2 | — |
| types/domain/operationalTransform.ts | 0.85 | 0.85 | 1 | 0 | 0 | — |
| types/domain/vectorSearch.ts | 0.84 | 0.83 | 1.33 | 2 | 2 | — |
| types/api/responses.ts | 0.83 | 0.79 | 1.28 | 1 | 1 | — |
| lib/permissions.ts | 0.83 | 0.74 | 0.99 | 1 | 1 | — |
| types/entities/system.ts | 0.81 | 0.74 | 0.86 | 0 | 0 | — |
| types/utils.ts | 0.81 | 0.81 | 0.85 | 1 | 1 | — |
| types/entities/embedding.ts | 0.79 | 0.77 | 1.92 | 2 | 2 | — |
| types/entities/user.ts | 0.78 | 0.73 | 0.83 | 0 | 0 | — |
| types/entities/stream.ts | 0.78 | 0.75 | 0.83 | 0 | 0 | — |
| types/entities/prompt.ts | 0.77 | 0.69 | 0.77 | 0 | 0 | — |
| types/entities/note.ts | 0.77 | 0.69 | 0.81 | 0 | 0 | — |
| types/entities/messaging.ts | 0.75 | 0.73 | 1.37 | 0 | 0 | — |

### Modules with bundle/import errors
- `auth.config.ts`: ERROR: Command failed: /usr/bin/node /home/user/work/connvo-lazy/tools/call-eval/out/module-loads-after/timed-import.mjs /home/user/work/connvo-lazy/tools/call-eval/out/module-loads-after/bundles/auth.config.ts/auth.config.mjs | ❌ WORKOS_CLIENT_ID environment variable is required but not set. |  | 🔧 TO FIX THIS ERROR: | 1. Go to https://dashboard.convex.dev | 2. Select your project and deployment
- `convex.config.ts`: ERROR: Command failed: /usr/bin/node /home/user/work/connvo-lazy/tools/call-eval/out/module-loads-after/timed-import.mjs /home/user/work/connvo-lazy/tools/call-eval/out/module-loads-after/bundles/convex.config.ts/convex.config.mjs | IMPORT_ERROR: Component definition does not have the required componentDefinitionPath property. This code only works in Convex runtime. | 

Slowest 10: types/_template.ts 22.93ms, types/index.ts 21.29ms, types/validators/index.ts 20.56ms, embeddings/index.ts 10.7ms, realtime/batchedOperations.ts 9.59ms, embeddings/queries.ts 9.5ms, meetings/webrtc/index.ts 9.46ms, matching/analytics.ts 9.35ms, matching/index.ts 9.3ms, meetings/webrtc/rooms.ts 8.75ms