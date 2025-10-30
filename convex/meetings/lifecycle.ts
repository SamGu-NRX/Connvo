/**
 * Enhanced Meeting Lifecycle Management
 *
 * This module implements comprehensive meeting lifecycle functions with
 * WebRTC integration, participant management, and real-time state tracking.
 * Designed for hybrid WebRTC (free tier) + GetStream (paid tier) architecture.
 *
 * Requirements: 6.1, 6.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex function patterns
 */

import { mutation, internalMutation } from "@convex/_generated/server";
import type { MutationCtx } from "@convex/_generated/server";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import {
  requireIdentity,
  assertMeetingAccess,
  assertOwnershipOrAdmin,
} from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { internal } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { withIdempotency, IdempotencyUtils } from "@convex/lib/idempotency";
import {
  sendAlert,
  trackMeetingEvent,
  AlertTemplates,
} from "@convex/lib/alerting";
import {
  withRetry,
  RetryPolicies,
  ResilienceUtils,
} from "@convex/lib/resilience";
import type {
  Meeting,
  VideoRoomConfig,
  ICEServer,
  VideoRoomFeatures,
} from "@convex/types/entities/meeting";
import type { User } from "@convex/types/entities/user";

/**
 * Creates a new meeting with comprehensive setup and hybrid video provider support.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "title": "Quarterly Planning Meeting",
 *     "description": "Planning the roadmap for next quarter objectives.",
 *     "scheduledAt": 1704067200000,
 *     "duration": 3600,
 *     "participantEmails": [
 *       "host@example.com",
 *       "participant@example.com"
 *     ],
 *     "recordingEnabled": false,
 *     "transcriptionEnabled": true,
 *     "meetingType": "small-group",
 *     "maxParticipants": 8
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
 *     "meetingId": "meeting_123example",
 *     "webrtcReady": true,
 *     "videoProvider": "webrtc",
 *     "features": {
 *       "recording": false,
 *       "transcription": true,
 *       "maxParticipants": 8
 *     }
 *   }
 * }
 * ```
 */
export const createMeeting = mutation({
  args: {
    organizerId: v.optional(v.id("users")),
    title: v.string(),
    description: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    duration: v.optional(v.number()),
    participantEmails: v.optional(v.array(v.string())),
    // Hybrid architecture options
    recordingEnabled: v.optional(v.boolean()),
    transcriptionEnabled: v.optional(v.boolean()),
    maxParticipants: v.optional(v.number()),
    // Meeting type affects provider selection
    meetingType: v.optional(
      v.union(
        v.literal("one-on-one"),
        v.literal("small-group"),
        v.literal("large-meeting"),
        v.literal("webinar"),
      ),
    ),
  },
  returns: v.object({
    meetingId: v.id("meetings"),
    webrtcReady: v.boolean(),
    videoProvider: v.union(v.literal("webrtc"), v.literal("getstream")),
    features: v.object({
      recording: v.boolean(),
      transcription: v.boolean(),
      maxParticipants: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const rawIdentity = await ctx.auth.getUserIdentity();
    const identity = rawIdentity ? await requireIdentity(ctx) : null;
    let organizer: User | null = null;

    try {
      // Validate input
      if (args.title.trim().length === 0) {
        throw createError.validation("Meeting title cannot be empty");
      }

      if (args.scheduledAt && args.scheduledAt < Date.now()) {
        throw createError.validation("Cannot schedule meeting in the past");
      }

      if (args.maxParticipants && args.maxParticipants < 1) {
        throw createError.validation("Maximum participants must be at least 1");
      }

      if (identity) {
        organizer = await ctx.db
          .query("users")
          .withIndex("by_workos_id", (q) =>
            q.eq("workosUserId", identity.workosUserId),
          )
          .unique();

        if (!organizer) {
          const userId = await ctx.db.insert("users", {
            workosUserId: identity.workosUserId,
            email: identity.email || "",
            orgId: identity.orgId ?? undefined,
            orgRole: identity.orgRole ?? undefined,
            displayName: identity.name ?? undefined,
            isActive: true,
            lastSeenAt: Date.now(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          organizer = await ctx.db.get(userId);
          if (!organizer) throw createError.notFound("User");
        }
      } else {
        if (!args.organizerId) {
          throw createError.unauthorized(
            "Unauthenticated meeting creation requires organizerId",
          );
        }
        organizer = await ctx.db.get(args.organizerId);
        if (!organizer) {
          throw createError.notFound("User", args.organizerId);
        }
      }

      const now = Date.now();

      // Determine video provider and features based on user plan and meeting requirements
      const maxParticipants = args.maxParticipants || 10;
      const recordingEnabled = args.recordingEnabled || false;
      const transcriptionEnabled = args.transcriptionEnabled || true; // Free tier gets transcription

      // Provider selection logic (hybrid architecture)
      // Free tier: WebRTC for small meetings, transcription enabled, no recording
      // Paid tier: GetStream for large meetings, recording enabled
      if (!organizer) {
        throw createError.internal("Organizer resolution failed");
      }

      const userPlan =
        identity?.orgRole === "admin" || organizer.orgRole === "admin"
          ? "paid"
          : "free";
      const isLargeMeeting =
        maxParticipants > 4 ||
        args.meetingType === "large-meeting" ||
        args.meetingType === "webinar";

      let videoProvider: "webrtc" | "getstream";
      let finalRecordingEnabled: boolean;
      let finalTranscriptionEnabled: boolean;
      let finalMaxParticipants: number;

      if (userPlan === "paid" && (isLargeMeeting || recordingEnabled)) {
        // Use GetStream for paid tier with advanced features
        videoProvider = "getstream";
        finalRecordingEnabled = recordingEnabled;
        finalTranscriptionEnabled = transcriptionEnabled;
        finalMaxParticipants = Math.min(maxParticipants, 100); // GetStream limit
      } else {
        // Use WebRTC for free tier
        videoProvider = "webrtc";
        finalRecordingEnabled = false; // No recording on free tier
        finalTranscriptionEnabled = transcriptionEnabled; // Free tier gets transcription
        finalMaxParticipants = Math.min(maxParticipants, 4); // WebRTC practical limit
      }

      // Create meeting with provider-specific configuration
      const meetingId = await ctx.db.insert("meetings", {
        organizerId: organizer._id,
        title: args.title.trim(),
        description: args.description?.trim(),
        scheduledAt: args.scheduledAt,
        duration: args.duration || 1800000, // Default 30 minutes in ms
        webrtcEnabled: videoProvider === "webrtc",
        state: "scheduled",
        participantCount: 1, // Organizer
        createdAt: now,
        updatedAt: now,
      });

      // Add organizer as host participant
      await ctx.db.insert("meetingParticipants", {
        meetingId,
        userId: organizer._id,
        role: "host",
        presence: "invited",
        createdAt: now,
      });

      // Create initial meeting state with provider-specific settings
      await ctx.db.insert("meetingState", {
        meetingId,
        active: false,
        topics: [],
        recordingEnabled: finalRecordingEnabled,
        updatedAt: now,
      });

      // Create initial empty notes
      await ctx.db.insert("meetingNotes", {
        meetingId,
        content: "",
        version: 0,
        lastRebasedAt: now,
        updatedAt: now,
      });

      // Provider-specific initialization
      let webrtcReady = false;
      if (videoProvider === "webrtc") {
        // WebRTC is always ready - no external service needed
        webrtcReady = true;
      } else {
        // GetStream room will be created when meeting starts
        webrtcReady = false;
        // TODO: Schedule GetStream room creation for immediate meetings
        if (!args.scheduledAt || args.scheduledAt <= Date.now() + 300000) {
          // Schedule GetStream room creation
          try {
            await ctx.scheduler.runAfter(
              0,
              internal.meetings.stream.index.createStreamRoom,
              { meetingId },
            );
          } catch (error) {
            console.warn("Failed to schedule GetStream room creation:", error);
          }
        }
      }

      // Track successful meeting creation
      const duration = Date.now() - startTime;
      await trackMeetingEvent(ctx, {
        meetingId,
        event: "meeting_created",
        userId: organizer._id,
        duration,
        success: true,
        metadata: {
          videoProvider,
          participantCount: 1,
          recordingEnabled: finalRecordingEnabled,
          transcriptionEnabled: finalTranscriptionEnabled,
        },
      });

      return {
        meetingId,
        webrtcReady,
        videoProvider,
        features: {
          recording: finalRecordingEnabled,
          transcription: finalTranscriptionEnabled,
          maxParticipants: finalMaxParticipants,
        },
      };
    } catch (error) {
      // Track failed meeting creation
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Don't track validation errors as they're user errors
      if (!errorMessage.includes("validation")) {
        await trackMeetingEvent(ctx, {
          meetingId: "unknown" as Id<"meetings">,
          event: "meeting_creation_failed",
          userId:
            organizer?._id ?? args.organizerId ?? ("unknown" as Id<"users">),
          duration,
          success: false,
          error: errorMessage,
          metadata: {
            title: args.title,
            scheduledAt: args.scheduledAt,
            maxParticipants: args.maxParticipants,
          },
        });

        // Send critical alert for system failures
        if (
          !errorMessage.includes("validation") &&
          !errorMessage.includes("not found")
        ) {
          await sendAlert(
            ctx,
            AlertTemplates.meetingCreationFailed("unknown", errorMessage),
          );
        }
      }

      throw error;
    }
  },
});

/**
 * Adds a participant to a meeting with proper validation and role management
 *
 * @summary Adds a participant to a meeting
 * @description Adds a new participant to an existing meeting with the specified role.
 * Only the meeting host can add participants. Validates that the user exists and is not
 * already a participant. Cannot add participants to concluded or cancelled meetings.
 * Updates the meeting's participant count automatically.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example",
 *     "userId": "user_456example",
 *     "role": "participant"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "participantId": "participant_789example",
 *     "success": true
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "User is already a participant in this meeting",
 *   "errorData": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "User is already a participant in this meeting"
 *   }
 * }
 * ```
 */
export const addParticipant = mutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    role: v.union(
      v.literal("host"),
      v.literal("co-host"),
      v.literal("participant"),
      v.literal("observer"),
    ),
  },
  returns: v.object({
    participantId: v.id("meetingParticipants"),
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId, userId, role }) => {
    // Verify user has permission to add participants (host only)
    const currentParticipant = await assertMeetingAccess(ctx, meetingId);
    if (currentParticipant.role !== "host") {
      throw createError.insufficientPermissions(
        "host",
        currentParticipant.role,
      );
    }

    // Check if user is already a participant
    const existingParticipant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", userId),
      )
      .unique();

    if (existingParticipant) {
      throw createError.validation(
        "User is already a participant in this meeting",
      );
    }

    // Verify target user exists
    const targetUser = await ctx.db.get(userId);
    if (!targetUser) {
      throw createError.notFound("User", userId);
    }

    // Verify meeting exists and is not concluded
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state === "concluded" || meeting.state === "cancelled") {
      throw createError.validation(
        "Cannot add participants to concluded or cancelled meeting",
      );
    }

    // Add participant
    const participantId = await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId,
      role: role === "co-host" ? "participant" : role, // Map co-host to participant for now
      presence: "invited",
      createdAt: Date.now(),
    });

    // Update participant count
    await ctx.db.patch(meetingId, {
      participantCount: (meeting.participantCount || 0) + 1,
      updatedAt: Date.now(),
    });

    return {
      participantId,
      success: true,
    };
  },
});

/**
 * Adds multiple participants to a meeting (bulk operation)
 *
 * @summary Adds multiple participants to a meeting in bulk
 * @description Adds multiple participants to an existing meeting in a single operation.
 * Only the meeting host can add participants. Validates each user and skips those who
 * are already participants or don't exist. Returns lists of successfully added participants
 * and skipped entries with reasons. Updates the meeting's participant count automatically.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example",
 *     "participants": [
 *       {
 *         "userId": "user_456example",
 *         "role": "participant"
 *       },
 *       {
 *         "userId": "user_789example",
 *         "role": "participant"
 *       },
 *       {
 *         "userId": "user_012example",
 *         "role": "observer"
 *       }
 *     ]
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "added": [
 *       "participant_456example",
 *       "participant_789example"
 *     ],
 *     "skipped": [
 *       {
 *         "userId": "user_012example",
 *         "reason": "User not found"
 *       }
 *     ],
 *     "success": true
 *   }
 * }
 * ```
 */
export const addMultipleParticipants = mutation({
  args: {
    meetingId: v.id("meetings"),
    participants: v.array(
      v.object({
        userId: v.id("users"),
        role: v.union(
          v.literal("host"),
          v.literal("co-host"),
          v.literal("participant"),
          v.literal("observer"),
        ),
      }),
    ),
  },
  returns: v.object({
    added: v.array(v.id("meetingParticipants")),
    skipped: v.array(
      v.object({
        userId: v.id("users"),
        reason: v.string(),
      }),
    ),
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId, participants }) => {
    // Verify user has permission to add participants (host only)
    const currentParticipant = await assertMeetingAccess(ctx, meetingId);
    if (currentParticipant.role !== "host") {
      throw createError.insufficientPermissions(
        "host",
        currentParticipant.role,
      );
    }

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state === "concluded" || meeting.state === "cancelled") {
      throw createError.validation(
        "Cannot add participants to concluded or cancelled meeting",
      );
    }

    const added: Id<"meetingParticipants">[] = [];
    const skipped: Array<{ userId: Id<"users">; reason: string }> = [];

    for (const participant of participants) {
      try {
        // Check if user is already a participant
        const existingParticipant = await ctx.db
          .query("meetingParticipants")
          .withIndex("by_meeting_and_user", (q) =>
            q.eq("meetingId", meetingId).eq("userId", participant.userId),
          )
          .unique();

        if (existingParticipant) {
          skipped.push({
            userId: participant.userId,
            reason: "Already a participant",
          });
          continue;
        }

        // Verify target user exists
        const targetUser = await ctx.db.get(participant.userId);
        if (!targetUser) {
          skipped.push({
            userId: participant.userId,
            reason: "User not found",
          });
          continue;
        }

        // Add participant
        const participantId = await ctx.db.insert("meetingParticipants", {
          meetingId,
          userId: participant.userId,
          role:
            participant.role === "co-host" ? "participant" : participant.role,
          presence: "invited",
          createdAt: Date.now(),
        });

        added.push(participantId);
      } catch (error) {
        skipped.push({
          userId: participant.userId,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Update participant count
    if (added.length > 0) {
      await ctx.db.patch(meetingId, {
        participantCount: (meeting.participantCount || 0) + added.length,
        updatedAt: Date.now(),
      });
    }

    return {
      added,
      skipped,
      success: true,
    };
  },
});

/**
 * Removes a participant from a meeting
 *
 * @summary Removes a participant from a meeting
 * @description Removes a participant from an existing meeting. Only the meeting host
 * can remove participants. Cannot remove the only host from a meeting. Updates the
 * meeting's participant count automatically.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example",
 *     "userId": "user_456example"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": null
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Cannot remove the only host from the meeting",
 *   "errorData": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Cannot remove the only host from the meeting"
 *   }
 * }
 * ```
 */
export const removeParticipant = mutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId }) => {
    // Verify user has permission to remove participants (host only)
    const currentParticipant = await assertMeetingAccess(
      ctx,
      meetingId,
      "host",
    );
    const identity = await requireIdentity(ctx);

    // Cannot remove self if you're the only host
    if (identity.userId === userId) {
      const hosts = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting_and_role", (q) =>
          q.eq("meetingId", meetingId).eq("role", "host"),
        )
        .collect();

      if (hosts.length === 1) {
        throw createError.validation(
          "Cannot remove the only host from the meeting",
        );
      }
    }

    // Find and remove participant
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", userId),
      )
      .unique();

    if (!participant) {
      throw createError.notFound("Participant not found in meeting");
    }

    await ctx.db.delete(participant._id);

    // Update participant count
    const meeting = await ctx.db.get(meetingId);
    if (meeting) {
      await ctx.db.patch(meetingId, {
        participantCount: Math.max(0, (meeting.participantCount || 1) - 1),
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Updates participant role with validation
 *
 * @summary Updates a participant's role in a meeting
 * @description Changes a participant's role (host or participant) in a meeting.
 * Only the meeting host can update roles. Cannot demote the only host to participant.
 * Useful for promoting participants to co-hosts or demoting hosts.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example",
 *     "userId": "user_456example",
 *     "newRole": "host"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": null
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Cannot demote the only host",
 *   "errorData": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Cannot demote the only host"
 *   }
 * }
 * ```
 */
export const updateParticipantRole = mutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    newRole: v.union(v.literal("host"), v.literal("participant")),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, userId, newRole }) => {
    // Verify user has permission to change roles (host only)
    await assertMeetingAccess(ctx, meetingId, "host");
    const identity = await requireIdentity(ctx);

    // Find participant
    const participant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", meetingId).eq("userId", userId),
      )
      .unique();

    if (!participant) {
      throw createError.notFound("Participant not found in meeting");
    }

    const oldRole = participant.role;

    // Cannot demote self if you're the only host
    if (
      identity.userId === userId &&
      oldRole === "host" &&
      newRole === "participant"
    ) {
      const hosts = await ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting_and_role", (q) =>
          q.eq("meetingId", meetingId).eq("role", "host"),
        )
        .collect();

      if (hosts.length === 1) {
        throw createError.validation("Cannot demote the only host");
      }
    }

    // Update role
    await ctx.db.patch(participant._id, {
      role: newRole,
    });

    return null;
  },
});

/**
 * Starts a meeting and activates real-time features with hybrid provider support
 *
 * @summary Starts a meeting and activates real-time features
 * @description Transitions a scheduled meeting to active state and initializes video
 * infrastructure. Supports hybrid architecture: WebRTC for free tier (up to 4 participants)
 * and GetStream for paid tier (up to 100 participants with recording). Only the meeting
 * host can start meetings. Provides ICE server configuration for WebRTC or schedules
 * GetStream room creation. Automatically initializes transcription services.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "success": true,
 *     "webrtcReady": true,
 *     "videoProvider": "webrtc",
 *     "roomInfo": {
 *       "iceServers": [
 *         {
 *           "urls": "stun:stun.l.google.com:19302"
 *         },
 *         {
 *           "urls": "stun:stun1.l.google.com:19302"
 *         }
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Meeting is already active",
 *   "errorData": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Meeting is already active"
 *   }
 * }
 * ```
 */
export const startMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
    webrtcReady: v.boolean(),
    videoProvider: v.union(v.literal("webrtc"), v.literal("getstream")),
    roomInfo: v.optional(
      v.object({
        roomId: v.optional(v.string()),
        iceServers: v.optional(
          v.array(
            v.object({
              urls: v.union(v.string(), v.array(v.string())),
              username: v.optional(v.string()),
              credential: v.optional(v.string()),
            }),
          ),
        ),
      }),
    ),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user has permission to start meeting (host only)
    await assertMeetingAccess(ctx, meetingId, "host");

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state === "active") {
      throw createError.validation("Meeting is already active");
    }

    if (meeting.state === "concluded" || meeting.state === "cancelled") {
      throw createError.validation(
        "Cannot start a concluded or cancelled meeting",
      );
    }

    const now = Date.now();

    // Update meeting state
    await ctx.db.patch(meetingId, {
      state: "active",
      updatedAt: now,
    });

    // Update meeting state record
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        active: true,
        startedAt: now,
        updatedAt: now,
      });
    }

    // Determine video provider and initialize accordingly
    const videoProvider = meeting.webrtcEnabled
      ? ("webrtc" as const)
      : ("getstream" as const);
    let webrtcReady = false;
    let roomInfo: any = undefined;

    if (videoProvider === "webrtc") {
      // WebRTC signaling is ready - no external service needed
      webrtcReady = true;

      // Provide STUN/TURN server configuration for WebRTC
      const iceServers: ICEServer[] = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        // Add TURN servers if configured
        ...(process.env.TURN_SERVER_URL
          ? [
              {
                urls: process.env.TURN_SERVER_URL,
                username: process.env.TURN_USERNAME || "",
                credential: process.env.TURN_CREDENTIAL || "",
              },
            ]
          : []),
      ];

      roomInfo = {
        iceServers,
      };
    } else {
      // GetStream provider - create room if not exists
      try {
        // Schedule GetStream room creation
        await ctx.scheduler.runAfter(
          0,
          internal.meetings.stream.index.createStreamRoom,
          { meetingId },
        );
        webrtcReady = false; // Will be ready after room creation
      } catch (error) {
        console.warn("Failed to create GetStream room:", error);
        // Fallback to WebRTC if GetStream fails
        await ctx.db.patch(meetingId, {
          webrtcEnabled: true,
          updatedAt: now,
        });
        webrtcReady = true;
        const fallbackIceServers: ICEServer[] = [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ];
        roomInfo = {
          iceServers: fallbackIceServers,
        };
      }
    }

    // Schedule transcription initialization if enabled
    if (meetingState?.recordingEnabled || true) {
      // Free tier gets transcription
      try {
        await ctx.scheduler.runAfter(
          1000, // 1 second delay
          internal.transcripts.initialization.initializeTranscription,
          { meetingId },
        );
      } catch (error) {
        console.warn("Failed to initialize transcription:", error);
      }
    }

    return {
      success: true,
      webrtcReady,
      videoProvider,
      roomInfo,
    };
  },
});

/**
 * Ends a meeting and triggers cleanup
 *
 * @summary Ends an active meeting
 * @description Transitions an active meeting to concluded state and triggers post-meeting
 * processing. Only the meeting host can end meetings. Calculates meeting duration and
 * schedules cleanup tasks including insights generation, recording processing, and
 * resource cleanup. Can only end meetings that are currently active.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "success": true,
 *     "duration": 3600000
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Can only end active meetings",
 *   "errorData": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Can only end active meetings"
 *   }
 * }
 * ```
 */
export const endMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
    duration: v.optional(v.number()),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user has permission to end meeting (host only)
    await assertMeetingAccess(ctx, meetingId, "host");

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state !== "active") {
      throw createError.validation("Can only end active meetings");
    }

    const now = Date.now();

    // Update meeting state
    await ctx.db.patch(meetingId, {
      state: "concluded",
      updatedAt: now,
    });

    // Update meeting state record and calculate duration
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    let duration: number | undefined;
    if (meetingState) {
      duration = meetingState.startedAt
        ? now - meetingState.startedAt
        : undefined;
      await ctx.db.patch(meetingState._id, {
        active: false,
        endedAt: now,
        updatedAt: now,
      });
    }

    // Schedule post-meeting processing
    try {
      await ctx.scheduler.runAfter(
        0,
        internal.meetings.postProcessing.handleMeetingEnd,
        { meetingId, endedAt: now },
      );
    } catch (error) {
      console.warn("Failed to schedule post-meeting processing:", error);
    }

    return {
      success: true,
      duration,
    };
  },
});

/**
 * Gets meeting connection information for participants
 *
 * @summary Gets meeting connection information for video calling
 * @description Retrieves connection details needed for participants to join the video call.
 * Provides different information based on video provider: ICE servers for WebRTC or
 * GetStream room ID for paid tier. Includes feature flags for recording, transcription,
 * and participant limits. Only available for active meetings.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "success": true,
 *     "videoProvider": "webrtc",
 *     "connectionInfo": {
 *       "roomId": "webrtc_meeting_123example",
 *       "iceServers": [
 *         {
 *           "urls": "stun:stun.l.google.com:19302"
 *         },
 *         {
 *           "urls": "stun:stun1.l.google.com:19302"
 *         }
 *       ]
 *     },
 *     "features": {
 *       "recording": false,
 *       "transcription": true,
 *       "maxParticipants": 4
 *     }
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Meeting is not active",
 *   "errorData": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Meeting is not active"
 *   }
 * }
 * ```
 */
export const getMeetingConnectionInfo = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
    videoProvider: v.union(v.literal("webrtc"), v.literal("getstream")),
    connectionInfo: v.object({
      roomId: v.optional(v.string()),
      iceServers: v.optional(
        v.array(
          v.object({
            urls: v.union(v.string(), v.array(v.string())),
            username: v.optional(v.string()),
            credential: v.optional(v.string()),
          }),
        ),
      ),
      streamToken: v.optional(v.string()),
    }),
    features: v.object({
      recording: v.boolean(),
      transcription: v.boolean(),
      maxParticipants: v.number(),
    }),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state !== "active") {
      throw createError.validation("Meeting is not active");
    }

    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    // Determine video provider and connection info
    const videoProvider = meeting.webrtcEnabled
      ? ("webrtc" as const)
      : ("getstream" as const);
    let connectionInfo: any = {};

    if (videoProvider === "webrtc") {
      // WebRTC connection info
      const iceServers: ICEServer[] = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        // Add TURN servers if configured
        ...(process.env.TURN_SERVER_URL
          ? [
              {
                urls: process.env.TURN_SERVER_URL,
                username: process.env.TURN_USERNAME || "",
                credential: process.env.TURN_CREDENTIAL || "",
              },
            ]
          : []),
      ];

      connectionInfo = {
        roomId: `webrtc_${meetingId}`,
        iceServers,
      };
    } else {
      // GetStream connection info
      // TODO: Generate GetStream token for participant
      connectionInfo = {
        roomId: meeting.streamRoomId,
        streamToken: undefined, // Will be generated by GetStream action
      };
    }

    return {
      success: true,
      videoProvider,
      connectionInfo,
      features: {
        recording: meetingState?.recordingEnabled || false,
        transcription: true, // Always enabled for free tier
        maxParticipants: meeting.webrtcEnabled ? 4 : 100,
      },
    };
  },
});

/**
 * Handles participant joining (presence update)
 *
 * @summary Updates participant presence to joined
 * @description Updates a participant's presence status to "joined" when they enter
 * the meeting. Records the join timestamp. Only available for active meetings.
 * Participants must be invited to the meeting before joining.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "success": true,
 *     "webrtcReady": true
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Cannot join inactive meeting",
 *   "errorData": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Cannot join inactive meeting"
 *   }
 * }
 * ```
 */
export const joinMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
    webrtcReady: v.boolean(),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state !== "active") {
      throw createError.validation("Cannot join inactive meeting");
    }

    const now = Date.now();

    // Update participant presence
    await ctx.db.patch(participant._id, {
      presence: "joined",
      joinedAt: now,
    });

    // WebRTC doesn't need tokens - direct peer-to-peer connection
    const webrtcReady = true;

    return {
      success: true,
      webrtcReady,
    };
  },
});

/**
 * Handles participant leaving (presence update)
 *
 * @summary Updates participant presence to left
 * @description Updates a participant's presence status to "left" when they exit
 * the meeting. Records the leave timestamp. Does not remove the participant from
 * the meeting - they can rejoin if the meeting is still active.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "success": true
 *   }
 * }
 * ```
 */
export const leaveMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, { meetingId }) => {
    // Verify user is a participant
    const participant = await assertMeetingAccess(ctx, meetingId);

    const now = Date.now();

    // Update participant presence
    await ctx.db.patch(participant._id, {
      presence: "left",
      leftAt: now,
    });

    return {
      success: true,
    };
  },
});

/**
 * Cancels a scheduled meeting
 *
 * @summary Cancels a scheduled meeting
 * @description Transitions a scheduled meeting to cancelled state. Only the meeting
 * host can cancel meetings. Cannot cancel active meetings (must end them instead).
 * Cannot cancel meetings that are already concluded or cancelled.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": null
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Cannot cancel active meeting - end it instead",
 *   "errorData": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Cannot cancel active meeting - end it instead"
 *   }
 * }
 * ```
 */
export const cancelMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    // Verify user has permission to cancel meeting (host only)
    await assertMeetingAccess(ctx, meetingId, "host");

    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw createError.notFound("Meeting", meetingId);
    }

    if (meeting.state === "active") {
      throw createError.validation(
        "Cannot cancel active meeting - end it instead",
      );
    }

    if (meeting.state === "concluded" || meeting.state === "cancelled") {
      throw createError.validation("Meeting is already concluded or cancelled");
    }

    // Update meeting state
    await ctx.db.patch(meetingId, {
      state: "cancelled",
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Internal mutation to update meeting with Stream room ID
 */
export const updateStreamRoomId = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    streamRoomId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, streamRoomId }): Promise<null> => {
    await ctx.db.patch(meetingId, {
      streamRoomId,
      updatedAt: Date.now(),
    });
    return null;
  },
});
