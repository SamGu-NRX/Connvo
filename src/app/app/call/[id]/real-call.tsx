"use client";

/**
 * The real call page behind NEXT_PUBLIC_CONNVO_REAL_CALL=1.
 *
 * Calls connect through a signaling service. The Convex one does not exist
 * yet (it waits for local Convex, PR #35), so today the page can only connect
 * in the local eval setup: with NEXT_PUBLIC_CONNVO_CALL_BENCH=1 it takes a
 * bench identity from ?as=A..D and uses the reference WebSocket signaling
 * server from ?signal= or NEXT_PUBLIC_CONNVO_CALL_SIGNALING_URL. Everywhere
 * else it says plainly that calls need the signaling service.
 */
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { CallRoom } from "@/components/call/CallRoom";
import { createP2PTransport } from "@/lib/call/transports/p2p/p2p-transport";
import { websocketSignaling } from "@/lib/call/transports/p2p/websocket-signaling";
import { signalUrlFromParam } from "@/app/dev/call-bench/[transport]/signal-url";

const BENCH = process.env.NEXT_PUBLIC_CONNVO_CALL_BENCH === "1";
const BENCH_IDS = ["A", "B", "C", "D"];

export function RealCall() {
  const params = useParams();
  const search = useSearchParams();
  const meetingId = String(params.id ?? "");
  const signalUrl =
    signalUrlFromParam(search.get("signal") ?? undefined) ??
    process.env.NEXT_PUBLIC_CONNVO_CALL_SIGNALING_URL ??
    null;

  if (!BENCH || !signalUrl) return <NoSignaling />;

  const requested = (search.get("as") ?? "A").toUpperCase();
  const selfId = BENCH_IDS.includes(requested) ? requested : "A";
  const name = search.get("name")?.slice(0, 80) || `Guest ${selfId}`;
  return (
    <BenchCall
      meetingId={meetingId}
      selfId={selfId}
      name={name}
      signalUrl={signalUrl}
    />
  );
}

function BenchCall({
  meetingId,
  selfId,
  name,
  signalUrl,
}: {
  meetingId: string;
  selfId: string;
  name: string;
  signalUrl: string;
}) {
  const createTransport = useCallback(
    () =>
      Promise.resolve(
        createP2PTransport({ signaling: websocketSignaling(signalUrl) }),
      ),
    [signalUrl],
  );
  const identityToken = useCallback(async () => {
    const res = await fetch(
      new URL("/mint", signalUrl.replace(/^ws/, "http")),
      {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ user: selfId }),
      },
    );
    if (!res.ok)
      throw new Error(`The call service refused a token (${res.status}).`);
    return ((await res.json()) as { token: string }).token;
  }, [selfId, signalUrl]);
  const self = useMemo(() => ({ id: selfId, name }), [selfId, name]);

  return (
    <div className="h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-7rem)]">
      <CallRoom
        meetingId={meetingId}
        self={self}
        createTransport={createTransport}
        identityToken={identityToken}
        nameFor={(id) => `Guest ${id}`}
        inviteLink={() => {
          // Bench invites keep the signaling server and hand the next bench
          // identity, so the person invited does not replace the sender.
          const next =
            BENCH_IDS[(BENCH_IDS.indexOf(selfId) + 1) % BENCH_IDS.length];
          const url = new URL(window.location.href);
          url.search = new URLSearchParams({
            as: next,
            signal: signalUrl,
          }).toString();
          return url.toString();
        }}
        exitHref="/app"
      />
    </div>
  );
}

function NoSignaling() {
  return (
    <div
      data-call-phase="failed"
      className="grid h-full min-h-[24rem] place-items-center p-6"
    >
      <div className="flex max-w-md flex-col gap-3 text-center">
        <h1 className="text-2xl font-medium tracking-tight">
          Calls need the signaling service
        </h1>
        <p data-testid="call-error" className="text-muted-foreground text-sm">
          This build has no call signaling configured, so it cannot connect you
          to anyone yet. Real calls will connect once the Convex signaling
          service is set up.
        </p>
        <Link
          href="/app"
          className="bg-primary text-primary-foreground focus-visible:ring-ring/50 mx-auto mt-1 grid h-10 place-items-center rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-[3px]"
        >
          Back to Connvo
        </Link>
      </div>
    </div>
  );
}
