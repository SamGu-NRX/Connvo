/**
 * Dynamic Permission Management System
 *
 * This module handles real-time permission validation, subscription management,
 * and dynamic permission updates for WebSocket connections.
 *
 * Requirements: 2.5, 4.2, 4.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns for real-time features
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireIdentity, assertMeetingAccess } from "./guards";
import { createError } from "../lib/errors";
import { internal } from "../_generated/api";

/**
 * Permission context for real-time subscriptions
 */
export interface SubscriptionPermission {
  userId: Id<"users">;
  resourceType: "meeting" | "user" | "organization";
  resourceId: string;
  permissions: string[];
  grantedAt: number;
  expiresAt?: number;
}

/**
 * Active subscription tracking for permission management
 */
export interface ActiveSubscription {
  subscriptionId: string;
  userId: Id<"users">;
  resourceType: string;
  resourceId: string;
  permissions: string[];
  connectionId: string;
  createdAt: number;
  lastValidated: number;
}

/**
 * Validates permissions for WebSocket subscription initialization
 * This is called when a client attempts to establish a real-time subscription
 */
export const validateSubscriptionPermissions = query({
  args: {
    resourceType: v.union(
      v.literal("meeting"),
      v.literal("meetingNotes"),
      v.literal("transcripts"),
      v.literal("prompts"),
      v.literal("messages"),
      v.literal("participants"),
    ),
    resourceId: v.string(),
    requiredPermissions: v.array(v.string()),
  },
  returns: v.object({
    granted: v.boolean(),
    permissions: v.array(v.string()),
    expiresAt: v.optional(v.number()),
    metadata: v.any(),
  }),
  handler: async (ctx, { resourceType, resourceId, requiredPermissions }) => {
    const identity = await requireIdentity(ctx);

    try {
      // Validate permissions based on resource type
      const permissions = await validateResourcePermissions(
        ctx,
        identity.userId as Id<"users">,
        resourceType,
        resourceId,
        requiredPermissions,
      );

      // Log successful permission grant
      const userIdentity = await ctx.auth.getUserIdentity();
      await logPermissionEvent(ctx, {
        userId: identity.userId as Id<"users">,
        action: "subscription_granted",
        resourceType,
        resourceId,
        permissions: permissions.granted,
        metadata: {
          requiredPermissions,
          connectionInfo: {
            userAgent: userIdentity?.name,
            timestamp: Date.now(),
          },
        },
      });

      return {
        granted: true,
        permissions: permissions.granted,
        expiresAt: permissions.expiresAt,
        metadata: permissions.metadata,
      };
    } catch (error) {
      // Log permission denial
      const message = error instanceof Error ? error.message : String(error);
      await logPermissionEvent(ctx, {
        userId: identity.userId as Id<"users">,
        action: "subscription_denied",
        resourceType,
        resourceId,
        permissions: [],
        metadata: {
          requiredPermissions,
          error: message,
          timestamp: Date.now(),
        },
      });

      return {
        granted: false,
        permissions: [],
        metadata: { error: message },
      };
    }
  },
});

/**
 * Validates permissions for a specific resource type
 */
async function validateResourcePermissions(
  ctx: any,
  userId: Id<"users">,
  resourceType: string,
  resourceId: string,
  requiredPermissions: string[],
): Promise<{
  granted: string[];
  expiresAt?: number;
  metadata: any;
}> {
  switch (resourceType) {
    case "meeting":
    case "meetingNotes":
    case "transcripts":
    case "prompts":
    case "messages":
    case "participants":
      return await validateMeetingResourcePermissions(
        ctx,
        userId,
        resourceId,
        requiredPermissions,
      );

    default:
      throw createError.validation(`Unknown resource type: ${resourceType}`);
  }
}

/**
 * Validates meeting-related resource permissions
 */
async function validateMeetingResourcePermissions(
  ctx: any,
  userId: Id<"users">,
  meetingId: string,
  requiredPermissions: string[],
): Promise<{
  granted: string[];
  expiresAt?: number;
  metadata: any;
}> {
  // Verify meeting access
  const participant = await assertMeetingAccess(
    ctx,
    meetingId as Id<"meetings">,
  );

  // Define permission mappings based on role
  const rolePermissions = {
    host: [
      "read",
      "write",
      "manage",
      "start_meeting",
      "end_meeting",
      "invite_participants",
      "manage_recording",
      "access_transcripts",
      "access_notes",
      "access_prompts",
      "access_messages",
      "access_participants",
    ],
    participant: [
      "read",
      "write",
      "access_transcripts",
      "access_notes",
      "access_prompts",
      "access_messages",
      "access_participants",
    ],
  };

  const userPermissions = rolePermissions[participant.role] || [];
  const grantedPermissions = requiredPermissions.filter((perm) =>
    userPermissions.includes(perm),
  );

  // Check if meeting is active for time-sensitive permissions
  const meeting = await ctx.db.get(meetingId as Id<"meetings">);
  const meetingState = await ctx.db
    .query("meetingState")
    .withIndex("by_meeting", (q: any) => q.eq("meetingId", meetingId))
    .unique();

  let expiresAt: number | undefined;
  if (meeting?.state === "active" && meetingState?.endedAt) {
    // Permissions expire when meeting ends
    expiresAt = meetingState.endedAt;
  }

  return {
    granted: grantedPermissions,
    expiresAt,
    metadata: {
      role: participant.role,
      meetingState: meeting?.state,
      participantId: participant._id,
    },
  };
}

/**
 * Revokes permissions and terminates unauthorized streams
 * Called when participant roles change or participants are removed
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
    // Log permission revocation
    await logPermissionEvent(ctx, {
      userId,
      action: "subscription_revoked",
      resourceType,
      resourceId,
      permissions: [],
      metadata: {
        reason,
        timestamp: Date.now(),
      },
    });

    // In a complete implementation, this would:
    // 1. Identify active WebSocket connections for this user/resource
    // 2. Send termination messages to those connections
    // 3. Update subscription tracking tables
    // 4. Clean up any cached permission state

    // For now, we log the revocation event
    console.log(
      `Revoked permissions for user ${userId} on ${resourceType}:${resourceId} - ${reason}`,
    );
  },
});

/**
 * Updates permissions when participant roles change
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
    // Log role change
    await logPermissionEvent(ctx, {
      userId,
      action: "role_changed",
      resourceType: "meeting",
      resourceId: meetingId,
      permissions: [],
      metadata: {
        oldRole,
        newRole,
        timestamp: Date.now(),
      },
    });

    // If role was downgraded, revoke elevated permissions
    if (oldRole === "host" && newRole === "participant") {
      await ctx.runMutation(
        internal.auth.permissions.revokeSubscriptionPermissions,
        {
          userId,
          resourceType: "meeting",
          resourceId: meetingId,
          reason: `Role downgraded from ${oldRole} to ${newRole}`,
        },
      );
    }

    // Update any cached permission state
    // In a complete implementation, this would trigger re-validation
    // of all active subscriptions for this user/meeting combination
  },
});

/**
 * Handles participant removal from meetings
 */
export const handleParticipantRemoval = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    removedBy: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId, removedBy }) => {
    // Log participant removal
    await logPermissionEvent(ctx, {
      userId: removedBy,
      action: "participant_removed",
      resourceType: "meeting",
      resourceId: meetingId,
      permissions: [],
      metadata: {
        removedUserId: userId,
        timestamp: Date.now(),
      },
    });

    // Revoke all permissions for the removed participant
    await ctx.runMutation(
      internal.auth.permissions.revokeSubscriptionPermissions,
      {
        userId,
        resourceType: "meeting",
        resourceId: meetingId,
        reason: `Removed from meeting by ${removedBy}`,
      },
    );
  },
});

/**
 * Validates and refreshes subscription permissions
 * Called periodically to ensure permissions are still valid
 */
export const refreshSubscriptionPermissions = query({
  args: {
    subscriptions: v.array(
      v.object({
        resourceType: v.string(),
        resourceId: v.string(),
        permissions: v.array(v.string()),
        lastValidated: v.number(),
      }),
    ),
  },
  returns: v.array(
    v.object({
      resourceType: v.string(),
      resourceId: v.string(),
      valid: v.boolean(),
      updatedPermissions: v.array(v.string()),
      reason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { subscriptions }) => {
    const identity = await requireIdentity(ctx);
    const results = [];

    for (const subscription of subscriptions) {
      try {
        const permissions = await validateResourcePermissions(
          ctx,
          identity.userId as Id<"users">,
          subscription.resourceType,
          subscription.resourceId,
          subscription.permissions,
        );

        results.push({
          resourceType: subscription.resourceType,
          resourceId: subscription.resourceId,
          valid: permissions.granted.length === subscription.permissions.length,
          updatedPermissions: permissions.granted,
        });
      } catch (error) {
        results.push({
          resourceType: subscription.resourceType,
          resourceId: subscription.resourceId,
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
 * Logs permission-related events for audit trail
 */
async function logPermissionEvent(
  ctx: any,
  event: {
    userId: Id<"users">;
    action: string;
    resourceType: string;
    resourceId: string;
    permissions: string[];
    metadata?: any;
  },
) {
  try {
    await ctx.db.insert("auditLogs", {
      actorUserId: event.userId,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      action: event.action,
      metadata: {
        permissions: event.permissions,
        ...event.metadata,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    // Log audit failures but don't block the main operation
    console.error("Failed to log permission event:", error);
  }
}
