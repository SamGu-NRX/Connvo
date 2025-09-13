/**
 * Dynamic Permission Management System
 *
 * This module handles dynamic permission updates and subscription management
 * for real-time access control.
 *
 * Requirements: 2.5, 4.1
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { internalMutation, query } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { assertMeetingAccess } from "./guards";
import { normalizeRole, permissionsForResource } from "../lib/permissions";
import { logAudit } from "../lib/audit";

export const validateSubscriptionPermissions = query({
  args: {
    resourceType: v.string(),
    resourceId: v.id("meetings"),
    requiredPermissions: v.array(
      v.union(
        v.literal("read"),
        v.literal("write"),
        v.literal("manage"),
        v.literal("export"),
        v.literal("invite"),
        v.literal("remove"),
      ),
    ),
  },
  returns: v.object({
    granted: v.boolean(),
    permissions: v.array(v.string()),
    metadata: v.object({
      error: v.optional(v.string()),
    }),
  }),
  handler: async (ctx, { resourceType, resourceId, requiredPermissions }) => {
    try {
      const participant = await assertMeetingAccess(ctx, resourceId);
      const role = normalizeRole(participant.role);
      const permissions = permissionsForResource(resourceType, role);

      const granted = requiredPermissions.every((p) => permissions.includes(p));
      return { granted, permissions, metadata: {} };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { granted: false, permissions: [], metadata: { error: message } };
    }
  },
});

export const refreshSubscriptionPermissions = query({
  args: {
    subscriptions: v.array(
      v.object({
        resourceType: v.string(),
        resourceId: v.id("meetings"),
        permissions: v.array(v.string()),
        lastValidated: v.number(),
      }),
    ),
  },
  returns: v.array(
    v.object({
      resourceType: v.string(),
      resourceId: v.id("meetings"),
      valid: v.boolean(),
      updatedPermissions: v.array(v.string()),
      reason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { subscriptions }) => {
    const results: Array<{
      resourceType: string;
      resourceId: Id<"meetings">;
      valid: boolean;
      updatedPermissions: string[];
      reason?: string;
    }> = [];

    for (const sub of subscriptions) {
      try {
        const participant = await assertMeetingAccess(ctx, sub.resourceId);
        const role = normalizeRole(participant.role);
        const updatedPermissions = permissionsForResource(
          sub.resourceType,
          role,
        );
        results.push({
          resourceType: sub.resourceType,
          resourceId: sub.resourceId,
          valid: true,
          updatedPermissions,
        });
      } catch (error) {
        results.push({
          resourceType: sub.resourceType,
          resourceId: sub.resourceId,
          valid: false,
          updatedPermissions: [],
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  },
});

/**
 * Handles participant removal and permission revocation
 * TODO: Implement comprehensive permission system in task 2.3
 */
export const handleParticipantRemoval = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    removedBy: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId, removedBy }) => {
    // Placeholder implementation
    console.log(
      `Revoking permissions for user ${userId} in meeting ${meetingId}`,
    );

    // Log the permission revocation
    await logAudit(ctx, {
      actorUserId: removedBy,
      resourceType: "meeting",
      resourceId: meetingId,
      action: "permissions_revoked",
      category: "auth",
      success: true,
      metadata: {
        targetUserId: userId,
        reason: "participant_removed",
      },
    });

    return null;
  },
});

/**
 * Updates participant permissions based on role change
 * TODO: Implement comprehensive permission system in task 2.3
 */
export const updateParticipantPermissions = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    oldRole: v.union(v.literal("host"), v.literal("participant")),
    newRole: v.union(v.literal("host"), v.literal("participant")),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId, oldRole, newRole }) => {
    // Placeholder implementation
    console.log(
      `Updating permissions for user ${userId}: ${oldRole} -> ${newRole}`,
    );

    // Log the permission update
    await logAudit(ctx, {
      actorUserId: userId,
      resourceType: "meeting",
      resourceId: meetingId,
      action: "permissions_updated",
      category: "auth",
      success: true,
      metadata: {
        oldRole,
        newRole,
      },
    });

    return null;
  },
});

/**
 * Revokes subscription permissions for a user
 * TODO: Implement comprehensive permission system in task 2.3
 */
export const revokeSubscriptionPermissions = internalMutation({
  args: {
    userId: v.id("users"),
    resourceType: v.string(),
    resourceId: v.string(),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, resourceType, resourceId, reason }) => {
    // Placeholder implementation
    console.log(
      `Revoking ${resourceType} subscription for user ${userId}: ${reason}`,
    );

    // Log the subscription revocation
    await logAudit(ctx, {
      actorUserId: userId,
      resourceType,
      resourceId,
      action: "subscription_revoked",
      category: "auth",
      success: true,
      metadata: {
        reason,
      },
    });

    return null;
  },
});
