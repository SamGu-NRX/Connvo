"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import LiveMatchQueue from "@/components/queue/LiveMatchQueue";
import { QueueLoading } from "@/components/queue/QueueView";

export default function SmartConnectionPage() {
  return (
    <Suspense fallback={<QueueLoading />}>
      <QueueFromSearch />
    </Suspense>
  );
}

function QueueFromSearch() {
  const params = useSearchParams();
  return (
    <LiveMatchQueue
      queueType={
        params.get("type") === "professional" ? "professional" : "casual"
      }
    />
  );
}
