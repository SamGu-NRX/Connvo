/**
 * AI Prompt and Insight Validators
 *
 * This module provides Convex validators that correspond to the AI Prompt entity types,
 * ensuring type-validator alignment and runtime validation.
 *
 * Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 4.1, 4.2
 * Compliance: steering/convex_rules.mdc - Proper validator patterns for AI systems
 */

import { v } from "convex/values";
import type {
  AIPrompt,
  AIInsight,
  AIPromptWithStats,
  AIInsightWithUser,
  AIContentGenerationRequest,
  AIContentGenerationResult,
  AIModelConfig,
  AIAnalytics,
  AIPromptTemplate,
  AIFeedback,
} from "../entities/prompt";

// Prompt type validator
const promptTypeV = v.union(v.literal("precall"), v.literal("incall"));

// Prompt feedback validator
const promptFeedbackV = v.union(
  v.literal("used"),
  v.literal("dismissed"),
  v.literal("upvoted"),
);

// Recommendation validator (for insights)
export const RecommendationV = v.object({
  type: v.string(),
  content: v.string(),
  confidence: v.number(),
});

// Link validator (for insights)
export const LinkV = v.object({
  type: v.string(),
  url: v.string(),
  title: v.string(),
});

// Core AI Prompt validators (matches schema exactly)
export const AIPromptV = {
  // Full prompt entity
  full: v.object({
    _id: v.id("prompts"),
    meetingId: v.id("meetings"),
    type: promptTypeV,
    content: v.string(),
    tags: v.array(v.string()),
    relevance: v.number(),
    usedAt: v.optional(v.number()),
    feedback: v.optional(promptFeedbackV),
    createdAt: v.number(),
  }),

  // Prompt with usage statistics
  withStats: v.object({
    _id: v.id("prompts"),
    meetingId: v.id("meetings"),
    type: promptTypeV,
    content: v.string(),
    tags: v.array(v.string()),
    relevance: v.number(),
    usedAt: v.optional(v.number()),
    feedback: v.optional(promptFeedbackV),
    createdAt: v.number(),
    usageCount: v.number(),
    averageRelevance: v.number(),
    feedbackStats: v.object({
      used: v.number(),
      dismissed: v.number(),
      upvoted: v.number(),
    }),
  }),
} as const;

// AI Insight validators (matches schema exactly)
export const AIInsightV = {
  // Full insight entity
  full: v.object({
    _id: v.id("insights"),
    userId: v.id("users"),
    meetingId: v.id("meetings"),
    summary: v.string(),
    actionItems: v.array(v.string()),
    recommendations: v.array(RecommendationV),
    links: v.array(LinkV),
    createdAt: v.number(),
  }),

  // Insight list item (for getUserInsights)
  listItem: v.object({
    _id: v.id("insights"),
    meetingId: v.id("meetings"),
    summary: v.string(),
    actionItems: v.array(v.string()),
    recommendations: v.array(RecommendationV),
    createdAt: v.number(),
    meetingTitle: v.string(),
    meetingDate: v.number(),
  }),

  // Insight with meeting details (for getInsightById)
  withMeeting: v.object({
    _id: v.id("insights"),
    meetingId: v.id("meetings"),
    summary: v.string(),
    actionItems: v.array(v.string()),
    recommendations: v.array(RecommendationV),
    links: v.array(LinkV),
    createdAt: v.number(),
    meetingTitle: v.string(),
    meetingDate: v.number(),
  }),

  // Insight with user details
  withUser: v.object({
    _id: v.id("insights"),
    userId: v.id("users"),
    meetingId: v.id("meetings"),
    summary: v.string(),
    actionItems: v.array(v.string()),
    recommendations: v.array(RecommendationV),
    links: v.array(LinkV),
    createdAt: v.number(),
    user: v.object({
      _id: v.id("users"),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
    }),
    meeting: v.object({
      _id: v.id("meetings"),
      title: v.string(),
      scheduledAt: v.optional(v.number()),
    }),
  }),
} as const;

// AI Content Generation validators
export const AIContentGenerationV = {
  request: v.object({
    type: v.union(
      v.literal("prompt"),
      v.literal("insight"),
      v.literal("summary"),
      v.literal("action_items"),
    ),
    meetingId: v.id("meetings"),
    context: v.object({
      transcriptText: v.optional(v.string()),
      meetingDuration: v.optional(v.number()),
      participantCount: v.optional(v.number()),
      topics: v.optional(v.array(v.string())),
    }),
    parameters: v.optional(
      v.object({
        maxLength: v.optional(v.number()),
        tone: v.optional(
          v.union(
            v.literal("professional"),
            v.literal("casual"),
            v.literal("friendly"),
          ),
        ),
        focus: v.optional(v.array(v.string())),
      }),
    ),
  }),

  result: v.object({
    type: v.union(
      v.literal("prompt"),
      v.literal("insight"),
      v.literal("summary"),
      v.literal("action_items"),
    ),
    content: v.string(),
    confidence: v.number(),
    processingTime: v.number(),
    metadata: v.object({
      model: v.string(),
      tokensUsed: v.number(),
      cost: v.optional(v.number()),
    }),
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
} as const;

// Connection recommendation validator
export const ConnectionRecommendationV = v.object({
  type: v.string(),
  content: v.string(),
  confidence: v.number(),
  meetingId: v.id("meetings"),
  meetingTitle: v.string(),
  createdAt: v.number(),
});

// AI Model Config validators
export const AIModelConfigV = {
  full: v.object({
    modelName: v.string(),
    provider: v.union(
      v.literal("openai"),
      v.literal("anthropic"),
      v.literal("cohere"),
      v.literal("custom"),
    ),
    version: v.string(),
    capabilities: v.array(v.string()),
    parameters: v.object({
      temperature: v.optional(v.number()),
      maxTokens: v.optional(v.number()),
      topP: v.optional(v.number()),
      frequencyPenalty: v.optional(v.number()),
      presencePenalty: v.optional(v.number()),
    }),
    costPerToken: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
} as const;

// AI Analytics validators
export const AIAnalyticsV = {
  full: v.object({
    totalPrompts: v.number(),
    totalInsights: v.number(),
    promptsByType: v.record(v.string(), v.number()), // PromptType -> count
    feedbackStats: v.record(v.string(), v.number()), // PromptFeedback -> count
    averageRelevance: v.number(),
    usageMetrics: v.object({
      totalGenerations: v.number(),
      averageProcessingTime: v.number(),
      totalTokensUsed: v.number(),
      totalCost: v.number(),
    }),
    qualityMetrics: v.object({
      averageConfidence: v.number(),
      userSatisfaction: v.number(),
      contentAccuracy: v.number(),
    }),
    modelPerformance: v.record(
      v.string(),
      v.object({
        usage: v.number(),
        averageConfidence: v.number(),
        averageProcessingTime: v.number(),
        cost: v.number(),
      }),
    ),
  }),
} as const;

// AI Prompt Template validators
export const AIPromptTemplateV = {
  full: v.object({
    templateId: v.string(),
    name: v.string(),
    description: v.string(),
    type: promptTypeV,
    template: v.string(),
    variables: v.array(
      v.object({
        name: v.string(),
        type: v.union(
          v.literal("string"),
          v.literal("number"),
          v.literal("boolean"),
          v.literal("array"),
        ),
        required: v.boolean(),
        description: v.string(),
        defaultValue: v.optional(v.any()),
      }),
    ),
    tags: v.array(v.string()),
    isActive: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
} as const;

// AI Feedback validators
export const AIFeedbackV = {
  full: v.object({
    contentId: v.string(), // Could be prompt ID or insight ID
    contentType: v.union(v.literal("prompt"), v.literal("insight")),
    userId: v.id("users"),
    meetingId: v.id("meetings"),
    rating: v.number(), // 1-5 scale
    feedback: v.optional(v.string()),
    categories: v.optional(
      v.object({
        relevance: v.number(),
        accuracy: v.number(),
        usefulness: v.number(),
        clarity: v.number(),
      }),
    ),
    improvements: v.optional(v.array(v.string())),
    submittedAt: v.number(),
  }),
} as const;
