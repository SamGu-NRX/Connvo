"use client";

import { useSearchParams } from "next/navigation";
import LiveMatchQueue from "@/components/queue/LiveMatchQueue";

export default function SmartConnectionPage() {
  const params = useSearchParams();
  return (
    <LiveMatchQueue
      queueType={
        params.get("type") === "professional" ? "professional" : "casual"
      }
    />
  );
}
