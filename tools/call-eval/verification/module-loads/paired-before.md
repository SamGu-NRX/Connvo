# Convex per-module import-load times — `before-paired`

Recorded 2026-10-11T22:31:57.875Z by `tools/call-eval/verification/measure-module-loads.mjs` (esbuild 0.25.4).

- node `v20.20.2`, 2 cpus, `linux x64`
- loadavg 1m/5m/15m: start `4.66 / 7.41 / 14.92`, end `4.66 / 7.41 / 14.92`
- 3 runs per module, fresh node process per run; values below are medians of `await import()` of the esbuild bundle (node startup excluded).
- 143 modules; 2 with bundle/import errors (see results.json — packages that will not evaluate under the node platform are expected to appear here).
- Sum of medians over error-free modules: **1.50 s** (upper bound on serial whole-tree load).

| module | median ms | min | max | entry KiB | closure KiB | top npm contributors (KiB) |
|---|---|---|---|---|---|---|
| meetings/webrtc/rooms.ts | 118.02 | 117.97 | 138.78 | 2884 | 2958 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| meetings/webrtc/index.ts | 111.63 | 62.4 | 121.56 | 2895 | 2969 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| lib/videoProviders.ts | 107.67 | 57.27 | 114.42 | 2851 | 2851 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| lib/getstreamServer.ts | 102.32 | 77.27 | 112.55 | 2845 | 2845 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| meetings/stream/index.ts | 101.21 | 95.71 | 111.41 | 2879 | 2928 | @stream-io/video-client 606, chart.js 503, rxjs 314, @floating-ui/react 183, mime-db 182 |
| types/_template.ts | 49.65 | 32.29 | 50.68 | 205 | 205 | convex 106 |
| types/index.ts | 45.6 | 33.93 | 61.68 | 174 | 174 | convex 106 |
| types/validators/index.ts | 38.15 | 36.49 | 53.04 | 167 | 167 | convex 106 |
| embeddings/index.ts | 34.27 | 22.01 | 60.08 | 355 | 355 | openai 326, convex 106 |
| embeddings/actions.ts | 27.46 | 24.44 | 38.78 | 322 | 322 | openai 326, convex 106 |
| realtime/batchedOperations.ts | 20.77 | 19.07 | 21.67 | 48 | 119 | convex 106 |
| realtime/subscriptions.ts | 19.48 | 9.8 | 21.82 | 33 | 98 | convex 106 |
| matching/queue.ts | 17.9 | 12.61 | 20.58 | 29 | 94 | convex 106 |
| matching/analytics.ts | 17.79 | 11.89 | 26.03 | 66 | 139 | convex 106 |
| matching/index.ts | 16.66 | 14.18 | 17.51 | 66 | 139 | convex 106 |
| insights/mutations.ts | 16.43 | 13.36 | 19.57 | 17 | 81 | convex 106 |
| types/validators/matching.ts | 15.82 | 5.19 | 24.97 | 40 | 40 | convex 32 |
| meetings/queries.ts | 15.74 | 15.67 | 24.86 | 36 | 95 | convex 106 |
| auth/permissions.ts | 15.33 | 14.13 | 17.62 | 11 | 76 | convex 106 |
| matching/scoring.ts | 15.16 | 14.3 | 15.75 | 97 | 97 | convex 106 |
| types/validators/embedding.ts | 14.44 | 12.05 | 16.58 | 37 | 37 | convex 32 |
| prompts/queries.ts | 14.37 | 5.44 | 28.1 | 17 | 77 | convex 106 |
| users/mutations.ts | 14.29 | 4.94 | 22.29 | 21 | 85 | convex 106 |
| types/validators/meeting.ts | 14.24 | 13.57 | 17.4 | 44 | 44 | convex 32 |
| embeddings/queries.ts | 13.64 | 11.85 | 14.55 | 86 | 86 | convex 106 |
| transcripts/ingestion.ts | 13.46 | 6.42 | 21.13 | 39 | 104 | convex 106 |
| meetings/webrtc/signaling.ts | 12.81 | 12.02 | 13.29 | 37 | 102 | convex 106 |
| insights/index.ts | 12.25 | 8.51 | 18.11 | 31 | 104 | convex 106 |
| schema/interests.ts | 11.78 | 3.28 | 12.34 | 30 | 30 | convex 106 |
| realtime/subscriptionActions.ts | 11.27 | 4.4 | 16.92 | 12 | 59 | convex 106 |
| monitoring/bandwidthManager.ts | 11.1 | 5.57 | 11.59 | 25 | 97 | convex 106 |
| notes/mutations.ts | 11.05 | 7.98 | 11.94 | 34 | 98 | convex 106 |
| matching/engine.ts | 10.44 | 10 | 15.27 | 100 | 100 | convex 106 |
| devEval/seed.ts | 9.86 | 6.9 | 11.26 | 65 | 65 | convex 106 |
| types/validators/operationalTransform.ts | 9.74 | 5.78 | 13.6 | 41 | 41 | convex 32 |
| types/domain/index.ts | 9.23 | 7.78 | 12.89 | 2 | 2 | — |
| schema.ts | 9.21 | 9.01 | 15.27 | 52 | 52 | convex 106 |
| types/validators/user.ts | 9.02 | 3.58 | 10.89 | 29 | 29 | convex 32 |
| prompts/mutations.ts | 8.07 | 6.53 | 8.3 | 9 | 73 | convex 106 |
| notes/index.ts | 7.68 | 6.52 | 11.19 | 57 | 123 | convex 106 |
| types/validators/webrtc.ts | 7.6 | 5.82 | 15.76 | 43 | 43 | convex 32 |
| profiles/mutations.ts | 7.37 | 4.17 | 13.96 | 9 | 73 | convex 106 |
| audit/logging.ts | 6.92 | 3.79 | 9.06 | 67 | 67 | convex 106 |
| interests/queries.ts | 6.88 | 3.81 | 9.45 | 67 | 67 | convex 106 |
| system/idempotency.ts | 6.67 | 4.02 | 8.26 | 76 | 76 | convex 106 |
| settings/queries.ts | 6.66 | 3.87 | 12.49 | 7 | 65 | convex 106 |
| insights/queries.ts | 6.66 | 5.83 | 9.2 | 18 | 78 | convex 106 |
| notes/queries.ts | 6.49 | 5.34 | 10.79 | 13 | 72 | convex 106 |
| types/entities/note.ts | 6.4 | 2.23 | 11.26 | 0 | 0 | — |
| realtime/subscriptionManager.ts | 6.2 | 6.08 | 8.13 | 35 | 100 | convex 106 |
| prompts/index.ts | 6.11 | 6.06 | 6.21 | 37 | 110 | convex 106 |
| monitoring/performanceQueries.ts | 5.94 | 5.89 | 10.45 | 30 | 95 | convex 106 |
| types/domain/realTime.ts | 5.94 | 1.71 | 7.45 | 0 | 0 | — |
| notes/offline.ts | 5.9 | 5.88 | 5.92 | 33 | 97 | convex 106 |
| meetings/stream/streamHelpers.ts | 5.89 | 3.84 | 8.93 | 65 | 65 | convex 106 |
| types/domain/vectorSearch.ts | 5.68 | 0.98 | 9.09 | 2 | 2 | — |
| lib/idempotency.ts | 5.46 | 2.55 | 7.45 | 37 | 37 | convex 106 |
| meetings/lifecycle.ts | 5.4 | 5.34 | 5.54 | 34 | 98 | convex 106 |
| users/queries.ts | 5.33 | 5.17 | 16.92 | 16 | 76 | convex 106 |
| types/validators/transcript.ts | 5.33 | 2.82 | 12.49 | 28 | 28 | convex 32 |
| schema/offline.ts | 5.3 | 4.31 | 10.33 | 31 | 31 | convex 106 |
| system/rateLimit.ts | 5.21 | 3.94 | 8.55 | 63 | 63 | convex 106 |
| schema/meetings.ts | 5.19 | 3.38 | 10.61 | 35 | 35 | convex 106 |
| transcripts/queries.ts | 5.07 | 4.97 | 8.44 | 14 | 73 | convex 106 |
| types/entities/webrtc.ts | 5.06 | 0.9 | 6.09 | 0 | 0 | — |
| settings/mutations.ts | 5.03 | 3.86 | 11.93 | 7 | 70 | convex 106 |
| matching/scheduler.ts | 4.92 | 4.22 | 5.44 | 82 | 82 | convex 106 |
| auth/guards.ts | 4.74 | 4.34 | 8.35 | 8 | 38 | convex 106 |
| meetings/stateTracking.ts | 4.72 | 4.43 | 6.4 | 12 | 76 | convex 106 |
| types/validators/stream.ts | 4.66 | 2.28 | 5.07 | 24 | 24 | convex 32 |
| environments/local.ts | 4.56 | 0.9 | 10.76 | 1 | 1 | — |
| profiles/queries.ts | 4.39 | 4.11 | 4.81 | 9 | 68 | convex 106 |
| transcripts/streaming.ts | 4.38 | 4.21 | 10.62 | 84 | 84 | convex 106 |
| transcripts/aggregation.ts | 4.35 | 4.31 | 6.04 | 76 | 76 | convex 106 |
| types/entities/user.ts | 4.35 | 3.54 | 4.77 | 0 | 0 | — |
| prompts/actions.ts | 4.3 | 3.49 | 4.52 | 67 | 67 | convex 106 |
| crons.ts | 4.16 | 3.52 | 13.73 | 41 | 41 | convex 106 |
| transcripts/initialization.ts | 4.15 | 3.95 | 15.57 | 75 | 75 | convex 106 |
| embeddings/mutations.ts | 4.12 | 3.96 | 7.34 | 71 | 71 | convex 106 |
| prompts/scheduler.ts | 4.07 | 3.6 | 6.03 | 75 | 75 | convex 106 |
| meetings/stream/streamHandlers.ts | 4.02 | 3.89 | 8.89 | 77 | 77 | convex 106 |
| lib/batching.ts | 3.82 | 1.59 | 7.77 | 7 | 7 | — |
| insights/scheduler.ts | 3.75 | 3.72 | 4.01 | 71 | 71 | convex 106 |
| monitoring/alerts.ts | 3.72 | 3.62 | 7.75 | 64 | 64 | convex 106 |
| types/entities/system.ts | 3.69 | 0.93 | 7.86 | 0 | 0 | — |
| analytics/meetings.ts | 3.65 | 3.14 | 3.69 | 46 | 46 | convex 106 |
| meetings/stream/webhooks.ts | 3.62 | 3.51 | 5.74 | 69 | 69 | convex 106 |
| migrations/createMissingProfiles.ts | 3.57 | 3.29 | 11.53 | 64 | 64 | convex 106 |
| types/validators/prompt.ts | 3.53 | 3.37 | 11.98 | 29 | 29 | convex 32 |
| types/validators/responses.ts | 3.52 | 2.64 | 5.15 | 29 | 29 | convex 32 |
| lib/permissions.ts | 3.52 | 0.83 | 8.37 | 1 | 1 | — |
| lib/config.ts | 3.46 | 1.1 | 5.43 | 4 | 4 | — |
| types/api/pagination.ts | 3.41 | 3.21 | 5.32 | 3 | 3 | — |
| insights/generation.ts | 3.35 | 3.32 | 11.52 | 58 | 58 | convex 106 |
| meetings/stream/cleanup.ts | 3.32 | 3.11 | 3.41 | 49 | 49 | convex 106 |
| system/maintenance.ts | 3.32 | 3.11 | 4.24 | 51 | 51 | convex 106 |
| types/validators/system.ts | 3.22 | 3.11 | 6.19 | 29 | 29 | convex 32 |
| http.ts | 3.21 | 3.12 | 3.75 | 55 | 55 | convex 106 |
| schema/transcripts.ts | 3.13 | 2.9 | 4.12 | 32 | 32 | convex 106 |
| notes/operations.ts | 3.12 | 3.04 | 5.64 | 41 | 41 | convex 32 |
| schema/ai.ts | 3.04 | 2.89 | 3.3 | 32 | 32 | convex 106 |
| types/api/index.ts | 3.03 | 1.02 | 9.37 | 4 | 4 | — |
| environments/staging.ts | 3.01 | 0.95 | 8.13 | 1 | 1 | — |
| types/validators/common.ts | 2.99 | 2.75 | 4.4 | 31 | 31 | convex 106 |
| schema/webrtc.ts | 2.95 | 2.92 | 4.22 | 32 | 32 | convex 106 |
| schema/system.ts | 2.94 | 2.91 | 4.51 | 33 | 33 | convex 106 |
| meetings/postProcessing.ts | 2.92 | 2.87 | 2.94 | 48 | 48 | convex 106 |
| types/validators/note.ts | 2.92 | 2.76 | 8.07 | 28 | 28 | convex 32 |
| types/validators/realTime.ts | 2.81 | 2.79 | 11.62 | 28 | 28 | convex 32 |
| schema/legacy.ts | 2.8 | 2.41 | 2.86 | 30 | 30 | convex 106 |
| schema/users.ts | 2.76 | 2.59 | 7.17 | 31 | 31 | convex 106 |
| schema/matching.ts | 2.76 | 2.64 | 2.83 | 31 | 31 | convex 106 |
| lib/rateLimit.ts | 2.74 | 2.58 | 2.86 | 42 | 42 | convex 106 |
| schema/messaging.ts | 2.73 | 2.7 | 3.65 | 30 | 30 | convex 106 |
| types/validators/messaging.ts | 2.68 | 2.61 | 2.69 | 26 | 26 | convex 32 |
| schema/userSettings.ts | 2.55 | 2.49 | 3.75 | 30 | 30 | convex 106 |
| types/validators/pagination.ts | 2.53 | 2.41 | 3.6 | 26 | 26 | convex 32 |
| lib/audit.ts | 2.45 | 2.28 | 6.49 | 31 | 31 | convex 106 |
| types/entities/prompt.ts | 2.34 | 0.84 | 11.28 | 0 | 0 | — |
| lib/validators.ts | 2.03 | 1.98 | 2.03 | 23 | 23 | convex 32 |
| types/api/responses.ts | 1.83 | 0.96 | 2.4 | 1 | 1 | — |
| lib/utils.ts | 1.73 | 0.99 | 2.86 | 4 | 4 | — |
| lib/resilience.ts | 1.67 | 1.51 | 1.86 | 17 | 17 | convex 32 |
| lib/clientOptimizations.ts | 1.62 | 1.08 | 2.79 | 10 | 10 | — |
| lib/performance.ts | 1.49 | 1.45 | 2.86 | 8 | 8 | — |
| lib/rateLimiter.ts | 1.45 | 1.4 | 1.6 | 16 | 16 | convex 32 |
| lib/observability.ts | 1.27 | 0.86 | 11.56 | 0 | 0 | — |
| lib/errors.ts | 1.24 | 1.18 | 1.27 | 10 | 10 | convex 32 |
| lib/queryOptimization.ts | 1.22 | 1.19 | 3.78 | 8 | 8 | — |
| lib/alerting.ts | 1.18 | 1.03 | 3.14 | 10 | 10 | — |
| types/domain/operationalTransform.ts | 1.01 | 0.99 | 2.08 | 0 | 0 | — |
| lib/monitoring.ts | 0.98 | 0.92 | 1.12 | 6 | 37 | convex 106 |
| types/entities/messaging.ts | 0.97 | 0.83 | 0.98 | 0 | 0 | — |
| types/utils.ts | 0.94 | 0.9 | 1.04 | 1 | 1 | — |
| environments/production.ts | 0.94 | 0.86 | 0.95 | 1 | 1 | — |
| types/entities/stream.ts | 0.92 | 0.86 | 6.16 | 0 | 0 | — |
| types/entities/meeting.ts | 0.92 | 0.89 | 0.94 | 0 | 0 | — |
| types/entities/transcript.ts | 0.91 | 0.8 | 3.16 | 0 | 0 | — |
| types/entities/embedding.ts | 0.9 | 0.82 | 0.95 | 2 | 2 | — |
| types/entities/index.ts | 0.9 | 0.81 | 2.16 | 2 | 2 | — |
| types/entities/matching.ts | 0.87 | 0.82 | 0.95 | 0 | 0 | — |

### Modules with bundle/import errors
- `auth.config.ts`: ERROR: Command failed: /usr/bin/node /home/user/work/connvo-before/tools/call-eval/out/module-loads-before-paired/timed-import.mjs /home/user/work/connvo-before/tools/call-eval/out/module-loads-before-paired/bundles/auth.config.ts/auth.config.mjs | ❌ WORKOS_CLIENT_ID environment variable is required but not set. |  | 🔧 TO FIX THIS ERROR: | 1. Go to https://dashboard.convex.dev | 2. Select your project and deployment
- `convex.config.ts`: ERROR: Command failed: /usr/bin/node /home/user/work/connvo-before/tools/call-eval/out/module-loads-before-paired/timed-import.mjs /home/user/work/connvo-before/tools/call-eval/out/module-loads-before-paired/bundles/convex.config.ts/convex.config.mjs | IMPORT_ERROR: Component definition does not have the required componentDefinitionPath property. This code only works in Convex runtime. | 

Slowest 10: meetings/webrtc/rooms.ts 118.02ms, meetings/webrtc/index.ts 111.63ms, lib/videoProviders.ts 107.67ms, lib/getstreamServer.ts 102.32ms, meetings/stream/index.ts 101.21ms, types/_template.ts 49.65ms, types/index.ts 45.6ms, types/validators/index.ts 38.15ms, embeddings/index.ts 34.27ms, embeddings/actions.ts 27.46ms