/**
 * Meeting Lifecycle Hook
 * 
 * Hook for managing meeting lifecycle and triggering backend services.
 * 
 * Features:
 * - Meeting creation with automatic prompt generation
 * - Meeting state transitions (scheduled → active → concluded)
 * - Automatic post-call processing trigger
 * - Connection info for video calls
 * 
 * Backend APIs:
 * - api.meetings.lifecycle.createMeeting
 * - api.meetings.lifecycle.startMeeting
 * - api.meetings.lifecycle.endMeeting
 * - api.meetings.lifecycle.getMeetingConnectionInfo
 * - Triggers: api.prompts.actions.generatePreCallIdeas (on create)
 * - Triggers: internal.meetings.postProcessing.handleMeetingEnd (on end)
 */

"use client";

import { useMutation, useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { useCallback, useState } from "react";

export interface CreateMeetingParams {
  title: string;
  description?: string;
  scheduledAt?: number;
  duration?: number;
  participantIds: Id<"users">[];
  generatePrompts?: boolean;
}

export interface MeetingConnectionInfo {
  videoProvider: "getstream" | "webrtc";
  connectionInfo: {
    roomId?: string;
    token?: string;
    iceServers?: Array<{
      urls: string | string[];
      username?: string;
      credential?: string;
    }>;
  };
}

export interface UseMeetingLifecycleResult {
  createMeeting: (params: CreateMeetingParams) => Promise<Id<"meetings">>;
  startMeeting: (meetingId: Id<"meetings">) => Promise<void>;
  endMeeting: (meetingId: Id<"meetings">) => Promise<void>;
  getConnectionInfo: (meetingId: Id<"meetings">) => MeetingConnectionInfo | undefined;
  isCreating: boolean;
  isStarting: boolean;
  isEnding: boolean;
  error: Error | null;
}

/**
 * Hook for managing meeting lifecycle
 * 
 * @returns Meeting lifecycle management utilities
 * 
 * @example
 * ```tsx
 * function CreateMeetingFlow() {
 *   const { createMeeting, startMeeting, isCreating } = useMeetingLifecycle();
 *   const router = useRouter();
 *   
 *   const handleCreateAndStart = async () => {
 *     // Create meeting with participants
 *     const meetingId = await createMeeting({
 *       title: "Networking Call",
 *       participantIds: [userId1, userId2],
 *       generatePrompts: true, // Auto-generate conversation starters
 *     });
 *     
 *     // Navigate to pre-call screen
 *     router.push(`/meeting/${meetingId}/prepare`);
 *   };
 *   
 *   return (
 *     <Button onClick={handleCreateAndStart} disabled={isCreating}>
 *       {isCreating ? "Creating..." : "Start Meeting"}
 *     </Button>
 *   );
 * }
 * 
 * function VideoCallRoom({ meetingId }) {
 *   const { startMeeting, endMeeting, getConnectionInfo } = useMeetingLifecycle();
 *   const connectionInfo = getConnectionInfo(meetingId);
 *   
 *   useEffect(() => {
 *     // Start meeting when component mounts
 *     startMeeting(meetingId);
 *   }, [meetingId, startMeeting]);
 *   
 *   const handleLeave = async () => {
 *     await endMeeting(meetingId);
 *     router.push(`/meeting/${meetingId}/insights`);
 *   };
 *   
 *   return <VideoCall connectionInfo={connectionInfo} onLeave={handleLeave} />;
 * }
 * ```
 */
export function useMeetingLifecycle(): UseMeetingLifecycleResult {
  const [isCreating, setIsCreating] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentMeetingId, setCurrentMeetingId] = useState<Id<"meetings"> | null>(null);

  // Mutations
  const createMeetingMutation = useMutation(api.meetings.lifecycle.createMeeting);
  const startMeetingMutation = useMutation(api.meetings.lifecycle.startMeeting);
  const endMeetingMutation = useMutation(api.meetings.lifecycle.endMeeting);

  // Actions
  const generatePromptsAction = useAction(api.prompts.actions.generatePreCallIdeas);

  // Query connection info when needed
  const connectionInfo = useQuery(
    currentMeetingId
      ? api.meetings.lifecycle.getMeetingConnectionInfo
      : "skip" as any,
    currentMeetingId ? { meetingId: currentMeetingId } : undefined
  );

  /**
   * Creates a new meeting and optionally generates pre-call prompts
   */
  const createMeeting = useCallback(async (params: CreateMeetingParams): Promise<Id<"meetings">> => {
    setIsCreating(true);
    setError(null);

    try {
      // Create meeting
      const meetingId = await createMeetingMutation({
        title: params.title,
        description: params.description,
        scheduledAt: params.scheduledAt,
        duration: params.duration,
        participantIds: params.participantIds,
      });

      setCurrentMeetingId(meetingId);

      // Generate pre-call prompts if requested (default: true)
      if (params.generatePrompts !== false) {
        try {
          await generatePromptsAction({
            meetingId,
            forceRegenerate: false,
          });
        } catch (err) {
          // Don't fail meeting creation if prompt generation fails
          console.warn("Failed to generate pre-call prompts:", err);
        }
      }

      return meetingId;
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to create meeting");
      setError(error);
      throw error;
    } finally {
      setIsCreating(false);
    }
  }, [createMeetingMutation, generatePromptsAction]);

  /**
   * Starts a meeting (transitions from scheduled → active)
   * This initializes backend services:
   * - Transcript streaming
   * - Lull detection scheduler
   * - Real-time note sync
   */
  const startMeeting = useCallback(async (meetingId: Id<"meetings">): Promise<void> => {
    setIsStarting(true);
    setError(null);
    setCurrentMeetingId(meetingId);

    try {
      await startMeetingMutation({ meetingId });
      
      // Backend automatically:
      // - Sets meeting state to "active"
      // - Initializes transcript streaming
      // - Starts lull detection scheduler (runs every 30s)
      // - Enables real-time note synchronization
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to start meeting");
      setError(error);
      throw error;
    } finally {
      setIsStarting(false);
    }
  }, [startMeetingMutation]);

  /**
   * Ends a meeting (transitions from active → concluded)
   * This triggers post-processing:
   * - Transcript aggregation (5s delay)
   * - Participant insights generation (30s delay)
   * - Meeting analytics update (1min delay)
   * - Resource cleanup (5min delay)
   */
  const endMeeting = useCallback(async (meetingId: Id<"meetings">): Promise<void> => {
    setIsEnding(true);
    setError(null);

    try {
      await endMeetingMutation({ meetingId });
      
      // Backend automatically schedules:
      // - internal.transcripts.aggregation.aggregateTranscriptSegments (5s)
      // - internal.insights.generation.generateParticipantInsights (30s)
      // - internal.analytics.meetings.updateMeetingAnalytics (1min)
      // - internal.meetings.stream.cleanup.cleanupMeetingResources (5min)
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to end meeting");
      setError(error);
      throw error;
    } finally {
      setIsEnding(false);
    }
  }, [endMeetingMutation]);

  /**
   * Gets connection info for video call
   */
  const getConnectionInfo = useCallback((meetingId: Id<"meetings">): MeetingConnectionInfo | undefined => {
    if (currentMeetingId !== meetingId) {
      setCurrentMeetingId(meetingId);
    }
    return connectionInfo;
  }, [connectionInfo, currentMeetingId]);

  return {
    createMeeting,
    startMeeting,
    endMeeting,
    getConnectionInfo,
    isCreating,
    isStarting,
    isEnding,
    error,
  };

  return {
    createMeeting,
    startMeeting,
    endMeeting,
    getConnectionInfo,
    isCreating,
    isStarting,
    isEnding,
    error,
  };
}