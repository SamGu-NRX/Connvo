/**
 * Real-time Domain Validators
 *
 * This module provides Convex validators for real-time operations, subscriptions,
 * and presence tracking.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper validator patterns for real-time systems
 */

import { v } from "convex/values";
import type { RealtimeSubscription, UserPresence } from "../domain/realTime";

// Real-time subscription validators
export const RealtimeSubscriptionV = {
  full: v.object({
    _id: v.id("subscriptions"),
    userId: v.id("users"),
    resourceType: v.union(
      v.literal("meeting"),
      v.literal("user"),
      v.literal("transcript"),
      v.literal("note"),
    ),
    resourceId: v.string(),
    events: v.array(v.string()),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
} as const;

// User presence validators
export const UserPresenceV = {
  full: v.object({
    _id: v.id("presence"),
    userId: v.id("users"),
    status: v.union(
      v.literal("online"),
      v.literal("away"),
      v.literal("busy"),
      v.literal("offline"),
    ),
    lastSeen: v.number(),
    currentMeeting: v.optional(v.id("meetings")),
    metadata: v.optional(v.record(v.string(), v.any())),
  }),
} as const;

// Subscription context validators
export const SubscriptionContextV = {
  full: v.object({
    subscriptionId: v.string(),
    userId: v.id("users"),
    resourceType: v.string(),
    resourceId: v.string(),
    permissions: v.array(v.string()),
    connectionId: v.string(),
    establishedAt: v.number(),
    lastValidated: v.number(),
    validUntil: v.optional(v.number()),
  }),
} as const;

// Active subscription validators
export const ActiveSubscriptionV = {
  full: v.object({
    subscriptionId: v.string(),
    userId: v.id("users"),
    resourceType: v.string(),
    resourceId: v.string(),
    permissions: v.array(v.string()),
    establishedAt: v.number(),
    lastValidated: v.number(),
    validUntil: v.optional(v.number()),
    priority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("normal"),
      v.literal("low"),
    ),
  }),
} as const;

// Subscription validation result validators
export const SubscriptionValidationResultV = {
  full: v.object({
    valid: v.boolean(),
    permissions: v.array(v.string()),
    reason: v.optional(v.string()),
    shouldReconnect: v.boolean(),
    validUntil: v.optional(v.number()),
    rateLimited: v.boolean(),
    resourceType: v.string(),
    resourceId: v.string(),
  }),

  // Simplified version without rateLimited, resourceType, resourceId
  simple: v.object({
    valid: v.boolean(),
    permissions: v.array(v.string()),
    reason: v.optional(v.string()),
    shouldReconnect: v.boolean(),
    validUntil: v.optional(v.number()),
  }),
} as const;

// Subscription establishment result validators
export const SubscriptionEstablishmentResultV = {
  full: v.object({
    success: v.boolean(),
    subscriptionId: v.string(),
    permissions: v.array(v.string()),
    validUntil: v.optional(v.number()),
    rateLimited: v.boolean(),
  }),
} as const;

// Bulk termination result validators
export const BulkTerminationResultV = {
  full: v.object({
    terminatedCount: v.number(),
    subscriptionIds: v.array(v.string()),
  }),
} as const;

// Subscription statistics validators
export const SubscriptionStatsV = {
  full: v.object({
    totalActive: v.number(),
    byResourceType: v.record(v.string(), v.number()),
    byPriority: v.record(v.string(), v.number()),
    performanceStats: v.array(
      v.object({
        subscriptionId: v.string(),
        stats: v.object({
          durationMs: v.number(),
          updateCount: v.number(),
          avgLatency: v.number(),
          updatesPerSecond: v.number(),
          errors: v.number(),
          lastUpdate: v.number(),
          sloCompliant: v.boolean(),
        }),
      }),
    ),
  }),
} as const;

// Meeting notes subscription result validators
export const MeetingNotesSubscriptionResultV = {
  full: v.union(
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
} as const;

// Transcript stream subscription result validators
export const TranscriptStreamSubscriptionResultV = {
  full: v.object({
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
} as const;

// Meeting participants subscription result validators
export const MeetingParticipantsSubscriptionResultV = {
  full: v.object({
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
} as const;

// Batched operations result validators
export const BatchQueueResultV = {
  full: v.object({
    queued: v.boolean(),
    batchSize: v.number(),
  }),
} as const;

export const BatchNoteOperationResultV = {
  full: v.object({
    queued: v.boolean(),
    batchSize: v.number(),
    serverSequence: v.number(),
  }),
} as const;

export const BatchTranscriptProcessResultV = {
  full: v.object({
    inserted: v.number(),
    sequences: v.array(v.number()),
  }),
} as const;

export const BatchNoteProcessResultV = {
  full: v.object({
    processed: v.number(),
    newVersion: v.number(),
    conflicts: v.array(v.number()),
  }),
} as const;

export const BatchPresenceProcessResultV = {
  full: v.object({
    updated: v.number(),
  }),
} as const;

export const BatchStatsResultV = {
  full: v.object({
    transcripts: v.object({
      queueSize: v.number(),
    }),
    noteOps: v.object({
      queueSize: v.number(),
    }),
    presence: v.object({
      queueSize: v.number(),
    }),
  }),
} as const;

// Batch presence update validator
export const BatchPresenceUpdateV = {
  update: v.object({
    userId: v.id("users"),
    presence: v.union(v.literal("joined"), v.literal("left")),
    metadata: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
    timestamp: v.number(),
  }),
} as const;
