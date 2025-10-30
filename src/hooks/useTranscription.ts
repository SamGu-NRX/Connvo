/**
 * Live Transcription Hook
 * 
 * Hook for accessing real-time meeting transcriptions with speaker identification.
 * 
 * Features:
 * - Real-time transcript segments
 * - Speaker identification
 * - Confidence scores
 * - Timestamp information
 * - Search and filter capabilities
 * 
 * Backend APIs:
 * - api.transcripts.queries.getTranscriptSegments
 * - Processing: internal.transcripts.streaming.processTranscriptStream
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { useMemo } from "react";

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

export interface UseTranscriptionResult {
  segments: TranscriptSegment[];
  isLoading: boolean;
  totalSegments: number;
  totalDuration: number;
  searchSegments: (query: string) => TranscriptSegment[];
  getSegmentsBySpeaker: (speaker: string) => TranscriptSegment[];
  getSegmentsByTimeRange: (startMs: number, endMs: number) => TranscriptSegment[];
}

/**
 * Hook for accessing meeting transcription
 * 
 * @param meetingId - The meeting ID to fetch transcripts for
 * @param options - Optional configuration
 * @param options.limit - Maximum number of segments to fetch (default: 100)
 * @param options.autoRefresh - Whether to auto-refresh transcripts (default: true)
 * @returns Transcription segments and utility functions
 * 
 * @example
 * ```tsx
 * function LiveTranscriptionPanel({ meetingId }) {
 *   const { segments, isLoading, searchSegments } = useTranscription(meetingId);
 *   const [searchQuery, setSearchQuery] = useState("");
 *   
 *   const filteredSegments = searchQuery
 *     ? searchSegments(searchQuery)
 *     : segments;
 *   
 *   if (isLoading) return <Spinner />;
 *   
 *   return (
 *     <div>
 *       <SearchBar value={searchQuery} onChange={setSearchQuery} />
 *       <TranscriptList segments={filteredSegments} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useTranscription(
  meetingId: Id<"meetings">,
  options?: {
    limit?: number;
    autoRefresh?: boolean;
  }
): UseTranscriptionResult {
  const limit = options?.limit || 100;

  // Query transcript segments from backend
  const segments = useQuery(
    api.transcripts.queries.getTranscriptSegments,
    { meetingId, limit }
  );

  // Calculate total duration
  const totalDuration = useMemo(() => {
    if (!segments || segments.length === 0) return 0;
    
    const lastSegment = segments[segments.length - 1];
    return lastSegment?.endMs || 0;
  }, [segments]);

  // Search segments by text content
  const searchSegments = (query: string): TranscriptSegment[] => {
    if (!segments || !query.trim()) return segments || [];
    
    const lowerQuery = query.toLowerCase();
    return segments.filter((segment) =>
      segment.text.toLowerCase().includes(lowerQuery) ||
      segment.topics.some((topic) => topic.toLowerCase().includes(lowerQuery))
    );
  };

  // Filter segments by speaker
  const getSegmentsBySpeaker = (speaker: string): TranscriptSegment[] => {
    if (!segments) return [];
    
    return segments.filter((segment) =>
      segment.speakers.includes(speaker)
    );
  };

  // Filter segments by time range
  const getSegmentsByTimeRange = (startMs: number, endMs: number): TranscriptSegment[] => {
    if (!segments) return [];
    
    return segments.filter((segment) =>
      segment.startMs >= startMs && segment.endMs <= endMs
    );
  };

  return {
    segments: segments || [],
    isLoading: segments === undefined,
    totalSegments: segments?.length || 0,
    totalDuration,
    searchSegments,
    getSegmentsBySpeaker,
    getSegmentsByTimeRange,
  };
}