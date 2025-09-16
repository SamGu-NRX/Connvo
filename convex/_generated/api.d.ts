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
import type * as meetings_cleanup from "../meetings/cleanup.js";
import type * as meetings_lifecycle from "../meetings/lifecycle.js";
import type * as meetings_mutations from "../meetings/mutations.js";
import type * as meetings_postProcessing from "../meetings/postProcessing.js";
import type * as meetings_queries from "../meetings/queries.js";
import type * as meetings_stateTracking from "../meetings/stateTracking.js";
import type * as meetings_stream from "../meetings/stream.js";
import type * as meetings_streamHandlers from "../meetings/streamHandlers.js";
import type * as meetings_streamHelpers from "../meetings/streamHelpers.js";
import type * as meetings_webhooks from "../meetings/webhooks.js";
import type * as meetings_webrtc from "../meetings/webrtc.js";
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
import type * as system_rateLimit from "../system/rateLimit.js";
import type * as transcripts_aggregation from "../transcripts/aggregation.js";
import type * as transcripts_ingestion from "../transcripts/ingestion.js";
import type * as transcripts_initialization from "../transcripts/initialization.js";
import type * as transcripts_queries from "../transcripts/queries.js";
import type * as transcripts_streaming from "../transcripts/streaming.js";
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
  "meetings/cleanup": typeof meetings_cleanup;
  "meetings/lifecycle": typeof meetings_lifecycle;
  "meetings/mutations": typeof meetings_mutations;
  "meetings/postProcessing": typeof meetings_postProcessing;
  "meetings/queries": typeof meetings_queries;
  "meetings/stateTracking": typeof meetings_stateTracking;
  "meetings/stream": typeof meetings_stream;
  "meetings/streamHandlers": typeof meetings_streamHandlers;
  "meetings/streamHelpers": typeof meetings_streamHelpers;
  "meetings/webhooks": typeof meetings_webhooks;
  "meetings/webrtc": typeof meetings_webrtc;
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
  "system/rateLimit": typeof system_rateLimit;
  "transcripts/aggregation": typeof transcripts_aggregation;
  "transcripts/ingestion": typeof transcripts_ingestion;
  "transcripts/initialization": typeof transcripts_initialization;
  "transcripts/queries": typeof transcripts_queries;
  "transcripts/streaming": typeof transcripts_streaming;
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
