/**
 * Pre-Call Prompts Card Component
 * 
 * Displays AI-generated conversation starters before a meeting begins.
 * 
 * Features:
 * - Display prompts with relevance scores
 * - Tag categorization
 * - User feedback (upvote/dismiss)
 * - Loading and empty states
 */

"use client";

import React from "react";
import { usePreCallPrompts } from "@/hooks/usePreCallPrompts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Lightbulb,
  ThumbsUp,
  X,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";

interface PreCallPromptsCardProps {
  meetingId: Id<"meetings">;
  className?: string;
}

export function PreCallPromptsCard({
  meetingId,
  className,
}: PreCallPromptsCardProps) {
  const {
    prompts,
    isLoading,
    isGenerating,
    generatePrompts,
    submitFeedback,
    hasPrompts,
  } = usePreCallPrompts(meetingId);

  const handleUpvote = async (promptId: Id<"prompts">) => {
    try {
      await submitFeedback(promptId, "upvoted");
      toast.success("Thanks for the feedback!");
    } catch (error) {
      toast.error("Failed to submit feedback");
    }
  };

  const handleDismiss = async (promptId: Id<"prompts">) => {
    try {
      await submitFeedback(promptId, "dismissed");
    } catch (error) {
      toast.error("Failed to dismiss prompt");
    }
  };

  const handleRegenerate = async () => {
    try {
      await generatePrompts({ forceRegenerate: true });
      toast.success("Generated new conversation starters!");
    } catch (error) {
      toast.error("Failed to generate prompts");
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!hasPrompts && !isGenerating) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-emerald-500" />
            Conversation Starters
          </CardTitle>
          <CardDescription>
            AI-generated based on participant profiles
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Sparkles className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground mb-4 text-sm">
              No conversation starters yet
            </p>
            <Button
              onClick={handleRegenerate}
              disabled={isGenerating}
              variant="outline"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Ideas
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-emerald-500" />
              Conversation Starters
            </CardTitle>
            <CardDescription>
              AI-generated based on participant profiles
            </CardDescription>
          </div>
          <Button
            onClick={handleRegenerate}
            disabled={isGenerating}
            variant="ghost"
            size="sm"
          >
            <RefreshCw
              className={`h-4 w-4 ${isGenerating ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {prompts?.map((prompt) => (
          <PromptItem
            key={prompt._id}
            prompt={prompt}
            onUpvote={() => handleUpvote(prompt._id)}
            onDismiss={() => handleDismiss(prompt._id)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

interface PromptItemProps {
  prompt: {
    _id: Id<"prompts">;
    content: string;
    tags: string[];
    relevance: number;
    feedback?: "used" | "dismissed" | "upvoted";
  };
  onUpvote: () => void;
  onDismiss: () => void;
}

function PromptItem({ prompt, onUpvote, onDismiss }: PromptItemProps) {
  const dismissed = prompt.feedback === "dismissed";
  const upvoted = prompt.feedback === "upvoted";

  if (dismissed) {
    return null; // Hide dismissed prompts
  }

  return (
    <div className="bg-muted/50 group rounded-lg border p-4 transition-all hover:border-emerald-200 hover:bg-emerald-50/50 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20">
      <div className="mb-3 flex items-start justify-between gap-2">
        <p className="text-sm leading-relaxed">{prompt.content}</p>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            onClick={onUpvote}
            variant="ghost"
            size="sm"
            className={`h-8 w-8 p-0 ${upvoted ? "text-emerald-600" : ""}`}
          >
            <ThumbsUp className="h-4 w-4" />
          </Button>
          <Button
            onClick={onDismiss}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {prompt.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          <span>{Math.round(prompt.relevance * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

export default PreCallPromptsCard;