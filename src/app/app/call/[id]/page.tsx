"use client";

import React, { useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import type { CallType } from "@/types/call";

export default function CallPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const callType = (searchParams.get("type") as CallType) || "casual";
  const callId = params.id as string;

  useEffect(() => {
    // Redirect to the video call page with the same call id and type parameter
    router.replace(`/videocall/${callId}?type=${callType}`);
  }, [router, callId, callType]);

  return <div>Redirecting to video call...</div>;
}
