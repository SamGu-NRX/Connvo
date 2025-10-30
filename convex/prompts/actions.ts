/**
 * AI-Powered Prompt Generation Actions
 *
 * This module provides actions for generating AI-powered conversation prompts
 * with idempotency, participant analysis, and fallback mechanisms.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex action patterns
 */

"use node";

import { action, internalAction } from "@convex/_generated/server";
import { internal } from "@convex/_generated/api";
import { v } from "convex/values";
import { createError } from "@convex/lib/errors";
import { Id } from "@convex/_generated/dataModel";
import type {
  AIPrompt,
  AIContentGenerationResult,
} from "@convex/types/entities/prompt";
import { AIContentGenerationV } from "@convex/types/validators/prompt";

/**
 * @summary Generates idempotent AI-assisted pre-call prompts for a meeting.
 * @description Produces up to six high-signal conversation starters by analyzing participant profiles, shared interests, and meeting metadata. The first invocation seeds prompts and stores an idempotency key; repeated calls return cached prompt IDs unless `forceRegenerate` is true. The heuristic fallback returns general conversation starters when richer participant data is unavailable, matching the datamodel example captured in the Convex tests.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9"
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "promptIds": [
 *       "prompts_ck9hx2g1v0001",
 *       "prompts_ck9hx2g1v0002",
 *       "prompts_ck9hx2g1v0003",
 *       "prompts_ck9hx2g1v0004",
 *       "prompts_ck9hx2g1v0005",
 *       "prompts_ck9hx2g1v0006"
 *     ],
 *     "generated": true,
 *     "fromCache": false
 *   }
 * }
 * ```
 * @example response-cache
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "promptIds": [
 *       "prompts_ck9hx2g1v0001",
 *       "prompts_ck9hx2g1v0002",
 *       "prompts_ck9hx2g1v0003",
 *       "prompts_ck9hx2g1v0004",
 *       "prompts_ck9hx2g1v0005",
 *       "prompts_ck9hx2g1v0006"
 *     ],
 *     "generated": false,
 *     "fromCache": true
 *   }
 * }
 * ```
 * @example datamodel
 * ```json
 * {
 *   "prompts": [
 *     {
 *       "_id": "prompts_ck9hx2g1v0001",
 *       "_creationTime": 1714066800000,
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *       "type": "precall",
 *       "content": "I noticed you both have experience with ai-ml. What drew you to this field initially?",
 *       "tags": ["shared-interests", "background"],
 *       "relevance": 0.9,
 *       "createdAt": 1714066800000
 *     },
 *     {
 *       "_id": "prompts_ck9hx2g1v0002",
 *       "_creationTime": 1714066800000,
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *       "type": "precall",
 *       "content": "You come from different backgrounds (Technology, Product). What perspectives do you think each industry brings to problem-solving?",
 *       "tags": ["cross-industry", "perspectives"],
 *       "relevance": 0.85,
 *       "createdAt": 1714066800000
 *     },
 *     {
 *       "_id": "prompts_ck9hx2g1v0003",
 *       "_creationTime": 1714066800000,
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *       "type": "precall",
 *       "content": "Given your mutual interest in ai-ml, what trends are you most excited about right now?",
 *       "tags": ["shared-interests", "trends"],
 *       "relevance": 0.8,
 *       "createdAt": 1714066800000
 *     },
 *     {
 *       "_id": "prompts_ck9hx2g1v0004",
 *       "_creationTime": 1714066800000,
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *       "type": "precall",
 *       "content": "If you could collaborate with anyone in your field, who would it be and why?",
 *       "tags": ["collaboration", "inspiration"],
 *       "relevance": 0.65,
 *       "createdAt": 1714066800000
 *     },
 *     {
 *       "_id": "prompts_ck9hx2g1v0005",
 *       "_creationTime": 1714066800000,
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *       "type": "precall",
 *       "content": "What's the most interesting project you've worked on recently?",
 *       "tags": ["projects", "general"],
 *       "relevance": 0.6,
 *       "createdAt": 1714066800000
 *     },
 *     {
 *       "_id": "prompts_ck9hx2g1v0006",
 *       "_creationTime": 1714066800000,
 *       "meetingId": "me_82f8c0a8bce1a2d5f4e7b6c9",
 *       "type": "precall",
 *       "content": "What's one skill you're currently trying to develop?",
 *       "tags": ["learning", "development"],
 *       "relevance": 0.55,
 *       "createdAt": 1714066800000
 *     }
 *   ]
 * }
 * ```
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorMessage": "Meeting with ID me_82f8c0a8bce1a2d5f4e7b6c9 not found",
 *   "errorData": {
 *     "code": "NOT_FOUND",
 *     "message": "Meeting with ID me_82f8c0a8bce1a2d5f4e7b6c9 not found",
 *     "statusCode": 404,
 *     "metadata": {
 *       "id": "me_82f8c0a8bce1a2d5f4e7b6c9"
 *     }
 *   },
 *   "value": null
 * }
 * ```
 */
export const generatePreCallIdeas = action({
  args: {
    meetingId: v.id("meetings"),
    forceRegenerate: v.optional(v.boolean()),
  },
  returns: v.object({
    promptIds: v.array(v.id("prompts")),
    generated: v.boolean(),
    fromCache: v.boolean(),
  }),
  handler: async (
    ctx,
    { meetingId, forceRegenerate = false },
  ): Promise<{
    promptIds: Id<"prompts">[];
    generated: boolean;
    fromCache: boolean;
  }> => {
    // Create idempotency key based on meetingId
    const idempotencyKey = `precall_ideas_${meetingId}`;
    const scope = "prompt_generation";

    // Check if we already generated ideas for this meeting
    if (!forceRegenerate) {
      const existingKey = await ctx.runQuery(
        internal.system.idempotency.getKey,
        {
          key: idempotencyKey,
          scope,
        },
      );

      if (existingKey) {
        // Return existing prompts
        const existingPrompts: Array<{ _id: Id<"prompts"> }> =
          await ctx.runQuery(
            internal.prompts.queries.getPromptsByMeetingAndType,
            {
              meetingId,
              type: "precall",
              limit: 10,
            },
          );

        return {
          promptIds: existingPrompts.map((p) => p._id),
          generated: false,
          fromCache: true,
        };
      }
    }

    try {
      // Get meeting details and participants
      const meeting = await ctx.runQuery(
        internal.meetings.queries.getMeetingById,
        {
          meetingId,
        },
      );

      if (!meeting) {
        throw createError.notFound("Meeting", meetingId);
      }

      const participants = await ctx.runQuery(
        internal.meetings.queries.getMeetingParticipants,
        { meetingId },
      );

      // Analyze participant profiles for shared interests and complementary skills
      const participantAnalysis = await analyzeParticipants(ctx, participants);

      // Generate AI prompts or use heuristic fallback
      const prompts = await generatePromptsWithFallback(
        ctx,
        meeting,
        participantAnalysis,
      );

      // Create prompts in database
      const promptIds = await ctx.runMutation(
        internal.prompts.mutations.batchCreatePrompts,
        {
          prompts: prompts.map((prompt) => ({
            meetingId,
            type: "precall" as const,
            content: prompt.content,
            tags: prompt.tags,
            relevance: prompt.relevance,
          })),
        },
      );

      // Store idempotency key to prevent regeneration
      await ctx.runMutation(internal.system.idempotency.createKey, {
        key: idempotencyKey,
        scope,
        metadata: {
          promptCount: promptIds.length,
          generatedAt: Date.now(),
          method: prompts[0]?.method || "heuristic",
        },
        createdAt: Date.now(),
      });

      return {
        promptIds,
        generated: true,
        fromCache: false,
      };
    } catch (error) {
      console.error("Failed to generate pre-call ideas:", error);
      throw createError.internal("Failed to generate pre-call ideas", {
        meetingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

/**
 * Analyzes participants to find shared interests and complementary skills
 */
async function analyzeParticipants(
  ctx: any,
  participants: Array<{
    _id: Id<"meetingParticipants">;
    userId: Id<"users">;
    role: "host" | "participant" | "observer";
  }>,
): Promise<{
  sharedInterests: string[];
  complementarySkills: string[];
  experienceLevels: string[];
  industries: string[];
  goals: string[];
}> {
  const analysis = {
    sharedInterests: [] as string[],
    complementarySkills: [] as string[],
    experienceLevels: [] as string[],
    industries: [] as string[],
    goals: [] as string[],
  };

  const allInterests: string[][] = [];
  const allSkills: string[] = [];
  const allGoals: string[] = [];

  // Collect data from all participants
  for (const participant of participants) {
    try {
      // Get user profile
      const profile = await ctx.runQuery(
        internal.profiles.queries.getProfileByUserId,
        {
          userId: participant.userId,
        },
      );

      if (profile) {
        // Extract experience level and industry from profile
        if (profile.experience) {
          analysis.experienceLevels.push(profile.experience);
        }
        if (profile.field) {
          analysis.industries.push(profile.field);
        }
        if (profile.goals) {
          allGoals.push(profile.goals);
        }
      }

      // Get user interests
      const userInterests = await ctx.runQuery(
        internal.interests.queries.getUserInterests,
        { userId: participant.userId },
      );

      if (userInterests.length > 0) {
        allInterests.push(userInterests.map((i: { key: string }) => i.key));
      }
    } catch (error) {
      console.warn(
        `Failed to analyze participant ${participant.userId}:`,
        error,
      );
    }
  }

  // Find shared interests (interests that appear in multiple participants)
  if (allInterests.length > 1) {
    const interestCounts = new Map<string, number>();
    allInterests.flat().forEach((interest) => {
      interestCounts.set(interest, (interestCounts.get(interest) || 0) + 1);
    });

    analysis.sharedInterests = Array.from(interestCounts.entries())
      .filter(([_, count]) => count > 1)
      .map(([interest, _]) => interest)
      .slice(0, 5); // Limit to top 5
  }

  // Extract goals and skills
  analysis.goals = allGoals.slice(0, 3);

  return analysis;
}

/**
 * Generates prompts using AI or heuristic fallback
 */
async function generatePromptsWithFallback(
  ctx: any,
  meeting: any,
  analysis: {
    sharedInterests: string[];
    complementarySkills: string[];
    experienceLevels: string[];
    industries: string[];
    goals: string[];
  },
): Promise<
  Array<{
    content: string;
    tags: string[];
    relevance: number;
    method: "ai" | "heuristic";
  }>
> {
  // Try AI generation first (stubbed for now)
  try {
    const aiPrompts = await generateAIPrompts(ctx, meeting, analysis);
    if (aiPrompts.length > 0) {
      return aiPrompts;
    }
  } catch (error) {
    console.warn(
      "AI prompt generation failed, falling back to heuristics:",
      error,
    );
  }

  // Fallback to heuristic generation
  return generateHeuristicPrompts(meeting, analysis);
}

/**
 * Generates prompts using AI (stubbed implementation)
 */
async function generateAIPrompts(
  ctx: any,
  meeting: any,
  analysis: any,
): Promise<
  Array<{
    content: string;
    tags: string[];
    relevance: number;
    method: "ai";
  }>
> {
  // TODO: Implement actual AI integration with OpenAI/Anthropic
  // For now, return empty array to trigger fallback
  return [];
}

/**
 * Generates prompts using heuristic rules
 */
function generateHeuristicPrompts(
  meeting: any,
  analysis: {
    sharedInterests: string[];
    complementarySkills: string[];
    experienceLevels: string[];
    industries: string[];
    goals: string[];
  },
): Array<{
  content: string;
  tags: string[];
  relevance: number;
  method: "heuristic";
}> {
  const prompts: Array<{
    content: string;
    tags: string[];
    relevance: number;
    method: "heuristic";
  }> = [];

  // Generate prompts based on shared interests
  if (analysis.sharedInterests.length > 0) {
    const interests = analysis.sharedInterests.slice(0, 2).join(" and ");
    prompts.push({
      content: `I noticed you both have experience with ${interests}. What drew you to this field initially?`,
      tags: ["shared-interests", "background"],
      relevance: 0.9,
      method: "heuristic",
    });

    prompts.push({
      content: `Given your mutual interest in ${interests}, what trends are you most excited about right now?`,
      tags: ["shared-interests", "trends"],
      relevance: 0.8,
      method: "heuristic",
    });
  }

  // Generate prompts based on different industries
  if (analysis.industries.length > 1) {
    const uniqueIndustries = [...new Set(analysis.industries)];
    if (uniqueIndustries.length > 1) {
      prompts.push({
        content: `You come from different backgrounds (${uniqueIndustries.join(", ")}). What perspectives do you think each industry brings to problem-solving?`,
        tags: ["cross-industry", "perspectives"],
        relevance: 0.85,
        method: "heuristic",
      });
    }
  }

  // Generate prompts based on experience levels
  if (analysis.experienceLevels.length > 0) {
    prompts.push({
      content:
        "What's one piece of advice you'd give to someone just starting in your field?",
      tags: ["advice", "experience"],
      relevance: 0.7,
      method: "heuristic",
    });
  }

  // Generate prompts based on goals
  if (analysis.goals.length > 0) {
    prompts.push({
      content:
        "What's the most important goal you're working toward right now, and what's your biggest challenge in achieving it?",
      tags: ["goals", "challenges"],
      relevance: 0.75,
      method: "heuristic",
    });
  }

  // Add general conversation starters
  prompts.push(
    {
      content: "What's the most interesting project you've worked on recently?",
      tags: ["projects", "general"],
      relevance: 0.6,
      method: "heuristic",
    },
    {
      content:
        "If you could collaborate with anyone in your field, who would it be and why?",
      tags: ["collaboration", "inspiration"],
      relevance: 0.65,
      method: "heuristic",
    },
    {
      content: "What's one skill you're currently trying to develop?",
      tags: ["learning", "development"],
      relevance: 0.55,
      method: "heuristic",
    },
  );

  // Sort by relevance and return top prompts
  return prompts.sort((a, b) => b.relevance - a.relevance).slice(0, 6);
}

/**
 * Generates contextual prompts during active meetings
 */
export const generateContextualPrompts = internalAction({
  args: {
    meetingId: v.id("meetings"),
    context: v.object({
      lullDetected: v.boolean(),
      topicShift: v.boolean(),
      currentTopics: v.array(v.string()),
      speakingTimeRatios: v.record(v.string(), v.number()),
      lastActivity: v.number(),
      lullDuration: v.optional(v.number()),
    }),
  },
  returns: v.array(v.id("prompts")),
  handler: async (ctx, { meetingId, context }): Promise<Id<"prompts">[]> => {
    try {
      // Get meeting details and participants
      const meeting = await ctx.runQuery(
        internal.meetings.queries.getMeetingById,
        {
          meetingId,
        },
      );

      if (!meeting || meeting.state !== "active") {
        return [];
      }

      const participants = await ctx.runQuery(
        internal.meetings.queries.getMeetingParticipants,
        { meetingId },
      );

      // Analyze current meeting context
      const contextAnalysis = await analyzeMeetingContext(
        ctx,
        meetingId,
        context,
        participants,
      );

      // Generate contextual prompts based on the situation
      const prompts = await generateContextualPromptsWithFallback(
        ctx,
        meeting,
        contextAnalysis,
        context,
      );

      if (prompts.length === 0) {
        return [];
      }

      // Create prompts in database
      const promptIds = await ctx.runMutation(
        internal.prompts.mutations.batchCreatePrompts,
        {
          prompts: prompts.map((prompt) => ({
            meetingId,
            type: "incall" as const,
            content: prompt.content,
            tags: prompt.tags,
            relevance: prompt.relevance,
          })),
        },
      );

      // Clean up old in-call prompts to prevent accumulation
      await ctx.runMutation(internal.prompts.mutations.cleanupOldPrompts, {
        meetingId,
        type: "incall",
        keepCount: 10, // Keep only the 10 most recent prompts
      });

      return promptIds;
    } catch (error) {
      console.error("Failed to generate contextual prompts:", error);
      return [];
    }
  },
});

/**
 * Detects lulls and triggers contextual prompt generation
 */
export const detectLullAndGeneratePrompts = internalAction({
  args: {
    meetingId: v.id("meetings"),
  },
  returns: v.object({
    lullDetected: v.boolean(),
    promptsGenerated: v.number(),
    promptIds: v.array(v.id("prompts")),
  }),
  handler: async (
    ctx,
    { meetingId },
  ): Promise<{
    lullDetected: boolean;
    promptsGenerated: number;
    promptIds: Id<"prompts">[];
  }> => {
    try {
      // Get current meeting state
      const meetingState: any = await ctx.runQuery(
        internal.meetings.queries.getMeetingState,
        {
          meetingId,
        },
      );

      if (!meetingState || !meetingState.active) {
        return {
          lullDetected: false,
          promptsGenerated: 0,
          promptIds: [],
        };
      }

      const now = Date.now();
      const lullThresholdMs = 30000; // 30 seconds of silence
      const lastActivity = meetingState.lullState?.lastActivity || now;
      const lullDuration = now - lastActivity;
      const lullDetected = lullDuration > lullThresholdMs;

      if (!lullDetected) {
        return {
          lullDetected: false,
          promptsGenerated: 0,
          promptIds: [],
        };
      }

      // Generate contextual prompts for the lull
      const promptIds: Id<"prompts">[] = await ctx.runAction(
        internal.prompts.actions.generateContextualPrompts,
        {
          meetingId,
          context: {
            lullDetected: true,
            topicShift: false,
            currentTopics: meetingState.topics || [],
            speakingTimeRatios: meetingState.speakingStats?.byUserMs || {},
            lastActivity,
            lullDuration,
          },
        },
      );

      return {
        lullDetected: true,
        promptsGenerated: promptIds.length,
        promptIds,
      };
    } catch (error) {
      console.error("Failed to detect lull and generate prompts:", error);
      return {
        lullDetected: false,
        promptsGenerated: 0,
        promptIds: [],
      };
    }
  },
});

/**
 * Analyzes current meeting context for prompt generation
 */
async function analyzeMeetingContext(
  ctx: any,
  meetingId: Id<"meetings">,
  context: {
    lullDetected: boolean;
    topicShift: boolean;
    currentTopics: string[];
    speakingTimeRatios: Record<string, number>;
    lastActivity: number;
    lullDuration?: number;
  },
  participants: Array<{
    _id: Id<"meetingParticipants">;
    userId: Id<"users">;
    role: "host" | "participant" | "observer";
  }>,
): Promise<{
  participantProfiles: Array<{
    userId: Id<"users">;
    interests: string[];
    expertise: string[];
    goals: string[];
  }>;
  speakingBalance: {
    dominant: string[];
    quiet: string[];
    balanced: boolean;
  };
  topicContext: {
    currentTopics: string[];
    suggestedTopics: string[];
  };
  lullContext: {
    duration: number;
    severity: "mild" | "moderate" | "severe";
  };
}> {
  const analysis = {
    participantProfiles: [] as Array<{
      userId: Id<"users">;
      interests: string[];
      expertise: string[];
      goals: string[];
    }>,
    speakingBalance: {
      dominant: [] as string[],
      quiet: [] as string[],
      balanced: true,
    },
    topicContext: {
      currentTopics: context.currentTopics,
      suggestedTopics: [] as string[],
    },
    lullContext: {
      duration: context.lullDuration || 0,
      severity: "mild" as "mild" | "moderate" | "severe",
    },
  };

  // Analyze participant profiles
  for (const participant of participants) {
    try {
      const profile = await ctx.runQuery(
        internal.profiles.queries.getProfileByUserId,
        {
          userId: participant.userId,
        },
      );

      const interests = await ctx.runQuery(
        internal.interests.queries.getUserInterests,
        {
          userId: participant.userId,
        },
      );

      analysis.participantProfiles.push({
        userId: participant.userId,
        interests: interests.map((i: { key: string }) => i.key),
        expertise: profile?.field ? [profile.field] : [],
        goals: profile?.goals ? [profile.goals] : [],
      });
    } catch (error) {
      console.warn(
        `Failed to analyze participant ${participant.userId}:`,
        error,
      );
    }
  }

  // Analyze speaking balance
  const totalSpeakingTime = Object.values(context.speakingTimeRatios).reduce(
    (sum, time) => sum + time,
    0,
  );

  if (totalSpeakingTime > 0) {
    const averageTime =
      totalSpeakingTime / Object.keys(context.speakingTimeRatios).length;
    const threshold = 0.3; // 30% deviation from average

    for (const [userId, speakingTime] of Object.entries(
      context.speakingTimeRatios,
    )) {
      const ratio = speakingTime / totalSpeakingTime;
      const deviation = Math.abs(
        ratio - 1 / Object.keys(context.speakingTimeRatios).length,
      );

      if (deviation > threshold) {
        if (ratio > 1 / Object.keys(context.speakingTimeRatios).length) {
          analysis.speakingBalance.dominant.push(userId);
        } else {
          analysis.speakingBalance.quiet.push(userId);
        }
        analysis.speakingBalance.balanced = false;
      }
    }
  }

  // Determine lull severity
  const lullDuration = context.lullDuration || 0;
  if (lullDuration > 60000) {
    // > 1 minute
    analysis.lullContext.severity = "severe";
  } else if (lullDuration > 30000) {
    // > 30 seconds
    analysis.lullContext.severity = "moderate";
  }

  analysis.lullContext.duration = lullDuration;

  return analysis;
}

/**
 * Generates contextual prompts using AI or heuristic fallback
 */
async function generateContextualPromptsWithFallback(
  ctx: any,
  meeting: any,
  analysis: any,
  context: any,
): Promise<
  Array<{
    content: string;
    tags: string[];
    relevance: number;
    method: "ai" | "heuristic";
  }>
> {
  // Try AI generation first (stubbed for now)
  try {
    const aiPrompts = await generateAIContextualPrompts(
      ctx,
      meeting,
      analysis,
      context,
    );
    if (aiPrompts.length > 0) {
      return aiPrompts;
    }
  } catch (error) {
    console.warn(
      "AI contextual prompt generation failed, falling back to heuristics:",
      error,
    );
  }

  // Fallback to heuristic generation
  return generateHeuristicContextualPrompts(meeting, analysis, context);
}

/**
 * Generates contextual prompts using AI (stubbed implementation)
 */
async function generateAIContextualPrompts(
  ctx: any,
  meeting: any,
  analysis: any,
  context: any,
): Promise<
  Array<{
    content: string;
    tags: string[];
    relevance: number;
    method: "ai";
  }>
> {
  // TODO: Implement actual AI integration
  // For now, return empty array to trigger fallback
  return [];
}

/**
 * Generates contextual prompts using heuristic rules
 */
function generateHeuristicContextualPrompts(
  meeting: any,
  analysis: {
    participantProfiles: Array<{
      userId: Id<"users">;
      interests: string[];
      expertise: string[];
      goals: string[];
    }>;
    speakingBalance: {
      dominant: string[];
      quiet: string[];
      balanced: boolean;
    };
    topicContext: {
      currentTopics: string[];
      suggestedTopics: string[];
    };
    lullContext: {
      duration: number;
      severity: "mild" | "moderate" | "severe";
    };
  },
  context: {
    lullDetected: boolean;
    topicShift: boolean;
    currentTopics: string[];
    speakingTimeRatios: Record<string, number>;
  },
): Array<{
  content: string;
  tags: string[];
  relevance: number;
  method: "heuristic";
}> {
  const prompts: Array<{
    content: string;
    tags: string[];
    relevance: number;
    method: "heuristic";
  }> = [];

  // Lull-specific prompts
  if (context.lullDetected) {
    if (analysis.lullContext.severity === "severe") {
      prompts.push({
        content:
          "Let's try a different angle. What's one thing you've learned recently that surprised you?",
        tags: ["lull", "severe", "learning"],
        relevance: 0.9,
        method: "heuristic",
      });
    } else if (analysis.lullContext.severity === "moderate") {
      prompts.push({
        content: "What's your take on what we just discussed?",
        tags: ["lull", "moderate", "reflection"],
        relevance: 0.8,
        method: "heuristic",
      });
    } else {
      prompts.push({
        content: "That's an interesting point. Can you elaborate on that?",
        tags: ["lull", "mild", "elaboration"],
        relevance: 0.7,
        method: "heuristic",
      });
    }
  }

  // Speaking balance prompts
  if (!analysis.speakingBalance.balanced) {
    if (analysis.speakingBalance.quiet.length > 0) {
      prompts.push({
        content:
          "I'd love to hear everyone's perspective on this. What do you think?",
        tags: ["balance", "inclusion"],
        relevance: 0.85,
        method: "heuristic",
      });
    }

    if (analysis.speakingBalance.dominant.length > 0) {
      prompts.push({
        content:
          "Let's make sure we're hearing from everyone. Any other thoughts?",
        tags: ["balance", "moderation"],
        relevance: 0.8,
        method: "heuristic",
      });
    }
  }

  // Topic-based prompts
  if (context.currentTopics.length > 0) {
    const topic = context.currentTopics[0];
    prompts.push({
      content: `Building on the ${topic} discussion, what challenges have you faced in this area?`,
      tags: ["topic-based", "challenges"],
      relevance: 0.75,
      method: "heuristic",
    });
  }

  // Interest-based prompts
  const commonInterests = findCommonInterests(analysis.participantProfiles);
  if (commonInterests.length > 0) {
    const interest = commonInterests[0];
    prompts.push({
      content: `Since you both work with ${interest}, what trends are you seeing in that space?`,
      tags: ["interests", "trends"],
      relevance: 0.8,
      method: "heuristic",
    });
  }

  // Expertise-based prompts
  const expertiseAreas = analysis.participantProfiles.flatMap(
    (p) => p.expertise,
  );
  if (expertiseAreas.length > 0) {
    const expertise = expertiseAreas[0];
    prompts.push({
      content: `Given your background in ${expertise}, how do you approach problem-solving?`,
      tags: ["expertise", "problem-solving"],
      relevance: 0.7,
      method: "heuristic",
    });
  }

  // General conversation continuers
  prompts.push(
    {
      content: "What's your experience been with that?",
      tags: ["general", "experience"],
      relevance: 0.6,
      method: "heuristic",
    },
    {
      content: "How do you see this evolving in the future?",
      tags: ["general", "future"],
      relevance: 0.65,
      method: "heuristic",
    },
    {
      content: "What would you do differently if you were starting over?",
      tags: ["general", "reflection"],
      relevance: 0.6,
      method: "heuristic",
    },
  );

  // Sort by relevance and return top prompts
  return prompts.sort((a, b) => b.relevance - a.relevance).slice(0, 3);
}

/**
 * Finds common interests among participants
 */
function findCommonInterests(
  profiles: Array<{
    userId: Id<"users">;
    interests: string[];
    expertise: string[];
    goals: string[];
  }>,
): string[] {
  if (profiles.length < 2) return [];

  const interestCounts = new Map<string, number>();
  profiles.forEach((profile) => {
    profile.interests.forEach((interest) => {
      interestCounts.set(interest, (interestCounts.get(interest) || 0) + 1);
    });
  });

  return Array.from(interestCounts.entries())
    .filter(([_, count]) => count > 1)
    .map(([interest, _]) => interest)
    .slice(0, 3);
}
