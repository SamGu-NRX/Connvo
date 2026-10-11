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
import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

type ProofState =
  | { kind: "pending" }
  | { kind: "ok"; title: string; raw: string }
  | { kind: "error"; message: string };

export default function AuthProof({ as, meetingId }: { as: string; meetingId: string }) {
  const convex = useConvex();
  const [state, setState] = useState<ProofState>({ kind: "pending" });

  useEffect(() => {
    let cancelled = false;
    if (!meetingId) {
      setState({ kind: "error", message: "missing ?meeting=<id>" });
      return;
    }
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
        const message =
          err instanceof Error ? err.message : JSON.stringify(err ?? String(err));
        setState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [convex, meetingId]);

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
        {state.kind === "pending" && "calling getMeeting…"}
        {state.kind === "ok" && `OK: ${state.title}\n${state.raw}`}
        {state.kind === "error" && `ERROR: ${state.message}`}
      </div>
    </main>
  );
}
