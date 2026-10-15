"use client";

import React, { Suspense, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import type { CallType } from "@/types/call";

import { CallNotice, RealCall } from "./real-call";

// Real calls stay off until Sam decides (CALL-PLAN "Production wiring"):
// without NEXT_PUBLIC_CONNVO_REAL_CALL=1 this page keeps redirecting to the
// simulated call, exactly as before.
const REAL_CALL = process.env.NEXT_PUBLIC_CONNVO_REAL_CALL === "1";

export default function CallPage() {
  return (
    <Suspense fallback={<CallNotice title="Getting your call ready" body="Loading your call…" />}>
      {REAL_CALL ? <RealCall /> : <SimulatedCallRedirect />}
    </Suspense>
  );
}

function SimulatedCallRedirect() {
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
