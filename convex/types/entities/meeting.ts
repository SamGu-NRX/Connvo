/**
 * Meeting Entity Type Definitions
 *
 * This module defines all meeting-related entity types including Meeting,
 * MeetingParticipant, and MeetingRuntimeState with their derived types.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper entity modeling with state machines
 */

import type { Id } from "@convex/_generated/dataModel";
import type { UserSummary } from "./user";

// Meeting lifecycle states (matches schema exactly)
export type MeetingLifecycleState =
  | "scheduled"
  | "active"
  | "concluded"
  | "cancelled";

// Participant roles and presence (matches schema exactly)
export type ParticipantRole = "host" | "participant" | "observer";
export type ParticipantPresence = "invited" | "joined" | "left";

// Core Meeting entity (matches convex/schema/meetings.ts exactly)
export interface Meeting {
  _id: Id<"meetings">;
  _creationTime: number; // Convex system field
  organizerId: Id<"users">;
  title: string;
  description?: string;
  scheduledAt?: number;
  duration?: number;
  // WebRTC doesn't need external room IDs - signaling is handled internally
  webrtcEnabled?: boolean;
  // GetStream room identifier when using paid provider
  streamRoomId?: string;
  state: MeetingLifecycleState;
  // Denormalized fields for performance
  participantCount?: number;
  averageRating?: number;
  createdAt: number;
  updatedAt: number;
}

// Meeting participant entity (matches schema exactly)
export interface MeetingParticipant {
  _id: Id<"meetingParticipants">;
  meetingId: Id<"meetings">;
  userId: Id<"users">;
  role: ParticipantRole;
  joinedAt?: number;
  leftAt?: number;
  presence: ParticipantPresence;
  createdAt: number;
}

// Speaking statistics type (matches lib/validators.ts)
export interface SpeakingStats {
  totalMs: number;
  byUserMs: Record<string, number>;
}

// Lull state type
export interface LullState {
  detected: boolean;
  lastActivity: number;
  duration: number;
}

// Meeting runtime state tracking (matches schema exactly)
export interface MeetingRuntimeState {
  _id: Id<"meetingState">;
  meetingId: Id<"meetings">;
  active: boolean;
  startedAt?: number;
  endedAt?: number;
  speakingStats?: SpeakingStats;
  lullState?: LullState;
  topics: string[];
  recordingEnabled: boolean;
  updatedAt: number;
}

// Meeting notes entity (matches schema exactly)
export interface MeetingNote {
  _id: Id<"meetingNotes">;
  meetingId: Id<"meetings">;
  content: string;
  version: number;
  lastRebasedAt: number;
  updatedAt: number;
}

// Note operation types (matches schema exactly)
export type OperationType = "insert" | "delete" | "retain";

export interface Operation {
  type: OperationType;
  position: number;
  content?: string;
  length?: number;
}

export interface NoteOperation {
  _id: Id<"noteOps">;
  meetingId: Id<"meetings">;
  sequence: number;
  authorId: Id<"users">;
  operation: Operation;
  timestamp: number;
  applied: boolean;
}

// Meeting counters (matches schema exactly)
export interface MeetingCounter {
  _id: Id<"meetingCounters">;
  meetingId: Id<"meetings">;
  lastSequence: number;
  updatedAt: number;
}

// Meeting events (matches schema exactly)
export interface MeetingEvent {
  _id: Id<"meetingEvents">;
  meetingId: Id<"meetings">;
  event: string;
  userId?: Id<"users">;
  duration?: number;
  success: boolean;
  error?: string;
  metadata: Record<string, string | number | boolean>;
  timestamp: number;
  createdAt: number;
}

// Meeting recordings (matches schema exactly)
export interface MeetingRecording {
  _id: Id<"meetingRecordings">;
  meetingId: Id<"meetings">;
  recordingId: string;
  recordingUrl?: string;
  provider: "webrtc" | "getstream";
  status: "pending" | "recording" | "syncing" | "synced" | "failed" | "ready";
  error?: string;
  lastAttempt?: number;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

// Video room configuration (matches schema exactly)
export interface ICEServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface VideoRoomFeatures {
  recording: boolean;
  transcription: boolean;
  maxParticipants: number;
  screenSharing: boolean;
  chat: boolean;
}

export interface VideoRoomConfig {
  _id: Id<"videoRoomConfigs">;
  meetingId: Id<"meetings">;
  roomId: string;
  provider: "webrtc" | "getstream";
  iceServers?: ICEServer[];
  features: VideoRoomFeatures;
  createdAt: number;
  updatedAt: number;
}

// Derived types for API responses

// Meeting with user's role and presence
export interface MeetingWithUserRole extends Meeting {
  userRole: ParticipantRole;
  userPresence: ParticipantPresence;
  activeWebRTCSessions: number;
}

// Meeting participant with user details
export interface MeetingParticipantWithUser extends MeetingParticipant {
  user: UserSummary;
  webrtcConnected: boolean;
  webrtcSessionCount: number;
}

// Meeting list item (optimized for lists)
export interface MeetingListItem
  extends Pick<
    Meeting,
    | "_id"
    | "organizerId"
    | "title"
    | "description"
    | "scheduledAt"
    | "duration"
    | "state"
    | "participantCount"
    | "createdAt"
    | "updatedAt"
  > {
  userRole: ParticipantRole;
  userPresence: ParticipantPresence;
  organizer: UserSummary;
}

// Meeting runtime state with metrics
export interface MeetingRuntimeStateWithMetrics extends MeetingRuntimeState {
  totalWebRTCSessions: number;
  connectedWebRTCSessions: number;
  participantCount: number;
  averageSpeakingTime: number;
}

// Complete meeting details (for single meeting view)
export interface MeetingDetails extends Meeting {
  organizer: UserSummary;
  participants: MeetingParticipantWithUser[];
  runtimeState?: MeetingRuntimeStateWithMetrics;
  recording?: MeetingRecording;
  videoRoomConfig?: VideoRoomConfig;
  userRole: ParticipantRole;
  userPresence: ParticipantPresence;
}

// Meeting search result
export interface MeetingSearchResult {
  meeting: MeetingListItem;
  relevanceScore: number;
  matchedFields: string[];
  snippet?: string;
}

// Meeting scheduling types
export interface MeetingScheduleRequest {
  title: string;
  description?: string;
  scheduledAt: number;
  duration: number;
  participantIds: Id<"users">[];
  webrtcEnabled?: boolean;
  streamRoomId?: string;
}

export interface MeetingScheduleResult {
  meetingId: Id<"meetings">;
  participantIds: Id<"meetingParticipants">[];
  scheduledAt: number;
  conflicts: {
    userId: Id<"users">;
    conflictingMeetings: Id<"meetings">[];
  }[];
}

// Note operation result
export interface NoteOperationResult {
  success: boolean;
  serverSequence: number;
  transformedOperation: Operation;
  newVersion: number;
  conflicts: string[];
}

// Meeting analytics
export interface MeetingAnalytics {
  meetingId: Id<"meetings">;
  duration: number;
  participantCount: number;
  averageRating?: number;
  speakingDistribution: Record<string, number>;
  topicsCovered: string[];
  engagementScore: number;
  technicalIssues: {
    audioDropouts: number;
    videoFreezes: number;
    connectionIssues: number;
  };
}
