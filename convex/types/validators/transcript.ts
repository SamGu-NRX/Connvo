/**
 * Transcript Entity Validators
 *
 * This module provides Convex validators that correspond to the Transcript entity types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper validator patterns with time-bucketed sharding
 */

import { v } from "convex/values";
import type {
  Transcript,
  TranscriptionSession,
  TranscriptSegment,
  TranscriptChunk,
  TranscriptStats,
  TranscriptSearchResult,
  TranscriptSegmentWithSpeakers,
  TranscriptExport,
  TranscriptStreamEvent,
  TranscriptProcessingStatus,
  TranscriptQualityMetrics,
  TranscriptBucket,
  SpeakerProfile,
} from "../entities/transcript";

// Transcription provider validator
const transcriptionProviderV = v.union(
  v.literal("whisper"),
  v.literal("assemblyai"),
  v.literal("getstream"),
);

// Transcription status validator
const transcriptionStatusV = v.union(
  v.literal("initializing"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("completed"),
  v.literal("failed"),
);

// Metadata validator (matches lib/validators.ts)
const metadataRecordV = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean()),
);

// Core Transcript validators (matches schema exactly)
export const TranscriptV = {
  // Full transcript entity
  full: v.object({
    _id: v.id("transcripts"),
    meetingId: v.id("meetings"),
    // Sharding key: time bucket (5-minute windows) to prevent hot partitions
    bucketMs: v.number(), // Math.floor(timestamp / 300000) * 300000
    sequence: v.number(),
    speakerId: v.optional(v.string()),
    text: v.string(),
    confidence: v.number(),
    startMs: v.number(),
    endMs: v.number(),
    // Whether this chunk is an interim hypothesis from the provider
    isInterim: v.optional(v.boolean()),
    // Denormalized for performance
    wordCount: v.number(),
    language: v.optional(v.string()),
    createdAt: v.number(),
  }),

  // Transcript chunk for streaming/real-time updates
  chunk: v.object({
    _id: v.id("transcripts"),
    sequence: v.number(),
    speakerId: v.optional(v.string()),
    text: v.string(),
    confidence: v.number(),
    startMs: v.number(),
    endMs: v.number(),
    wordCount: v.number(),
    language: v.optional(v.string()),
    createdAt: v.number(),
  }),

  // Transcript chunk for batch processing (input format)
  batchChunk: v.object({
    speakerId: v.optional(v.string()),
    text: v.string(),
    confidence: v.number(),
    startMs: v.number(),
    endMs: v.number(),
    userId: v.id("users"),
    timestamp: v.number(),
  }),

  // Transcript statistics
  stats: v.object({
    totalChunks: v.number(),
    totalWords: v.number(),
    averageConfidence: v.number(),
    duration: v.number(),
    speakers: v.array(v.string()),
    languages: v.array(v.string()),
    bucketCount: v.number(), // Number of time buckets
  }),
} as const;

// Transcription Session validators (matches schema exactly)
export const TranscriptionSessionV = {
  full: v.object({
    _id: v.id("transcriptionSessions"),
    meetingId: v.id("meetings"),
    provider: transcriptionProviderV,
    status: transcriptionStatusV,
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    metadata: v.optional(metadataRecordV),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
} as const;

// Transcript Segment validators (matches schema exactly)
export const TranscriptSegmentV = {
  full: v.object({
    _id: v.id("transcriptSegments"),
    meetingId: v.id("meetings"),
    startMs: v.number(),
    endMs: v.number(),
    speakers: v.array(v.string()),
    text: v.string(),
    topics: v.array(v.string()),
    sentiment: v.optional(v.number()),
    createdAt: v.number(),
  }),

  // Segment with speaker details
  withSpeakers: v.object({
    _id: v.id("transcriptSegments"),
    meetingId: v.id("meetings"),
    startMs: v.number(),
    endMs: v.number(),
    speakers: v.array(v.string()),
    text: v.string(),
    topics: v.array(v.string()),
    sentiment: v.optional(v.number()),
    createdAt: v.number(),
    speakerDetails: v.array(
      v.object({
        speakerId: v.string(),
        displayName: v.optional(v.string()),
        avatarUrl: v.optional(v.string()),
      }),
    ),
  }),
} as const;

// Transcript Search Result validators
export const TranscriptSearchResultV = {
  full: v.object({
    transcript: TranscriptV.chunk,
    relevanceScore: v.number(),
    matchedFields: v.array(v.string()),
    snippet: v.optional(v.string()),
    context: v.optional(
      v.object({
        before: v.string(),
        after: v.string(),
      }),
    ),
  }),
} as const;

// Transcript Export validators
export const TranscriptExportV = {
  full: v.object({
    meetingId: v.id("meetings"),
    format: v.union(
      v.literal("txt"),
      v.literal("srt"),
      v.literal("vtt"),
      v.literal("json"),
    ),
    content: v.string(),
    metadata: v.object({
      totalDuration: v.number(),
      speakerCount: v.number(),
      wordCount: v.number(),
      averageConfidence: v.number(),
      exportedAt: v.number(),
    }),
  }),
} as const;

// Real-time Transcript Stream Event validators
export const TranscriptStreamEventV = {
  full: v.object({
    type: v.union(
      v.literal("chunk"),
      v.literal("segment"),
      v.literal("session_update"),
      v.literal("error"),
    ),
    meetingId: v.id("meetings"),
    data: v.union(
      TranscriptV.chunk,
      TranscriptSegmentV.full,
      TranscriptionSessionV.full,
      v.object({ error: v.string() }),
    ),
    timestamp: v.number(),
  }),
} as const;

// Transcript Processing Status validators
export const TranscriptProcessingStatusV = {
  full: v.object({
    meetingId: v.id("meetings"),
    totalChunks: v.number(),
    processedChunks: v.number(),
    failedChunks: v.number(),
    lastProcessedAt: v.optional(v.number()),
    estimatedCompletion: v.optional(v.number()),
    errors: v.array(v.string()),
  }),
} as const;

// Transcript Quality Metrics validators
export const TranscriptQualityMetricsV = {
  full: v.object({
    meetingId: v.id("meetings"),
    averageConfidence: v.number(),
    lowConfidenceChunks: v.number(),
    speakerIdentificationAccuracy: v.number(),
    languageDetectionAccuracy: v.number(),
    processingLatency: v.number(), // Average ms from audio to transcript
    qualityScore: v.number(), // 0-100 overall quality score
  }),
} as const;

// Transcript Bucket validators (for sharding management)
export const TranscriptBucketV = {
  full: v.object({
    bucketMs: v.number(),
    meetingId: v.id("meetings"),
    chunkCount: v.number(),
    totalWords: v.number(),
    averageConfidence: v.number(),
    firstChunkAt: v.number(),
    lastChunkAt: v.number(),
  }),
} as const;

// Speaker Profile validators
export const SpeakerProfileV = {
  full: v.object({
    speakerId: v.string(),
    meetingId: v.id("meetings"),
    userId: v.optional(v.id("users")), // If identified
    displayName: v.optional(v.string()),
    voiceprint: v.optional(v.bytes()), // Voice characteristics for identification
    confidence: v.number(), // Confidence in speaker identification
    totalSpeakingTime: v.number(),
    chunkCount: v.number(),
    firstAppearance: v.number(),
    lastAppearance: v.number(),
  }),
} as const;
