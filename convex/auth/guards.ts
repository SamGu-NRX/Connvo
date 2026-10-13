/**
 * Authentication and Authorization Guards for Convex
 *
 * This module provides centralized authentication and authorization logic
 * with WorkOS integration, role-based access control, and audit logging.
 *
 * Requirements: 2.3, 2.4, 2.6
 * Compliance: steering/convex_rules.mdc - Uses proper Convex auth patterns
 */

import { v } from "convex/values";
import { QueryCtx, MutationCtx, ActionCtx } from "@convex/_generated/server";
import { internal } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { createError } from "@convex/lib/errors";

/**
 * Authenticated user identity with WorkOS context
 */
export interface AuthIdentity {
  userId: Id<"users">;
  workosUserId: string;
  orgId: string | null;
  orgRole: string | null;
  email: string | null;
  name?: string | null;
}

/**
 * Context types that support authentication
 */
type AuthContext = QueryCtx | MutationCtx | ActionCtx;

/**
 * Resolves the organization identity used for authorization from VERIFIED
 * token claims only. Stored document org fields never reach the returned
 * identity; the helper additionally reports which stored values are UNPROVEN
 * (present on the document but not corroborated by the current claims) so
 * callers can quarantine them where writes are possible.
 *
 * Corroboration is per field:
 *  - a stored orgId is corroborated when it equals the claim's org_id;
 *  - a stored orgRole is corroborated when it equals the claim's org_role and
 *    the org it is scoped to (document orgId, when present) matches the
 *    claim's org_id.
 */
export function resolveOrgProvenance(
  claimOrgId: string | null,
  claimOrgRole: string | null,
  stored: { orgId?: string; orgRole?: string },
): {
  orgId: string | null;
  orgRole: string | null;
  unprovenOrgId?: string;
  unprovenOrgRole?: string;
} {
  const unprovenOrgId =
    stored.orgId !== undefined && stored.orgId !== claimOrgId
      ? stored.orgId
      : undefined;
  const orgScopeMatches =
    stored.orgId === undefined || stored.orgId === claimOrgId;
  const unprovenOrgRole =
    stored.orgRole !== undefined &&
    (stored.orgRole !== claimOrgRole || !orgScopeMatches)
      ? stored.orgRole
      : undefined;

  return {
    orgId: claimOrgId,
    orgRole: claimOrgRole,
    unprovenOrgId,
    unprovenOrgRole,
  };
}

/**
 * Extracts and validates user identity from Convex auth context
 *
 * @param ctx - Convex context (query, mutation, or action)
 * @param allowBootstrap - If true, allows authenticated but unprovisioned users (for upsertUser)
 * @returns AuthIdentity with WorkOS user information
 * @throws ConvexError if user is not authenticated
 */
export async function requireIdentity(
  ctx: AuthContext,
  allowBootstrap: boolean = false,
): Promise<AuthIdentity> {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw createError.unauthorized("Authentication required");
  }

  const workosUserId = identity.subject;
  if (!workosUserId) {
    throw createError.unauthorized("Invalid authentication token");
  }

  // Load the corresponding Convex user document (no writes here).
  // Queries/Mutations have ctx.db; Actions must use ctx.runQuery.
  let userDoc: {
    _id: Id<"users">;
    email: string;
    displayName?: string | undefined;
    orgId?: string;
    orgRole?: string;
    isActive?: boolean | undefined;
  } | null = null;
  const hasDb = (ctx as any).db && typeof (ctx as any).db.query === "function";
  if (hasDb) {
    userDoc = await (ctx as QueryCtx).db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", workosUserId))
      .unique();
  } else {
    userDoc = await (ctx as ActionCtx).runQuery(
      internal.users.queries.getUserByWorkosId,
      { workosUserId },
    );
  }

  if (!userDoc) {
    if (allowBootstrap) {
      // Return a bootstrap identity for user creation
      return {
        userId: null as any, // Will be set after user creation
        workosUserId,
        orgId: (identity.org_id as string) || null,
        orgRole: (identity.org_role as string) || null,
        email: identity.email || null,
        name: identity.name || null,
      };
    }
    throw createError.unauthorized(
      "User not provisioned. Please complete sign-in and try again.",
    );
  }

  // Deactivated accounts never resolve to an identity, even with a valid JWT:
  // sessions must stay bound to active users. (Bootstrap above only applies
  // when NO user doc exists.)
  if (userDoc.isActive === false) {
    throw createError.forbidden("Account deactivated");
  }

  const email = identity.email ?? userDoc.email ?? null;
  const name = identity.name ?? userDoc.displayName ?? null;

  // ORG PROVENANCE POLICY (verified claims only):
  // orgId/orgRole on the returned identity ALWAYS come from the current
  // verified JWT claims (identity.org_id / identity.org_role) — never from
  // the stored user document. A stored org value is not proof of anything:
  // a legacy import or a forged write can carry orgRole: "admin" that no
  // current token vouches for.
  //
  // Stored values the current claims do not corroborate ("unproven") are
  // handled by context:
  //  - Mutation/write context: moved to legacyOrgId/legacyOrgRole (removed
  //    from orgId/orgRole) and an "auth" audit event is written, so the
  //    unproven values can no longer grant or scope any access.
  //  - Query (read-only) and action (no-DB, runQuery branch) contexts: no
  //    writes are possible; unproven values are treated as ABSENT for
  //    authorization — the claim-derived values below are the only ones
  //    ever returned.
  const claimOrgId = (identity.org_id as string) || null;
  const claimOrgRole = (identity.org_role as string) || null;
  const provenance = resolveOrgProvenance(claimOrgId, claimOrgRole, {
    orgId: (userDoc as any).orgId,
    orgRole: (userDoc as any).orgRole,
  });

  // Quarantine only where this context can actually write (mutations).
  const canWrite = hasDb && typeof (ctx as any).db.patch === "function";
  if (
    canWrite &&
    (provenance.unprovenOrgId !== undefined ||
      provenance.unprovenOrgRole !== undefined)
  ) {
    await quarantineOrgFields(ctx as MutationCtx, userDoc._id, {
      orgId: provenance.unprovenOrgId,
      orgRole: provenance.unprovenOrgRole,
      claims: { orgId: claimOrgId, orgRole: claimOrgRole },
    });
  }

  return {
    userId: userDoc._id,
    workosUserId,
    orgId: provenance.orgId,
    orgRole: provenance.orgRole,
    email,
    name,
  };
}

/**
 * Validates user access to a specific meeting with optional role requirements
 *
 * @param ctx - Convex context (query or mutation)
 * @param meetingId - Meeting ID to check access for
 * @param requiredRole - Optional role requirement ("host" or "participant")
 * @returns Meeting participant record if access is granted
 * @throws ConvexError if access is denied
 */
export async function assertMeetingAccess(
  ctx: QueryCtx | MutationCtx,
  meetingId: Id<"meetings">,
  requiredRole?: "host" | "co-host" | "participant" | "observer",
) {
  const identity = await requireIdentity(ctx);

  const participant = await ctx.db
    .query("meetingParticipants")
    .withIndex("by_meeting_and_user", (q) =>
      q.eq("meetingId", meetingId).eq("userId", identity.userId),
    )
    .unique();

  if (!participant) {
    throw createError.forbidden("Access denied: Not a meeting participant", {
      meetingId,
      userId: identity.userId,
    });
  }

  // Check role if required
  if (requiredRole) {
    const roleHierarchy = {
      host: 3,
      "co-host": 2,
      participant: 1,
      observer: 0,
    };
    const userRoleLevel = roleHierarchy[participant.role];
    const requiredRoleLevel = roleHierarchy[requiredRole];

    if (userRoleLevel < requiredRoleLevel) {
      throw createError.insufficientPermissions(requiredRole, participant.role);
    }
  }

  return participant;
}

/**
 * Validates organization-level access for admin operations
 *
 * @param ctx - Convex context
 * @param requiredOrgRole - Required organization role
 * @returns AuthIdentity if access is granted
 * @throws ConvexError if access is denied
 */
export async function assertOrgAccess(
  ctx: AuthContext,
  requiredOrgRole: "admin" | "member" = "member",
) {
  const identity = await requireIdentity(ctx);

  if (!identity.orgId) {
    throw createError.forbidden("Organization membership required");
  }

  // Check organization role hierarchy
  const roleHierarchy = { admin: 2, member: 1 };
  const userRoleLevel =
    roleHierarchy[identity.orgRole as keyof typeof roleHierarchy] || 0;
  const requiredRoleLevel = roleHierarchy[requiredOrgRole];

  if (userRoleLevel < requiredRoleLevel) {
    throw createError.insufficientPermissions(
      requiredOrgRole,
      identity.orgRole || "none",
    );
  }

  return identity;
}

/**
 * Validates resource ownership or admin access
 *
 * @param ctx - Convex context
 * @param resourceOwnerId - ID of the resource owner
 * @returns AuthIdentity if access is granted
 * @throws ConvexError if access is denied
 */
export async function assertOwnershipOrAdmin(
  ctx: AuthContext,
  resourceOwnerId: Id<"users">,
) {
  const identity = await requireIdentity(ctx);

  // Allow access if user owns the resource
  if (identity.userId === resourceOwnerId) {
    return identity;
  }

  // Allow access if user is org admin
  if (identity.orgRole === "admin") {
    return identity;
  }

  throw createError.forbidden("Access denied: Insufficient permissions", {
    resourceOwnerId,
    userId: identity.userId,
    orgRole: identity.orgRole,
  });
}

/**
 * Logs audit events for security and compliance tracking
 *
 * @param ctx - Convex context (query or mutation only)
 * @param event - Audit event details
 */
async function logAuditEvent(
  ctx: QueryCtx | MutationCtx,
  event: {
    actorUserId: Id<"users">;
    resourceType: string;
    resourceId: string;
    action: string;
    metadata?: Record<string, any>;
  },
) {
  // Only log in mutation context to avoid side effects in queries
  const dbAny = (ctx as any).db;
  if (dbAny && typeof dbAny.insert === "function") {
    try {
      const { logAudit } = await import("@convex/lib/audit");
      await logAudit(ctx as any, {
        actorUserId: event.actorUserId,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        action: event.action,
        category: "auth",
        success: true,
        metadata: event.metadata || {},
      });
    } catch (error) {
      // Log audit failures but don't block the main operation
      console.error("Failed to log audit event:", error);
    }
  }
}

/**
 * Moves unproven stored org values out of orgId/orgRole into the dedicated
 * quarantine fields (legacyOrgId/legacyOrgRole) and writes an auth audit
 * event. Only called from write-capable (mutation) contexts — a query or
 * action cannot and does not mutate; there the unproven values are simply
 * treated as absent for authorization. Quarantine bookkeeping failures are
 * logged but never block the caller: authorization has already switched to
 * the verified token claims, so the stale values are inert either way.
 */
async function quarantineOrgFields(
  ctx: MutationCtx,
  userId: Id<"users">,
  unproven: {
    orgId?: string;
    orgRole?: string;
    claims: { orgId: string | null; orgRole: string | null };
  },
): Promise<void> {
  try {
    const patch: {
      orgId?: string | undefined;
      orgRole?: string | undefined;
      legacyOrgId?: string | undefined;
      legacyOrgRole?: string | undefined;
    } = {};
    if (unproven.orgId !== undefined) {
      patch.orgId = undefined;
      patch.legacyOrgId = unproven.orgId;
    }
    if (unproven.orgRole !== undefined) {
      patch.orgRole = undefined;
      patch.legacyOrgRole = unproven.orgRole;
    }
    await ctx.db.patch(userId, patch);

    await logAuditEvent(ctx, {
      actorUserId: userId,
      resourceType: "user",
      resourceId: userId,
      action: "org_provenance_quarantine",
      metadata: {
        quarantinedFields: [
          unproven.orgId !== undefined ? "orgId" : null,
          unproven.orgRole !== undefined ? "orgRole" : null,
        ]
          .filter((field): field is string => field !== null)
          .join(","),
        legacyOrgId: unproven.orgId ?? "",
        legacyOrgRole: unproven.orgRole ?? "",
        claimOrgId: unproven.claims.orgId ?? "",
        claimOrgRole: unproven.claims.orgRole ?? "",
      },
    });
  } catch (error) {
    console.error("Failed to quarantine unproven org fields:", error);
  }
}

/**
 * Helper to check if user has specific permissions without throwing
 *
 * @param ctx - Convex context
 * @param meetingId - Meeting ID to check
 * @param requiredRole - Optional role requirement
 * @returns boolean indicating if user has access
 */
export async function hasMeetingAccess(
  ctx: QueryCtx | MutationCtx,
  meetingId: Id<"meetings">,
  requiredRole?: "host" | "participant",
): Promise<boolean> {
  try {
    await assertMeetingAccess(ctx, meetingId, requiredRole);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to get current user identity without throwing
 *
 * @param ctx - Convex context
 * @returns AuthIdentity if authenticated, null otherwise
 */
export async function getCurrentUser(
  ctx: AuthContext,
): Promise<AuthIdentity | null> {
  try {
    return await requireIdentity(ctx);
  } catch {
    return null;
  }
}

/**
 * Lightweight authentication check for bootstrap operations
 * Only validates the JWT token without requiring a provisioned user
 *
 * @param ctx - Convex context
 * @returns Basic identity information from JWT
 * @throws ConvexError if token is invalid
 */
export async function requireAuthToken(ctx: AuthContext): Promise<{
  workosUserId: string;
  email: string | null;
  name: string | null;
  orgId: string | null;
  orgRole: string | null;
}> {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw createError.unauthorized("Authentication required");
  }

  const workosUserId = identity.subject;
  if (!workosUserId) {
    throw createError.unauthorized("Invalid authentication token");
  }

  return {
    workosUserId,
    email: identity.email || null,
    name: identity.name || null,
    orgId: (identity.org_id as string) || null,
    orgRole: (identity.org_role as string) || null,
  };
}
