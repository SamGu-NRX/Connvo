/**
 * In-Call Prompts Hook
 * 
 * Hook for real-time in-call prompt subscriptions with lull detection.
 * 
 * Features:
 * - Real-time prompt updates via subscription
 * - Automatic lull detection triggers from backend
 * - Prompt dismissal and usage tracking
 * - New prompt notifications
 * 
 * Backend APIs:
 * - api.prompts.queries.subscribeToInCallPrompts (real-time subscription)
 * - api.prompts.mutations.updatePromptFeedback
 * - Triggered by: internal.prompts.actions.detectLullAndGeneratePrompts (backend scheduler)
 */

"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { useCallback, useEffect, useRef } from "react";

export interface InCallPrompt {
  _id: Id<"prompts">;
  content: string;
  tags: string[];
  relevance: number;
  usedAt?: number;
  feedback?: "used" | "dismissed" | "upvoted";
  createdAt: number;
}

export interface InCallPromptsSubscription {
  prompts: InCallPrompt[];
  lastUpdated: number;
}

export interface UseInCallPromptsResult {
  prompts: InCallPrompt[];
  isLoading: boolean;
  lastUpdated: number | undefined;
  hasNewPrompts: boolean;
  submitFeedback: (promptId: Id<"prompts">, feedback: "used" | "dismissed" | "upvoted") => Promise<void>;
  markPromptsAsSeen: () => void;
}

/**
 * Hook for managing real-time in-call prompts
 * 
 * @param meetingId - The meeting ID to subscribe to prompts for
 * @param onNewPrompt - Optional callback when new prompts arrive
 * @returns In-call prompts subscription utilities
 * 
 * @example
 * ```tsx
 * function InCallPromptsOverlay({ meetingId }) {
 *   const { prompts, hasNewPrompts, submitFeedback, markPromptsAsSeen } = 
 *     useInCallPrompts(meetingId, (newPrompts) => {
 *       toast.info(`${newPrompts.length} new conversation prompts available!`);
 *     });
 *   
 *   useEffect(() => {
 *     if (hasNewPrompts) {
 *       // Show notification or animate
 *       markPromptsAsSeen();
 *     }
 *   }, [hasNewPrompts, markPromptsAsSeen]);
 *   
 *   return (
 *     <div>
 *       {prompts.map(prompt => (
 *         <PromptCard
 *           key={prompt._id}
 *           prompt={prompt}
 *           onUse={() => submitFeedback(prompt._id, "used")}
 *           onDismiss={() => submitFeedback(prompt._id, "dismissed")}
 *         />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useInCallPrompts(
  meetingId: Id<"meetings">,
  onNewPrompt?: (newPrompts: InCallPrompt[]) => void
): UseInCallPromptsResult {
  const previousPromptsRef = useRef<InCallPrompt[]>([]);
  const lastSeenUpdateRef = useRef<number>(0);

  // Subscribe to real-time in-call prompts
  const subscription = useQuery(
    api.prompts.queries.subscribeToInCallPrompts,
    { meetingId }
  );

  // Mutation to submit feedback
  const updateFeedbackMutation = useMutation(api.prompts.mutations.updatePromptFeedback);

  const prompts = subscription?.prompts || [];
  const lastUpdated = subscription?.lastUpdated;

  // Detect new prompts and trigger callback
  useEffect(() => {
    if (!subscription || !onNewPrompt) return;

    const newPrompts = prompts.filter(
      (prompt) => !previousPromptsRef.current.some((p) => p._id === prompt._id)
    );

    if (newPrompts.length > 0) {
      onNewPrompt(newPrompts);
    }

    previousPromptsRef.current = prompts;
  }, [prompts, subscription, onNewPrompt]);

  // Check if there are new prompts since last seen
  const hasNewPrompts = lastUpdated !== undefined && lastUpdated > lastSeenUpdateRef.current;

  // Mark prompts as seen
  const markPromptsAsSeen = useCallback(() => {
    if (lastUpdated !== undefined) {
      lastSeenUpdateRef.current = lastUpdated;
    }
  }, [lastUpdated]);

  // Submit feedback callback
  const submitFeedback = useCallback(async (
    promptId: Id<"prompts">,
    feedback: "used" | "dismissed" | "upvoted"
  ) => {
    try {
      await updateFeedbackMutation({
        promptId,
        feedback,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Failed to submit prompt feedback:", err);
      throw err;
    }
  }, [updateFeedbackMutation]);

  return {
    prompts,
    isLoading: subscription === undefined,
    lastUpdated,
    hasNewPrompts,
    submitFeedback,
    markPromptsAsSeen,
  };
}