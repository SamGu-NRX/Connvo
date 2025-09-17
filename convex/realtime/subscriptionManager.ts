/**
 * Advanced Subscription Management with Real-Time Permission Updates
 *
 * This module provides centralized subscription management, permission
 * validation, and automatic termination of unauthorized streams.
 *
 * Requirements: 2.5, 4.2, 5.1, 5.2
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "@convex/_generated/server";
import { Id } from "@convex/_generated/dataModel";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";
import { globalBandwidthManager } from "@convex/lib/batching";
import { SubscriptionPerformanceTracker } from "@convex/lib/performance";
import {
  SubscriptionStateManager,
  QueryCache,
} from "@convex/lib/queryOptimization";
import { internal } from "@convex/_generated/api";
import { buildSubscriptionAudit } from "@convex/lib/audit";
import { normalizeRole, permissionsForResource } from "@convex/lib/permissions";
import {
  SubscriptionEstablishmentResultV,
  SubscriptionValidationResultV,
  BulkTerminationResultV,
  SubscriptionStatsV,
} from "@convex/types/validators/real-time";
import type { ActiveSubscription } from "@convex/types/domain/real-time";

/**
 * Global subscription registry
 */
class SubscriptionRegistry {
  private static subscriptions = new Map<string, ActiveSubscription>();

  static register(subscription: ActiveSubscription): void {
    this.subscriptions.set(subscription.subscriptionId, subscription);
    SubscriptionPerformanceTracker.trackSubscriptionEstablished(
      subscription.subscriptionId,
    );
  }

  static unregister(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  static get(subscriptionId: string): ActiveSubscription | null {
    return this.subscriptions.get(subscriptionId) || null;
  }

  static getByUser(userId: Id<"users">): ActiveSubscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (sub) => sub.userId === userId,
    );
  }

  static getByResource(
    resourceType: string,
    resourceId: string,
  ): ActiveSubscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (sub) =>
        sub.resourceType === resourceType && sub.resourceId === resourceId,
    );
  }

  static updatePermissions(
    subscriptionId: string,
    permissions: string[],
  ): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      subscription.permissions = permissions;
      subscription.lastValidated = Date.now();
    }
  }

  static cleanup(): void {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes

    for (const [id, sub] of this.subscriptions.entries()) {
      if (now - sub.lastValidated > staleThreshold) {
        this.subscriptions.delete(id);
      }
    }
  }

  static getAllActive(): ActiveSubscription[] {
    return Array.from(this.subscriptions.values());
  }
}

/**
 * Establishes a new subscription with comprehensive validation
 */
export const establishSubscription = mutation({
  args: {
    resourceType: v.string(),
    resourceId: v.string(),
    subscriptionId: v.string(),
    priority: v.optional(
      v.union(
        v.literal("critical"),
        v.literal("high"),
        v.literal("normal"),
        v.literal("low"),
      ),
    ),
  },
  returns: SubscriptionEstablishmentResultV.full,
  handler: async (
    ctx,
    { resourceType, resourceId, subscriptionId, priority = "normal" },
  ) => {
    const identity = await requireIdentity(ctx);

    // Validate resource access based on type
    let permissions: string[] = [];
    let validUntil: number | undefined;

    if (
      resourceType.startsWith("meeting") ||
      resourceType === "transcripts" ||
      resourceType === "participants"
    ) {
      const participant = await assertMeetingAccess(
        ctx,
        resourceId as Id<"meetings">,
      );
      const roleForPerms = normalizeRole(participant.role);
      permissions = permissionsForResource(resourceType, roleForPerms);

      // Check if meeting is still active for time-sensitive resources
      if (resourceType === "transcripts") {
        const meetingState = await ctx.db
          .query("meetingState")
          .withIndex("by_meeting", (q) =>
            q.eq("meetingId", resourceId as Id<"meetings">),
          )
          .unique();

        if (!meetingState?.active) {
          return {
            success: false,
            subscriptionId,
            permissions: [],
            rateLimited: false,
          };
        }

        validUntil = meetingState.endedAt;
      }
    }

    // Check bandwidth limits
    const canEstablish = globalBandwidthManager.canSendUpdate(
      subscriptionId,
      priority,
    );
    if (!canEstablish) {
      return {
        success: false,
        subscriptionId,
        permissions: [],
        rateLimited: true,
      };
    }

    // Register subscription
    const subscription: ActiveSubscription = {
      subscriptionId,
      userId: identity.userId as Id<"users">,
      resourceType,
      resourceId,
      permissions,
      establishedAt: Date.now(),
      lastValidated: Date.now(),
      validUntil,
      priority,
    };

    SubscriptionRegistry.register(subscription);

    // Log establishment using centralized audit logger
    await ctx.runMutation(
      internal.audit.logging.createAuditLog,
      buildSubscriptionAudit({
        actorUserId: identity.userId as Id<"users">,
        resourceType,
        resourceId,
        action: "subscription_established",
        metadata: {
          subscriptionId,
          permissions: permissions.join(","),
          priority,
        },
      }),
    );

    return {
      success: true,
      subscriptionId,
      permissions,
      validUntil,
      rateLimited: false,
    };
  },
});

/**
 * Validates and updates subscription permissions in real-time
 */
export const validateAndUpdateSubscription = query({
  args: {
    subscriptionId: v.string(),
    lastValidated: v.number(),
  },
  returns: SubscriptionValidationResultV.full,
  handler: async (ctx, { subscriptionId }) => {
    const identity = await requireIdentity(ctx);
    const subscription = SubscriptionRegistry.get(subscriptionId);

    if (!subscription) {
      return {
        valid: false,
        permissions: [],
        reason: "Subscription not found",
        shouldReconnect: false,
        rateLimited: false,
        resourceType: "unknown",
        resourceId: "unknown",
      };
    }

    // Verify ownership
    if (subscription.userId !== identity.userId) {
      return {
        valid: false,
        permissions: [],
        reason: "Unauthorized access",
        shouldReconnect: false,
        rateLimited: false,
        resourceType: subscription.resourceType,
        resourceId: subscription.resourceId,
      };
    }

    // Check bandwidth limits
    const canUpdate = globalBandwidthManager.canSendUpdate(
      subscriptionId,
      subscription.priority,
    );
    if (!canUpdate) {
      return {
        valid: true,
        permissions: subscription.permissions,
        shouldReconnect: false,
        rateLimited: true,
        resourceType: subscription.resourceType,
        resourceId: subscription.resourceId,
      };
    }

    try {
      // Re-validate resource access
      if (
        subscription.resourceType.startsWith("meeting") ||
        subscription.resourceType === "transcripts" ||
        subscription.resourceType === "participants"
      ) {
        const participant = await assertMeetingAccess(
          ctx,
          subscription.resourceId as Id<"meetings">,
        );
        const roleForPerms2 = normalizeRole(participant.role);
        const newPermissions = permissionsForResource(
          subscription.resourceType,
          roleForPerms2,
        );

        // Check if meeting state has changed for time-sensitive resources
        if (subscription.resourceType === "transcripts") {
          const meetingState = await ctx.db
            .query("meetingState")
            .withIndex("by_meeting", (q) =>
              q.eq("meetingId", subscription.resourceId as Id<"meetings">),
            )
            .unique();

          if (!meetingState?.active) {
            SubscriptionRegistry.unregister(subscriptionId);
            return {
              valid: false,
              permissions: [],
              reason: "Meeting is no longer active",
              shouldReconnect: false,
              rateLimited: false,
              resourceType: subscription.resourceType,
              resourceId: subscription.resourceId,
            };
          }

          subscription.validUntil = meetingState.endedAt;
        }

        // Update permissions if they've changed
        if (
          JSON.stringify(newPermissions) !==
          JSON.stringify(subscription.permissions)
        ) {
          SubscriptionRegistry.updatePermissions(
            subscriptionId,
            newPermissions,
          );
        }

        return {
          valid: true,
          permissions: newPermissions,
          shouldReconnect: false,
          validUntil: subscription.validUntil,
          rateLimited: false,
          resourceType: subscription.resourceType,
          resourceId: subscription.resourceId,
        };
      }

      // Default case for unknown resource types
      return {
        valid: false,
        permissions: [],
        reason: "Unknown resource type",
        shouldReconnect: false,
        rateLimited: false,
        resourceType: subscription.resourceType,
        resourceId: subscription.resourceId,
      };
    } catch (error) {
      // Do not attempt writes from a query; just clean up and report

      SubscriptionRegistry.unregister(subscriptionId);

      return {
        valid: false,
        permissions: [],
        reason: error instanceof Error ? error.message : String(error),
        shouldReconnect:
          error instanceof Error && error.message.includes("not found")
            ? false
            : true,
        rateLimited: false,
        resourceType: subscription ? subscription.resourceType : "unknown",
        resourceId: subscription ? subscription.resourceId : "unknown",
      };
    }
  },
});

/**
 * Terminates subscription and cleans up resources
 */
export const terminateSubscription = mutation({
  args: {
    subscriptionId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { subscriptionId, reason = "User requested" }) => {
    const identity = await requireIdentity(ctx);
    const subscription = SubscriptionRegistry.get(subscriptionId);

    if (subscription && subscription.userId === identity.userId) {
      // Clean up subscription state
      SubscriptionRegistry.unregister(subscriptionId);
      SubscriptionStateManager.removeState(subscriptionId);

      // Invalidate related cache entries
      QueryCache.invalidate(subscription.resourceId);

      // Log termination using centralized audit logger
      await ctx.runMutation(
        internal.audit.logging.createAuditLog,
        buildSubscriptionAudit({
          actorUserId: identity.userId as Id<"users">,
          resourceType: subscription.resourceType,
          resourceId: subscription.resourceId,
          action: "subscription_terminated",
          metadata: {
            subscriptionId,
            reason,
            duration: Date.now() - subscription.establishedAt,
          },
        }),
      );
    }
  },
});

/**
 * Bulk terminate subscriptions for a user (e.g., when permissions are revoked)
 */
export const bulkTerminateUserSubscriptions = internalMutation({
  args: {
    userId: v.id("users"),
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    reason: v.string(),
  },
  returns: BulkTerminationResultV.full,
  handler: async (ctx, { userId, resourceType, resourceId, reason }) => {
    let subscriptions = SubscriptionRegistry.getByUser(userId);

    // Filter by resource if specified
    if (resourceType) {
      subscriptions = subscriptions.filter(
        (sub) => sub.resourceType === resourceType,
      );
    }
    if (resourceId) {
      subscriptions = subscriptions.filter(
        (sub) => sub.resourceId === resourceId,
      );
    }

    const terminatedIds: string[] = [];

    for (const subscription of subscriptions) {
      SubscriptionRegistry.unregister(subscription.subscriptionId);
      SubscriptionStateManager.removeState(subscription.subscriptionId);
      QueryCache.invalidate(subscription.resourceId);
      terminatedIds.push(subscription.subscriptionId);

      // Log termination
      await ctx.runMutation(
        internal.audit.logging.createAuditLog,
        buildSubscriptionAudit({
          actorUserId: userId,
          resourceType: subscription.resourceType,
          resourceId: subscription.resourceId,
          action: "subscription_bulk_terminated",
          metadata: {
            subscriptionId: subscription.subscriptionId,
            reason,
            duration: Date.now() - subscription.establishedAt,
          },
        }),
      );
    }

    return {
      terminatedCount: terminatedIds.length,
      subscriptionIds: terminatedIds,
    };
  },
});

/**
 * Get subscription statistics for monitoring
 */
export const getSubscriptionStats = query({
  args: {},
  returns: SubscriptionStatsV.full,
  handler: async (ctx, {}) => {
    const identity = await requireIdentity(ctx);

    // Only allow admins to view global stats
    // For now, return user's own subscriptions
    const userSubscriptions = SubscriptionRegistry.getByUser(
      identity.userId as Id<"users">,
    );

    const byResourceType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const sub of userSubscriptions) {
      byResourceType[sub.resourceType] =
        (byResourceType[sub.resourceType] || 0) + 1;
      byPriority[sub.priority] = (byPriority[sub.priority] || 0) + 1;
    }

    return {
      totalActive: userSubscriptions.length,
      byResourceType,
      byPriority,
      performanceStats: SubscriptionPerformanceTracker.getAllStats(),
    };
  },
});

/**
 * Helper function to get permissions for a resource type and role
 */
// Permission helpers moved to @convex/lib/permissions for consistency

/**
 * Cleanup function to be called periodically
 */
export function subscriptionManagerCleanup(): void {
  SubscriptionRegistry.cleanup();
}

// Auto-cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(subscriptionManagerCleanup, 5 * 60 * 1000);
}
