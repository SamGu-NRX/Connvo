/**
 * Messaging Validators
 *
 * This module provides Convex validators that correspond to the Messaging entity types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper validator patterns for messaging systems
 */

import { v } from "convex/values";
import type {
  Message,
  MessageWithUser,
  MessageThread,
  ChatStats,
  MessageSearchResult,
  MessageModeration,
  ChatExport,
  ChatEvent,
  ChatPreferences,
  Attachment,
} from "../entities/messaging";

// Attachment validator (matches lib/validators.ts exactly)
const attachmentV = v.object({
  kind: v.union(v.literal("file"), v.literal("url"), v.literal("image")),
  url: v.string(),
  name: v.optional(v.string()),
  size: v.optional(v.number()),
  contentType: v.optional(v.string()),
});

// Core Message validators (matches schema exactly)
export const MessageV = {
  // Full message entity
  full: v.object({
    _id: v.id("messages"),
    _creationTime: v.number(), // Convex system field
    meetingId: v.id("meetings"),
    userId: v.optional(v.id("users")), // Optional for system messages
    content: v.string(),
    attachments: v.optional(v.array(attachmentV)),
    timestamp: v.number(),
  }),

  // Message with user details
  withUser: v.object({
    _id: v.id("messages"),
    _creationTime: v.number(), // Convex system field
    meetingId: v.id("meetings"),
    userId: v.optional(v.id("users")),
    content: v.string(),
    attachments: v.optional(v.array(attachmentV)),
    timestamp: v.number(),
    user: v.optional(
      v.object({
        _id: v.id("users"),
        displayName: v.optional(v.string()),
        avatarUrl: v.optional(v.string()),
      }),
    ),
    isSystemMessage: v.boolean(),
  }),
} as const;

// Message Thread validators
export const MessageThreadV = {
  full: v.object({
    messages: v.array(MessageV.withUser),
    startTime: v.number(),
    endTime: v.number(),
    participantCount: v.number(),
    totalMessages: v.number(),
  }),
} as const;

// Chat Statistics validators
export const ChatStatsV = {
  full: v.object({
    meetingId: v.id("meetings"),
    totalMessages: v.number(),
    messagesByUser: v.record(v.string(), v.number()),
    averageMessageLength: v.number(),
    attachmentCount: v.number(),
    attachmentsByType: v.record(v.string(), v.number()), // AttachmentKind -> count
    mostActiveHour: v.number(),
    messageFrequency: v.array(
      v.object({
        timestamp: v.number(),
        count: v.number(),
      }),
    ),
  }),
} as const;

// Message Search Result validators
export const MessageSearchResultV = {
  full: v.object({
    message: MessageV.withUser,
    relevanceScore: v.number(),
    matchedFields: v.array(v.string()),
    snippet: v.optional(v.string()),
    context: v.optional(
      v.object({
        before: v.array(MessageV.withUser),
        after: v.array(MessageV.withUser),
      }),
    ),
  }),
} as const;

// Message Moderation validators
export const MessageModerationV = {
  full: v.object({
    messageId: v.id("messages"),
    flaggedBy: v.optional(v.id("users")),
    reason: v.union(
      v.literal("spam"),
      v.literal("inappropriate"),
      v.literal("harassment"),
      v.literal("off-topic"),
      v.literal("other"),
    ),
    description: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("removed"),
      v.literal("warned"),
    ),
    moderatedBy: v.optional(v.id("users")),
    moderatedAt: v.optional(v.number()),
    createdAt: v.number(),
  }),
} as const;

// Chat Export validators
export const ChatExportV = {
  full: v.object({
    meetingId: v.id("meetings"),
    format: v.union(
      v.literal("txt"),
      v.literal("html"),
      v.literal("json"),
      v.literal("csv"),
    ),
    content: v.string(),
    metadata: v.object({
      totalMessages: v.number(),
      participantCount: v.number(),
      timeRange: v.object({
        start: v.number(),
        end: v.number(),
      }),
      exportedAt: v.number(),
      exportedBy: v.id("users"),
    }),
  }),
} as const;

// Chat Event validators
export const ChatEventV = {
  full: v.object({
    type: v.union(
      v.literal("message_sent"),
      v.literal("message_edited"),
      v.literal("message_deleted"),
      v.literal("user_typing"),
      v.literal("user_stopped_typing"),
    ),
    meetingId: v.id("meetings"),
    userId: v.optional(v.id("users")),
    messageId: v.optional(v.id("messages")),
    data: v.optional(v.any()),
    timestamp: v.number(),
  }),
} as const;

// Chat Preferences validators
export const ChatPreferencesV = {
  full: v.object({
    userId: v.id("users"),
    notifications: v.object({
      enabled: v.boolean(),
      mentions: v.boolean(),
      allMessages: v.boolean(),
      keywords: v.array(v.string()),
    }),
    display: v.object({
      showTimestamps: v.boolean(),
      showAvatars: v.boolean(),
      messageGrouping: v.boolean(),
      fontSize: v.union(
        v.literal("small"),
        v.literal("medium"),
        v.literal("large"),
      ),
    }),
    privacy: v.object({
      allowDirectMessages: v.boolean(),
      showOnlineStatus: v.boolean(),
    }),
    updatedAt: v.number(),
  }),
} as const;

/**
 * Aggregated export for messaging validators to maintain concise imports.
 */
export const MessagingV = {
  attachment: attachmentV,
  message: MessageV,
  thread: MessageThreadV,
  stats: ChatStatsV,
  searchResult: MessageSearchResultV,
  moderation: MessageModerationV,
  export: ChatExportV,
  event: ChatEventV,
  preferences: ChatPreferencesV,
} as const;
