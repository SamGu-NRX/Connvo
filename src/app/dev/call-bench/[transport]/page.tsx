/**
 * Dev call bench (CALL-PLAN.md S0, CONTRACT.md "Bench route and transports").
 *
 * The harness mounts a transport by name and drives the page through the DOM
 * contract. This route exists only for evaluation:
 *
 * - 404 unless `NEXT_PUBLIC_CONNVO_CALL_BENCH=1`;
 * - no Convex provider and no sign-in — peer identity comes from the URL
 *   (`?as=<A|B|C|O>`) and tokens come from the eval-only test-auth endpoint;
 * - the page states plainly that it is a dev bench.
 */

import { notFound } from "next/navigation";

import { listTransports } from "@/lib/call/transports";

import { BenchClient } from "./bench-client";
import { signalUrlFromParam } from "./signal-url";

export const metadata = {
  title: "Connvo call bench",
  robots: { index: false },
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function CallBenchPage({
  params,
  searchParams,
}: {
  params: Promise<{ transport: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NEXT_PUBLIC_CONNVO_CALL_BENCH !== "1") notFound();

  const { transport } = await params;
  if (!listTransports().includes(transport)) notFound();

  const query = await searchParams;
  const participant = (firstParam(query.as) ?? "A").toUpperCase();
  if (!["A", "B", "C", "O"].includes(participant)) notFound();

  const meetingId = firstParam(query.meeting) ?? "bench-meeting";
  const name = firstParam(query.name);
  const delayJoinMs = Number(firstParam(query.delayJoin) ?? 0) || 0;
  const avatar = firstParam(query.avatar);
  const autoJoin = firstParam(query.autojoin) !== "0";
  const state = firstParam(query.state);

  // Additive eval param: the runner hands the spawned signaling server's
  // address here (port fallback means the port is not known ahead of time).
  const signalUrl = signalUrlFromParam(query.signal);

  // One identity scheme end to end: the subject the token carries IS the
  // harness participant id (A/B) — the bench signaling server mints exactly
  // this sub, and rooms/event logs/scenarios all use it.
  return (
    <BenchClient
      transportName={transport}
      participant={participant}
      selfId={participant}
      meetingId={meetingId}
      displayName={name}
      delayJoinMs={delayJoinMs}
      showAvatar={avatar !== "0"}
      autoJoin={autoJoin}
      forcedState={state}
      signalUrl={signalUrl}
    />
  );
}
