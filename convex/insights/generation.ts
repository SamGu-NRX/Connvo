/**
 * AI-Powered Insights Generation Actions
 *
 * This module provides actions for generating post-call insights with
 * privacy controls, per-user analysis, and connection recommendations.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex action patterns
 */

"use node";

import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { Id } from "../_generated/dataModel";

/**
 * Generates post-call insights for all meeting participants
 */
export const generateMeetingInsights = action({
  args: {
    meetingId: v.id("meetings"),
    forceRegenerate: v.optional(v.boolean()),
  },
  returns: v.object({
    insightIds: v.array(v.id("insights")),
    participantsProcessed: v.number(),
    generated: v.boolean(),
  }),
  handler: async (ctx, { meetingId, forceRegenerate = false }) => {
    try {
      // Get meeting details
      const meeting = await ctx.runQuery(
        internal.meetings.queries.getMeetingById,
        {
          meetingId,
        },
      );

      if (!meeting) {
        throw createError.notFound("Meeting", meetingId);
      }

      // Only generate insights for concluded meetings
      if (meeting.state !== "concluded") {
        throw createError.validation(
          "Meeting must be concluded to generate insights",
        );
      }

      // Get meeting participants
      const participants = await ctx.runQuery(
        internal.meetings.queries.getMeetingParticipants,
        { meetingId },
      );

      if (participants.length === 0) {
        return {
          insightIds: [],
          participantsProcessed: 0,
          generated: false,
        };
      }

      // Check if insights already exist (unless force regenerate)
      if (!forceRegenerate) {
        const existingInsights = await Promise.all(
          participants.map((p) =>
            ctx.runQuery(
              internal.insights.queries.getInsightsByUserAndMeeting,
              {
                userId: p.userId,
                meetingId,
              },
            ),
          ),
        );

        const hasExistingInsights = existingInsights.some(
          (insight) => insight !== null,
        );
        if (hasExistingInsights) {
          return {
            insightIds: existingInsights
              .filter(i > i !== null)
              .map((i) => i!._id),
            participantsProcessed: participants.length,
            generated: false,
          };
        }
      }

      // Gather meeting data for analysis
      const meetingData = await gatherMeetingData(ctx, meetingId);

      // Generate insights for each participant
      const insightPromises = participants.map((participant) =>
        generateParticipantInsights(
          ctx,
          meetingId,
          participant.userId,
          meetingData,
        ),
      );

      const participantInsights = await Promise.all(insightPromises);

      // Create insights in database
      const insightIds = await ctx.runMutation(
        internal.insights.mutations.batchCreateInsights,
        {
          insights: participantInsights,
        },
      );

      return {
        insightIds,
        participantsProcessed: participants.length,
        generated: true,
      };
    } catch (error) {
      console.error("Failed to generate meeting insights:", error);
      throw createError.internal("Failed to generate meeting insights", {
        meetingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

/**
 * Generates insights for a specific participant
 */
export const generateParticipantInsights = internalAction({
  args: {
    userId: v.id("users"),
    meetingId: v.id("meetings"),
  },
  returns: v.id("insights"),
  handler: async (ctx, { userId, meetingId }) => {
    // Gather meeting data
    const meetingData = await gatherMeetingData(ctx, meetingId);

    // Generate insights for this specific participant
    const insights = await generateParticipantInsights(
      ctx,
      meetingId,
      userId,
      meetingData,
    );

    // Create insights in database
    return await ctx.runMutation(
      internal.insights.mutations.createInsights,
      insights,
    );
  },
});

/**
 * Gathers all relevant meeting data for analysis
 */
async function gatherMeetingData(
  ctx: any,
  meetingId: Id<"meetings">,
): Promise<{
  meeting: any;
  participants: any[];
  transcriptSegments: any[];
  notes: any;
  prompts: any[];
  participantProfiles: Map<Id<"users">, any>;
}> {
  // Get meeting details
  const meeting = await ctx.runQuery(internal.meetings.queries.getMeetingById, {
    meetingId,
  });

  // Get participants
  const participants = await ctx.runQuery(
    internal.meetings.queries.getMeetingParticipants,
    {
      meetingId,
    },
  );

  // Get transcript segments
  const transcriptSegments = await ctx.runQuery(
    internal.transcripts.queries.getTranscriptSegments,
    {
      meetingId,
      limit: 100,
    },
  );

  // Get meeting notes
  const notes = await ctx.runQuery(internal.notes.queries.getMeetingNotes, {
    meetingId,
  });

  // Get prompts used during the meeting
  const prompts = await ctx.runQuery(
    internal.prompts.queries.getPromptsByMeetingAndType,
    {
      meetingId,
      type: "incall",
      limit: 50,
    },
  );

  // Get participant profiles
  const participantProfiles = new Map();
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
      participantProfiles.set(participant.userId, { profile, interests });
    } catch (error) {
      console.warn(
        `Failed to get profile for user ${participant.userId}:`,
        error,
      );
    }
  }

  return {
    meeting,
    participants,
    transcriptSegments,
    notes,
    prompts,
    participantProfiles,
  };
}

/**
 * Generates insights for a specific participant using AI or heuristic analysis
 */
async function generateParticipantInsights(
  ctx: any,
  meetingId: Id<"meetings">,
  userId: Id<"users">,
  meetingData: {
    meeting: any;
    participants: any[];
    transcriptSegments: any[];
    notes: any;
    prompts: any[];
    participantProfiles: Map<Id<"users">, any>;
  },
): Promise<{
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
}> {
  // Try AI generation first (stubbed for now)
  try {
    const aiInsights = await generateAIInsights(ctx, userId, meetingData);
    if (aiInsights) {
      return {
        userId,
        meetingId,
        ...aiInsights,
      };
    }
  } catch (error) {
    console.warn(
      "AI insights generation failed, falling back to heuristics:",
      error,
    );
  }

  // Fallback to heuristic analysis
  const heuristicInsights = generateHeuristicInsights(userId, meetingData);

  return {
    userId,
    meetingId,
    ...heuristicInsights,
  };
}

/**
 * Generates insights using AI (stubbed implementation)
 */
async function generateAIInsights(
  ctx: any,
  userId: Id<"users">,
  meetingData: any,
): Promise<{
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
} | null> {
  // TODO: Implement actual AI integration
  // For now, return null to trigger fallback
  return null;
}

/**
 * Generates insights using heuristic analysis
 */
function generateHeuristicInsights(
  userId: Id<"users">,
  meetingData: {
    meeting: any;
    participants: any[];
    transcriptSegments: any[];
    notes: any;
    prompts: any[];
    participantProfiles: Map<Id<"users">, any>;
  },
): {
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
} {
  const {
    meeting,
    participants,
    transcriptSegments,
    notes,
    prompts,
    participantProfiles,
  } = meetingData;

  // Find the current user's participation
  const userParticipant = participants.find((p) => p.userId === userId);
  const userProfile = participantProfiles.get(userId);

  // Generate summary
  const summary = generateMeetingSummary(
    meeting,
    participants,
    transcriptSegments,
    userParticipant,
  );

  // Extract action items
  const actionItems = extractActionItems(transcriptSegments, notes, prompts);

  // Generate recommendations
  const recommendations = generateRecommendations(
    userId,
    userProfile,
    participants,
    participantProfiles,
    meeting,
  );

  // Generate relevant links
  const links = generateRelevantLinks(userProfile, meeting, recommendations);

  return {
    summary,
    actionItems,
    recommendations,
    links,
  };
}

/**
 * Generates a personalized meeting summary
 */
function generateMeetingSummary(
  meeting: any,
  participants: any[],
  transcriptSegments: any[],
  userParticipant: any,
): string {
  const duration = meeting.duration || "unknown duration";
  const participantCount = participants.length;
  const topics = transcriptSegments.flatMap((seg) => seg.topics || []);
  const uniqueTopics = [...new Set(topics)].slice(0, 3);

  let summary = `You participated in "${meeting.title}" with ${participantCount} participants`;

  if (userParticipant?.role === "host") {
    summary += " as the host";
  }

  summary += `. The meeting lasted ${duration}`;

  if (uniqueTopics.length > 0) {
    summary += ` and covered topics including ${uniqueTopics.join(", ")}`;
  }

  summary += ".";

  // Add speaking time analysis if available
  if (userParticipant?.speakingTime) {
    const speakingRatio =
      userParticipant.speakingTime / (meeting.duration || 1);
    if (speakingRatio > 0.4) {
      summary += " You were actively engaged in the discussion.";
    } else if (speakingRatio < 0.1) {
      summary += " You primarily listened during this meeting.";
    }
  }

  return summary;
}

/**
 * Extracts action items from meeting content
 */
function extractActionItems(
  transcriptSegments: any[],
  notes: any,
  prompts: any[],
): string[] {
  const actionItems: string[] = [];

  // Look for action-oriented language in transcripts
  const actionKeywords = [
    "will",
    "should",
    "need to",
    "action item",
    "follow up",
    "next step",
  ];

  transcriptSegments.forEach((segment) => {
    const text = segment.text.toLowerCase();
    actionKeywords.forEach((keyword) => {
      if (text.includes(keyword)) {
        // Extract the sentence containing the action keyword
        const sentences = segment.text.split(/[.!?]+/);
        sentences.forEach((sentence) => {
          if (
            sentence.toLowerCase().includes(keyword) &&
            sentence.trim().length > 10
          ) {
            actionItems.push(sentence.trim());
          }
        });
      }
    });
  });

  // Look for action items in notes
  if (notes?.content) {
    const noteLines = notes.content.split("\n");
    noteLines.forEach((line) => {
      const trimmed = line.trim();
      if (
        (trimmed.startsWith("- ") || trimmed.startsWith("* ")) &&
        (trimmed.toLowerCase().includes("action") ||
          trimmed.toLowerCase().includes("todo") ||
          trimmed.toLowerCase().includes("follow"))
      ) {
        actionItems.push(trimmed.substring(2));
      }
    });
  }

  // Deduplicate and limit
  const uniqueActionItems = [...new Set(actionItems)];
  return uniqueActionItems.slice(0, 5);
}

/**
 * Generates personalized recommendations
 */
function generateRecommendations(
  userId: Id<"users">,
  userProfile: any,
  participants: any[],
  participantProfiles: Map<Id<"users">, any>,
  meeting: any,
): Array<{
  type: string;
  content: string;
  confidence: number;
}> {
  const recommendations: Array<{
    type: string;
    content: string;
    confidence: number;
  }> = [];

  // Connection recommendations
  participants.forEach((participant) => {
    if (participant.userId === userId) return;

    const otherProfile = participantProfiles.get(participant.userId);
    if (otherProfile?.profile) {
      const sharedInterests = findSharedInterests(
        userProfile?.interests || [],
        otherProfile.interests || [],
      );
      const complementarySkills = findComplementarySkills(
        userProfile?.profile,
        otherProfile.profile,
      );

      if (sharedInterests.length > 0) {
        recommendations.push({
          type: "connection",
          content: `Consider connecting with ${otherProfile.profile.displayName} - you share interests in ${sharedInterests.slice(0, 2).join(" and ")}`,
          confidence: 0.8,
        });
      }

      if (complementarySkills) {
        recommendations.push({
          type: "collaboration",
          content: `${otherProfile.profile.displayName}'s expertise in ${otherProfile.profile.field} could complement your background`,
          confidence: 0.7,
        });
      }
    }
  });

  // Follow-up recommendations
  if (
    meeting.title.toLowerCase().includes("project") ||
    meeting.title.toLowerCase().includes("collaboration")
  ) {
    recommendations.push({
      type: "follow-up",
      content:
        "Schedule a follow-up meeting to discuss next steps and timeline",
      confidence: 0.9,
    });
  }

  // Learning recommendations
  if (userProfile?.profile?.goals) {
    recommendations.push({
      type: "learning",
      content: `Based on your goals, consider exploring resources related to the topics discussed in this meeting`,
      confidence: 0.6,
    });
  }

  // Sort by confidence and return top recommendations
  return recommendations
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

/**
 * Generates relevant links based on meeting content and user profile
 */
function generateRelevantLinks(
  userProfile: any,
  meeting: any,
  recommendations: any[],
): Array<{
  type: string;
  url: string;
  title: string;
}> {
  const links: Array<{
    type: string;
    url: string;
    title: string;
  }> = [];

  // Add meeting-related links
  links.push({
    type: "meeting",
    url: `/app/call/${meeting._id}`,
    title: "View Meeting Details",
  });

  // Add profile links for connection recommendations
  recommendations
    .filter((rec) => rec.type === "connection")
    .slice(0, 2)
    .forEach((rec, index) => {
      links.push({
        type: "profile",
        url: `/app/profile/${index}`, // This would be the actual user ID in a real implementation
        title: "View Profile",
      });
    });

  return links;
}

/**
 * Finds shared interests between two users
 */
function findSharedInterests(interests1: any[], interests2: any[]): string[] {
  const keys1 = new Set(interests1.map((i) => i.key));
  const keys2 = new Set(interests2.map((i) => i.key));
  const shared = [...keys1].filter((key) => keys2.has(key));
  return shared.map(
    (key) => interests1.find((i) => i.key === key)?.label || key,
  );
}

/**
 * Determines if two profiles have complementary skills
 */
function findComplementarySkills(profile1: any, profile2: any): boolean {
  if (!profile1?.field || !profile2?.field) return false;

  // Simple heuristic: different fields are potentially complementary
  const complementaryPairs = [
    ["engineering", "design"],
    ["engineering", "product"],
    ["design", "marketing"],
    ["sales", "engineering"],
    ["finance", "operations"],
  ];

  const field1 = profile1.field.toLowerCase();
  const field2 = profile2.field.toLowerCase();

  return complementaryPairs.some(
    ([a, b]) =>
      (field1.includes(a) && field2.includes(b)) ||
      (field1.includes(b) && field2.includes(a)),
  );
}
