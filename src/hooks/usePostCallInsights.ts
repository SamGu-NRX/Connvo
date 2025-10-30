/**
 * Post-Call Insights Hook
 * 
 * Hook for accessing post-meeting insights, summaries, and analytics.
 * 
 * Features:
 * - Meeting summary and metadata
 * - Complete transcript access
 * - Collaborative notes retrieval
 * - Participant statistics
 * - Topic analysis
 * 
 * Backend APIs:
 * - api.meetings.queries.getMeeting
 * - api.transcripts.queries.getTranscriptSegments
 * - api.notes.queries.getMeetingNotes
 * - Post-processing: internal.meetings.postProcessing.handleMeetingEnd
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { useMemo } from "react";

export interface MeetingWithInsights {
  _id: Id<"meetings">;
  organizerId: Id<"users">;
  title: string;
  description?: string;
  scheduledAt?: number;
  duration?: number;
  state: "scheduled" | "active" | "concluded" | "cancelled";
  participantCount?: number;
  createdAt: number;
  updatedAt: number;
  userRole: "host" | "participant" | "observer";
  userPresence: "invited" | "joined" | "left";
  activeWebRTCSessions: number;
}

export interface TranscriptSegment {
  _id: Id<"transcriptSegments">;
  _creationTime: number;
  meetingId: Id<"meetings">;
  startMs: number;
  endMs: number;
  speakers: string[];
  text: string;
  topics: string[];
  sentiment?: {
    score: number;
    label: "positive" | "negative" | "neutral";
  };
  createdAt: number;
}

export interface MeetingNote {
  _id: Id<"meetingNotes">;
  meetingId: Id<"meetings">;
  content: string;
  version: number;
  lastEditedBy?: Id<"users">;
  lastEditedAt: number;
  createdAt: number;
}

export interface MeetingInsights {
  totalDuration: number;
  totalSegments: number;
  uniqueSpeakers: string[];
  topics: string[];
  averageSentiment: number;
  hasNotes: boolean;
  notesLength: number;
}

export interface UsePostCallInsightsResult {
  meeting: MeetingWithInsights | null | undefined;
  transcriptSegments: TranscriptSegment[];
  notes: MeetingNote | null | undefined;
  insights: MeetingInsights;
  isLoading: boolean;
  isProcessing: boolean;
  fullTranscript: string;
}

/**
 * Hook for accessing post-call meeting insights
 * 
 * @param meetingId - The meeting ID to fetch insights for
 * @returns Post-call insights and related data
 * 
 * @example
 * ```tsx
 * function PostCallDashboard({ meetingId }) {
 *   const {
 *     meeting,
 *     transcriptSegments,
 *     notes,
 *     insights,
 *     isLoading,
 *     fullTranscript
 *   } = usePostCallInsights(meetingId);
 *   
 *   if (isLoading) return <LoadingSpinner />;
 *   
 *   return (
 *     <div>
 *       <MeetingSummary
 *         duration={insights.totalDuration}
 *         participants={meeting?.participantCount}
 *         topics={insights.topics}
 *       />
 *       <TranscriptSection text={fullTranscript} />
 *       <NotesSection content={notes?.content} />
 *       <InsightsPanel insights={insights} />
 *     </div>
 *   );
 * }
 * ```
 */
export function usePostCallInsights(
  meetingId: Id<"meetings">
): UsePostCallInsightsResult {
  // Query meeting details
  const meeting = useQuery(
    api.meetings.queries.getMeeting,
    { meetingId }
  );

  // Query transcript segments
  const transcriptSegments = useQuery(
    api.transcripts.queries.getTranscriptSegments,
    { meetingId, limit: 1000 }
  );

  // Query notes
  const notes = useQuery(
    api.notes.queries.getMeetingNotes,
    { meetingId }
  );

  // Calculate insights from transcript data
  const insights = useMemo((): MeetingInsights => {
    const segments = transcriptSegments || [];
    
    // Calculate total duration
    const totalDuration = segments.length > 0
      ? segments[segments.length - 1].endMs
      : 0;

    // Extract unique speakers
    const speakerSet = new Set<string>();
    segments.forEach(segment => {
      segment.speakers.forEach(speaker => speakerSet.add(speaker));
    });

    // Extract all topics
    const topicSet = new Set<string>();
    segments.forEach(segment => {
      segment.topics.forEach(topic => topicSet.add(topic));
    });

    // Calculate average sentiment
    const sentimentScores = segments
      .filter(s => s.sentiment)
      .map(s => s.sentiment!.score);
    const averageSentiment = sentimentScores.length > 0
      ? sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length
      : 0;

    return {
      totalDuration,
      totalSegments: segments.length,
      uniqueSpeakers: Array.from(speakerSet),
      topics: Array.from(topicSet),
      averageSentiment,
      hasNotes: !!notes,
      notesLength: notes?.content?.length || 0,
    };
  }, [transcriptSegments, notes]);

  // Compile full transcript text
  const fullTranscript = useMemo(() => {
    if (!transcriptSegments) return "";
    
    return transcriptSegments
      .map(segment => {
        const speakers = segment.speakers.length > 0
          ? `[${segment.speakers.join(", ")}]: `
          : "";
        return `${speakers}${segment.text}`;
      })
      .join("\n\n");
  }, [transcriptSegments]);

  // Determine if post-processing is still ongoing
  const isProcessing = meeting?.state === "concluded" &&
    (transcriptSegments === undefined || transcriptSegments.length === 0);

  return {
    meeting,
    transcriptSegments: transcriptSegments || [],
    notes,
    insights,
    isLoading: meeting === undefined,
    isProcessing,
    fullTranscript,
  };
}