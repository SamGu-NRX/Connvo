"use client";

import React, { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import QueueStatus from "./QueueStatus";
import MatchNotification from "./MatchNotification";
import ErrorState from "@/components/mvp/ErrorState";
import { Button } from "@/components/ui/button";

interface SmartConnectionEngineProps {
  userId: string;
  queueType: "professional" | "casual";
  onLeaveQueue: () => void;
  onAcceptMatch: (matchId: string) => void;
  onDeclineMatch: (matchId: string) => void;
}

export default function SmartConnectionEngine({
  userId,
  queueType,
  onLeaveQueue,
  onAcceptMatch,
  onDeclineMatch,
}: SmartConnectionEngineProps) {
  const [queueStatus, setQueueStatus] = useState<
    "searching" | "match_found" | "error"
  >("searching");
  const [estimatedWaitTime, setEstimatedWaitTime] = useState<number>(60); // in seconds
  const [matchData, setMatchData] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [infoMessage, setInfoMessage] = useState<string>("");

  useEffect(() => {
    if (queueStatus !== "searching") {
      return;
    }

    setInfoMessage("");
    setEstimatedWaitTime(60);

    const waitTimer = setInterval(() => {
      setEstimatedWaitTime((prev) => Math.max(0, prev - 1));
    }, 1000);

    const notEnoughTimer = setTimeout(() => {
      setInfoMessage("There aren't enough people queueing right now.");
    }, 2000);

    const demoTimer = setTimeout(() => {
      setInfoMessage("Directing you to our demo experience...");
    }, 6000);

    const matchTimer = setTimeout(() => {
      setInfoMessage("");
      setQueueStatus("match_found");
      setMatchData({
        id: "match123",
        name: "Jane Doe",
        avatar: null,
        bio: "Software Engineer | AI Enthusiast",
        profession: "Software Engineer",
        company: "TechCorp Inc.",
        school: "Stanford University",
        experience: 5,
        tag: "AI Specialist",
        connectionType: "collaboration" as const,
        sharedInterests: [
          { type: "academic", name: "Machine Learning" },
          { type: "industry", name: "Open Source" },
          { type: "skill", name: "Hiking" },
        ],
        upvotes: 42,
      });
    }, 10000);

    return () => {
      clearInterval(waitTimer);
      clearTimeout(matchTimer);
      clearTimeout(notEnoughTimer);
      clearTimeout(demoTimer);
    };
  }, [queueStatus]);

  const handleAcceptMatch = () => {
    if (matchData) {
      onAcceptMatch(matchData.id);
    }
  };

  const handleDeclineMatch = () => {
    if (matchData) {
      onDeclineMatch(matchData.id);
      setQueueStatus("searching");
      setMatchData(null);
      setEstimatedWaitTime(30); // Reset wait time
    }
  };

  if (queueStatus === "error") {
    return (
      <ErrorState
        message={errorMessage}
        onRetry={() => setQueueStatus("searching")}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-6 text-center">
      <AnimatePresence mode="wait">
        {queueStatus === "searching" && (
          <motion.div
            key="searching"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <QueueStatus
              queueType={queueType === "professional" ? "formal" : "casual"}
              estimatedWaitTime={estimatedWaitTime}
            />
            {infoMessage && (
              <motion.p
                key={infoMessage}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="text-sm text-emerald-900/70 dark:text-emerald-100/70"
              >
                {infoMessage}
              </motion.p>
            )}
            <Button
              onClick={onLeaveQueue}
              variant="outline"
              className="rounded-sm border border-surface bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/80 transition-colors duration-200 hover:bg-emerald-50/60 dark:bg-emerald-950/40 dark:text-emerald-100/80 dark:hover:bg-emerald-900/60"
            >
              Leave Queue
            </Button>
          </motion.div>
        )}

        {queueStatus === "match_found" && matchData && (
          <motion.div
            key="match_found"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.3 }}
          >
            <MatchNotification
              matchData={matchData}
              onAccept={handleAcceptMatch}
              onDecline={handleDeclineMatch}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
