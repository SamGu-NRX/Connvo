/**
 * Pre-Call Prompts Hook
 * 
 * Hook for pre-call prompt generation and display with feedback submission.
 * 
 * Features:
 * - Automatic prompt generation on meeting creation
 * - Feedback submission (used/dismissed/upvoted)
 * - Loading and error states
 * - Force regeneration capability
 * 
 * Backend APIs:
 * - api.prompts.queries.getPreCallPrompts
 * - api.prompts.actions.generatePreCallIdeas
 * - api.prompts.mutations.updatePromptFeedback
 */

"use client";

import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { useCallback, useState } from "react";

export interface PreCallPrompt {
  _id: Id<"prompts">;
  content: string;
  tags: string[];
  relevance: number;
  usedAt?: number;
  feedback?: "used" | "dismissed" | "upvoted";
  createdAt: number;
}

export interface UsePreCallPromptsResult {
  prompts: PreCallPrompt[] | undefined;
  isLoading: boolean;
  isGenerating: boolean;
  error: Error | null;
  generatePrompts: (options?: { forceRegenerate?: boolean }) => Promise<void>;
  submitFeedback: (promptId: Id<"prompts">, feedback: "used" | "dismissed" | "upvoted") => Promise<void>;
  hasPrompts: boolean;
}

/**
 * Hook for managing pre-call prompts
 * 
 * @param meetingId - The meeting ID to fetch prompts for
 * @param autoGenerate - Whether to automatically generate prompts if none exist (default: true)
 * @returns Pre-call prompts management utilities
 * 
 * @example
 * ```tsx
 * function PreCallScreen({ meetingId }) {
 *   const { prompts, isLoading, submitFeedback } = usePreCallPrompts(meetingId);
 *   
 *   if (isLoading) return <Spinner />;
 *   
 *   return (
 *     <div>
 *       {prompts?.map(prompt => (
 *         <PromptCard
 *           key={prompt._id}
 *           prompt={prompt}
 *           onUpvote={() => submitFeedback(prompt._id, "upvoted")}
 *           onDismiss={() => submitFeedback(prompt._id, "dismissed")}
 *         />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePreCallPrompts(
  meetingId: Id<"meetings">,
  autoGenerate: boolean = true
): UsePreCallPromptsResult {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Query prompts from backend
  const prompts = useQuery(
    api.prompts.queries.getPreCallPrompts,
    { meetingId, limit: 10 }
  );

  // Action to generate new prompts
  const generatePromptsAction = useAction(api.prompts.actions.generatePreCallIdeas);

  // Mutation to submit feedback
  const updateFeedbackMutation = useMutation(api.prompts.mutations.updatePromptFeedback);

  // Auto-generate prompts if none exist
  const [hasAttemptedGeneration, setHasAttemptedGeneration] = useState(false);
  
  // Generate prompts callback
  const generatePrompts = useCallback(async (options?: { forceRegenerate?: boolean }) => {
    setIsGenerating(true);
    setError(null);

    try {
      await generatePromptsAction({
        meetingId,
        forceRegenerate: options?.forceRegenerate || false,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to generate prompts");
      setError(error);
      console.error("Failed to generate pre-call prompts:", error);
    } finally {
      setIsGenerating(false);
    }
  }, [meetingId, generatePromptsAction]);

  // Auto-generate on mount if needed
  if (autoGenerate && prompts !== undefined && prompts.length === 0 && !hasAttemptedGeneration && !isGenerating) {
    // Mark as attempted to prevent infinite loops
    setHasAttemptedGeneration(true);
    generatePrompts();
  }

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
    isLoading: prompts === undefined,
    isGenerating,
    error,
    generatePrompts,
    submitFeedback,
    hasPrompts: (prompts?.length || 0) > 0,
  };
}