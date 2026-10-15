"use client";

/**
 * The real call page behind NEXT_PUBLIC_CONNVO_REAL_CALL=1.
 *
 * Signaling, in order:
 * - the eval reference server, when NEXT_PUBLIC_CONNVO_CALL_BENCH=1 and the
 *   page has a ?signal= URL (bench identity from ?as=A..D);
 * - Convex (convex/meetings/webrtc/mesh.ts), whenever Convex is configured:
 *   the signed-in user joins if they are a participant of the meeting, and
 *   assertMeetingAccess refuses everyone else;
 * - otherwise a plain "calls need the signaling service" state.
 */
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  Component,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

import styles from "@/components/call/call.module.css";
import { CallRoom } from "@/components/call/CallRoom";
import { MeetingNotesPanel } from "@/components/meeting-notes/MeetingNotesPanel";
import { EndedRecap, OpenRecapLink } from "@/components/history/EndedRecap";
import {
  IceAccessError,
  isIceAccessRefusal,
  sessionIceConfiguration,
} from "@/lib/call/ice-config";
import { createP2PTransport } from "@/lib/call/transports/p2p/p2p-transport";
import { websocketSignaling } from "@/lib/call/transports/p2p/websocket-signaling";
import {
  convexSignaling,
  type ConvexCallClient,
} from "@/lib/call/transports/p2p/convex-signaling";
import { signalUrlFromParam } from "@/app/dev/call-bench/[transport]/signal-url";

const BENCH = process.env.NEXT_PUBLIC_CONNVO_CALL_BENCH === "1";
const BENCH_IDS = ["A", "B", "C", "D"];
const CONVEX_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
// The local test identities (CALL-PLAN D2) are WorkOS subjects
// local-test-a..o; on the page and to the harness they are A..O, the same
// ids the bench uses. Real WorkOS users keep their own ids.
const TEST_AUTH = process.env.NEXT_PUBLIC_CONNVO_TEST_AUTH === "1";
const participantIdOf = (workosUserId: string) =>
  TEST_AUTH && workosUserId.startsWith("local-test-")
    ? workosUserId.slice("local-test-".length).toUpperCase()
    : workosUserId;

export function RealCall() {
  const params = useParams();
  const search = useSearchParams();
  const meetingId = String(params.id ?? "");
  // An explicit ?signal= always means the bench; the build-time default
  // server only stands in when Convex is not configured.
  const benchSignalUrl = BENCH
    ? (signalUrlFromParam(search.get("signal") ?? undefined) ??
      (CONVEX_CONFIGURED
        ? null
        : (process.env.NEXT_PUBLIC_CONNVO_CALL_SIGNALING_URL ?? null)))
    : null;

  if (benchSignalUrl) {
    const requested = (search.get("as") ?? "A").toUpperCase();
    const selfId = BENCH_IDS.includes(requested) ? requested : "A";
    const name = search.get("name")?.slice(0, 80) || `Guest ${selfId}`;
    return (
      <BenchCall
        meetingId={meetingId}
        selfId={selfId}
        name={name}
        signalUrl={benchSignalUrl}
      />
    );
  }
  if (CONVEX_CONFIGURED) return <ConvexCall meetingId={meetingId} />;
  return <NoSignaling />;
}

/** A call signaled over Convex, for the signed-in user. */
function ConvexCall({ meetingId }: { meetingId: string }) {
  const convex = useConvex();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(
    api.users.queries.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );
  // After the person leaves, the page shows what the meeting recorded
  // (behind NEXT_PUBLIC_CONNVO_AFTER_CALL; the server has its own flag).
  const [ended, setEnded] = useState(false);
  const onScreenChange = useCallback(
    (screen: "lobby" | "call" | "ended") => setEnded(screen === "ended"),
    [],
  );

  const [path, setPath] = useState("unknown");
  const getRtcConfig = useMemo(
    () =>
      sessionIceConfiguration(async () => {
        if (!me?._id)
          throw new IceAccessError(
            "Sign in with the account invited to this meeting.",
          );
        try {
          return await convex.action(api.meetings.webrtc.ice.configuration, {
            meetingId: meetingId as Id<"meetings">,
          });
        } catch (error) {
          if (isIceAccessRefusal(error))
            throw new IceAccessError(
              "Access denied: Calls are only for the people invited to this meeting. Sign in with the invited account.",
            );
          throw error;
        }
      }),
    [convex, meetingId, me?._id],
  );
  const createTransport = useCallback(
    () =>
      Promise.resolve(
        createP2PTransport({
          getRtcConfig,
          onConnectionPath: setPath,
          signaling: convexSignaling(convex as unknown as ConvexCallClient, {
            participantIdOf,
          }),
        }),
      ),
    [convex, getRtcConfig],
  );
  // The Convex client already carries the user's token.
  const identityToken = useCallback(async () => "", []);
  const self = useMemo(
    () =>
      me
        ? {
            id: participantIdOf(me.workosUserId),
            name: me.displayName ?? me.email ?? "You",
          }
        : null,
    [me],
  );

  if (isLoading || (isAuthenticated && me === undefined)) {
    return (
      <CallNotice
        title="Getting your call ready"
        body="Checking who you are…"
      />
    );
  }
  if (!isAuthenticated || !self) {
    return (
      <CallNotice
        title="Sign in to join this call"
        body="Calls are for the people invited to the meeting. Sign in, then open this link again."
        failed
      />
    );
  }
  // CallRoom owns responsive placement of the notes slot.
  return (
    <div className={styles.page} data-call-connection-path={path}>
      <CallRoom
        meetingId={meetingId}
        self={self}
        createTransport={createTransport}
        identityToken={identityToken}
        // Presence carries ids, not names; test users read as Guest A..O.
        nameFor={(id) =>
          TEST_AUTH && /^[A-Z]$/.test(id) ? `Guest ${id}` : "Participant"
        }
        inviteLink={() => {
          const url = new URL(window.location.href);
          url.search = "";
          return url.toString();
        }}
        exitHref="/app"
        onScreenChange={onScreenChange}
        endedActions={<OpenRecapLink meetingId={meetingId} />}
        sidePanel={
          <>
            {ended ? <EndedRecap meetingId={meetingId} /> : null}
            <NotesBoundary>
              <MeetingNotesPanel meetingId={meetingId as Id<"meetings">} />
            </NotesBoundary>
          </>
        }
      />
    </div>
  );
}

/**
 * The notes query throws for someone outside the meeting or a link that is
 * not a meeting. The call shows its own answer for those; the notes say
 * theirs here instead of taking the page down.
 */
class NotesBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const refused = /access denied|forbidden|not a meeting participant/i.test(
      error.message,
    );
    return (
      <div
        data-testid="notes-unavailable"
        className="text-muted-foreground rounded-md border p-4 text-sm"
      >
        {refused
          ? "Notes are only for the people in this meeting."
          : "Notes could not load. Reload the page to try again."}
      </div>
    );
  }
}

function CallNotice({
  title,
  body,
  failed,
}: {
  title: string;
  body: string;
  failed?: boolean;
}) {
  return (
    <div
      data-call-phase={failed ? "failed" : "idle"}
      className="grid h-full min-h-[24rem] place-items-center p-6"
    >
      <div className="flex max-w-md flex-col gap-3 text-center">
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        <p
          data-testid={failed ? "call-error" : undefined}
          className="text-muted-foreground text-sm"
        >
          {body}
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
    <div className={styles.page}>
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
          to anyone yet.
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
