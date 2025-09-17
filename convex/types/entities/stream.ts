/**
 * Stream (GetStream) Domain Types
 *
 * Centralized type definitions for the paid-tier GetStream integration, covering
 * room provisioning, participant access, recording, and webhook payloads.
 *
 * Requirements: 1.1, 1.2, 2.1, 2.2
 * Compliance: steering/convex_rules.mdc - Type-first API modeling
 */

import type { VideoRoomFeatures } from "./meeting";

/**
 * Result of provisioning a GetStream call for a meeting.
 */
export interface StreamRoomCreationResponse {
  roomId: string;
  callId: string;
  success: boolean;
  features: VideoRoomFeatures;
}

/**
 * Public token issued to the current user via action.
 */
export interface StreamParticipantTokenPublic {
  token: string;
  userId: string;
  user: {
    id: string;
    name: string;
    image?: string;
  };
  expiresAt: number;
  success: boolean;
}

/**
 * Token issued internally when generating access for a specific participant.
 */
export interface StreamParticipantTokenInternal {
  token: string;
  userId: string;
  callId: string;
  expiresAt: number;
  success: boolean;
}

/**
 * Result returned when starting a recording session.
 */
export interface StreamRecordingStartResult {
  recordingId: string;
  recordingUrl?: string;
  success: boolean;
}

/**
 * Result returned when stopping an active recording session.
 */
export interface StreamRecordingStopResult {
  success: boolean;
  recordingUrl?: string;
  recordingId?: string;
  duration?: number;
}

/**
 * Result of meeting resource cleanup routines.
 */
export interface StreamCleanupResult {
  success: boolean;
  tasksCompleted: string[];
}

/**
 * Minimal boolean success envelope used by webhook handlers and teardown paths.
 */
export interface StreamSimpleSuccess {
  success: boolean;
}

/**
 * Shape of webhook payloads emitted by Stream that we consume.
 */
export interface StreamWebhookPayload {
  call?: {
    id: string;
  };
  call_session?: {
    id: string;
    duration_ms?: number;
  };
  user?: {
    id: string;
  };
  call_recording?: {
    id: string;
    url?: string;
  };
}
