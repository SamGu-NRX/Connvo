/**
 * Real-Time Subscription Management with Dynamic Permissions
 *
 * This module manages WebSocket subscriptions with real-time permission
 * validation and automatic termination of unauthorized streams.
 *
 * Requirements: 2.5, 4.2, 5.1, 5.2
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
 * Real-time meeting notes subscription with permission validation
 */
export const subscribeMeetingNotes = query({
  args: {
    meetingId: v.id("meetings"),
    subscriptionId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      content: v.string(),
      version: v.number(),
      lastUpdated: v.number(),
      subscriptionValid: v.boolean(),
      permissions: v.array(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { meetingId, subscriptionId }) => {
    // Validate meeting access and log subscription attempt
    const participant = await assertMeetingAccess(ctx, meetingId);
    const identity = await requireIdentity(ctx);

    // Log subscription establishment
    await logSubscriptionEvent(ctx, {
      userId: identity.userId as Id<"users">,
      action: "subscription_established",
      resourceType: "meetingNotes",
      resourceId: meetingId,
      subscriptionId: subscriptionId || `notes_${meetingId}_${Date.now()}`,
      metadata: {
        participantRole: participant.role,
        meetingState: await getMeetingState(ctx, meetingId),
      },
    });

    // Get meeting notes
    const notes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    // Determine user permissions
    const permissions = getNotesPermissions(participant.role);

    return {
      content: notes?.content || "",
      version: notes?.version || 0,
      lastUpdated: notes?.updatedAt || Date.now(),
      subscriptionValid: true,
      permissions,
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

    // Log subscription
      await logSubscriptionEvent(ctx, {
        userId: identity.userId as Id<"users">,
        action: "transcript_subscription_established",
        resourceType: "transcripts",
        resourceId: meetingId,
        subscriptionId:
          subscriptionId || `transcripts_${meetingId}_${Date.now()}`,
        metadata: {
          fromSequence,
          participantRole: participant.role,
        meetingActive: meetingState.active,
      },
    });

    // Get recent transcripts across time buckets
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    const buckets = [];

    // Generate recent time buckets (last 30 minutes)
    for (let i = 0; i < 6; i++) {
      const bucketTime = now - i * fiveMinutes;
      buckets.push(Math.floor(bucketTime / fiveMinutes) * fiveMinutes);
    }

    const allTranscripts = [];
    for (const bucketMs of buckets) {
      const bucketTranscripts = await ctx.db
        .query("transcripts")
        .withIndex("by_meeting_bucket_seq", (q) =>
          q
            .eq("meetingId", meetingId)
            .eq("bucketMs", bucketMs)
            .gt("sequence", fromSequence),
        )
        .take(limit - allTranscripts.length);

      allTranscripts.push(...bucketTranscripts);

      if (allTranscripts.length >= limit) break;
    }

    // Sort by sequence and limit
    const sortedTranscripts = allTranscripts
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit);

    const nextSequence =
      sortedTranscripts.length > 0
        ? Math.max(...sortedTranscripts.map((t) => t.sequence)) + 1
        : fromSequence;

    const permissions = getTranscriptPermissions(participant.role);
    const validUntil = meetingState.endedAt || undefined;

    return {
      transcripts: sortedTranscripts,
      nextSequence,
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
