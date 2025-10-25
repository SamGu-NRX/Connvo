/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics_meetings from "../analytics/meetings.js";
import type * as audit_logging from "../audit/logging.js";
import type * as auth_guards from "../auth/guards.js";
import type * as auth_permissions from "../auth/permissions.js";
import type * as crons from "../crons.js";
import type * as embeddings_actions from "../embeddings/actions.js";
import type * as embeddings_index from "../embeddings/index.js";
import type * as embeddings_mutations from "../embeddings/mutations.js";
import type * as embeddings_queries from "../embeddings/queries.js";
import type * as environments_local from "../environments/local.js";
import type * as environments_production from "../environments/production.js";
import type * as environments_staging from "../environments/staging.js";
import type * as http from "../http.js";
import type * as insights_generation from "../insights/generation.js";
import type * as insights_index from "../insights/index.js";
import type * as insights_mutations from "../insights/mutations.js";
import type * as insights_queries from "../insights/queries.js";
import type * as insights_scheduler from "../insights/scheduler.js";
import type * as interests_queries from "../interests/queries.js";
import type * as lib_alerting from "../lib/alerting.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_batching from "../lib/batching.js";
import type * as lib_clientOptimizations from "../lib/clientOptimizations.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_getstreamServer from "../lib/getstreamServer.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_monitoring from "../lib/monitoring.js";
import type * as lib_observability from "../lib/observability.js";
import type * as lib_performance from "../lib/performance.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_queryOptimization from "../lib/queryOptimization.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_rateLimiter from "../lib/rateLimiter.js";
import type * as lib_resilience from "../lib/resilience.js";
import type * as lib_utils from "../lib/utils.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_videoProviders from "../lib/videoProviders.js";
import type * as matching_analytics from "../matching/analytics.js";
import type * as matching_engine from "../matching/engine.js";
import type * as matching_index from "../matching/index.js";
import type * as matching_queue from "../matching/queue.js";
import type * as matching_scheduler from "../matching/scheduler.js";
import type * as matching_scoring from "../matching/scoring.js";
import type * as meetings_lifecycle from "../meetings/lifecycle.js";
import type * as meetings_postProcessing from "../meetings/postProcessing.js";
import type * as meetings_queries from "../meetings/queries.js";
import type * as meetings_stateTracking from "../meetings/stateTracking.js";
import type * as meetings_stream_cleanup from "../meetings/stream/cleanup.js";
import type * as meetings_stream_index from "../meetings/stream/index.js";
import type * as meetings_stream_streamHandlers from "../meetings/stream/streamHandlers.js";
import type * as meetings_stream_streamHelpers from "../meetings/stream/streamHelpers.js";
import type * as meetings_stream_webhooks from "../meetings/stream/webhooks.js";
import type * as meetings_webrtc_index from "../meetings/webrtc/index.js";
import type * as meetings_webrtc_rooms from "../meetings/webrtc/rooms.js";
import type * as meetings_webrtc_signaling from "../meetings/webrtc/signaling.js";
import type * as monitoring_alerts from "../monitoring/alerts.js";
import type * as monitoring_bandwidthManager from "../monitoring/bandwidthManager.js";
import type * as monitoring_performanceQueries from "../monitoring/performanceQueries.js";
import type * as notes_index from "../notes/index.js";
import type * as notes_mutations from "../notes/mutations.js";
import type * as notes_offline from "../notes/offline.js";
import type * as notes_operations from "../notes/operations.js";
import type * as notes_queries from "../notes/queries.js";
import type * as profiles_queries from "../profiles/queries.js";
import type * as prompts_actions from "../prompts/actions.js";
import type * as prompts_index from "../prompts/index.js";
import type * as prompts_mutations from "../prompts/mutations.js";
import type * as prompts_queries from "../prompts/queries.js";
import type * as prompts_scheduler from "../prompts/scheduler.js";
import type * as realtime_batchedOperations from "../realtime/batchedOperations.js";
import type * as realtime_subscriptionActions from "../realtime/subscriptionActions.js";
import type * as realtime_subscriptionManager from "../realtime/subscriptionManager.js";
import type * as realtime_subscriptions from "../realtime/subscriptions.js";
import type * as schema_ai from "../schema/ai.js";
import type * as schema_interests from "../schema/interests.js";
import type * as schema_legacy from "../schema/legacy.js";
import type * as schema_matching from "../schema/matching.js";
import type * as schema_meetings from "../schema/meetings.js";
import type * as schema_messaging from "../schema/messaging.js";
import type * as schema_offline from "../schema/offline.js";
import type * as schema_system from "../schema/system.js";
import type * as schema_transcripts from "../schema/transcripts.js";
import type * as schema_users from "../schema/users.js";
import type * as schema_webrtc from "../schema/webrtc.js";
import type * as system_idempotency from "../system/idempotency.js";
import type * as system_maintenance from "../system/maintenance.js";
import type * as system_rateLimit from "../system/rateLimit.js";
import type * as transcripts_aggregation from "../transcripts/aggregation.js";
import type * as transcripts_ingestion from "../transcripts/ingestion.js";
import type * as transcripts_initialization from "../transcripts/initialization.js";
import type * as transcripts_queries from "../transcripts/queries.js";
import type * as transcripts_streaming from "../transcripts/streaming.js";
import type * as types___tests___ciValidation from "../types/__tests__/ciValidation.js";
import type * as types___tests___monitoringTools from "../types/__tests__/monitoringTools.js";
import type * as types___tests___typeValidationUtils from "../types/__tests__/typeValidationUtils.js";
import type * as types__template from "../types/_template.js";
import type * as types_api_index from "../types/api/index.js";
import type * as types_api_pagination from "../types/api/pagination.js";
import type * as types_api_responses from "../types/api/responses.js";
import type * as types_domain_index from "../types/domain/index.js";
import type * as types_domain_operationalTransform from "../types/domain/operationalTransform.js";
import type * as types_domain_realTime from "../types/domain/realTime.js";
import type * as types_domain_vectorSearch from "../types/domain/vectorSearch.js";
import type * as types_entities_embedding from "../types/entities/embedding.js";
import type * as types_entities_index from "../types/entities/index.js";
import type * as types_entities_matching from "../types/entities/matching.js";
import type * as types_entities_meeting from "../types/entities/meeting.js";
import type * as types_entities_messaging from "../types/entities/messaging.js";
import type * as types_entities_note from "../types/entities/note.js";
import type * as types_entities_prompt from "../types/entities/prompt.js";
import type * as types_entities_stream from "../types/entities/stream.js";
import type * as types_entities_system from "../types/entities/system.js";
import type * as types_entities_transcript from "../types/entities/transcript.js";
import type * as types_entities_user from "../types/entities/user.js";
import type * as types_entities_webrtc from "../types/entities/webrtc.js";
import type * as types_index from "../types/index.js";
import type * as types_utils from "../types/utils.js";
import type * as types_validators_common from "../types/validators/common.js";
import type * as types_validators_embedding from "../types/validators/embedding.js";
import type * as types_validators_index from "../types/validators/index.js";
import type * as types_validators_matching from "../types/validators/matching.js";
import type * as types_validators_meeting from "../types/validators/meeting.js";
import type * as types_validators_messaging from "../types/validators/messaging.js";
import type * as types_validators_note from "../types/validators/note.js";
import type * as types_validators_operationalTransform from "../types/validators/operationalTransform.js";
import type * as types_validators_pagination from "../types/validators/pagination.js";
import type * as types_validators_prompt from "../types/validators/prompt.js";
import type * as types_validators_realTime from "../types/validators/realTime.js";
import type * as types_validators_responses from "../types/validators/responses.js";
import type * as types_validators_stream from "../types/validators/stream.js";
import type * as types_validators_system from "../types/validators/system.js";
import type * as types_validators_transcript from "../types/validators/transcript.js";
import type * as types_validators_user from "../types/validators/user.js";
import type * as types_validators_webrtc from "../types/validators/webrtc.js";
import type * as users_mutations from "../users/mutations.js";
import type * as users_queries from "../users/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  "analytics/meetings": typeof analytics_meetings;
  "audit/logging": typeof audit_logging;
  "auth/guards": typeof auth_guards;
  "auth/permissions": typeof auth_permissions;
  crons: typeof crons;
  "embeddings/actions": typeof embeddings_actions;
  "embeddings/index": typeof embeddings_index;
  "embeddings/mutations": typeof embeddings_mutations;
  "embeddings/queries": typeof embeddings_queries;
  "environments/local": typeof environments_local;
  "environments/production": typeof environments_production;
  "environments/staging": typeof environments_staging;
  http: typeof http;
  "insights/generation": typeof insights_generation;
  "insights/index": typeof insights_index;
  "insights/mutations": typeof insights_mutations;
  "insights/queries": typeof insights_queries;
  "insights/scheduler": typeof insights_scheduler;
  "interests/queries": typeof interests_queries;
  "lib/alerting": typeof lib_alerting;
  "lib/audit": typeof lib_audit;
  "lib/batching": typeof lib_batching;
  "lib/clientOptimizations": typeof lib_clientOptimizations;
  "lib/config": typeof lib_config;
  "lib/errors": typeof lib_errors;
  "lib/getstreamServer": typeof lib_getstreamServer;
  "lib/idempotency": typeof lib_idempotency;
  "lib/monitoring": typeof lib_monitoring;
  "lib/observability": typeof lib_observability;
  "lib/performance": typeof lib_performance;
  "lib/permissions": typeof lib_permissions;
  "lib/queryOptimization": typeof lib_queryOptimization;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/rateLimiter": typeof lib_rateLimiter;
  "lib/resilience": typeof lib_resilience;
  "lib/utils": typeof lib_utils;
  "lib/validators": typeof lib_validators;
  "lib/videoProviders": typeof lib_videoProviders;
  "matching/analytics": typeof matching_analytics;
  "matching/engine": typeof matching_engine;
  "matching/index": typeof matching_index;
  "matching/queue": typeof matching_queue;
  "matching/scheduler": typeof matching_scheduler;
  "matching/scoring": typeof matching_scoring;
  "meetings/lifecycle": typeof meetings_lifecycle;
  "meetings/postProcessing": typeof meetings_postProcessing;
  "meetings/queries": typeof meetings_queries;
  "meetings/stateTracking": typeof meetings_stateTracking;
  "meetings/stream/cleanup": typeof meetings_stream_cleanup;
  "meetings/stream/index": typeof meetings_stream_index;
  "meetings/stream/streamHandlers": typeof meetings_stream_streamHandlers;
  "meetings/stream/streamHelpers": typeof meetings_stream_streamHelpers;
  "meetings/stream/webhooks": typeof meetings_stream_webhooks;
  "meetings/webrtc/index": typeof meetings_webrtc_index;
  "meetings/webrtc/rooms": typeof meetings_webrtc_rooms;
  "meetings/webrtc/signaling": typeof meetings_webrtc_signaling;
  "monitoring/alerts": typeof monitoring_alerts;
  "monitoring/bandwidthManager": typeof monitoring_bandwidthManager;
  "monitoring/performanceQueries": typeof monitoring_performanceQueries;
  "notes/index": typeof notes_index;
  "notes/mutations": typeof notes_mutations;
  "notes/offline": typeof notes_offline;
  "notes/operations": typeof notes_operations;
  "notes/queries": typeof notes_queries;
  "profiles/queries": typeof profiles_queries;
  "prompts/actions": typeof prompts_actions;
  "prompts/index": typeof prompts_index;
  "prompts/mutations": typeof prompts_mutations;
  "prompts/queries": typeof prompts_queries;
  "prompts/scheduler": typeof prompts_scheduler;
  "realtime/batchedOperations": typeof realtime_batchedOperations;
  "realtime/subscriptionActions": typeof realtime_subscriptionActions;
  "realtime/subscriptionManager": typeof realtime_subscriptionManager;
  "realtime/subscriptions": typeof realtime_subscriptions;
  "schema/ai": typeof schema_ai;
  "schema/interests": typeof schema_interests;
  "schema/legacy": typeof schema_legacy;
  "schema/matching": typeof schema_matching;
  "schema/meetings": typeof schema_meetings;
  "schema/messaging": typeof schema_messaging;
  "schema/offline": typeof schema_offline;
  "schema/system": typeof schema_system;
  "schema/transcripts": typeof schema_transcripts;
  "schema/users": typeof schema_users;
  "schema/webrtc": typeof schema_webrtc;
  "system/idempotency": typeof system_idempotency;
  "system/maintenance": typeof system_maintenance;
  "system/rateLimit": typeof system_rateLimit;
  "transcripts/aggregation": typeof transcripts_aggregation;
  "transcripts/ingestion": typeof transcripts_ingestion;
  "transcripts/initialization": typeof transcripts_initialization;
  "transcripts/queries": typeof transcripts_queries;
  "transcripts/streaming": typeof transcripts_streaming;
  "types/__tests__/ciValidation": typeof types___tests___ciValidation;
  "types/__tests__/monitoringTools": typeof types___tests___monitoringTools;
  "types/__tests__/typeValidationUtils": typeof types___tests___typeValidationUtils;
  "types/_template": typeof types__template;
  "types/api/index": typeof types_api_index;
  "types/api/pagination": typeof types_api_pagination;
  "types/api/responses": typeof types_api_responses;
  "types/domain/index": typeof types_domain_index;
  "types/domain/operationalTransform": typeof types_domain_operationalTransform;
  "types/domain/realTime": typeof types_domain_realTime;
  "types/domain/vectorSearch": typeof types_domain_vectorSearch;
  "types/entities/embedding": typeof types_entities_embedding;
  "types/entities/index": typeof types_entities_index;
  "types/entities/matching": typeof types_entities_matching;
  "types/entities/meeting": typeof types_entities_meeting;
  "types/entities/messaging": typeof types_entities_messaging;
  "types/entities/note": typeof types_entities_note;
  "types/entities/prompt": typeof types_entities_prompt;
  "types/entities/stream": typeof types_entities_stream;
  "types/entities/system": typeof types_entities_system;
  "types/entities/transcript": typeof types_entities_transcript;
  "types/entities/user": typeof types_entities_user;
  "types/entities/webrtc": typeof types_entities_webrtc;
  "types/index": typeof types_index;
  "types/utils": typeof types_utils;
  "types/validators/common": typeof types_validators_common;
  "types/validators/embedding": typeof types_validators_embedding;
  "types/validators/index": typeof types_validators_index;
  "types/validators/matching": typeof types_validators_matching;
  "types/validators/meeting": typeof types_validators_meeting;
  "types/validators/messaging": typeof types_validators_messaging;
  "types/validators/note": typeof types_validators_note;
  "types/validators/operationalTransform": typeof types_validators_operationalTransform;
  "types/validators/pagination": typeof types_validators_pagination;
  "types/validators/prompt": typeof types_validators_prompt;
  "types/validators/realTime": typeof types_validators_realTime;
  "types/validators/responses": typeof types_validators_responses;
  "types/validators/stream": typeof types_validators_stream;
  "types/validators/system": typeof types_validators_system;
  "types/validators/transcript": typeof types_validators_transcript;
  "types/validators/user": typeof types_validators_user;
  "types/validators/webrtc": typeof types_validators_webrtc;
  "users/mutations": typeof users_mutations;
  "users/queries": typeof users_queries;
}>;
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: {
    lib: {
      checkRateLimit: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
      getValue: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          key?: string;
          name: string;
          sampleShards?: number;
        },
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          shard: number;
          ts: number;
          value: number;
        }
      >;
      rateLimit: FunctionReference<
        "mutation",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      resetRateLimit: FunctionReference<
        "mutation",
        "internal",
        { key?: string; name: string },
        null
      >;
    };
    time: {
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
    };
  };
};
