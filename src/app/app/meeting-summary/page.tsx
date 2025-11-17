"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Clock,
  FileText,
  Loader2,
  MessageSquare,
  Sparkles,
  Users,
} from "lucide-react";
import { LAST_MEETING_SUMMARY_KEY } from "@/constants/meeting";

type StoredMeetingSummary = {
  meetingId: string;
  partnerName: string;
  queueType: "casual" | "professional";
  durationSeconds: number;
  participants: Array<{ name: string; role?: string }>;
  messages: { total: number; you: number; partner: number };
  notes: string;
  notesLength: number;
  endedAt: string;
  promptsViewed: string[];
  activePrompt: string;
};

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export default function MeetingSummaryPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<StoredMeetingSummary | null>(null);
  const [isCheckingSummary, setIsCheckingSummary] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = sessionStorage.getItem(LAST_MEETING_SUMMARY_KEY);
      if (!raw) return;

      setSummary(JSON.parse(raw));
    } catch (error) {
      console.warn("Failed to parse stored meeting summary", error);
      sessionStorage.removeItem(LAST_MEETING_SUMMARY_KEY);
    } finally {
      setIsCheckingSummary(false);
    }
  }, []);

  const handleBackToApp = () => {
    router.push("/app");
  };

  const handleClearAndReturn = () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(LAST_MEETING_SUMMARY_KEY);
    }
    router.push("/app");
  };

  if (isCheckingSummary) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center px-4 py-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
            Preparing your meeting summary
          </p>
          <p className="text-xs text-emerald-900/70 dark:text-emerald-200/70">
            Hang tight while we gather your latest session details.
          </p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center justify-center gap-4 px-4 py-6 text-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">No Meeting Summary Yet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-muted-foreground">
            <p>
              Finish a call to generate a summary. The most recent summary is
              stored locally for this browser session only.
            </p>
            <Button onClick={handleBackToApp} className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-emerald-900 dark:text-white">
            Latest Meeting Summary
          </h1>
          <p className="text-sm text-muted-foreground">
            Generated {new Date(summary.endedAt).toLocaleString()} • Meeting ID:{" "}
            {summary.meetingId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="uppercase tracking-wide">
            {summary.queueType}
          </Badge>
          <Button variant="ghost" onClick={handleBackToApp}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to App
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm text-muted-foreground">Partner</p>
            <p className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
              {summary.partnerName}
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Session data stored locally – not saved to your account
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3">
            <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-500/20">
              <Clock className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {formatDuration(summary.durationSeconds)}
              </p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Time in meeting
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3">
            <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-500/20">
              <Users className="h-5 w-5 text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {summary.participants.length}
              </p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Participants
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3">
            <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-500/20">
              <MessageSquare className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            </div>
            <div>
              <p className="text-2xl font-bold">{summary.messages.total}</p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Total messages
              </p>
              <p className="text-[11px] text-muted-foreground">
                You: {summary.messages.you} · {summary.partnerName}:{" "}
                {summary.messages.partner}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-emerald-500" />
              Conversation Highlights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {summary.promptsViewed.length > 0 ? (
              summary.promptsViewed.map((prompt, index) => (
                <div
                  key={`${prompt}-${index}`}
                  className="rounded-md border border-dashed border-emerald-200 p-3 dark:border-emerald-800/60"
                >
                  <p className="text-xs uppercase tracking-wide text-emerald-500">
                    Prompt {index + 1}
                  </p>
                  <p className="text-sm text-emerald-900 dark:text-emerald-100">
                    {prompt}
                  </p>
                </div>
              ))
            ) : (
              <p>No prompts were cycled during this meeting.</p>
            )}
            <Separator />
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Active prompt when call ended
            </p>
            <p className="text-sm text-emerald-900 dark:text-emerald-100">
              {summary.activePrompt}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-sky-500" />
              Meeting Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary.notesLength > 0 ? (
              <ScrollArea className="h-40 rounded-md border bg-muted/20 p-3">
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {summary.notes}
                </p>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground">
                You didn’t capture any notes this time. Use the Notes tab during
                your next session to jot down key ideas.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Participants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {summary.participants.map((participant) => (
            <div
              key={participant.name}
              className="flex flex-wrap items-center justify-between rounded-md border border-border/80 px-3 py-2"
            >
              <div>
                <p className="font-medium text-emerald-900 dark:text-emerald-100">
                  {participant.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {participant.role || "Participant"}
                </p>
              </div>
              <Badge variant="secondary">Present</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
{/* 
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          This summary is temporary and will disappear once you leave or refresh
          the page.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleBackToApp}>
            Continue in App
          </Button>
          <Button onClick={handleClearAndReturn}>Clear Summary</Button>
        </div>
      </div> */}
    </div>
  );
}
