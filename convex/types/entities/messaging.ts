/**
 * Messaging Entity Type Definitions
 *
 * This module defines all messaging-related entity types for chat
 * and communication functionality within meetings.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper entity modeling for messaging systems
 */

import type { Id } from "../../_generated/dataModel";

// Attachment types (matches lib/validators.ts exactly)
export type AttachmentKind = "file" | "url" | "image";

export interface Attachment {
  kind: AttachmentKind;
  url: string;
  name?: string;
  size?: number;
  contentType?: string;
}

// Core Message entity (matches convex/schema/messaging.ts exactly)
export interface Message {
  _id: Id<"messages">;
  meetingId: Id<"meetings">;
  userId?: Id<"users">; // Optional for system messages
  content: string;
  attachments?: Attachment[];
  timestamp: number;
}

// Derived types for API responses

// Message with user details
export interface MessageWithUser extends Message {
  user?: {
    _id: Id<"users">;
    displayName?: string;
    avatarUrl?: string;
  };
  isSystemMessage: boolean;
}

// Message thread (for grouped messages)
export interface MessageThread {
  messages: MessageWithUser[];
  startTime: number;
  endTime: number;
  participantCount: number;
  totalMessages: number;
}

// Chat statistics
export interface ChatStats {
  meetingId: Id<"meetings">;
  totalMessages: number;
  messagesByUser: Record<string, number>;
  averageMessageLength: number;
  attachmentCount: number;
  attachmentsByType: Record<AttachmentKind, number>;
  mostActiveHour: number;
  messageFrequency: Array<{
    timestamp: number;
    count: number;
  }>;
}

// Message search result
export interface MessageSearchResult {
  message: MessageWithUser;
  relevanceScore: number;
  matchedFields: string[];
  snippet?: string;
  context?: {
    before: MessageWithUser[];
    after: MessageWithUser[];
  };
}

// Chat moderation
export interface MessageModeration {
  messageId: Id<"messages">;
  flaggedBy?: Id<"users">;
  reason: "spam" | "inappropriate" | "harassment" | "off-topic" | "other";
  description?: string;
  status: "pending" | "approved" | "removed" | "warned";
  moderatedBy?: Id<"users">;
  moderatedAt?: number;
  createdAt: number;
}

// Chat export
export interface ChatExport {
  meetingId: Id<"meetings">;
  format: "txt" | "html" | "json" | "csv";
  content: string;
  metadata: {
    totalMessages: number;
    participantCount: number;
    timeRange: {
      start: number;
      end: number;
    };
    exportedAt: number;
    exportedBy: Id<"users">;
  };
}

// Real-time chat events
export interface ChatEvent {
  type:
    | "message_sent"
    | "message_edited"
    | "message_deleted"
    | "user_typing"
    | "user_stopped_typing";
  meetingId: Id<"meetings">;
  userId?: Id<"users">;
  messageId?: Id<"messages">;
  data?: any;
  timestamp: number;
}

// Chat preferences
export interface ChatPreferences {
  userId: Id<"users">;
  notifications: {
    enabled: boolean;
    mentions: boolean;
    allMessages: boolean;
    keywords: string[];
  };
  display: {
    showTimestamps: boolean;
    showAvatars: boolean;
    messageGrouping: boolean;
    fontSize: "small" | "medium" | "large";
  };
  privacy: {
    allowDirectMessages: boolean;
    showOnlineStatus: boolean;
  };
  updatedAt: number;
}
