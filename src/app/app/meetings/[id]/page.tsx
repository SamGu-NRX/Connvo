"use client";

import { notFound, useParams } from "next/navigation";
import type { Id } from "@convex/_generated/dataModel";
import { MeetingDetail } from "@/components/history/MeetingDetail";
import { isAfterCallEnabled } from "@/lib/featureFlags";

export default function MeetingPage() {
  const params = useParams();
  if (!isAfterCallEnabled()) notFound();
  const meetingId = String(params.id ?? "") as Id<"meetings">;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col py-2">
      <MeetingDetail meetingId={meetingId} />
    </main>
  );
}
