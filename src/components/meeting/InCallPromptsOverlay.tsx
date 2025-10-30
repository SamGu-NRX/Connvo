/**
 * In-Call Prompts Overlay Component
 * 
 * Displays real-time conversation prompts during active meetings.
 * 
 * Features:
 * - Toast-style notifications for new prompts
 * - Dismissable prompt cards
 * - Context-aware positioning
 * - Fade-in/out animations
 * - Subscription to backend lull detection
 */

"use client";

import React, { useEffect, useState } from "react";
import { useInCallPrompts } from "@/hooks/useInCallPrompts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { X, Check, MessageSquare, Sparkles } from "lucide-react";
import { Id } from "@convex/_generated/dataModel";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

interface InCallPromptsOverlayProps {
  meetingId: Id<"meetings">;
  position?: "top-right" | "bottom-right" | "top-left" | "bottom-left";
  className?: string;
}

export function InCallPromptsOverlay({
  meetingId,
  position = "bottom-right",
  className,
}: InCallPromptsOverlayProps) {
  const [dismissedPromptIds, setDismissedPromptIds] = useState<Set<Id<"prompts">>>(new Set());
  const [activePromptId, setActivePromptId] = useState<Id<"prompts"> | null>(null);

  const { prompts, hasNewPrompts, submitFeedback, markPromptsAsSeen } = useInCallPrompts(
    meetingId,
    (newPrompts) => {
      // Show toast notification for new prompts
      toast.info(`${newPrompts.length} new conversation ${newPrompts.length === 1 ? 'prompt' : 'prompts'} available!`, {
        icon: <Sparkles className="h-4 w-4" />,
      });
    }
  );

  // Mark prompts as seen when they appear
  useEffect(() => {
    if (hasNewPrompts) {
      markPromptsAsSeen();
    }
  }, [hasNewPrompts, markPromptsAsSeen]);

  // Filter out dismissed prompts
  const visiblePrompts = prompts.filter(
    (prompt) => !dismissedPromptIds.has(prompt._id)
  );

  // Show the most recent non-dismissed prompt
  const currentPrompt = visiblePrompts[0];

  const handleUse = async (promptId: Id<"prompts">) => {
    try {
      await submitFeedback(promptId, "used");
      setActivePromptId(null);
      toast.success("Great! That prompt has been marked as used.");
    } catch (error) {
      toast.error("Failed to mark prompt as used");
    }
  };

  const handleDismiss = async (promptId: Id<"prompts">) => {
    try {
      await submitFeedback(promptId, "dismissed");
      setDismissedPromptIds((prev) => new Set(prev).add(promptId));
      setActivePromptId(null);
    } catch (error) {
      toast.error("Failed to dismiss prompt");
    }
  };

  const handleShow = (promptId: Id<"prompts">) => {
    setActivePromptId(promptId);
  };

  const handleHide = () => {
    setActivePromptId(null);
  };

  // Position classes
  const positionClasses = {
    "top-right": "top-4 right-4",
    "bottom-right": "bottom-4 right-4",
    "top-left": "top-4 left-4",
    "bottom-left": "bottom-4 left-4",
  };

  if (!currentPrompt) {
    return null;
  }

  return (
    <div
      className={`pointer-events-none fixed z-50 ${positionClasses[position]} ${className}`}
    >
      <AnimatePresence mode="wait">
        {activePromptId === currentPrompt._id ? (
          // Expanded prompt card
          <motion.div
            key={`expanded-${currentPrompt._id}`}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto"
          >
            <Card className="w-80 border-emerald-200 bg-white shadow-lg dark:border-emerald-800 dark:bg-zinc-900">
              <CardContent className="p-4">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-emerald-500" />
                    <span className="text-xs font-medium text-muted-foreground">
                      Conversation Prompt
                    </span>
                  </div>
                  <Button
                    onClick={handleHide}
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>

                <p className="mb-4 text-sm leading-relaxed">
                  {currentPrompt.content}
                </p>

                <div className="mb-4 flex flex-wrap gap-1">
                  {currentPrompt.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => handleUse(currentPrompt._id)}
                    size="sm"
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Check className="mr-1 h-3 w-3" />
                    I Used This
                  </Button>
                  <Button
                    onClick={() => handleDismiss(currentPrompt._id)}
                    size="sm"
                    variant="outline"
                    className="flex-1"
                  >
                    <X className="mr-1 h-3 w-3" />
                    Dismiss
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          // Minimized notification button
          <motion.div
            key={`minimized-${currentPrompt._id}`}
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ duration: 0.3 }}
            className="pointer-events-auto"
          >
            <Button
              onClick={() => handleShow(currentPrompt._id)}
              className="bg-emerald-600 shadow-lg hover:bg-emerald-700"
              size="lg"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              New Prompt Available
              {visiblePrompts.length > 1 && (
                <Badge variant="secondary" className="ml-2">
                  {visiblePrompts.length}
                </Badge>
              )}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default InCallPromptsOverlay;