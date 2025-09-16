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
  QueryCtx,
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
import { normalizeRole, permissionsForResource } from "../lib/permissions";
import { buildSubscriptionAudit } from "../lib/audit";
import { internal } from "../_generated/api";

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
      const roleForNotes = normalizeRole(participant.role);
      return {
        content: "",
        version: 0,
        lastUpdated: Date.now(),
        subscriptionValid: true,
        permissions: permissionsForResource("meetingNotes", roleForNotes),
        cursor: cursor || "",
        rateLimited: true,
      };
    }

    // Do not write from queries; log via mutations elsewhere if needed

    // Track subscription establishment
    SubscriptionPerformanceTracker.trackSubscriptionEstablished(subId);

    // Try cache first for frequently accessed notes
    const cacheKey = `notes_${meetingId}`;
    type NotesMaterialized = {
      content: string;
      version: number;
      lastUpdated: number;
    };
    let notes = QueryCache.get<NotesMaterialized>(cacheKey);

    if (!notes) {
      // Get meeting notes using optimized query
      notes = await NotesQueryOptimizer.getMaterializedNotes(ctx, meetingId);

      // Cache for 30 seconds
      QueryCache.set<NotesMaterialized>(cacheKey, notes, 30000);
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
    const roleForNotes = normalizeRole(participant.role);
    const permissions = permissionsForResource("meetingNotes", roleForNotes);

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
        isInterim: v.optional(v.boolean()),
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
      const roleForPerms = normalizeRole(participant.role);
      return {
        transcripts: [],
        nextSequence: fromSequence,
        subscriptionValid: true,
        permissions: permissionsForResource("transcripts", roleForPerms),
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

    const roleForPerms2 = normalizeRole(participant.role);
    const permissions = permissionsForResource("transcripts", roleForPerms2);
    const validUntil = meetingState.endedAt || undefined;

    // Do not write from queries

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
        role: v.union(
          v.literal("host"),
          v.literal("participant"),
          v.literal("observer"),
        ),
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

    // Do not write from queries

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

    const roleForPerms3 = normalizeRole(participant.role);
    const permissions = permissionsForResource(
      "meetingParticipants",
      roleForPerms3,
    );

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
    resourceId: v.id("meetings"),
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

        const roleForPerms4 = normalizeRole(participant.role);
        const permissions = permissionsForResource(resourceType, roleForPerms4);

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
      // Do not write from queries

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
    // Log subscription termination using centralized audit logger
    await ctx.runMutation(
      internal.audit.logging.createAuditLog,
      buildSubscriptionAudit({
        actorUserId: userId,
        resourceType,
        resourceId,
        action: "subscription_terminated",
        metadata: {
          subscriptionId,
          reason,
          terminatedAt: Date.now(),
        },
      }),
    );

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

async function getMeetingState(ctx: QueryCtx, meetingId: Id<"meetings">) {
  return await ctx.db
    .query("meetingState")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .unique();
}

// Permission helpers moved to ../lib/permissions for consistency

// Intentionally no logging writes from queries
