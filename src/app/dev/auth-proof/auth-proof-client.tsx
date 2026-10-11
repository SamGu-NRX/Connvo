"use client";

/**
 * Client half of the eval-only auth proof page: calls the authenticated
 * convex/meetings/queries.ts getMeeting (behind assertMeetingAccess) as the
 * signed-in test identity and renders the outcome for the harness.
 *
 * Expected: participant A resolves with the seeded meeting; signed-in
 * outsider O gets the named rejection ("Access denied: Not a meeting
 * participant").
 */

import { useEffect, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// Bounded retries for transient query failures — backend contention on the
// shared sandbox, or a token that raced auth application. The auth gate
// makes the first attempt wait for the token, so these are rare; the bound
// keeps the page terminating instead of spinning forever.
const MAX_QUERY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

type ProofState =
  | { kind: "pending" }
  | { kind: "ok"; title: string; raw: string }
  | { kind: "error"; message: string };

export default function AuthProof({ as, meetingId }: { as: string; meetingId: string }) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [state, setState] = useState<ProofState>({ kind: "pending" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Gate on auth readiness: until the Convex client holds the test token,
    // getMeeting is rejected as unauthenticated and that premature error
    // stuck — the query never retried. isAuthenticated flips once the
    // adapter's token lands.
    if (!isAuthenticated) return;
    if (!meetingId) {
      setState({ kind: "error", message: "missing ?meeting=<id>" });
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    convex
      .query(api.meetings.queries.getMeeting, {
        meetingId: meetingId as Id<"meetings">,
      })
      .then((meeting: { title?: string } | null) => {
        if (cancelled) return;
        setState({
          kind: "ok",
          title: meeting?.title ?? "(no meeting)",
          raw: JSON.stringify(meeting),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (attempt + 1 < MAX_QUERY_ATTEMPTS) {
          retryTimer = setTimeout(
            () => setAttempt((a) => a + 1),
            RETRY_DELAY_MS * 2 ** attempt,
          );
          return;
        }
        const message =
          err instanceof Error ? err.message : JSON.stringify(err ?? String(err));
        setState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [convex, isAuthenticated, meetingId, attempt]);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>connvo auth proof (eval)</h1>
      <p>
        identity: <b data-testid="auth-proof-user">{as}</b>
      </p>
      <p>
        meeting: <code>{meetingId || "(none)"}</code>
      </p>
      <div
        data-testid="auth-proof-result"
        data-proof={state.kind === "pending" ? "pending" : state.kind === "ok" ? "ok" : "error"}
        style={{
          padding: 12,
          border: "1px solid #ccc",
          borderRadius: 8,
          whiteSpace: "pre-wrap",
        }}
      >
        {state.kind === "pending" &&
          (isAuthenticated ? "calling getMeeting…" : "waiting for authentication…")}
        {state.kind === "ok" && `OK: ${state.title}\n${state.raw}`}
        {state.kind === "error" && `ERROR: ${state.message}`}
      </div>
    </main>
  );
}
