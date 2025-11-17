"use client";

import React, { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import QueueStatus from "./QueueStatus";
import UserCard from "@/components/mvp/user-card";
import MatchNotification from "./MatchNotification";
import ErrorState from "@/components/mvp/ErrorState";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";

interface MatchQueueLobbyProps {
  userId: string;
  queueType: "formal" | "casual";
  onLeaveQueue: () => void;
  onAcceptMatch: (matchId: string) => void;
  onDeclineMatch: (matchId: string) => void;
}

export default function MatchQueueLobby({
  userId,
  queueType,
  onLeaveQueue,
  onAcceptMatch,
  onDeclineMatch,
}: MatchQueueLobbyProps) {
  const [queueStatus, setQueueStatus] = useState<
    "searching" | "match_found" | "error"
  >("searching");
  const [estimatedWaitTime, setEstimatedWaitTime] = useState<number>(60); // in seconds
  const [matchData, setMatchData] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    // Simulating queue updates
    const timer = setInterval(() => {
      setEstimatedWaitTime((prev) => Math.max(0, prev - 1));
    }, 1000);

    // Simulating a match found after 10 seconds
    const matchTimer = setTimeout(() => {
      setQueueStatus("match_found");
      setMatchData({
        id: "match123",
        name: "Jane Doe",
        avatar: null,
        bio: "Software Engineer | AI Enthusiast",
        sharedInterests: ["AI", "Hiking", "Photography"],
      });
    }, 10000);

    return () => {
      clearInterval(timer);
      clearTimeout(matchTimer);
    };
  }, []);

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
    <div className="flex w-full justify-center py-4">
      <GlassPanel className="w-full max-w-3xl rounded-sm px-4 py-4">
        <AnimatePresence mode="wait">
          {queueStatus === "searching" && (
            <motion.div
              key="searching"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4 text-center"
            >
              <QueueStatus
                queueType={queueType}
                estimatedWaitTime={estimatedWaitTime}
              />
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
      </GlassPanel>
    </div>
  );
}
