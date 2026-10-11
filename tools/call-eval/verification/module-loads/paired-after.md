# Convex per-module import-load times — `after-paired`

Recorded 2026-10-11T22:33:05.985Z by `tools/call-eval/verification/measure-module-loads.mjs` (esbuild 0.25.4).

- node `v20.20.2`, 2 cpus, `linux x64`
- loadavg 1m/5m/15m: start `5.60 / 7.11 / 14.27`, end `5.60 / 7.11 / 14.27`
- 3 runs per module, fresh node process per run; values below are medians of `await import()` of the esbuild bundle (node startup excluded).
- 143 modules; 2 with bundle/import errors (see results.json — packages that will not evaluate under the node platform are expected to appear here).
- Sum of medians over error-free modules: **1.15 s** (upper bound on serial whole-tree load).

| module | median ms | min | max | entry KiB | closure KiB | top npm contributors (KiB) |
|---|---|---|---|---|---|---|
| types/index.ts | 44.36 | 31.59 | 53.83 | 174 | 174 | convex 106 |
| types/_template.ts | 43.57 | 39.69 | 54.64 | 204 | 204 | convex 106 |
| types/validators/index.ts | 35.99 | 32.77 | 36.53 | 167 | 167 | convex 106 |
| meetings/webrtc/signaling.ts | 28.21 | 16.98 | 45.92 | 37 | 101 | convex 106 |
| users/mutations.ts | 25.22 | 8.53 | 26.32 | 21 | 85 | convex 106 |
| notes/mutations.ts | 24.74 | 19.02 | 33.61 | 34 | 98 | convex 106 |
| realtime/batchedOperations.ts | 22.33 | 21.19 | 35.56 | 48 | 119 | convex 106 |
| matching/scoring.ts | 21.6 | 18.21 | 43.4 | 97 | 97 | convex 106 |
| meetings/webrtc/index.ts | 20 | 16.3 | 25.76 | 53 | 2958 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| meetings/lifecycle.ts | 17.91 | 17.2 | 19.97 | 34 | 98 | convex 106 |
| embeddings/queries.ts | 17.45 | 10.87 | 30.25 | 86 | 86 | convex 106 |
| meetings/stateTracking.ts | 17.37 | 4.9 | 25.55 | 12 | 75 | convex 106 |
| notes/offline.ts | 17.23 | 13.46 | 23.63 | 33 | 97 | convex 106 |
| schema.ts | 17.19 | 5.76 | 31.18 | 51 | 51 | convex 106 |
| embeddings/index.ts | 17.05 | 12.83 | 18.6 | 108 | 358 | openai 326, convex 106 |
| notes/queries.ts | 17.02 | 11.28 | 24.66 | 13 | 71 | convex 106 |
| profiles/mutations.ts | 16.79 | 12.56 | 17.5 | 9 | 72 | convex 106 |
| meetings/queries.ts | 16.72 | 10 | 21.43 | 36 | 94 | convex 106 |
| matching/index.ts | 16.52 | 12.24 | 19.73 | 66 | 139 | convex 106 |
| monitoring/performanceQueries.ts | 16.43 | 14.71 | 28.83 | 30 | 94 | convex 106 |
| meetings/webrtc/rooms.ts | 16.08 | 14.72 | 34.82 | 43 | 2947 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| matching/analytics.ts | 15.87 | 15.37 | 35.11 | 66 | 139 | convex 106 |
| notes/operations.ts | 15.6 | 4.9 | 15.97 | 41 | 41 | convex 32 |
| prompts/index.ts | 15.3 | 13.12 | 19.13 | 37 | 110 | convex 106 |
| meetings/stream/index.ts | 15.06 | 7.98 | 19.44 | 38 | 2917 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| matching/engine.ts | 14.98 | 12.09 | 19.3 | 99 | 99 | convex 106 |
| insights/index.ts | 14.75 | 9.71 | 20.66 | 31 | 103 | convex 106 |
| prompts/queries.ts | 14.6 | 14.41 | 34.93 | 17 | 76 | convex 106 |
| matching/queue.ts | 13.76 | 13.15 | 25.2 | 29 | 93 | convex 106 |
| users/queries.ts | 13.45 | 8.34 | 14.73 | 16 | 75 | convex 106 |
| insights/queries.ts | 13.11 | 8.63 | 16.06 | 18 | 77 | convex 106 |
| embeddings/actions.ts | 13.01 | 12.37 | 32.22 | 75 | 325 | openai 326, convex 106 |
| transcripts/ingestion.ts | 12.95 | 9.49 | 25.54 | 39 | 104 | convex 106 |
| notes/index.ts | 12.63 | 6.37 | 17.36 | 57 | 123 | convex 106 |
| transcripts/streaming.ts | 12.61 | 7.44 | 13.77 | 84 | 84 | convex 106 |
| system/idempotency.ts | 12.5 | 4.47 | 18.94 | 76 | 76 | convex 106 |
| schema/meetings.ts | 12.04 | 3.59 | 15.62 | 35 | 35 | convex 106 |
| monitoring/bandwidthManager.ts | 11.3 | 5.7 | 15.37 | 25 | 96 | convex 106 |
| insights/mutations.ts | 11.24 | 5.7 | 14.63 | 17 | 81 | convex 106 |
| meetings/stream/webhooks.ts | 11.11 | 8.55 | 14.21 | 68 | 68 | convex 106 |
| types/validators/pagination.ts | 10.85 | 2.49 | 13.01 | 26 | 26 | convex 32 |
| types/validators/webrtc.ts | 10.49 | 10.41 | 11.81 | 43 | 43 | convex 32 |
| system/rateLimit.ts | 10.38 | 3.3 | 11.93 | 63 | 63 | convex 106 |
| insights/generation.ts | 9.95 | 8.04 | 14.29 | 58 | 58 | convex 106 |
| prompts/actions.ts | 9.87 | 3.8 | 20.94 | 67 | 67 | convex 106 |
| types/validators/embedding.ts | 9.69 | 5.17 | 14.76 | 37 | 37 | convex 32 |
| auth/permissions.ts | 9.63 | 8.85 | 10.53 | 11 | 75 | convex 106 |
| profiles/queries.ts | 9.53 | 4.46 | 15.27 | 9 | 67 | convex 106 |
| transcripts/initialization.ts | 9.42 | 4.3 | 18.54 | 75 | 75 | convex 106 |
| prompts/mutations.ts | 9.4 | 9.35 | 12.97 | 9 | 73 | convex 106 |
| migrations/createMissingProfiles.ts | 9.36 | 8.56 | 21.19 | 63 | 63 | convex 106 |
| types/validators/common.ts | 9.07 | 8.6 | 9.49 | 31 | 31 | convex 106 |
| realtime/subscriptions.ts | 8.81 | 8.49 | 52.39 | 33 | 97 | convex 106 |
| settings/mutations.ts | 8.73 | 4.36 | 15.88 | 7 | 70 | convex 106 |
| transcripts/aggregation.ts | 8.37 | 4 | 9.79 | 75 | 75 | convex 106 |
| meetings/stream/cleanup.ts | 8.13 | 3.28 | 9.82 | 49 | 49 | convex 106 |
| meetings/stream/streamHandlers.ts | 7.61 | 3.83 | 9.83 | 76 | 76 | convex 106 |
| types/validators/operationalTransform.ts | 7.4 | 5.87 | 14.56 | 41 | 41 | convex 32 |
| meetings/stream/streamHelpers.ts | 6.79 | 5.22 | 14.01 | 65 | 65 | convex 106 |
| http.ts | 6.73 | 3.56 | 9.58 | 54 | 54 | convex 106 |
| realtime/subscriptionManager.ts | 6.65 | 6.54 | 26.36 | 35 | 100 | convex 106 |
| settings/queries.ts | 6.06 | 4.46 | 12 | 7 | 65 | convex 106 |
| types/validators/meeting.ts | 5.92 | 5.7 | 14.66 | 44 | 44 | convex 32 |
| types/entities/stream.ts | 5.86 | 1 | 12.52 | 0 | 0 | — |
| types/validators/matching.ts | 5.62 | 5.35 | 8.89 | 40 | 40 | convex 32 |
| types/validators/prompt.ts | 5.58 | 2.98 | 8.46 | 29 | 29 | convex 32 |
| transcripts/queries.ts | 5.57 | 5.51 | 14.55 | 14 | 73 | convex 106 |
| schema/matching.ts | 5.5 | 2.85 | 7.69 | 31 | 31 | convex 106 |
| types/api/responses.ts | 5.4 | 5.01 | 5.5 | 1 | 1 | — |
| schema/ai.ts | 5.37 | 3.19 | 11.08 | 32 | 32 | convex 106 |
| analytics/meetings.ts | 5.08 | 3 | 6.82 | 46 | 46 | convex 106 |
| prompts/scheduler.ts | 5.06 | 3.91 | 9.08 | 74 | 74 | convex 106 |
| insights/scheduler.ts | 4.94 | 3.6 | 6.45 | 70 | 70 | convex 106 |
| realtime/subscriptionActions.ts | 4.84 | 4.66 | 14.41 | 12 | 59 | convex 106 |
| matching/scheduler.ts | 4.73 | 4.7 | 12.45 | 81 | 81 | convex 106 |
| schema/users.ts | 4.38 | 4.12 | 6.52 | 31 | 31 | convex 106 |
| lib/rateLimit.ts | 4.29 | 3 | 7.11 | 42 | 42 | convex 106 |
| types/validators/realTime.ts | 4.28 | 3.26 | 4.53 | 28 | 28 | convex 32 |
| lib/rateLimiter.ts | 4.28 | 1.94 | 7.64 | 16 | 16 | convex 32 |
| embeddings/mutations.ts | 4.19 | 4.16 | 4.48 | 71 | 71 | convex 106 |
| lib/permissions.ts | 4.15 | 2.62 | 5.09 | 1 | 1 | — |
| audit/logging.ts | 3.99 | 3.87 | 8.69 | 67 | 67 | convex 106 |
| monitoring/alerts.ts | 3.85 | 3.74 | 7.36 | 64 | 64 | convex 106 |
| schema/offline.ts | 3.75 | 2.39 | 18.71 | 31 | 31 | convex 106 |
| devEval/seed.ts | 3.7 | 3.59 | 8.37 | 64 | 64 | convex 106 |
| interests/queries.ts | 3.62 | 3.6 | 3.74 | 66 | 66 | convex 106 |
| types/entities/webrtc.ts | 3.6 | 2.68 | 3.79 | 0 | 0 | — |
| crons.ts | 3.6 | 3.3 | 4.92 | 41 | 41 | convex 106 |
| system/maintenance.ts | 3.59 | 2.93 | 5.04 | 51 | 51 | convex 106 |
| types/entities/user.ts | 3.54 | 0.84 | 9.97 | 0 | 0 | — |
| types/validators/responses.ts | 3.43 | 2.45 | 8.61 | 29 | 29 | convex 32 |
| types/validators/system.ts | 3.37 | 3.12 | 4.7 | 29 | 29 | convex 32 |
| auth/guards.ts | 3.32 | 2.88 | 12.55 | 8 | 38 | convex 106 |
| types/validators/transcript.ts | 3.29 | 3.15 | 4.01 | 28 | 28 | convex 32 |
| lib/audit.ts | 3.25 | 2.33 | 3.35 | 30 | 30 | convex 106 |
| types/entities/index.ts | 3.18 | 1.08 | 5.39 | 2 | 2 | — |
| schema/transcripts.ts | 3.14 | 2.87 | 9.29 | 32 | 32 | convex 106 |
| types/utils.ts | 3.12 | 1.05 | 6.5 | 1 | 1 | — |
| schema/system.ts | 3.06 | 2.9 | 10.63 | 33 | 33 | convex 106 |
| types/validators/user.ts | 3.02 | 2.85 | 3.03 | 28 | 28 | convex 32 |
| schema/webrtc.ts | 2.92 | 2.89 | 3.07 | 32 | 32 | convex 106 |
| types/validators/messaging.ts | 2.92 | 2.75 | 10.53 | 26 | 26 | convex 32 |
| meetings/postProcessing.ts | 2.85 | 2.73 | 2.92 | 48 | 48 | convex 106 |
| types/validators/note.ts | 2.84 | 2.76 | 2.95 | 28 | 28 | convex 32 |
| schema/messaging.ts | 2.78 | 2.74 | 2.79 | 30 | 30 | convex 106 |
| types/entities/matching.ts | 2.64 | 0.86 | 6.4 | 0 | 0 | — |
| lib/idempotency.ts | 2.57 | 2.48 | 7.52 | 37 | 37 | convex 106 |
| schema/interests.ts | 2.54 | 2.45 | 13.49 | 30 | 30 | convex 106 |
| schema/userSettings.ts | 2.47 | 2.4 | 2.53 | 29 | 29 | convex 106 |
| schema/legacy.ts | 2.42 | 2.31 | 2.82 | 29 | 29 | convex 106 |
| types/entities/prompt.ts | 2.36 | 0.94 | 4.58 | 0 | 0 | — |
| environments/production.ts | 2.31 | 0.89 | 2.96 | 1 | 1 | — |
| types/validators/stream.ts | 2.11 | 2.02 | 2.52 | 23 | 23 | convex 32 |
| types/api/pagination.ts | 2.03 | 0.93 | 3.48 | 3 | 3 | — |
| lib/performance.ts | 2.03 | 1.79 | 9.6 | 8 | 8 | — |
| lib/validators.ts | 1.96 | 1.91 | 2.2 | 22 | 22 | convex 32 |
| lib/queryOptimization.ts | 1.95 | 1.16 | 8.76 | 8 | 8 | — |
| types/entities/meeting.ts | 1.87 | 0.84 | 2.22 | 0 | 0 | — |
| lib/observability.ts | 1.86 | 1.05 | 11.4 | 0 | 0 | — |
| lib/videoProviders.ts | 1.83 | 1.66 | 2.12 | 8 | 2840 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| environments/staging.ts | 1.82 | 1.09 | 14.05 | 1 | 1 | — |
| types/domain/realTime.ts | 1.68 | 1.04 | 2.32 | 0 | 0 | — |
| lib/getstreamServer.ts | 1.63 | 1.56 | 1.67 | 2 | 2834 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| types/entities/system.ts | 1.62 | 1.02 | 4.01 | 0 | 0 | — |
| types/api/index.ts | 1.6 | 1.13 | 3.28 | 4 | 4 | — |
| lib/resilience.ts | 1.59 | 1.43 | 4.04 | 17 | 17 | convex 32 |
| lib/batching.ts | 1.47 | 1.37 | 2.77 | 7 | 7 | — |
| lib/errors.ts | 1.35 | 1.22 | 1.65 | 10 | 10 | convex 32 |
| lib/monitoring.ts | 1.33 | 1.13 | 14.76 | 6 | 37 | convex 106 |
| types/entities/embedding.ts | 1.32 | 1.07 | 3.57 | 2 | 2 | — |
| lib/clientOptimizations.ts | 1.15 | 1.07 | 1.79 | 10 | 10 | — |
| types/domain/index.ts | 1.1 | 0.94 | 1.56 | 2 | 2 | — |
| lib/alerting.ts | 1.07 | 0.97 | 1.09 | 10 | 10 | — |
| types/entities/note.ts | 1.02 | 0.96 | 2.61 | 0 | 0 | — |
| types/entities/messaging.ts | 1.01 | 0.9 | 7.06 | 0 | 0 | — |
| types/domain/operationalTransform.ts | 1 | 0.91 | 1.03 | 0 | 0 | — |
| lib/utils.ts | 0.99 | 0.95 | 3.13 | 4 | 4 | — |
| environments/local.ts | 0.98 | 0.74 | 2.72 | 1 | 1 | — |
| lib/config.ts | 0.98 | 0.96 | 1.03 | 4 | 4 | — |
| types/domain/vectorSearch.ts | 0.94 | 0.82 | 5.42 | 2 | 2 | — |
| types/entities/transcript.ts | 0.79 | 0.79 | 3.01 | 0 | 0 | — |

### Modules with bundle/import errors
- `auth.config.ts`: ERROR: Command failed: /usr/bin/node /home/user/work/connvo-lazy/tools/call-eval/out/module-loads-after-paired/timed-import.mjs /home/user/work/connvo-lazy/tools/call-eval/out/module-loads-after-paired/bundles/auth.config.ts/auth.config.mjs | ❌ WORKOS_CLIENT_ID environment variable is required but not set. |  | 🔧 TO FIX THIS ERROR: | 1. Go to https://dashboard.convex.dev | 2. Select your project and deployment
- `convex.config.ts`: ERROR: Command failed: /usr/bin/node /home/user/work/connvo-lazy/tools/call-eval/out/module-loads-after-paired/timed-import.mjs /home/user/work/connvo-lazy/tools/call-eval/out/module-loads-after-paired/bundles/convex.config.ts/convex.config.mjs | IMPORT_ERROR: Component definition does not have the required componentDefinitionPath property. This code only works in Convex runtime. | 

Slowest 10: types/index.ts 44.36ms, types/_template.ts 43.57ms, types/validators/index.ts 35.99ms, meetings/webrtc/signaling.ts 28.21ms, users/mutations.ts 25.22ms, notes/mutations.ts 24.74ms, realtime/batchedOperations.ts 22.33ms, matching/scoring.ts 21.6ms, meetings/webrtc/index.ts 20ms, meetings/lifecycle.ts 17.91ms