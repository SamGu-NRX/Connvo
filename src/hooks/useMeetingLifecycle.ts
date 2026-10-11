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
 * - An acceptance journal for create/start/end: a lost ack can neither
 *   double-accept nor re-send an accepted lifecycle mutation, and an
 *   unknowable outcome is surfaced as state instead of retried blindly.
 * - Prompt-generation failures surfaced as state, not only console.warn.
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
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

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

/** Journal states for lifecycle mutations.
 * - pending: send in flight (concurrent invocations share the promise)
 * - accepted: ack received — NEVER re-sent, the recorded result is returned
 * - unconfirmed: the send's outcome is unknowable (ack/request lost);
 *   surfaced as state, an explicit retry records a new attempt
 * - failed: a definite domain rejection (the server did not apply it) */
export type LifecycleJournalState =
  | "pending"
  | "accepted"
  | "unconfirmed"
  | "failed";

export interface LifecycleJournalEntry {
  readonly key: string;
  readonly operation: "create" | "start" | "end";
  /** meetingId for start/end; client correlation key for create. */
  readonly target: string;
  readonly state: LifecycleJournalState;
  readonly attempts: number;
  /** Recorded outcome of an accepted mutation (create: the meeting id). */
  readonly result?: unknown;
  readonly error?: string;
  readonly updatedAt: number;
}

/** Prompt-generation status, surfaced as state (not only console.warn). */
export interface PromptGenerationState {
  status: "idle" | "generating" | "succeeded" | "failed";
  meetingId: Id<"meetings"> | null;
  error: string | null;
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
  lifecycleJournal: LifecycleJournalEntry[];
  promptGeneration: PromptGenerationState;
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

/** Deterministic correlation key for a create submission: the same logical
 * create (same params) maps to the same journal entry, so an accepted
 * create is never re-sent and a lost ack is visible on the right entry. */
function createCorrelationKey(params: CreateMeetingParams): string {
  const canonical = JSON.stringify([
    params.title,
    params.description ?? null,
    params.scheduledAt ?? null,
    params.duration ?? null,
    [...params.participantIds].sort(),
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `create-${hash.toString(16).padStart(8, "0")}`;
}

function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const data = (error as { data?: { code?: unknown } }).data;
    const code = typeof data?.code === "string" ? data.code : "UNKNOWN";
    return { code, message: error.message };
  }
  return { code: "UNKNOWN", message: String(error) };
}

/** Codes that mean "the send did not complete normally and we cannot know
 * whether the server applied it" — everything else is a definite domain
 * rejection. */
function isUnknowableFailureCode(code: string): boolean {
  return code === "ACK_LOST" || code === "NETWORK_LOST" || code === "UNKNOWN";
}

/**
 * Module-scoped acceptance journal. Per-mutation state must survive hook
 * remounts (strict-mode double-mounts, navigation mid-mutation) — otherwise
 * a lost ack could be double-accepted or an accepted mutation re-sent.
 * External store: the hook reads it through useSyncExternalStore.
 */
class LifecycleJournalStore {
  private entries = new Map<string, LifecycleJournalEntry>();
  private inFlight = new Map<string, Promise<unknown>>();
  private listeners = new Set<() => void>();
  private revision = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): number => this.revision;

  list(): LifecycleJournalEntry[] {
    return [...this.entries.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  }

  get(key: string): LifecycleJournalEntry | undefined {
    return this.entries.get(key);
  }

  record(entry: LifecycleJournalEntry): void {
    this.entries.set(entry.key, entry);
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  inFlightOf(key: string): Promise<unknown> | undefined {
    return this.inFlight.get(key);
  }

  setInFlight(key: string, promise: Promise<unknown>): void {
    this.inFlight.set(key, promise);
  }

  clearInFlight(key: string): void {
    this.inFlight.delete(key);
  }

  /** Test isolation only — not used in production code paths. */
  reset(): void {
    this.entries.clear();
    this.inFlight.clear();
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

const lifecycleJournalStore = new LifecycleJournalStore();

/** Drop all journaled lifecycle state (test isolation). */
export function resetLifecycleJournal(): void {
  lifecycleJournalStore.reset();
}

export function useMeetingLifecycle(): UseMeetingLifecycleResult {
  const [isCreating, setIsCreating] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentMeetingId, setCurrentMeetingId] = useState<Id<"meetings"> | null>(null);
  const [promptGeneration, setPromptGeneration] = useState<PromptGenerationState>({
    status: "idle",
    meetingId: null,
    error: null,
  });

  // Acceptance journal: module-scoped external store, read through
  // useSyncExternalStore. Concurrent invocations of the same journal entry
  // share one in-flight send; entries survive hook remounts.
  const journalRevision = useSyncExternalStore(
    lifecycleJournalStore.subscribe,
    lifecycleJournalStore.getSnapshot,
    // Server rendering reads the same pure snapshot (React 19 requires
    // the third argument under renderToStaticMarkup).
    lifecycleJournalStore.getSnapshot
  );
  const lifecycleJournal = useMemo(
    () => {
      void journalRevision;
      return lifecycleJournalStore.list();
    },
    [journalRevision]
  );

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
  ) as MeetingConnectionInfo | undefined;

  // getConnectionInfo may be called during the consumer's render; updating
  // state there is the render-phase setState bug (fixed). The request is
  // recorded in a ref and synced into state AFTER render, so the query
  // subscription follows the requested meeting one render later.
  const requestedMeetingIdRef = useRef<Id<"meetings"> | null>(null);

  useEffect(() => {
    const requested = requestedMeetingIdRef.current;
    if (requested && requested !== currentMeetingId) {
      setCurrentMeetingId(requested);
    }
  });

  /**
   * Run one lifecycle mutation under the acceptance journal.
   * - accepted: return the recorded result without a network call.
   * - pending:  share the in-flight promise (no double send).
   * - none/unconfirmed/failed: send, recording the attempt; the outcome is
   *   accepted (ack), failed (domain rejection) or unconfirmed (unknowable).
   */
  const runJournaled = useCallback(
    <T,>(
      key: string,
      operation: LifecycleJournalEntry["operation"],
      target: string,
      send: () => Promise<T>
    ): Promise<T> => {
      const entry = lifecycleJournalStore.get(key);
      if (entry?.state === "accepted") {
        // An accepted lifecycle mutation is never re-sent and never
        // double-accepted — the recorded result is the outcome.
        return Promise.resolve(entry.result as T);
      }
      const inFlight = lifecycleJournalStore.inFlightOf(key);
      if (entry?.state === "pending" && inFlight) {
        return inFlight as Promise<T>;
      }

      const attempt = (entry?.attempts ?? 0) + 1;
      lifecycleJournalStore.record({
        key,
        operation,
        target,
        state: "pending",
        attempts: attempt,
        result: entry?.result,
        updatedAt: Date.now(),
      });

      const sendPromise = (async () => {
        try {
          const result = await send();
          lifecycleJournalStore.record({
            key,
            operation,
            target,
            state: "accepted",
            attempts: attempt,
            result,
            updatedAt: Date.now(),
          });
          return result;
        } catch (err) {
          const failure = describeError(err);
          const state: LifecycleJournalState = isUnknowableFailureCode(failure.code)
            ? "unconfirmed"
            : "failed";
          lifecycleJournalStore.record({
            key,
            operation,
            target,
            state,
            attempts: attempt,
            error: failure.message,
            updatedAt: Date.now(),
          });
          throw err;
        } finally {
          lifecycleJournalStore.clearInFlight(key);
        }
      })();
      lifecycleJournalStore.setInFlight(key, sendPromise);
      return sendPromise;
    },
    []
  );

  /**
   * Creates a new meeting and optionally generates pre-call prompts
   */
  const createMeeting = useCallback(async (params: CreateMeetingParams): Promise<Id<"meetings">> => {
    setIsCreating(true);
    setError(null);

    try {
      // Create meeting (journaled: a lost ack is surfaced as unconfirmed,
      // an accepted create is never re-sent)
      const meetingId = await runJournaled(
        createCorrelationKey(params),
        "create",
        createCorrelationKey(params),
        () =>
          createMeetingMutation({
            title: params.title,
            description: params.description,
            scheduledAt: params.scheduledAt,
            duration: params.duration,
            participantIds: params.participantIds,
          })
      );

      setCurrentMeetingId(meetingId);

      // Generate pre-call prompts if requested (default: true)
      if (params.generatePrompts !== false) {
        setPromptGeneration({
          status: "generating",
          meetingId,
          error: null,
        });
        try {
          await generatePromptsAction({
            meetingId,
            forceRegenerate: false,
          });
          setPromptGeneration({
            status: "succeeded",
            meetingId,
            error: null,
          });
        } catch (err) {
          // Don't fail meeting creation if prompt generation fails — but
          // surface it as state, not only console.warn.
          const message = describeError(err).message;
          console.warn("Failed to generate pre-call prompts:", err);
          setPromptGeneration({
            status: "failed",
            meetingId,
            error: message,
          });
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
  }, [createMeetingMutation, generatePromptsAction, runJournaled]);

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
      await runJournaled(`start:${meetingId}`, "start", meetingId, () =>
        startMeetingMutation({ meetingId })
      );

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
  }, [startMeetingMutation, runJournaled]);

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
      await runJournaled(`end:${meetingId}`, "end", meetingId, () =>
        endMeetingMutation({ meetingId })
      );

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
  }, [endMeetingMutation, runJournaled]);

  /**
   * Gets connection info for video call. Pure during render: no state is
   * updated here (the effect above syncs the request into the query
   * subscription after render).
   */
  const getConnectionInfo = useCallback((meetingId: Id<"meetings">): MeetingConnectionInfo | undefined => {
    requestedMeetingIdRef.current = meetingId;
    return currentMeetingId === meetingId ? connectionInfo : undefined;
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
    lifecycleJournal,
    promptGeneration,
  };
}
