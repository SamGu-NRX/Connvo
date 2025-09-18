/**
 * Meeting Entity Validators
 *
 * This module provides Convex validators that correspond to the Meeting entity types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper validator patterns with state machines
 */

import { v } from "convex/values";
import { UserV } from "./user";
import { NoteV, OperationV } from "./note";
import type {
  Meeting,
  MeetingParticipant,
  MeetingRuntimeState,
  MeetingCounter,
  MeetingEvent,
  MeetingRecording,
  VideoRoomConfig,
  MeetingWithUserRole,
  MeetingParticipantWithUser,
  MeetingListItem,
  MeetingRuntimeStateWithMetrics,
  MeetingDetails,
  MeetingSearchResult,
  MeetingScheduleRequest,
  MeetingScheduleResult,
  MeetingAnalytics,
  SpeakingStats,
  LullState,
  ICEServer,
  VideoRoomFeatures,
} from "../entities/meeting";
import type {
  MeetingNote,
  NoteOperation,
  NoteOperationResult,
  Operation,
} from "../entities/note";

// Meeting lifecycle state validator
const meetingLifecycleStateV = v.union(
  v.literal("scheduled"),
  v.literal("active"),
  v.literal("concluded"),
  v.literal("cancelled"),
);

// Participant role and presence validators
const participantRoleV = v.union(
  v.literal("host"),
  v.literal("participant"),
  v.literal("observer"),
);

const participantPresenceV = v.union(
  v.literal("invited"),
  v.literal("joined"),
  v.literal("left"),
);

// Operation type validator
const operationTypeV = v.union(
  v.literal("insert"),
  v.literal("delete"),
  v.literal("retain"),
);

// Speaking stats validator (matches lib/validators.ts)
const speakingStatsV = v.object({
  totalMs: v.number(),
  byUserMs: v.record(v.string(), v.number()),
});

// Lull state validator
const lullStateV = v.object({
  detected: v.boolean(),
  lastActivity: v.number(),
  duration: v.number(),
});

// Operation validator
const operationV = v.object({
  type: operationTypeV,
  position: v.number(),
  content: v.optional(v.string()),
  length: v.optional(v.number()),
});

// ICE server validator
const iceServerV = v.object({
  urls: v.union(v.string(), v.array(v.string())),
  username: v.optional(v.string()),
  credential: v.optional(v.string()),
});

// Video room features validator
const videoRoomFeaturesV = v.object({
  recording: v.boolean(),
  transcription: v.boolean(),
  maxParticipants: v.number(),
  screenSharing: v.boolean(),
  chat: v.boolean(),
});

// Core Meeting validators (matches schema exactly)
export const MeetingV = {
  // Full meeting entity
  full: v.object({
    _id: v.id("meetings"),
    _creationTime: v.number(), // Convex system field
    organizerId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    duration: v.optional(v.number()),
    // WebRTC doesn't need external room IDs - signaling is handled internally
    webrtcEnabled: v.optional(v.boolean()),
    // GetStream room identifier when using paid provider
    streamRoomId: v.optional(v.string()),
    state: meetingLifecycleStateV,
    // Denormalized fields for performance
    participantCount: v.optional(v.number()),
    averageRating: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  // Meeting with user role
  withUserRole: v.object({
    _id: v.id("meetings"),
    _creationTime: v.number(), // Convex system field
    organizerId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    duration: v.optional(v.number()),
    webrtcEnabled: v.optional(v.boolean()),
    streamRoomId: v.optional(v.string()),
    state: meetingLifecycleStateV,
    participantCount: v.optional(v.number()),
    averageRating: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    userRole: participantRoleV,
    userPresence: participantPresenceV,
    activeWebRTCSessions: v.number(),
  }),

  // Meeting list item (optimized for lists)
  listItem: v.object({
    _id: v.id("meetings"),
    _creationTime: v.number(), // Convex system field
    organizerId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    duration: v.optional(v.number()),
    state: meetingLifecycleStateV,
    participantCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    userRole: participantRoleV,
    userPresence: participantPresenceV,
    organizer: UserV.summary,
  }),
} as const;

// Meeting Participant validators (matches schema exactly)
export const MeetingParticipantV = {
  // Full participant entity
  full: v.object({
    _id: v.id("meetingParticipants"),
    _creationTime: v.number(), // Convex system field
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    role: participantRoleV,
    joinedAt: v.optional(v.number()),
    leftAt: v.optional(v.number()),
    presence: participantPresenceV,
    createdAt: v.number(),
  }),

  // Participant with user details
  withUser: v.object({
    _id: v.id("meetingParticipants"),
    _creationTime: v.number(), // Convex system field
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    role: participantRoleV,
    joinedAt: v.optional(v.number()),
    leftAt: v.optional(v.number()),
    presence: participantPresenceV,
    createdAt: v.number(),
    user: UserV.summary,
    webrtcConnected: v.boolean(),
    webrtcSessionCount: v.number(),
  }),
} as const;

// Meeting Runtime State validators (matches schema exactly)
export const MeetingRuntimeStateV = {
  // Full runtime state
  full: v.object({
    _id: v.id("meetingState"),
    _creationTime: v.number(), // Convex system field
    meetingId: v.id("meetings"),
    active: v.boolean(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    speakingStats: v.optional(speakingStatsV),
    lullState: v.optional(lullStateV),
    topics: v.array(v.string()),
    recordingEnabled: v.boolean(),
    updatedAt: v.number(),
  }),

  // Runtime state with metrics
  withMetrics: v.object({
    _id: v.id("meetingState"),
    _creationTime: v.number(), // Convex system field
    meetingId: v.id("meetings"),
    active: v.boolean(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    speakingStats: v.optional(speakingStatsV),
    lullState: v.optional(lullStateV),
    topics: v.array(v.string()),
    recordingEnabled: v.boolean(),
    updatedAt: v.number(),
    totalWebRTCSessions: v.number(),
    connectedWebRTCSessions: v.number(),
    participantCount: v.number(),
    averageSpeakingTime: v.number(),
  }),
} as const;

// Meeting Notes validators (matches schema exactly)
export const MeetingNoteV = {
  full: NoteV.meetingNote,
} as const;

// Note Operation validators (matches schema exactly)
export const NoteOperationV = {
  full: NoteV.noteOperation,
  operation: OperationV,
  result: NoteV.operationResult,
} as const;

// Meeting Counter validators (matches schema exactly)
export const MeetingCounterV = {
  full: v.object({
    _id: v.id("meetingCounters"),
    _creationTime: v.number(), // Convex system field
    meetingId: v.id("meetings"),
    lastSequence: v.number(),
    updatedAt: v.number(),
  }),
} as const;

// Meeting Event validators (matches schema exactly)
export const MeetingEventV = {
  full: v.object({
    _id: v.id("meetingEvents"),
    _creationTime: v.number(), // Convex system field
    meetingId: v.id("meetings"),
    event: v.string(),
    userId: v.optional(v.id("users")),
    duration: v.optional(v.number()),
    success: v.boolean(),
    error: v.optional(v.string()),
    metadata: v.record(
      v.string(),
      v.union(v.string(), v.number(), v.boolean()),
    ),
    timestamp: v.number(),
    createdAt: v.number(),
  }),
} as const;

// Meeting Recording validators (matches schema exactly)
export const MeetingRecordingV = {
  full: v.object({
    _id: v.id("meetingRecordings"),
    _creationTime: v.number(), // Convex system field
    meetingId: v.id("meetings"),
    recordingId: v.string(),
    recordingUrl: v.optional(v.string()),
    provider: v.union(v.literal("webrtc"), v.literal("getstream")),
    status: v.union(
      v.literal("pending"),
      v.literal("recording"),
      v.literal("syncing"),
      v.literal("synced"),
      v.literal("failed"),
      v.literal("ready"),
    ),
    error: v.optional(v.string()),
    lastAttempt: v.optional(v.number()),
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
} as const;

// Video Room Config validators (matches schema exactly)
export const VideoRoomConfigV = {
  full: v.object({
    _id: v.id("videoRoomConfigs"),
    _creationTime: v.number(), // Convex system field
    meetingId: v.id("meetings"),
    roomId: v.string(),
    provider: v.union(v.literal("webrtc"), v.literal("getstream")),
    iceServers: v.optional(v.array(iceServerV)),
    features: videoRoomFeaturesV,
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
} as const;

// Meeting Details validator (complete meeting view)
export const MeetingDetailsV = {
  full: v.object({
    _id: v.id("meetings"),
    _creationTime: v.number(), // Convex system field
    organizerId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    duration: v.optional(v.number()),
    webrtcEnabled: v.optional(v.boolean()),
    streamRoomId: v.optional(v.string()),
    state: meetingLifecycleStateV,
    participantCount: v.optional(v.number()),
    averageRating: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    organizer: UserV.summary,
    participants: v.array(MeetingParticipantV.withUser),
    runtimeState: v.optional(MeetingRuntimeStateV.withMetrics),
    recording: v.optional(MeetingRecordingV.full),
    videoRoomConfig: v.optional(VideoRoomConfigV.full),
    userRole: participantRoleV,
    userPresence: participantPresenceV,
  }),
} as const;

// Meeting Search Result validators
export const MeetingSearchResultV = {
  full: v.object({
    meeting: MeetingV.listItem,
    relevanceScore: v.number(),
    matchedFields: v.array(v.string()),
    snippet: v.optional(v.string()),
  }),
} as const;

// Meeting Scheduling validators
export const MeetingSchedulingV = {
  request: v.object({
    title: v.string(),
    description: v.optional(v.string()),
    scheduledAt: v.number(),
    duration: v.number(),
    participantIds: v.array(v.id("users")),
    webrtcEnabled: v.optional(v.boolean()),
    streamRoomId: v.optional(v.string()),
  }),

  result: v.object({
    meetingId: v.id("meetings"),
    participantIds: v.array(v.id("meetingParticipants")),
    scheduledAt: v.number(),
    conflicts: v.array(
      v.object({
        userId: v.id("users"),
        conflictingMeetings: v.array(v.id("meetings")),
      }),
    ),
  }),
} as const;

// Meeting Analytics validators
export const MeetingAnalyticsV = {
  full: v.object({
    meetingId: v.id("meetings"),
    duration: v.number(),
    participantCount: v.number(),
    averageRating: v.optional(v.number()),
    speakingDistribution: v.record(v.string(), v.number()),
    topicsCovered: v.array(v.string()),
    engagementScore: v.number(),
    technicalIssues: v.object({
      audioDropouts: v.number(),
      videoFreezes: v.number(),
      connectionIssues: v.number(),
    }),
  }),
} as const;
