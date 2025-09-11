/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as audit_logging from "../audit/logging.js";
import type * as auth_guards from "../auth/guards.js";
import type * as auth_permissions from "../auth/permissions.js";
import type * as environments_local from "../environments/local.js";
import type * as environments_production from "../environments/production.js";
import type * as environments_staging from "../environments/staging.js";
import type * as lib_batching from "../lib/batching.js";
import type * as lib_clientOptimizations from "../lib/clientOptimizations.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_observability from "../lib/observability.js";
import type * as lib_performance from "../lib/performance.js";
import type * as lib_queryOptimization from "../lib/queryOptimization.js";
import type * as meetings_lifecycle from "../meetings/lifecycle.js";
import type * as meetings_mutations from "../meetings/mutations.js";
import type * as meetings_queries from "../meetings/queries.js";
import type * as monitoring_bandwidthManager from "../monitoring/bandwidthManager.js";
import type * as monitoring_performanceQueries from "../monitoring/performanceQueries.js";
import type * as realtime_batchedOperations from "../realtime/batchedOperations.js";
import type * as realtime_subscriptionActions from "../realtime/subscriptionActions.js";
import type * as realtime_subscriptionManager from "../realtime/subscriptionManager.js";
import type * as realtime_subscriptions from "../realtime/subscriptions.js";
import type * as users_mutations from "../users/mutations.js";
import type * as users_queries from "../users/queries.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  "audit/logging": typeof audit_logging;
  "auth/guards": typeof auth_guards;
  "auth/permissions": typeof auth_permissions;
  "environments/local": typeof environments_local;
  "environments/production": typeof environments_production;
  "environments/staging": typeof environments_staging;
  "lib/batching": typeof lib_batching;
  "lib/clientOptimizations": typeof lib_clientOptimizations;
  "lib/config": typeof lib_config;
  "lib/errors": typeof lib_errors;
  "lib/idempotency": typeof lib_idempotency;
  "lib/observability": typeof lib_observability;
  "lib/performance": typeof lib_performance;
  "lib/queryOptimization": typeof lib_queryOptimization;
  "meetings/lifecycle": typeof meetings_lifecycle;
  "meetings/mutations": typeof meetings_mutations;
  "meetings/queries": typeof meetings_queries;
  "monitoring/bandwidthManager": typeof monitoring_bandwidthManager;
  "monitoring/performanceQueries": typeof monitoring_performanceQueries;
  "realtime/batchedOperations": typeof realtime_batchedOperations;
  "realtime/subscriptionActions": typeof realtime_subscriptionActions;
  "realtime/subscriptionManager": typeof realtime_subscriptionManager;
  "realtime/subscriptions": typeof realtime_subscriptions;
  "users/mutations": typeof users_mutations;
  "users/queries": typeof users_queries;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
