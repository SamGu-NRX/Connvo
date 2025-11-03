/**
 * User Query Functions
 *
 * This module provides query functions for user data access with
 * proper authorization and performance optimization.
 *
 * Requirements: 2.2, 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex query patterns with centralized types
 */

import { query, internalQuery } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertOwnershipOrAdmin } from "@convex/auth/guards";
import { Id } from "@convex/_generated/dataModel";
import { UserV } from "@convex/types/validators/user";
import type {
  User,
  UserPublic,
  UserWithOrgInfo,
} from "@convex/types/entities/user";

// Onboarding state validator
const OnboardingStateV = v.object({
  userId: v.id("users"),
  onboardingComplete: v.boolean(),
  profileExists: v.boolean(),
  profileId: v.optional(v.id("profiles")),
  completedAt: v.optional(v.number()),
});

/**
 * Gets user by ID (internal use)
 */
export const getUserByIdInternal = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { userId }): Promise<User | null> => {
    return await ctx.db.get(userId);
  },
});

/**
 * Gets user by ID
 *
 * Returns the full user document for the supplied `userId`. This wrapper exists for non-sensitive tooling and tests; clients should prefer `getCurrentUser` or scoped profile queries when they need authorization filtering.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "userId": "user_9f3c2ab457"
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "_id": "user_9f3c2ab457",
 *     "_creationTime": 1716403200000,
 *     "workosUserId": "org_user_123",
 *     "email": "member@example.com",
 *     "displayName": "Member Example",
 *     "orgId": "org_abc123",
 *     "orgRole": "member",
 *     "isActive": true,
 *     "onboardingComplete": true,
 *     "onboardingStartedAt": 1716406800000,
 *     "onboardingCompletedAt": 1716489600000,
 *     "createdAt": 1716403200000,
 *     "updatedAt": 1716489600000
 *   }
 * }
 * ```
 * @example response-not-found
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": null
 * }
 * ```
 */
export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { userId }): Promise<User | null> => {
    return await ctx.db.get(userId);
  },
});

/**
 * Gets user by WorkOS ID (internal use)
 */
export const getUserByWorkosId = internalQuery({
  args: { workosUserId: v.string() },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { workosUserId }): Promise<User | null> => {
    return await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", workosUserId))
      .unique();
  },
});

/**
 * Gets current authenticated user
 *
 * Returns the full user document for the currently authenticated user based on their WorkOS identity. Returns null if the user is not authenticated, allowing clients to safely subscribe without triggering errors during logged-out states. This is the primary method for retrieving the current user's data in authenticated contexts.
 *
 * @example request
 * ```json
 * {
 *   "args": {}
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "_id": "user_9f3c2ab457",
 *     "_creationTime": 1716403200000,
 *     "workosUserId": "org_user_123",
 *     "email": "member@example.com",
 *     "displayName": "Member Example",
 *     "orgId": "org_abc123",
 *     "orgRole": "member",
 *     "isActive": true,
 *     "onboardingComplete": true,
 *     "onboardingStartedAt": 1716406800000,
 *     "onboardingCompletedAt": 1716489600000,
 *     "createdAt": 1716403200000,
 *     "updatedAt": 1716489600000
 *   }
 * }
 * ```
 * @example response-unauthenticated
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": null
 * }
 * ```
 */
export const getCurrentUser = query({
  args: {},
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx): Promise<User | null> => {
    // Return null instead of throwing when unauthenticated so clients can
    // safely subscribe without triggering errors during logged-out states.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const workosUserId: string = identity.subject;

    try {
      return await ctx.db
        .query("users")
        .withIndex("by_workos_id", (q) => q.eq("workosUserId", workosUserId))
        .unique();
    } catch (error) {
      console.error("[users.getCurrentUser] Failed to fetch user", {
        workosUserId,
        error,
      });
      return null;
    }
  },
});

/**
 * Gets user profile by ID with authorization
 *
 * Returns a user profile with privacy-controlled access to organization information. Organization details (orgId, orgRole) are only included if the requesting user is in the same organization or has admin privileges. Returns null if the user does not exist. Requires authentication.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "userId": "user_9f3c2ab457"
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "_id": "user_9f3c2ab457",
 *     "displayName": "Member Example",
 *     "avatarUrl": "https://example.com/avatar.jpg",
 *     "isActive": true,
 *     "orgId": "org_abc123",
 *     "orgRole": "member"
 *   }
 * }
 * ```
 * @example response-restricted
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "_id": "user_9f3c2ab457",
 *     "displayName": "Member Example",
 *     "avatarUrl": "https://example.com/avatar.jpg",
 *     "isActive": true
 *   }
 * }
 * ```
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Authentication required",
 *   "errorData": {
 *     "code": "UNAUTHORIZED",
 *     "message": "Authentication required",
 *     "statusCode": 401
 *   },
 *   "value": null
 * }
 * ```
 */
export const getUserProfile = query({
  args: { userId: v.id("users") },
  returns: v.union(UserV.withOrgInfo, v.null()),
  handler: async (ctx, { userId }): Promise<UserWithOrgInfo | null> => {
    const identity = await requireIdentity(ctx);
    const user = await ctx.db.get(userId);

    if (!user) {
      return null;
    }

    // Check if user can see full profile (same org or admin)
    const canSeeOrgInfo =
      identity.orgId === user.orgId || identity.orgRole === "admin";

    return {
      _id: user._id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
      orgId: canSeeOrgInfo ? user.orgId : undefined,
      orgRole: canSeeOrgInfo ? user.orgRole : undefined,
    };
  },
});

/**
 * Gets onboarding state for current user
 *
 * Returns the onboarding completion status for the currently authenticated user, including whether they have completed onboarding, whether a profile exists, and the completion timestamp. Used by the frontend to determine which onboarding steps to display. Requires authentication.
 *
 * @example request
 * ```json
 * {
 *   "args": {}
 * }
 * ```
 * @example response-complete
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "userId": "user_9f3c2ab457",
 *     "onboardingComplete": true,
 *     "profileExists": true,
 *     "profileId": "profiles_d4c1e87a90",
 *     "completedAt": 1716489600000
 *   }
 * }
 * ```
 * @example response-incomplete
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "userId": "user_9f3c2ab457",
 *     "onboardingComplete": false,
 *     "profileExists": false
 *   }
 * }
 * ```
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Authentication required",
 *   "errorData": {
 *     "code": "UNAUTHORIZED",
 *     "message": "Authentication required",
 *     "statusCode": 401
 *   },
 *   "value": null
 * }
 * ```
 */
export const getOnboardingState = query({
  args: {},
  returns: OnboardingStateV,
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const user = await ctx.db.get(identity.userId);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .unique();

    return {
      userId: identity.userId,
      onboardingComplete: user?.onboardingComplete ?? false,
      profileExists: !!profile,
      profileId: profile?._id,
      completedAt: user?.onboardingCompletedAt,
    };
  },
});

/**
 * Lists active users in the same organization
 *
 * Returns a paginated list of active users within the authenticated user's organization. Only returns public-safe user data (ID, display name, avatar, active status). Uses index-first query pattern for optimal performance. Returns an empty list if the user is not part of an organization. Requires authentication.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "paginationOpts": {
 *       "numItems": 10,
 *       "cursor": null
 *     }
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "page": [
 *       {
 *         "_id": "user_9f3c2ab457",
 *         "displayName": "Member Example",
 *         "avatarUrl": "https://example.com/avatar1.jpg",
 *         "isActive": true
 *       },
 *       {
 *         "_id": "user_8e2b1cd346",
 *         "displayName": "Another Member",
 *         "avatarUrl": "https://example.com/avatar2.jpg",
 *         "isActive": true
 *       }
 *     ],
 *     "isDone": false,
 *     "continueCursor": "cursor_abc123"
 *   }
 * }
 * ```
 * @example response-empty
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "page": [],
 *     "isDone": true,
 *     "continueCursor": null
 *   }
 * }
 * ```
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Authentication required",
 *   "errorData": {
 *     "code": "UNAUTHORIZED",
 *     "message": "Authentication required",
 *     "statusCode": 401
 *   },
 *   "value": null
 * }
 * ```
 */
export const listActiveUsersInOrg = query({
  args: {
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  returns: v.object({
    page: v.array(UserV.public),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const identity = await requireIdentity(ctx);

    if (!identity.orgId) {
      return {
        page: [],
        isDone: true,
        continueCursor: null,
      };
    }

    const orgId = identity.orgId as string;

    // Use index-first query pattern - requires "by_org_and_active" index
    const result = await ctx.db
      .query("users")
      .withIndex("by_org_and_active", (q) =>
        q.eq("orgId", orgId).eq("isActive", true),
      )
      .order("desc")
      .paginate(paginationOpts);

    // Return only public-safe user data
    return {
      page: result.page.map(
        (user): UserPublic => ({
          _id: user._id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          isActive: user.isActive,
        }),
      ),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Gets users by onboarding completion status (internal)
 *
 * Returns a list of users filtered by their onboarding completion status. Used internally for analytics, monitoring, and administrative tasks. Uses index-first query pattern for optimal performance. Limited to 100 results by default to prevent excessive data retrieval.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "onboardingComplete": true,
 *     "limit": 50
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": [
 *     {
 *       "_id": "user_9f3c2ab457",
 *       "_creationTime": 1716403200000,
 *       "workosUserId": "org_user_123",
 *       "email": "member@example.com",
 *       "displayName": "Member Example",
 *       "orgId": "org_abc123",
 *       "orgRole": "member",
 *       "isActive": true,
 *       "onboardingComplete": true,
 *       "onboardingStartedAt": 1716406800000,
 *       "onboardingCompletedAt": 1716489600000,
 *       "createdAt": 1716403200000,
 *       "updatedAt": 1716489600000
 *     }
 *   ]
 * }
 * ```
 * @example response-empty
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": []
 * }
 * ```
 */
export const getUsersByOnboardingStatus = internalQuery({
  args: {
    onboardingComplete: v.boolean(),
    limit: v.optional(v.number()),
  },
  returns: v.array(UserV.full),
  handler: async (
    ctx,
    { onboardingComplete, limit = 100 },
  ): Promise<User[]> => {
    // Use index-first query - requires "by_onboarding_complete" index
    return await ctx.db
      .query("users")
      .withIndex("by_onboarding_complete", (q) =>
        q.eq("onboardingComplete", onboardingComplete),
      )
      .order("desc")
      .take(limit);
  },
});
