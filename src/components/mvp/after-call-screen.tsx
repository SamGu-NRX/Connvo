"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Clock,
  Users,
  MessageSquare,
  FileText,
  Download,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import { Id } from "@convex/_generated/dataModel";

interface AfterCallScreenProps {
  meetingId: Id<"meetings"> | string;
}

const AfterCallScreen = ({ meetingId }: AfterCallScreenProps) => {
  // Check if this is a valid Convex ID or a demo
  const isDemo = typeof meetingId === 'string' && !meetingId.startsWith('j');
  
  // Query meeting details - skip if demo
  const meeting = useQuery(
    api.meetings.queries.getMeeting,
    isDemo ? undefined : { meetingId: meetingId as Id<"meetings"> }
  );

  // Query transcript segments - skip if demo
  const transcriptSegments = useQuery(
    api.transcripts.queries.getTranscriptSegments,
    isDemo ? undefined : { meetingId: meetingId as Id<"meetings">, limit: 1000 }
  );

  // Query notes - skip if demo
  const notes = useQuery(
    api.notes.queries.getMeetingNotes,
    isDemo ? undefined : { meetingId: meetingId as Id<"meetings"> }
  );

  // Calculate insights from transcript data
  const insights = useMemo(() => {
    if (isDemo) {
      return {
        totalDuration: 1500000,
        totalSegments: 15,
        uniqueSpeakers: ["User 1", "User 2"],
        topics: ["Demo", "Testing"],
        averageSentiment: 0.85,
        hasNotes: false,
        notesLength: 0,
      };
    }

    const segments = transcriptSegments || [];
    const totalDuration = segments.length > 0
      ? segments[segments.length - 1].endMs
      : 0;

    const speakerSet = new Set<string>();
    segments.forEach(segment => {
      segment.speakers.forEach(speaker => speakerSet.add(speaker));
    });

    const topicSet = new Set<string>();
    segments.forEach(segment => {
      segment.topics.forEach(topic => topicSet.add(topic));
    });

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
  }, [transcriptSegments, notes, isDemo]);

  // Compile full transcript text
  const fullTranscript = useMemo(() => {
    if (isDemo || !transcriptSegments) return "";
    
    return transcriptSegments
      .map(segment => {
        const speakers = segment.speakers.length > 0
          ? `[${segment.speakers.join(", ")}]: `
          : "";
        return `${speakers}${segment.text}`;
      })
      .join("\n\n");
  }, [transcriptSegments, isDemo]);

  const isLoading = !isDemo && meeting === undefined;
  const isProcessing = !isDemo && meeting?.state === "concluded" &&
    (transcriptSegments === undefined || transcriptSegments.length === 0);

  const handleDownloadTranscript = () => {
    const blob = new Blob([fullTranscript], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${meetingId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadNotes = () => {
    if (!notes?.content) return;
    
    const blob = new Blob([notes.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `notes-${meetingId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Demo data fallback
  if (isDemo) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="mb-2 text-3xl">Demo Meeting Summary</CardTitle>
                  <p className="text-muted-foreground text-sm">
                    This is a demo. Real meeting data will appear here after actual calls.
                  </p>
                </div>
                <Badge variant="secondary">Demo</Badge>
              </div>
            </CardHeader>
          </Card>

          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/30">
                    <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">25:00</p>
                    <p className="text-muted-foreground text-xs">Duration</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-green-100 p-2 dark:bg-green-900/30">
                    <Users className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">2</p>
                    <p className="text-muted-foreground text-xs">Participants</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-purple-100 p-2 dark:bg-purple-900/30">
                    <MessageSquare className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">15</p>
                    <p className="text-muted-foreground text-xs">Segments</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-orange-100 p-2 dark:bg-orange-900/30">
                    <TrendingUp className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">85%</p>
                    <p className="text-muted-foreground text-xs">Positive</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-blue-500" />
                Demo Transcript
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                Real transcripts and meeting insights will appear here after your calls end.
                The system will automatically generate summaries, extract topics, and provide
                downloadable transcripts.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-4xl">
          <CardHeader>
            <Skeleton className="h-8 w-64" />
          </CardHeader>
          <CardContent className="space-y-6">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12">
            <Sparkles className="mx-auto mb-4 h-12 w-12 animate-pulse text-emerald-500" />
            <h3 className="mb-2 text-lg font-semibold">Processing Meeting Data</h3>
            <p className="text-muted-foreground text-sm">
              We're generating your meeting insights. This will take about 30 seconds...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="mb-2 text-3xl">{meeting?.title || "Meeting Summary"}</CardTitle>
                <p className="text-muted-foreground text-sm">
                  {meeting?.description || "View your meeting insights and recordings"}
                </p>
              </div>
              <Badge variant="secondary">Concluded</Badge>
            </div>
          </CardHeader>
        </Card>

        {/* Meeting Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/30">
                  <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatDuration(insights.totalDuration)}</p>
                  <p className="text-muted-foreground text-xs">Duration</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-green-100 p-2 dark:bg-green-900/30">
                  <Users className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{meeting?.participantCount || 0}</p>
                  <p className="text-muted-foreground text-xs">Participants</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-purple-100 p-2 dark:bg-purple-900/30">
                  <MessageSquare className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{insights.totalSegments}</p>
                  <p className="text-muted-foreground text-xs">Segments</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-orange-100 p-2 dark:bg-orange-900/30">
                  <TrendingUp className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{Math.round(insights.averageSentiment * 100)}%</p>
                  <p className="text-muted-foreground text-xs">Positive</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Topics Discussed */}
        {insights.topics.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-500" />
                Topics Discussed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {insights.topics.map((topic) => (
                  <Badge key={topic} variant="secondary" className="text-sm">
                    {topic}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Transcript */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-blue-500" />
                Meeting Transcript
              </CardTitle>
              <Button onClick={handleDownloadTranscript} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {transcriptSegments.length > 0 ? (
              <ScrollArea className="h-64">
                <div className="space-y-3 pr-4">
                  {transcriptSegments.slice(0, 10).map((segment) => (
                    <div key={segment._id} className="text-sm">
                      <span className="font-medium text-blue-600 dark:text-blue-400">
                        {segment.speakers.join(", ")}:
                      </span>{" "}
                      {segment.text}
                    </div>
                  ))}
                  {transcriptSegments.length > 10 && (
                    <p className="text-muted-foreground text-xs italic">
                      ...and {transcriptSegments.length - 10} more segments
                    </p>
                  )}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-muted-foreground text-center text-sm">
                No transcript available
              </p>
            )}
          </CardContent>
        </Card>

        {/* Shared Notes */}
        {insights.hasNotes && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-purple-500" />
                  Shared Notes
                </CardTitle>
                <Button onClick={handleDownloadNotes} variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-48">
                <div className="whitespace-pre-wrap pr-4 text-sm">
                  {notes?.content || "No notes taken during this meeting"}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default AfterCallScreen;
