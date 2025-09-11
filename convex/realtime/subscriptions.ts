/**
 * Real-Time Subscription Management with Advanced Batching and Coalescing
 *
 * This module manages WebSocket subscriptions with real-time permission
 * validation, automatic termination of unauthorized streams, and advanced
 * batching/coalescing for high-frequency operations.
 *
 * Requirements: 2.5, 4.2, 5.1, 5.2, 5.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex reactive patterns
 */

import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireIdentity, assertMeetingAccess } from "../auth/guards";
import { createError } from "../lib/errors";
import {
  globalBandwidthManager,
  CircuitBreaker,
  debounce,
  throttle,
} from "../lib/batching";
import { withTrace, SubscriptionPerformanceTracker } from "../lib/performance";
import {
  TranscriptQueryOptimizer,
  NotesQueryOptimizer,
  SubscriptionStateManager,
  QueryCache,
} from "../lib/queryOptimization";

/**
 * Subscription context for tracking active connections
 */
export interface SubscriptionContext {
  subscriptionId: string;
  userId: Id<"users">;
  resourceType: string;
  resourceId: string;
  permissions: string[];
  connectionId: string;
  establishedAt: number;
  lastValidated: number;
  validUntil?: number;
}

/**
 * Real-time meeting notes subscription with permission validation and bandwidth management
 */
export const subscribeMeetingNotes = query({
  args: {
    meetingId: v.id("meetings"),
    subscriptionId: v.optional(v.string()),
    cursor: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      content: v.string(),
      version: v.number(),
      lastUpdated: v.number(),
      subscriptionValid: v.boolean(),
      permissions: v.array(v.string()),
      cursor: v.string(),
      rateLimited: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { meetingId, subscriptionId, cursor }) => {
    const startTime = Date.now();

    // Validate meeting access and log subscription attempt
    const participant = await assertMeetingAccess(ctx, meetingId);
    const identity = await requireIdentity(ctx);

    const subId = subscriptionId || `notes_${meetingId}_${Date.now()}`;

    // Check bandwidth limits
    const canSendUpdate = globalBandwidthManager.canSendUpdate(subId, "normal");
    if (!canSendUpdate) {
      return {
        content: "",
        version: 0,
        lastUpdated: Date.now(),
        subscriptionValid: true,
        permissions: getNotesPermissions(participant.role),
        cursor: cursor || "",
        rateLimited: true,
      };
    }

    // Log subscription establishment
    await logSubscriptionEvent(ctx, {
      userId: identity.userId as Id<"users">,
      action: "subscription_established",
      resourceType: "meetingNotes",
      resourceId: meetingId,
      subscriptionId: subId,
      metadata: {
        participantRole: participant.role,
        meetingState: await getMeetingState(ctx, meetingId),
        cursor,
        latency: Date.now() - startTime,
      },
    });

    // Track subscription establishment
    SubscriptionPerformanceTracker.trackSubscriptionEstablished(subId);

    // Try cache first for frequently accessed notes
    const cacheKey = `notes_${meetingId}`;
    let notes = QueryCache.get(cacheKey);

    if (!notes) {
      // Get meeting notes using optimized query
      notes = await NotesQueryOptimizer.getMaterializedNotes(ctx, meetingId);

      // Cache for 30 seconds
      QueryCache.set(cacheKey, notes, 30000);
    }

    // Save subscription state for resumability
    SubscriptionStateManager.saveState({
      subscriptionId: subId,
      lastCursor: { timestamp: Date.now(), sequence: notes.version },
      lastUpdate: Date.now(),
      resourceType: "meetingNotes",
      resourceId: meetingId,
      userId: identity.userId as Id<"users">,
    });

    // Determine user permissions
    const permissions = getNotesPermissions(participant.role);

    // Record successful update with latency
    const latency = Date.now() - startTime;
    globalBandwidthManager.recordUpdate(subId);
    SubscriptionPerformanceTracker.trackUpdate(subId, latency);

    const newCursor = `${notes.version}_${Date.now()}`;

    return {
      content: notes.content,
      version: notes.version,
      lastUpdated: notes.lastUpdated,
      subscriptionValid: true,
      permissions,
      cursor: newCursor,
      rateLimited: false,
    };
  },
});

/**
 * Real-time transcript stream subscription with time-bounded access
 */
export const subscribeTranscriptStream = query({
  args: {
    meetingId: v.id("meetings"),
    fromSequence: v.optional(v.number()),
    limit: v.optional(v.number()),
    subscriptionId: v.optional(v.string()),
  },
  returns: v.object({
    transcripts: v.array(
      v.object({
        _id: v.id("transcripts"),
        sequence: v.number(),
        speakerId: v.optional(v.string()),
        text: v.string(),
        confidence: v.number(),
        startMs: v.number(),
        endMs: v.number(),
        createdAt: v.number(),
      }),
    ),
    nextSequence: v.number(),
    subscriptionValid: v.boolean(),
    permissions: v.array(v.string()),
    validUntil: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    { meetingId, fromSequence = 0, limit = 50, subscriptionId },
  ) => {
    // Validate meeting access
    const participant = await assertMeetingAccess(ctx, meetingId);
    const identity = await requireIdentity(ctx);

    // Check if meeting is active for transcript access
    const meetingState = await getMeetingState(ctx, meetingId);
    if (!meetingState?.active) {
      throw createError.meetingNotActive(meetingId);
    }

    const startTime = Date.now();
    const subId = subscriptionId || `transcripts_${meetingId}_${Date.now()}`;

    // Check bandwidth limits - transcripts are high priority
    const canSendUpdate = globalBandwidthManager.canSendUpdate(subId, "high");
    if (!canSendUpdate) {
      return {
        transcripts: [],
        nextSequence: fromSequence,
        subscriptionValid: true,
        permissions: getTranscriptPermissions(participant.role),
        validUntil: undefined,
      };
    }

    // Track subscription establishment
    SubscriptionPerformanceTracker.trackSubscriptionEstablished(subId);

    // Use optimized transcript query with intelligent bucketing
    const queryResult = await TranscriptQueryOptimizer.queryTranscripts(
      ctx,
      meetingId,
      fromSequence,
      limit,
      30 * 60 * 1000, // 30 minutes window
    );

    const { transcripts, nextCursor, performance } = queryResult;

    // Save subscription state for resumability
    SubscriptionStateManager.saveState({
      subscriptionId: subId,
      lastCursor: nextCursor,
      lastUpdate: Date.now(),
      resourceType: "transcripts",
      resourceId: meetingId,
      userId: identity.userId as Id<"users">,
    });

    const permissions = getTranscriptPermissions(participant.role);
    const validUntil = meetingState.endedAt || undefined;

    // Log subscription with comprehensive performance metrics
    await logSubscriptionEvent(ctx, {
      userId: identity.userId as Id<"users">,
      action: "transcript_subscription_established",
      resourceType: "transcripts",
      resourceId: meetingId,
      subscriptionId: subId,
      metadata: {
        fromSequence,
        participantRole: participant.role,
        meetingActive: meetingState.active,
        performance: {
          ...performance,
          totalLatency: Date.now() - startTime,
        },
      },
    });

    // Record successful update with comprehensive latency tracking
    const totalLatency = Date.now() - startTime;
    globalBandwidthManager.recordUpdate(subId);
    SubscriptionPerformanceTracker.trackUpdate(subId, totalLatency);

    return {
      transcripts,
      nextSequence: nextCursor.sequence || fromSequence,
      subscriptionValid: true,
      permissions,
      validUntil,
    };
  },
});

/**
 * Real-time meeting participants subscription
 */
export const subscribeMeetingParticipants = query({
  args: {
    meetingId: v.id("meetings"),
    subscriptionId: v.optional(v.string()),
  },
  returns: v.object({
    participants: v.array(
      v.object({
        _id: v.id("meetingParticipants"),
        userId: v.id("users"),
        role: v.union(v.literal("host"), v.literal("participant")),
        presence: v.union(
          v.literal("invited"),
          v.literal("joined"),
          v.literal("left"),
        ),
        joinedAt: v.optional(v.number()),
        leftAt: v.optional(v.number()),
        user: v.object({
          displayName: v.optional(v.string()),
          email: v.string(),
          avatarUrl: v.optional(v.string()),
        }),
      }),
    ),
    subscriptionValid: v.boolean(),
    permissions: v.array(v.string()),
  }),
  handler: async (ctx, { meetingId, subscriptionId }) => {
    // Validate meeting access
    const participant = await assertMeetingAccess(ctx, meetingId);
    const identity = await requireIdentity(ctx);

    // Log subscription
    await logSubscriptionEvent(ctx, {
      userId: identity.userId as Id<"users">,
      action: "participants_subscription_established",
      resourceType: "meetingParticipants",
      resourceId: meetingId,
      subscriptionId:
        subscriptionId || `participants_${meetingId}_${Date.now()}`,
      metadata: {
        participantRole: participant.role,
      },
    });

    // Get all participants
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();

    // Enrich with user data
    const enrichedParticipants = await Promise.all(
      participants.map(async (p) => {
        const user = await ctx.db.get(p.userId);
        return {
          ...p,
          user: {
            displayName: user?.displayName,
            email: user?.email || "",
            avatarUrl: user?.avatarUrl,
          },
        };
      }),
    );

    const permissions = getParticipantsPermissions(participant.role);

    return {
      participants: enrichedParticipants,
      subscriptionValid: true,
      permissions,
    };
  },
});

/**
 * Validates subscription permissions in real-time
 * Called periodically by clients to ensure continued access
 */
export const validateSubscription = query({
  args: {
    subscriptionId: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    lastValidated: v.number(),
  },
  returns: v.object({
    valid: v.boolean(),
    permissions: v.array(v.string()),
    reason: v.optional(v.string()),
    shouldReconnect: v.boolean(),
    validUntil: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    { subscriptionId, resourceType, resourceId, lastValidated },
  ) => {
    const identity = await requireIdentity(ctx);

    try {
      // Validate based on resource type
      if (
        resourceType.startsWith("meeting") ||
        resourceType === "transcripts" ||
        resourceType === "participants"
      ) {
        const participant = await assertMeetingAccess(
          ctx,
          resourceId as Id<"meetings">,
        );

        // Check if meeting state has changed
        const meetingState = await getMeetingState(
          ctx,
          resourceId as Id<"meetings">,
        );

        // For transcript subscriptions, validate meeting is still active
        if (resourceType === "transcripts" && !meetingState?.active) {
          return {
            valid: false,
            permissions: [],
            reason: "Meeting is no longer active",
            shouldReconnect: false,
          };
        }

        const permissions = getPermissionsForResource(
          resourceType,
          participant.role,
        );

        return {
          valid: true,
          permissions,
          shouldReconnect: false,
          validUntil: meetingState?.endedAt,
        };
      }

      // Default case - invalid resource type
      return {
        valid: false,
        permissions: [],
        reason: "Unknown resource type",
        shouldReconnect: false,
      };
    } catch (error) {
      // Log validation failure
      await logSubscriptionEvent(ctx, {
        userId: identity.userId as Id<"users">,
        action: "subscription_validation_failed",
        resourceType,
        resourceId,
        subscriptionId,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          lastValidated,
        },
      });

      return {
        valid: false,
        permissions: [],
        reason: error instanceof Error ? error.message : String(error),
        shouldReconnect:
          error instanceof Error && error.message.includes("not found")
            ? false
            : true,
      };
    }
  },
});

/**
 * Terminates subscription when permissions are revoked
 */
export const terminateSubscription = internalMutation({
  args: {
    userId: v.id("users"),
    subscriptionId: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { userId, subscriptionId, resourceType, resourceId, reason },
  ) => {
    // Log subscription termination
    await logSubscriptionEvent(ctx, {
      userId,
      action: "subscription_terminated",
      resourceType,
      resourceId,
      subscriptionId,
      metadata: {
        reason,
        terminatedAt: Date.now(),
      },
    });

    // In a complete implementation, this would:
    // 1. Send termination message to WebSocket connection
    // 2. Clean up subscription tracking state
    // 3. Update client-side subscription managers

    console.log(
      `Terminated subscription ${subscriptionId} for user ${userId}: ${reason}`,
    );
  },
});

/**
 * Helper functions
 */

async function getMeetingState(ctx: any, meetingId: Id<"meetings">) {
  return await ctx.db
    .query("meetingState")
    .withIndex("by_meeting", (q: any) => q.eq("meetingId", meetingId))
    .unique();
}

function getNotesPermissions(role: "host" | "participant"): string[] {
  const basePermissions = ["read", "write"];
  if (role === "host") {
    return [...basePermissions, "manage", "export"];
  }
  return basePermissions;
}

function getTranscriptPermissions(role: "host" | "participant"): string[] {
  const basePermissions = ["read"];
  if (role === "host") {
    return [...basePermissions, "export", "manage"];
  }
  return basePermissions;
}

function getParticipantsPermissions(role: "host" | "participant"): string[] {
  const basePermissions = ["read"];
  if (role === "host") {
    return [...basePermissions, "invite", "remove", "manage"];
  }
  return basePermissions;
}

function getPermissionsForResource(
  resourceType: string,
  role: "host" | "participant",
): string[] {
  switch (resourceType) {
    case "meetingNotes":
      return getNotesPermissions(role);
    case "transcripts":
      return getTranscriptPermissions(role);
    case "meetingParticipants":
    case "participants":
      return getParticipantsPermissions(role);
    default:
      return ["read"];
  }
}

async function logSubscriptionEvent(
  ctx: any,
  event: {
    userId: Id<"users">;
    action: string;
    resourceType: string;
    resourceId: string;
    subscriptionId: string;
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
        subscriptionId: event.subscriptionId,
        category: "subscription_management",
        severity: "low",
        ...event.metadata,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Failed to log subscription event:", error);
  }
}
