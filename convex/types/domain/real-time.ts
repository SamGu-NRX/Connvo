/**
 * Real-time Domain Types
 *
 * Complex domain types for real-time operations, subscriptions, and WebRTC.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2
 */

import type { Id } from "../../_generated/dataModel";
import type { EpochMs } from "../utils";

// Real-time subscription types
export interface RealtimeSubscription {
  _id: Id<"subscriptions">;
  userId: Id<"users">;
  resourceType: "meeting" | "user" | "transcript" | "note";
  resourceId: string;
  events: string[];
  active: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

// Presence tracking
export interface UserPresence {
  _id: Id<"presence">;
  userId: Id<"users">;
  status: "online" | "away" | "busy" | "offline";
  lastSeen: EpochMs;
  currentMeeting?: Id<"meetings">;
  metadata?: Record<string, any>;
}

// Active subscription metadata for tracking connections
export interface ActiveSubscription {
  subscriptionId: string;
  userId: Id<"users">;
  resourceType: string;
  resourceId: string;
  permissions: string[];
  establishedAt: number;
  lastValidated: number;
  validUntil?: number;
  priority: "critical" | "high" | "normal" | "low";
}

// Subscription context for tracking active connections
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

// Re-export WebRTC types for convenience
export * from "../entities/webrtc";
