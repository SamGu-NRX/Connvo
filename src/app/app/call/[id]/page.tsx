"use client";

import { Suspense } from "react";

import { CallNotice, RealCall } from "./real-call";

// Real calls stay off until Sam decides (CALL-PLAN "Production wiring").
// The simulated call was removed, so without NEXT_PUBLIC_CONNVO_REAL_CALL=1
// this page shows a plain not-available notice instead of redirecting.
const REAL_CALL = process.env.NEXT_PUBLIC_CONNVO_REAL_CALL === "1";

export default function CallPage() {
  return (
    <Suspense
      fallback={<CallNotice title="Getting your call ready" body="Loading your call…" />}
    >
      {REAL_CALL ? (
        <RealCall />
      ) : (
        <CallNotice
          title="Calls aren't available yet"
          body="Live video calls are coming soon. Matching and the queue still work as usual — you'll be able to join from here once a call is scheduled."
        />
      )}
    </Suspense>
  );
}
