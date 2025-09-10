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
import type * as auth_guards from "../auth/guards.js";
import type * as environments_local from "../environments/local.js";
import type * as environments_production from "../environments/production.js";
import type * as environments_staging from "../environments/staging.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_observability from "../lib/observability.js";
import type * as meetings_lifecycle from "../meetings/lifecycle.js";
import type * as meetings_queries from "../meetings/queries.js";
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
  "auth/guards": typeof auth_guards;
  "environments/local": typeof environments_local;
  "environments/production": typeof environments_production;
  "environments/staging": typeof environments_staging;
  "lib/config": typeof lib_config;
  "lib/errors": typeof lib_errors;
  "lib/idempotency": typeof lib_idempotency;
  "lib/observability": typeof lib_observability;
  "meetings/lifecycle": typeof meetings_lifecycle;
  "meetings/queries": typeof meetings_queries;
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
