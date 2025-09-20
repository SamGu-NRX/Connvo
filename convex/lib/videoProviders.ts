/**
 * Video Provider Abstraction Layer
 *
 * This module provides a unified interface for different video providers
 * supporting the hybrid WebRTC (free) + GetStream (paid) architecture.
 *
 * Requirements: 6.2, 6.3
 * Compliance: steering/convex_rules.mdc - Uses proper TypeScript patterns
 */

import { Id } from "@convex/_generated/dataModel";
import {
  createStreamToken,
  getStreamCall,
  STREAM_DEFAULT_CALL_TYPE,
} from "@convex/lib/getstreamServer";

/**
 * Video provider types
 */
export type VideoProvider = "webrtc" | "getstream";

/**
 * Video room configuration
 */
export interface VideoRoomConfig {
  roomId: string;
  provider: VideoProvider;
  iceServers?: RTCIceServer[];
  streamToken?: string;
  features: {
    recording: boolean;
    transcription: boolean;
    maxParticipants: number;
    screenSharing: boolean;
    chat: boolean;
  };
}

/**
 * Participant connection info
 */
export interface ParticipantConnectionInfo {
  participantId: string;
  userId: Id<"users">;
  token?: string;
  permissions: {
    canRecord: boolean;
    canMute: boolean;
    canKick: boolean;
    canShare: boolean;
  };
}

/**
 * Video provider interface
 */
export interface IVideoProvider {
  readonly name: VideoProvider;

  // Room management
  createRoom(
    meetingId: Id<"meetings">,
    config: CreateRoomConfig,
  ): Promise<VideoRoomConfig>;
  deleteRoom(roomId: string): Promise<boolean>;

  // Participant management
  generateParticipantToken(
    roomId: string,
    userId: Id<"users">,
    role: "host" | "participant",
  ): Promise<string>;

  // Recording (paid tier only)
  startRecording?(roomId: string): Promise<{ recordingId: string }>;
  stopRecording?(recordingId: string): Promise<{ recordingUrl: string }>;

  // Transcription
  startTranscription?(roomId: string): Promise<{ transcriptionId: string }>;
  stopTranscription?(transcriptionId: string): Promise<boolean>;
}

/**
 * Room creation configuration
 */
export interface CreateRoomConfig {
  title: string;
  organizerId: Id<"users">;
  maxParticipants: number;
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  scheduledAt?: number;
}

/**
 * WebRTC provider implementation (free tier)
 */
export class WebRTCProvider implements IVideoProvider {
  readonly name: VideoProvider = "webrtc";

  async createRoom(
    meetingId: Id<"meetings">,
    config: CreateRoomConfig,
  ): Promise<VideoRoomConfig> {
    const roomId = `webrtc_${meetingId}_${Date.now()}`;

    return {
      roomId,
      provider: "webrtc",
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        // Add TURN servers if configured
        ...(process.env.TURN_SERVER_URL
          ? [
              {
                urls: process.env.TURN_SERVER_URL,
                username: process.env.TURN_USERNAME,
                credential: process.env.TURN_CREDENTIAL,
              },
            ]
          : []),
      ],
      features: {
        recording: false, // Not available on free tier
        transcription: true, // Available on free tier
        maxParticipants: Math.min(config.maxParticipants, 4),
        screenSharing: true,
        chat: true,
      },
    };
  }

  async deleteRoom(roomId: string): Promise<boolean> {
    // WebRTC rooms don't need cleanup - just signaling data
    console.log(`WebRTC room ${roomId} cleanup completed`);
    return true;
  }

  async generateParticipantToken(
    roomId: string,
    userId: Id<"users">,
    role: "host" | "participant",
  ): Promise<string> {
    // WebRTC doesn't use tokens - return session ID
    return `webrtc_session_${userId}_${Date.now()}`;
  }

  async startTranscription(
    roomId: string,
  ): Promise<{ transcriptionId: string }> {
    // WebRTC uses external transcription services
    const transcriptionId = `webrtc_transcription_${roomId}_${Date.now()}`;
    return { transcriptionId };
  }

  async stopTranscription(transcriptionId: string): Promise<boolean> {
    console.log(`WebRTC transcription ${transcriptionId} stopped`);
    return true;
  }
}

/**
 * GetStream provider implementation (paid tier)
 */
export class GetStreamProvider implements IVideoProvider {
  readonly name: VideoProvider = "getstream";

  async createRoom(
    meetingId: Id<"meetings">,
    config: CreateRoomConfig,
  ): Promise<VideoRoomConfig> {
    const roomId = `stream_${meetingId}_${Date.now()}`;

    const call = getStreamCall(roomId, STREAM_DEFAULT_CALL_TYPE);
    await call.create({
      data: {
        created_by_id: config.organizerId,
        settings_override: {
          recording: {
            mode: config.recordingEnabled ? "available" : "disabled",
            audio_only: false,
            quality: "720p",
          },
          transcription: {
            mode: config.transcriptionEnabled ? "available" : "disabled",
          },
          screensharing: {
            enabled: true,
            access_request_enabled: false,
          },
          limits: {
            max_participants: Math.min(config.maxParticipants, 100),
            max_duration_seconds: 14400, // 4 hours
          },
        },
        custom: {
          meetingId: meetingId,
          title: config.title,
        },
      },
    });

    return {
      roomId,
      provider: "getstream",
      features: {
        recording: config.recordingEnabled,
        transcription: config.transcriptionEnabled,
        maxParticipants: Math.min(config.maxParticipants, 100),
        screenSharing: true,
        chat: true,
      },
    };
  }

  async deleteRoom(roomId: string): Promise<boolean> {
    try {
      const call = getStreamCall(roomId, STREAM_DEFAULT_CALL_TYPE);
      await call.delete();

      console.log(`GetStream call ${roomId} deleted`);
      return true;
    } catch (error) {
      console.error("Failed to delete GetStream call:", error);
      return false;
    }
  }

  async generateParticipantToken(
    roomId: string,
    userId: Id<"users">,
    role: "host" | "participant",
  ): Promise<string> {
    const token = createStreamToken(userId, {
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour expiry
      iat: Math.floor(Date.now() / 1000),
      user_id: userId,
      role: role,
      call_cids: [`${STREAM_DEFAULT_CALL_TYPE}:${roomId}`],
    });

    return token;
  }

  async startRecording(roomId: string): Promise<{ recordingId: string }> {
    const call = getStreamCall(roomId, STREAM_DEFAULT_CALL_TYPE);
    const recordingResponse = await call.startRecording({
      mode: "available",
      audio_only: false,
      quality: "720p",
      layout: {
        name: "grid",
        options: {
          background_color: "#000000",
        },
      },
    });

    return {
      recordingId: recordingResponse.recording?.id || `recording_${Date.now()}`,
    };
  }

  async stopRecording(recordingId: string): Promise<{ recordingUrl: string }> {
    // Note: GetStream doesn't provide direct stop recording by ID.
    // This stub will be replaced once we extend the integration further.
    const recordingUrl = `https://stream-recordings.getstream.io/${recordingId}`;
    return { recordingUrl };
  }

  async startTranscription(
    roomId: string,
  ): Promise<{ transcriptionId: string }> {
    // TODO: Start GetStream transcription
    const transcriptionId = `stream_transcription_${roomId}_${Date.now()}`;
    return { transcriptionId };
  }

  async stopTranscription(transcriptionId: string): Promise<boolean> {
    // TODO: Stop GetStream transcription
    console.log(`GetStream transcription ${transcriptionId} stopped`);
    return true;
  }
}

/**
 * Provider factory for selecting the appropriate video provider
 */
export class VideoProviderFactory {
  private static webrtcProvider = new WebRTCProvider();
  private static getstreamProvider = new GetStreamProvider();

  /**
   * Selects the appropriate video provider based on meeting requirements
   */
  static selectProvider(
    userPlan: "free" | "paid",
    participantCount: number,
    recordingRequired: boolean,
    meetingType?: "one-on-one" | "small-group" | "large-meeting" | "webinar",
  ): IVideoProvider {
    // Provider selection logic
    const isLargeMeeting =
      participantCount > 4 ||
      meetingType === "large-meeting" ||
      meetingType === "webinar";

    if (userPlan === "paid" && (isLargeMeeting || recordingRequired)) {
      return this.getstreamProvider;
    }

    return this.webrtcProvider;
  }

  /**
   * Gets provider by name
   */
  static getProvider(providerName: VideoProvider): IVideoProvider {
    switch (providerName) {
      case "webrtc":
        return this.webrtcProvider;
      case "getstream":
        return this.getstreamProvider;
      default:
        throw new Error(`Unknown video provider: ${providerName}`);
    }
  }
}

/**
 * Helper functions for provider management
 */
export const VideoProviderUtils = {
  /**
   * Determines user plan based on org role (simplified for demo)
   */
  getUserPlan(orgRole?: string | null): "free" | "paid" {
    return orgRole === "admin" ? "paid" : "free";
  },

  /**
   * Validates provider capabilities against requirements
   */
  validateProviderCapabilities(
    provider: IVideoProvider,
    requirements: {
      recording?: boolean;
      maxParticipants?: number;
      transcription?: boolean;
    },
  ): boolean {
    if (requirements.recording && provider.name === "webrtc") {
      return false; // WebRTC doesn't support recording
    }

    if (
      requirements.maxParticipants &&
      requirements.maxParticipants > 4 &&
      provider.name === "webrtc"
    ) {
      return false; // WebRTC limited to 4 participants
    }

    return true;
  },

  /**
   * Gets provider-specific connection instructions
   */
  getConnectionInstructions(provider: VideoProvider): string {
    switch (provider) {
      case "webrtc":
        return "Direct peer-to-peer connection. Ensure your browser supports WebRTC.";
      case "getstream":
        return "Enterprise-grade video calling with recording and advanced features.";
      default:
        return "Unknown provider";
    }
  },
};
