"use client";

import React, { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SmartConnectionEngine from "@/components/queue/SmartConnectionEngine";
import { normalizeQueueType } from "../_lib/queue-params";

export default function SmartConnectionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawQueueType = searchParams.get("type");
  const queueType = normalizeQueueType(rawQueueType);
  const purpose = searchParams.get("purpose");

  const handleLeaveQueue = useCallback(() => {
    router.push("/app");
  }, [router]);

  const handleAcceptMatch = useCallback(
    (matchId: string) => {
      console.log(`Accepted match with ID: ${matchId}`);
      router.push(`/videocall/${matchId}`);
    },
    [router],
  );

  const handleDeclineMatch = useCallback((matchId: string) => {
    console.log(`Declined match with ID: ${matchId}`);
  }, []);

  return (
    <SmartConnectionEngine
      userId="user123"
      queueType={queueType}
      onLeaveQueue={handleLeaveQueue}
      onAcceptMatch={handleAcceptMatch}
      onDeclineMatch={handleDeclineMatch}
    />
  );
}
