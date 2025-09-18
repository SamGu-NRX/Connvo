/**
 * Transcript Entity Type Definitions
 *
 * This module defines all transcript-related entity types including Transcript,
 * TranscriptSegment, and TranscriptionSession with their derived types.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper entity modeling with time-bucketed sharding
 */

import type { Id } from "@convex/_generated/dataModel";

// Core Transcript entity (matches convex/schema/transcripts.ts exactly)
export interface Transcript {
  _id: Id<"transcripts">;
  _creationTime: number; // Convex system field
  meetingId: Id<"meetings">;
  // Sharding key: time bucket (5-minute windows) to prevent hot partitions
  bucketMs: number; // Math.floor(timestamp / 300000) * 300000
  sequence: number;
  speakerId?: string;
  text: string;
  confidence: number;
  startMs: number;
  endMs: number;
  // Whether this chunk is an interim hypothesis from the provider
  isInterim?: boolean;
  // Denormalized for performance
  wordCount: number;
  language?: string;
  createdAt: number;
}

// Transcription session management (matches schema exactly)
export interface TranscriptionSession {
  _id: Id<"transcriptionSessions">;
  _creationTime: number; // Convex system field
  meetingId: Id<"meetings">;
  provider: "whisper" | "assemblyai" | "getstream";
  status: "initializing" | "active" | "paused" | "completed" | "failed";
  startedAt: number;
  endedAt?: number;
  metadata?: Record<string, string | number | boolean>;
  createdAt: number;
  updatedAt: number;
}

// Transcript segment (aggregated chunks) (matches schema exactly)
export interface TranscriptSegment {
  _id: Id<"transcriptSegments">;
  _creationTime: number; // Convex system field
  meetingId: Id<"meetings">;
  startMs: number;
  endMs: number;
  speakers: string[];
  text: string;
  topics: string[];
  sentiment?: number;
  createdAt: number;
}

// API response types

// Transcript chunk for streaming/real-time updates
export type TranscriptChunk = Pick<
  Transcript,
  | "_id"
  | "sequence"
  | "speakerId"
  | "text"
  | "confidence"
  | "startMs"
  | "endMs"
  | "wordCount"
  | "language"
  | "createdAt"
>;

// Transcript statistics for analytics
export interface TranscriptStats {
  totalChunks: number;
  totalWords: number;
  averageConfidence: number;
  duration: number;
  speakers: string[];
  languages: string[];
  bucketCount: number; // Number of time buckets
}

// Transcript search result
export interface TranscriptSearchResult {
  transcript: TranscriptChunk;
  relevanceScore: number;
  matchedFields: string[];
  snippet?: string;
  context?: {
    before: string;
    after: string;
  };
}

// Transcript segment with speaker details
export interface TranscriptSegmentWithSpeakers extends TranscriptSegment {
  speakerDetails: Array<{
    speakerId: string;
    displayName?: string;
    avatarUrl?: string;
  }>;
}

// Transcript export formats
export interface TranscriptExport {
  meetingId: Id<"meetings">;
  format: "txt" | "srt" | "vtt" | "json";
  content: string;
  metadata: {
    totalDuration: number;
    speakerCount: number;
    wordCount: number;
    averageConfidence: number;
    exportedAt: number;
  };
}

// Real-time transcript streaming types
export interface TranscriptStreamEvent {
  type: "chunk" | "segment" | "session_update" | "error";
  meetingId: Id<"meetings">;
  data:
    | TranscriptChunk
    | TranscriptSegment
    | TranscriptionSession
    | { error: string };
  timestamp: number;
}

// Transcript processing status
export interface TranscriptProcessingStatus {
  meetingId: Id<"meetings">;
  totalChunks: number;
  processedChunks: number;
  failedChunks: number;
  lastProcessedAt?: number;
  estimatedCompletion?: number;
  errors: string[];
}

// Transcript quality metrics
export interface TranscriptQualityMetrics {
  meetingId: Id<"meetings">;
  averageConfidence: number;
  lowConfidenceChunks: number;
  speakerIdentificationAccuracy: number;
  languageDetectionAccuracy: number;
  processingLatency: number; // Average ms from audio to transcript
  qualityScore: number; // 0-100 overall quality score
}

// Transcript bucket management (for sharding)
export interface TranscriptBucket {
  bucketMs: number;
  meetingId: Id<"meetings">;
  chunkCount: number;
  totalWords: number;
  averageConfidence: number;
  firstChunkAt: number;
  lastChunkAt: number;
}

// Speaker identification and management
export interface SpeakerProfile {
  speakerId: string;
  meetingId: Id<"meetings">;
  userId?: Id<"users">; // If identified
  displayName?: string;
  voiceprint?: ArrayBuffer; // Voice characteristics for identification
  confidence: number; // Confidence in speaker identification
  totalSpeakingTime: number;
  chunkCount: number;
  firstAppearance: number;
  lastAppearance: number;
}
