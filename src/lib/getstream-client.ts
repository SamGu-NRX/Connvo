/**
 * GetStream Video Client Integration (Paid Tier)
 *
 * This module provides a type-safe GetStream Video client for paid tier features
 * including recording, advanced layouts, and enterprise-grade video calling.
 *
 * Requirements: 6.2, 6.3
 * Compliance: Full TypeScript type safety for scalable frontend/backend integration
 */

import {
  StreamVideoClient,
  Call,
  StreamVideo,
  StreamCall,
  User as StreamUser,
} from "@stream-io/video-react-sdk";
import { ConvexReactClient } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

/**
 * GetStream call configuration
 */
export interface GetStreamCallConfig {
  callId: string;
  callType: string;
  token: string;
  userId: string;
  apiKey: string;
}

/**
 * GetStream call events
 */
export interface GetStreamCallEvents {
  callJoined: (call: Call) => void;
  callLeft: () => void;
  participantJoined: (participant: any) => void;
  participantLeft: (participant: any) => void;
  recordingStarted: (recording: any) => void;
  recordingStopped: (recording: any) => void;
  transcriptionStarted: () => void;
  transcriptionStopped: () => void;
  error: (error: Error) => void;
}

/**
 * GetStream call manager for paid tier features
 */
export class GetStreamCallManager {
  private convex: ConvexReactClient;
  private meetingId: Id<"meetings">;
  private client: StreamVideoClient | null = null;
  private call: Call | null = null;
  private eventListeners = new Map<keyof GetStreamCallEvents, Function[]>();
  private isJoined = false;

  constructor(convex: ConvexReactClient, meetingId: Id<"meetings">) {
    this.convex = convex;
    this.meetingId = meetingId;
  }

  /**
   * Initializes GetStream client and joins call
   */
  async join(): Promise<void> {
    try {
      // Get call configuration from backend
      const connectionInfo = await this.convex.mutation(
        api.meetings.lifecycle.getMeetingConnectionInfo,
        { meetingId: this.meetingId },
      );

      if (connectionInfo.videoProvider !== "getstream") {
        throw new Error("Meeting is not configured for GetStream");
      }

      if (!connectionInfo.connectionInfo.roomId) {
        throw new Error("GetStream call ID not available");
      }

      // Generate participant token
      const tokenResponse = await this.convex.action(
        api.meetings.stream.generateParticipantTokenPublic,
        {
          meetingId: this.meetingId,
          role: "participant", // Will be determined by backend based on user's role
        },
      );

      // Initialize GetStream client
      this.client = new StreamVideoClient(
        process.env.NEXT_PUBLIC_STREAM_API_KEY!,
      );

      // Get call object
      this.call = this.client.call(
        "default",
        connectionInfo.connectionInfo.roomId,
      );

      // Set up event listeners
      this.setupEventListeners();

      // Join the call
      await this.call.join();
      this.isJoined = true;

      this.emit("callJoined", this.call);
      console.log(
        `Joined GetStream call ${connectionInfo.connectionInfo.roomId}`,
      );
    } catch (error) {
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Leaves the GetStream call
   */
  async leave(): Promise<void> {
    if (!this.call || !this.isJoined) return;

    try {
      await this.call.leave();
      this.isJoined = false;
      this.emit("callLeft");
      console.log("Left GetStream call");
    } catch (error) {
      this.emit("error", error as Error);
    }
  }

  /**
   * Starts recording (host only)
   */
  async startRecording(config?: {
    mode?: "available" | "disabled";
    audioOnly?: boolean;
    quality?: "360p" | "720p" | "1080p";
    layout?: "grid" | "spotlight" | "single-participant";
  }): Promise<{ recordingId: string }> {
    if (!this.call) {
      throw new Error("Not joined to call");
    }

    try {
      // Start recording via backend (includes permission checks)
      const result = await this.convex.action(
        api.meetings.stream.startRecording,
        {
          meetingId: this.meetingId,
          recordingConfig: config,
        },
      );

      this.emit("recordingStarted", { recordingId: result.recordingId });
      return { recordingId: result.recordingId };
    } catch (error) {
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Stops recording (host only)
   */
  async stopRecording(
    recordingId?: string,
  ): Promise<{ recordingUrl?: string }> {
    if (!this.call) {
      throw new Error("Not joined to call");
    }

    try {
      // Stop recording via backend (includes permission checks)
      const result = await this.convex.action(
        api.meetings.stream.stopRecording,
        {
          meetingId: this.meetingId,
          recordingId,
        },
      );

      this.emit("recordingStopped", {
        recordingId: result.recordingId,
        recordingUrl: result.recordingUrl,
      });

      return { recordingUrl: result.recordingUrl };
    } catch (error) {
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Enables/disables camera
   */
  async toggleCamera(enabled: boolean): Promise<void> {
    if (!this.call) {
      throw new Error("Not joined to call");
    }

    try {
      if (enabled) {
        await this.call.camera.enable();
      } else {
        await this.call.camera.disable();
      }
    } catch (error) {
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Enables/disables microphone
   */
  async toggleMicrophone(enabled: boolean): Promise<void> {
    if (!this.call) {
      throw new Error("Not joined to call");
    }

    try {
      if (enabled) {
        await this.call.microphone.enable();
      } else {
        await this.call.microphone.disable();
      }
    } catch (error) {
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Starts screen sharing
   */
  async startScreenShare(): Promise<void> {
    if (!this.call) {
      throw new Error("Not joined to call");
    }

    try {
      await this.call.screenShare.enable();
    } catch (error) {
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Stops screen sharing
   */
  async stopScreenShare(): Promise<void> {
    if (!this.call) {
      throw new Error("Not joined to call");
    }

    try {
      await this.call.screenShare.disable();
    } catch (error) {
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Sets up GetStream event listeners
   */
  private setupEventListeners(): void {
    if (!this.call) return;

    // Participant events
    this.call.on("call.session_participant_joined", (event: any) => {
      this.emit("participantJoined", event.participant);
    });

    this.call.on("call.session_participant_left", (event: any) => {
      this.emit("participantLeft", event.participant);
    });

    // Recording events
    this.call.on("call.recording_started", (event: any) => {
      this.emit("recordingStarted", event.call_recording);
    });

    this.call.on("call.recording_stopped", (event: any) => {
      this.emit("recordingStopped", event.call_recording);
    });

    // Transcription events
    this.call.on("call.transcription_started", () => {
      this.emit("transcriptionStarted");
    });

    this.call.on("call.transcription_stopped", () => {
      this.emit("transcriptionStopped");
    });

    // Error handling
    this.call.on("call.session_ended", () => {
      this.isJoined = false;
      this.emit("callLeft");
    });
  }

  /**
   * Event listener management
   */
  on<K extends keyof GetStreamCallEvents>(
    event: K,
    listener: GetStreamCallEvents[K],
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  off<K extends keyof GetStreamCallEvents>(
    event: K,
    listener: GetStreamCallEvents[K],
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit<K extends keyof GetStreamCallEvents>(
    event: K,
    ...args: Parameters<GetStreamCallEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          (listener as any)(...args);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Gets current call state
   */
  getState() {
    return {
      isJoined: this.isJoined,
      callId: this.call?.id,
      participantCount: this.call?.state.participantCount || 0,
      isRecording: this.call?.state.recording || false,
      isTranscribing: this.call?.state.transcribing || false,
    };
  }

  /**
   * Gets call statistics
   */
  async getCallStats() {
    if (!this.call) {
      return null;
    }

    try {
      // Stats API not available in current types; return null for now.
      return null;
    } catch (error) {
      console.error("Failed to get call stats:", error);
      return null;
    }
  }

  /**
   * Gets participants list
   */
  getParticipants() {
    if (!this.call) {
      return [];
    }

    return this.call.state.participants || [];
  }
}

/**
 * React hook for GetStream call management
 */
export function useGetStreamCall(
  convex: ConvexReactClient,
  meetingId: Id<"meetings">,
) {
  const callManager = new GetStreamCallManager(convex, meetingId);

  return {
    callManager,
    join: () => callManager.join(),
    leave: () => callManager.leave(),
    startRecording: (config?: any) => callManager.startRecording(config),
    stopRecording: (recordingId?: string) =>
      callManager.stopRecording(recordingId),
    toggleCamera: (enabled: boolean) => callManager.toggleCamera(enabled),
    toggleMicrophone: (enabled: boolean) =>
      callManager.toggleMicrophone(enabled),
    startScreenShare: () => callManager.startScreenShare(),
    stopScreenShare: () => callManager.stopScreenShare(),
    getState: () => callManager.getState(),
    getCallStats: () => callManager.getCallStats(),
    getParticipants: () => callManager.getParticipants(),
  };
}

/**
 * GetStream provider utilities
 */
export const GetStreamUtils = {
  /**
   * Validates GetStream configuration
   */
  validateConfig(): boolean {
    return !!(
      process.env.NEXT_PUBLIC_STREAM_API_KEY && process.env.STREAM_SECRET
    );
  },

  /**
   * Gets GetStream environment info
   */
  getEnvironmentInfo() {
    return {
      apiKey: process.env.NEXT_PUBLIC_STREAM_API_KEY,
      hasSecret: !!process.env.STREAM_SECRET,
      environment: process.env.NODE_ENV,
    };
  },

  /**
   * Formats call ID for GetStream
   */
  formatCallId(meetingId: string): string {
    return `call_${meetingId}_${Date.now()}`;
  },

  /**
   * Parses GetStream webhook payload
   */
  parseWebhookPayload(body: string): { type: string; data: any } {
    const payload = JSON.parse(body);
    return {
      type: payload.type,
      data: payload,
    };
  },
};
