/**
 * AI Prompt and Insight Entity Type Definitions
 *
 * This module defines all AI-related entity types including prompts,
 * insights, and AI-generated content.
 *
 * Requirements: 1.1, 2.1, 2.2, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper entity modeling for AI systems
 */

import type { Id } from "../../_generated/dataModel";

// AI prompt types (matches schema exactly)
export type PromptType = "precall" | "incall";

// Prompt feedback types (matches schema exactly)
export type PromptFeedback = "used" | "dismissed" | "upvoted";

// AI prompt entity (matches convex/schema/ai.ts exactly)
export interface AIPrompt {
  _id: Id<"prompts">;
  meetingId: Id<"meetings">;
  type: PromptType;
  content: string;
  tags: string[];
  relevance: number;
  usedAt?: number;
  feedback?: PromptFeedback;
  createdAt: number;
}

// AI insights entity (matches schema exactly)
export interface AIInsight {
  _id: Id<"insights">;
  userId: Id<"users">;
  meetingId: Id<"meetings">;
  summary: string;
  actionItems: string[];
  recommendations: Array<{
    type: string;
    content: string;
    confidence: number;
  }>;
  links: Array<{
    type: string;
    url: string;
    title: string;
  }>;
  createdAt: number;
}

// Derived types for API responses

// AI prompt with usage statistics
export interface AIPromptWithStats extends AIPrompt {
  usageCount: number;
  averageRelevance: number;
  feedbackStats: {
    used: number;
    dismissed: number;
    upvoted: number;
  };
}

// AI insight with user details
export interface AIInsightWithUser extends AIInsight {
  user: {
    _id: Id<"users">;
    displayName?: string;
    avatarUrl?: string;
  };
  meeting: {
    _id: Id<"meetings">;
    title: string;
    scheduledAt?: number;
  };
}

// AI content generation request
export interface AIContentGenerationRequest {
  type: "prompt" | "insight" | "summary" | "action_items";
  meetingId: Id<"meetings">;
  context: {
    transcriptText?: string;
    meetingDuration?: number;
    participantCount?: number;
    topics?: string[];
  };
  parameters?: {
    maxLength?: number;
    tone?: "professional" | "casual" | "friendly";
    focus?: string[];
  };
}

// AI content generation result
export interface AIContentGenerationResult {
  type: AIContentGenerationRequest["type"];
  content: string;
  confidence: number;
  processingTime: number;
  metadata: {
    model: string;
    tokensUsed: number;
    cost?: number;
  };
  success: boolean;
  error?: string;
}

// AI model configuration
export interface AIModelConfig {
  modelName: string;
  provider: "openai" | "anthropic" | "cohere" | "custom";
  version: string;
  capabilities: string[];
  parameters: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
  costPerToken: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

// AI analytics and metrics
export interface AIAnalytics {
  totalPrompts: number;
  totalInsights: number;
  promptsByType: Record<PromptType, number>;
  feedbackStats: Record<PromptFeedback, number>;
  averageRelevance: number;
  usageMetrics: {
    totalGenerations: number;
    averageProcessingTime: number;
    totalTokensUsed: number;
    totalCost: number;
  };
  qualityMetrics: {
    averageConfidence: number;
    userSatisfaction: number;
    contentAccuracy: number;
  };
  modelPerformance: Record<
    string,
    {
      usage: number;
      averageConfidence: number;
      averageProcessingTime: number;
      cost: number;
    }
  >;
}

// AI prompt template
export interface AIPromptTemplate {
  templateId: string;
  name: string;
  description: string;
  type: PromptType;
  template: string;
  variables: Array<{
    name: string;
    type: "string" | "number" | "boolean" | "array";
    required: boolean;
    description: string;
    defaultValue?: any;
  }>;
  tags: string[];
  isActive: boolean;
  createdBy: Id<"users">;
  createdAt: number;
  updatedAt: number;
}

// AI feedback and learning
export interface AIFeedback {
  contentId: string; // Could be prompt ID or insight ID
  contentType: "prompt" | "insight";
  userId: Id<"users">;
  meetingId: Id<"meetings">;
  rating: number; // 1-5 scale
  feedback?: string;
  categories?: {
    relevance: number;
    accuracy: number;
    usefulness: number;
    clarity: number;
  };
  improvements?: string[];
  submittedAt: number;
}
