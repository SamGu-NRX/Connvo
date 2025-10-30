/**
 * Live Transcription Panel Component
 * 
 * Displays real-time meeting transcription with speaker identification.
 * 
 * Features:
 * - Scrollable transcript view
 * - Speaker identification with colors
 * - Timestamp display
 * - Auto-scroll to latest
 * - Search functionality
 * - Sentiment indicators
 */

"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranscription } from "@/hooks/useTranscription";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Download,
  MessageSquare,
  ChevronDown,
  Smile,
  Frown,
  Meh,
} from "lucide-react";
import { Id } from "@convex/_generated/dataModel";

interface LiveTranscriptionPanelProps {
  meetingId: Id<"meetings">;
  className?: string;
  autoScroll?: boolean;
}

export function LiveTranscriptionPanel({
  meetingId,
  className,
  autoScroll = true,
}: LiveTranscriptionPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(autoScroll);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    segments,
    isLoading,
    totalSegments,
    searchSegments,
  } = useTranscription(meetingId);

  // Filter segments based on search
  const displaySegments = searchQuery
    ? searchSegments(searchQuery)
    : segments;

  // Auto-scroll to bottom when new segments arrive
  useEffect(() => {
    if (isAutoScrollEnabled && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [segments.length, isAutoScrollEnabled]);

  const handleDownload = () => {
    const text = segments
      .map((segment) => {
        const timestamp = formatTimestamp(segment.startMs);
        const speakers = segment.speakers.join(", ");
        return `[${timestamp}] ${speakers ? `${speakers}: ` : ""}${segment.text}`;
      })
      .join("\n\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${meetingId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-blue-500" />
            <CardTitle>Live Transcription</CardTitle>
            <Badge variant="secondary">{totalSegments} segments</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleDownload} variant="ghost" size="sm">
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search transcript..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            onClick={() => setIsAutoScrollEnabled(!isAutoScrollEnabled)}
            variant={isAutoScrollEnabled ? "default" : "outline"}
            size="sm"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {displaySegments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              {searchQuery
                ? "No matching transcript segments found"
                : "Waiting for transcript..."}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-96" ref={scrollRef}>
            <div className="space-y-4">
              {displaySegments.map((segment, index) => (
                <TranscriptSegment
                  key={segment._id}
                  segment={segment}
                  searchQuery={searchQuery}
                  speakerColor={getSpeakerColor(segment.speakers[0] || "", index)}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

interface TranscriptSegmentProps {
  segment: {
    startMs: number;
    endMs: number;
    speakers: string[];
    text: string;
    topics: string[];
    sentiment?: {
      score: number;
      label: "positive" | "negative" | "neutral";
    };
  };
  searchQuery: string;
  speakerColor: string;
}

function TranscriptSegment({
  segment,
  searchQuery,
  speakerColor,
}: TranscriptSegmentProps) {
  const highlightText = (text: string, query: string) => {
    if (!query) return text;

    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-900">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const getSentimentIcon = () => {
    if (!segment.sentiment) return null;

    switch (segment.sentiment.label) {
      case "positive":
        return <Smile className="h-3 w-3 text-green-500" />;
      case "negative":
        return <Frown className="h-3 w-3 text-red-500" />;
      case "neutral":
        return <Meh className="h-3 w-3 text-gray-500" />;
    }
  };

  return (
    <div className="group rounded-lg border p-3 transition-colors hover:bg-muted/50">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {segment.speakers.length > 0 && (
            <div className={`flex items-center gap-2 ${speakerColor}`}>
              <div className="h-2 w-2 rounded-full bg-current" />
              <span className="text-xs font-medium">
                {segment.speakers.join(", ")}
              </span>
            </div>
          )}
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(segment.startMs)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {getSentimentIcon()}
        </div>
      </div>

      <p className="mb-2 text-sm leading-relaxed">
        {highlightText(segment.text, searchQuery)}
      </p>

      {segment.topics.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {segment.topics.map((topic) => (
            <Badge key={topic} variant="outline" className="text-xs">
              {topic}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getSpeakerColor(speaker: string, index: number): string {
  const colors = [
    "text-blue-600 dark:text-blue-400",
    "text-green-600 dark:text-green-400",
    "text-purple-600 dark:text-purple-400",
    "text-orange-600 dark:text-orange-400",
    "text-pink-600 dark:text-pink-400",
    "text-cyan-600 dark:text-cyan-400",
  ];

  // Use speaker name hash or index to consistently assign colors
  const hash = speaker
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length] || colors[index % colors.length];
}

export default LiveTranscriptionPanel;