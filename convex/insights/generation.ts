/**
 * Insights Generation Actions
 *
 * This module provides AI-powered post-call insight generation with
 * privacy controls and per-user analysis.
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
 * Generates post-call insights for all participants
 */
export const generateInsights = action({
  args: {
    meetingId: v.id("meetings"),
    forceRegenerate: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    insightsGenerated: v.number(),
    participantInsights: v.array(v.id("insights")),
  }),
  handler: async (ctx, { meetingId, forceRegenerate = false }) => {
    try {
      // Get meeting details and participants
      const meeting = await ctx.runQuery(
        internal.meetings.queries.getMeetingById,
        { meetingId },
      );

      if (!meeting || meeting.state !== "concluded") {
        throw createError.validation(
          "Meeting must be concluded to generate insights",
        );
      }

      const participants = await ctx.runQuery(
        internal.meetings.queries.getMeetingParticipants,
        { meetingId },
      );

      // Generate insights for each participant
      const participantInsights: Id<"insights">[] = [];
      let insightsGenerated = 0;

      for (const participant of participants) {
        try {
          // Check if insights already exist
          if (!forceRegenerate) {
            const existingInsights = await ctx.runQuery(
              internal.insights.queries.getInsightsByUserAndMeeting,
              {
                userId: participant.userId,
                meetingId,
              },
            );

            if (existingInsights) {
              participantInsights.push(existingInsights._id);
              continue;
            }
          }

          // Generate insights for this participant
          const insightId = await ctx.runAction(
            internal.insights.generation.generateParticipantInsights,
            {
              meetingId,
              userId: participant.userId,
            },
          );

          if (insightId) {
            participantInsights.push(insightId);
            insightsGenerated++;
          }
        } catch (error) {
          console.error(
            `Failed to generate insights for participant ${participant.userId}:`,
            error,
          );
        }
      }

      return {
        success: true,
        insightsGenerated,
        participantInsights,
      };
    } catch (error) {
      console.error("Failed to generate insights:", error);
      throw createError.internal("Failed to generate insights", {
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
    meetingId: v.id("meetings"),
    userId: v.id("users"),
  },
  returns: v.id("insights"),
  handler: async (ctx, { meetingId, userId }) => {
    try {
      // Get transcript segments for analysis
      const transcriptSegments = await ctx.runQuery(
        internal.transcripts.queries.getTranscriptSegments,
        { meetingId, limit: 100 },
      );

      // Get meeting notes
      const meetingNotes = await ctx.runQuery(
        internal.notes.queries.getMeetingNotes,
        { meetingId },
      );

      // Analyze content and generate insights
      const insights = await analyzeContentForInsights(
        ctx,
        meetingId,
        userId,
        transcriptSegments,
        meetingNotes,
      );

      if (!insights) {
        return undefined;
      }

      // Create insights document
      const insightId = await ctx.runMutation(
        internal.insights.mutations.createInsights,
        {
          userId,
          meetingId,
          summary: insights.summary,
          actionItems: insights.actionItems,
          recommendations: insights.recommendations,
          links: insights.links,
        },
      );

      return insightId;
    } catch (error) {
      console.error("Failed to generate participant insights:", error);
      return undefined;
    }
  },
});

/**
 * Analyzes content to generate insights (stubbed implementation)
 */
async function analyzeContentForInsights(
  ctx: any,
  meetingId: Id<"meetings">,
  userId: Id<"users">,
  transcriptSegments: any[],
  meetingNotes: any,
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
  // TODO: Implement actual AI analysis
  // For now, generate heuristic insights

  if (transcriptSegments.length === 0 && !meetingNotes?.content) {
    return null;
  }

  // Extract key topics from transcript
  const topics = transcriptSegments
    .flatMap((segment) => segment.topics || [])
    .filter((topic, index, array) => array.indexOf(topic) === index)
    .slice(0, 5);

  // Generate summary
  const summary = generateHeuristicSummary(
    transcriptSegments,
    meetingNotes,
    topics,
  );

  // Generate action items
  const actionItems = generateHeuristicActionItems(
    transcriptSegments,
    meetingNotes,
  );

  // Generate recommendations
  const recommendations = await generateHeuristicRecommendations(
    ctx,
    userId,
    topics,
    transcriptSegments,
  );

  // Generate relevant links
  const links = generateHeuristicLinks(topics);

  return {
    summary,
    actionItems,
    recommendations,
    links,
  };
}

/**
 * Generates a heuristic summary
 */
function generateHeuristicSummary(
  transcriptSegments: any[],
  meetingNotes: any,
  topics: string[],
): string {
  const duration =
    transcriptSegments.length > 0
      ? Math.max(...transcriptSegments.map((s) => s.endMs)) -
        Math.min(...transcriptSegments.map((s) => s.startMs))
      : 0;

  const durationMinutes = Math.round(duration / 60000);
  const speakerCount = new Set(
    transcriptSegments.flatMap((s) => s.speakers || []),
  ).size;

  let summary = `This ${durationMinutes}-minute meeting involved ${speakerCount} participants`;

  if (topics.length > 0) {
    summary += ` and covered topics including ${topics.slice(0, 3).join(", ")}`;
  }

  if (meetingNotes?.content) {
    summary += ". Key points were documented in the shared notes";
  }

  summary += ".";

//  TODO:  // Add speaking time analysis if available
//   if (userParticipant?.speakingTime) {
//     const speakingRatio =
//       userParticipant.speakingTime / (meeting.duration || 1);
//     if (speakingRatio > 0.4) {
//       summary += " You were actively engaged in the discussion.";
//     } else if (speakingRatio < 0.1) {
//       summary += " You primarily listened during this meeting.";
//     }
//   }

  return summary;
}

/**
 * Generates heuristic action items
 */
function generateHeuristicActionItems(
  transcriptSegments: any[],
  meetingNotes: any,
): string[] {
  const actionItems: string[] = [];

  // Look for action-oriented keywords in transcript
  const actionKeywords = [
    "will",
    "should",
    "need to",
    "follow up",
    "action item",
    "next step",
    "todo",
    "task",
    "deadline",
  ];

  transcriptSegments.forEach((segment) => {
    const text = segment.text.toLowerCase();
    actionKeywords.forEach((keyword) => {
      if (text.includes(keyword)) {
        // Extract sentence containing the keyword
        const sentences = segment.text.split(/[.!?]+/);
        const actionSentence = sentences.find((s) =>
          s.toLowerCase().includes(keyword),
        );
        if (actionSentence && actionSentence.trim().length > 10) {
          actionItems.push(actionSentence.trim());
        }
      }
    });
  });

  // Look for action items in notes
  if (meetingNotes?.content) {
    const noteLines = meetingNotes.content.split("\n");
    noteLines.forEach((line) => {
      const trimmed = line.trim();
      if (
        trimmed.startsWith("- [ ]") ||
        trimmed.startsWith("* [ ]") ||
        trimmed.toLowerCase().includes("action:") ||
        trimmed.toLowerCase().includes("todo:")
      ) {
        actionItems.push(
          trimmed
            .replace(/^[-*]\s*\[\s*\]\s*/, "")
            .replace(/^(action|todo):\s*/i, ""),
        );
      }
    });
  }

  // Add generic action items if none found
  if (actionItems.length === 0) {
    actionItems.push("Follow up on key discussion points from this meeting");
    actionItems.push(
      "Share relevant resources mentioned during the conversation",
    );
  }

  return actionItems.slice(0, 5); // Limit to 5 action items
}

/**
 * Generates heuristic recommendations
 */
async function generateHeuristicRecommendations(
  ctx: any,
  userId: Id<"users">,
  topics: string[],
  transcriptSegments: any[],
): Promise<
  Array<{
    type: string;
    content: string;
    confidence: number;
  }>
> {
  const recommendations: Array<{
    type: string;
    content: string;
    confidence: number;
  }> = [];

  // Topic-based recommendations
  if (topics.length > 0) {
    const primaryTopic = topics[0];
    recommendations.push({
      type: "learning",
      content: `Consider exploring advanced topics in ${primaryTopic} to deepen your expertise`,
      confidence: 0.7,
    });
  }

  // Connection recommendations based on speakers
  const speakers = new Set(transcriptSegments.flatMap((s) => s.speakers || []));

  if (speakers.size > 1) {
    recommendations.push({
      type: "networking",
      content:
        "Consider connecting with other participants to continue the conversation",
      confidence: 0.8,
    });
  }

  // Generic recommendations
  recommendations.push({
    type: "follow-up",
    content: "Schedule a follow-up meeting to track progress on action items",
    confidence: 0.6,
  });

  return recommendations;
}

/**
 * Generates heuristic links
 */
function generateHeuristicLinks(topics: string[]): Array<{
  type: string;
  url: string;
  title: string;
}> {
  const links: Array<{
    type: string;
    url: string;
    title: string;
  }> = [];

  // Generate topic-based resource links
  topics.slice(0, 3).forEach((topic) => {
    links.push({
      type: "resource",
      url: `https://example.com/resources/${encodeURIComponent(topic.toLowerCase())}`,
      title: `Learn more about ${topic}`,
    });
  });

  return links;
}

// /**
//  * Finds shared interests between two users
//  */
// function findSharedInterests(interests1: any[], interests2: any[]): string[] {
//   const keys1 = new Set(interests1.map((i) => i.key));
//   const keys2 = new Set(interests2.map((i) => i.key));
//   const shared = [...keys1].filter((key) => keys2.has(key));
//   return shared.map(
//     (key) => interests1.find((i) => i.key === key)?.label || key,
//   );
// }

// /**
//  * Determines if two profiles have complementary skills
//  */
// function findComplementarySkills(profile1: any, profile2: any): boolean {
//   if (!profile1?.field || !profile2?.field) return false;

//   // Simple heuristic: different fields are potentially complementary
//   const complementaryPairs = [
//     ["engineering", "design"],
//     ["engineering", "product"],
//     ["design", "marketing"],
//     ["sales", "engineering"],
//     ["finance", "operations"],
//   ];

//   const field1 = profile1.field.toLowerCase();
//   const field2 = profile2.field.toLowerCase();

//   return complementaryPairs.some(
//     ([a, b]) =>
//       (field1.includes(a) && field2.includes(b)) ||
//       (field1.includes(b) && field2.includes(a)),
//   );
// }
