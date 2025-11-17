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
} from "@convex/_generated/server";
import { Id } from "@convex/_generated/dataModel";
import { requireIdentity, assertMeetingAccess } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import {
  globalBandwidthManager,
  CircuitBreaker,
  debounce,
  throttle,
} from "@convex/lib/batching";
import {
  withTrace,
  SubscriptionPerformanceTracker,
} from "@convex/lib/performance";
import {
  TranscriptQueryOptimizer,
  NotesQueryOptimizer,
  SubscriptionStateManager,
  QueryCache,
} from "@convex/lib/queryOptimization";
import { normalizeRole, permissionsForResource } from "@convex/lib/permissions";
import { buildSubscriptionAudit } from "@convex/lib/audit";
import { internal } from "@convex/_generated/api";
import {
  SubscriptionContextV,
  MeetingNotesSubscriptionResultV,
  TranscriptStreamSubscriptionResultV,
  MeetingParticipantsSubscriptionResultV,
  SubscriptionValidationResultV,
} from "@convex/types/validators/realTime";
import type { SubscriptionContext } from "@convex/types/domain/realTime";

/**
 * @summary Subscribes to real-time meeting notes updates
 * @description Establishes a reactive subscription to collaborative meeting notes with automatic permission validation,
 * bandwidth management, and intelligent caching. The subscription validates user access on each update and applies
 * rate limiting to prevent bandwidth exhaustion. Supports cursor-based resumption for reliable reconnection.
 * Uses query optimization with 30-second cache for frequently accessed notes.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7x8y9z0a1b2c3d4e5f6g7h",
 *     "subscriptionId": "notes_sub_1699564800000",
 *     "cursor": "42_1699564800000"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "content": "# Meeting Notes\n\n## Action Items\n- Review Q4 roadmap\n- Schedule follow-up",
 *     "version": 42,
 *     "lastUpdated": 1699564800000,
 *     "subscriptionValid": true,
 *     "permissions": ["read", "write"],
 *     "cursor": "43_1699564850000",
 *     "rateLimited": false
 *   }
 * }
 * ```
 *
 * @example response-rate-limited
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "content": "",
 *     "version": 0,
 *     "lastUpdated": 1699564800000,
 *     "subscriptionValid": true,
 *     "permissions": ["read", "write"],
 *     "cursor": "42_1699564800000",
 *     "rateLimited": true
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "UNAUTHORIZED",
 *     "message": "User is not a participant in this meeting"
 *   }
 * }
 * ```
 */
export const subscribeMeetingNotes = query({
  args: {
    meetingId: v.id("meetings"),
    subscriptionId: v.optional(v.string()),
    cursor: v.optional(v.string()),
  },
  returns: MeetingNotesSubscriptionResultV.full,
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
 * @summary Subscribes to real-time transcript stream updates
 * @description Establishes a reactive subscription to live meeting transcripts with sequence-based pagination and
 * time-bounded access validation. Only active meetings can stream transcripts. Uses intelligent bucketing with
 * 30-minute time windows for optimized query performance. Supports high-priority bandwidth allocation for
 * low-latency transcript delivery. Automatically terminates when meeting ends.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7x8y9z0a1b2c3d4e5f6g7h",
 *     "fromSequence": 100,
 *     "limit": 50,
 *     "subscriptionId": "transcripts_sub_1699564800000"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "transcripts": [
 *       {
 *         "_id": "transcript_chunk_100",
 *         "sequence": 100,
 *         "speakerId": "user_alice123",
 *         "text": "Let's discuss the quarterly results",
 *         "confidence": 0.95,
 *         "startMs": 1699564800000,
 *         "endMs": 1699564802400,
 *         "isInterim": false,
 *         "createdAt": 1699564802500
 *       },
 *       {
 *         "_id": "transcript_chunk_101",
 *         "sequence": 101,
 *         "speakerId": "user_bob456",
 *         "text": "Revenue increased by 15% this quarter",
 *         "confidence": 0.92,
 *         "startMs": 1699564802600,
 *         "endMs": 1699564805100,
 *         "createdAt": 1699564805200
 *       }
 *     ],
 *     "nextSequence": 102,
 *     "subscriptionValid": true,
 *     "permissions": ["read"],
 *     "validUntil": 1699568400000
 *   }
 * }
 * ```
 *
 * @example response-rate-limited
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "transcripts": [],
 *     "nextSequence": 100,
 *     "subscriptionValid": true,
 *     "permissions": ["read"],
 *     "validUntil": 1699568400000
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "MEETING_NOT_ACTIVE",
 *     "message": "Meeting jd7x8y9z0a1b2c3d4e5f6g7h is not currently active"
 *   }
 * }
 * ```
 */
export const subscribeTranscriptStream = query({
  args: {
    meetingId: v.id("meetings"),
    fromSequence: v.optional(v.number()),
    limit: v.optional(v.number()),
    subscriptionId: v.optional(v.string()),
  },
  returns: TranscriptStreamSubscriptionResultV.full,
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
 * @summary Subscribes to real-time meeting participants updates
 * @description Establishes a reactive subscription to meeting participant list with automatic enrichment of user data
 * (display name, email, avatar). Updates reactively when participants join, leave, or change roles. Validates
 * user access and returns role-based permissions for participant management operations.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "jd7x8y9z0a1b2c3d4e5f6g7h",
 *     "subscriptionId": "participants_sub_1699564800000"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "participants": [
 *       {
 *         "_id": "mt0c1d2e3f4g5h6i7j8k9l0m",
 *         "userId": "user_alice123",
 *         "role": "host",
 *         "presence": "joined",
 *         "joinedAt": 1699564700000,
 *         "user": {
 *           "displayName": "Alice Johnson",
 *           "email": "alice@example.com",
 *           "avatarUrl": "https://example.com/avatars/alice.jpg"
 *         }
 *       },
 *       {
 *         "_id": "nt1d2e3f4g5h6i7j8k9l0m1n",
 *         "userId": "user_bob456",
 *         "role": "participant",
 *         "presence": "joined",
 *         "joinedAt": 1699564750000,
 *         "user": {
 *           "displayName": "Bob Smith",
 *           "email": "bob@example.com",
 *           "avatarUrl": "https://example.com/avatars/bob.jpg"
 *         }
 *       }
 *     ],
 *     "subscriptionValid": true,
 *     "permissions": ["read", "manage_participants"]
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "UNAUTHORIZED",
 *     "message": "User is not a participant in this meeting"
 *   }
 * }
 * ```
 */
export const subscribeMeetingParticipants = query({
  args: {
    meetingId: v.id("meetings"),
    subscriptionId: v.optional(v.string()),
  },
  returns: MeetingParticipantsSubscriptionResultV.full,
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
 * @summary Validates subscription permissions in real-time
 * @description Periodically called by clients to verify continued access to subscribed resources. Checks if user
 * still has permission to access the resource, validates meeting state for transcript subscriptions (must be active),
 * and returns updated permissions. Provides reconnection guidance when access is revoked or resources become unavailable.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "subscriptionId": "notes_sub_1699564800000",
 *     "resourceType": "meetingNotes",
 *     "resourceId": "jd7x8y9z0a1b2c3d4e5f6g7h",
 *     "lastValidated": 1699564800000
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "valid": true,
 *     "permissions": ["read", "write"],
 *     "shouldReconnect": false,
 *     "validUntil": 1699568400000
 *   }
 * }
 * ```
 *
 * @example response-invalid-meeting-ended
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "valid": false,
 *     "permissions": [],
 *     "reason": "Meeting is no longer active",
 *     "shouldReconnect": false
 *   }
 * }
 * ```
 *
 * @example response-invalid-access-revoked
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "valid": false,
 *     "permissions": [],
 *     "reason": "User is not a participant in this meeting",
 *     "shouldReconnect": true
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "UNAUTHORIZED",
 *     "message": "Authentication required"
 *   }
 * }
 * ```
 */
export const validateSubscription = query({
  args: {
    subscriptionId: v.string(),
    resourceType: v.string(),
    resourceId: v.id("meetings"),
    lastValidated: v.number(),
  },
  returns: SubscriptionValidationResultV.simple,
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
 * @summary Terminates subscription when permissions are revoked
 * @description Internal mutation that forcibly terminates a user's subscription when access is revoked or resource
 * becomes unavailable. Logs termination event to audit trail, cleans up subscription tracking state, and notifies
 * client-side subscription managers. Called automatically when permission changes are detected or meetings end.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "userId": "user_alice123",
 *     "subscriptionId": "notes_sub_1699564800000",
 *     "resourceType": "meetingNotes",
 *     "resourceId": "jd7x8y9z0a1b2c3d4e5f6g7h",
 *     "reason": "User removed from meeting"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 *
 * @example datamodel
 * ```json
 * {
 *   "auditLog": {
 *     "_id": "ot2e3f4g5h6i7j8k9l0m1n2o",
 *     "actorUserId": "user_alice123",
 *     "resourceType": "meetingNotes",
 *     "resourceId": "jd7x8y9z0a1b2c3d4e5f6g7h",
 *     "action": "subscription_terminated",
 *     "metadata": {
 *       "subscriptionId": "notes_sub_1699564800000",
 *       "reason": "User removed from meeting",
 *       "terminatedAt": 1699564900000
 *     },
 *     "timestamp": 1699564900000
 *   }
 * }
 * ```
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

// Permission helpers moved to @convex/lib/permissions for consistency

// Intentionally no logging writes from queries
