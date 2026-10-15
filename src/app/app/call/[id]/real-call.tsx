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
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

import styles from "@/components/call/call.module.css";
import { useCallNetwork } from "@/hooks/useCallNetwork";
import { ConversationPrompts } from "@/components/call/ConversationPrompts";
import { NoShowControl } from "./no-show";
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
  const network = useCallNetwork();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(
    api.users.queries.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );
  const statusWatch = useMemo(
    () =>
      isAuthenticated
        ? convex.watchQuery(api.meetings.webrtc.mesh.callStatus, {
            meetingId: meetingId as Id<"meetings">,
          })
        : null,
    [convex, isAuthenticated, meetingId],
  );
  const subscribeStatus = useCallback(
    (onChange: () => void) => statusWatch?.onUpdate(onChange) ?? (() => {}),
    [statusWatch],
  );
  const readStatus = useCallback(() => {
    try {
      return statusWatch?.localQueryResult() ?? "loading";
    } catch (error) {
      return error instanceof Error &&
        /not a meeting participant|access denied|forbidden/i.test(error.message)
        ? "refused"
        : "failed";
    }
  }, [statusWatch]);
  const callStatus = useSyncExternalStore(
    subscribeStatus,
    readStatus,
    () => "loading",
  );
  // After the person leaves, the page shows what the meeting recorded
  // (behind NEXT_PUBLIC_CONNVO_AFTER_CALL; the server has its own flag).
  const [ended, setEnded] = useState(false);
  const [inCall, setInCall] = useState(false);
  const onScreenChange = useCallback((screen: "lobby" | "call" | "ended") => {
    setEnded(screen === "ended");
    setInCall(screen === "call");
  }, []);

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
          onPeerConnection: network.onPeerConnection,
          signaling: convexSignaling(convex as unknown as ConvexCallClient, {
            participantIdOf,
          }),
        }),
      ),
    [convex, getRtcConfig, network.onPeerConnection],
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
  if (callStatus === "loading") {
    return (
      <CallNotice
        title="Getting your call ready"
        body="Checking whether the call is still open…"
      />
    );
  }
  if (callStatus === "ended") {
    return (
      <CallNotice
        title="This call has ended"
        body="Open the recap to see what this meeting recorded."
        recapMeetingId={meetingId}
      />
    );
  }
  if (callStatus === "refused") {
    return (
      <CallNotice
        title="This call is for invited participants"
        body="Access denied. Check your link or ask the host to invite you."
        failed
      />
    );
  }
  if (callStatus === "failed" || callStatus === "unavailable") {
    return (
      <CallNotice
        title={
          callStatus === "failed"
            ? "This call couldn't load"
            : "This call isn't open"
        }
        body={
          callStatus === "failed"
            ? "Reload the page to check the call again."
            : "Ask the host to start the meeting, then reload this page."
        }
        failed
      />
    );
  }
  // CallRoom keeps prompts and notes in the same responsive panel.

  return (
    <div className={styles.page} data-call-connection-path={path}>
      <CallRoom
        meetingId={meetingId}
        self={self}
        createTransport={createTransport}
        network={network.peers}
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
            <NoShowControl meetingId={meetingId as Id<"meetings">} />
            {ended ? (
              <EndedRecap meetingId={meetingId} />
            ) : (
              <ConversationPrompts
                meetingId={meetingId as Id<"meetings">}
                inCall={inCall}
              />
            )}
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

function focusNoticeHeading(heading: HTMLHeadingElement | null) {
  heading?.focus();
}

export function CallNotice({
  title,
  body,
  failed,
  recapMeetingId,
}: {
  title: string;
  body: string;
  failed?: boolean;
  recapMeetingId?: string;
}) {
  return (
    <div className={styles.page}>
      <div
        data-call-phase={recapMeetingId ? "left" : failed ? "failed" : "idle"}
        role={failed ? "alert" : "status"}
        className={`${styles.room} grid h-full place-items-center bg-[var(--stage)] p-6 text-[var(--ink)]`}
      >
        <div className="flex max-w-md flex-col gap-3 text-center">
          <h1
            ref={recapMeetingId ? focusNoticeHeading : undefined}
            tabIndex={recapMeetingId ? -1 : undefined}
            className="text-2xl font-medium tracking-tight outline-none"
          >
            {title}
          </h1>
          <p
            data-testid={failed ? "call-error" : undefined}
            className="text-sm text-[var(--ink-muted)]"
          >
            {body}
          </p>
          {recapMeetingId ? (
            <Link
              href={`/app/meetings/${recapMeetingId}`}
              data-testid="open-recap"
              className="inline-flex min-h-11 items-center justify-center rounded-md text-emerald-300 underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-emerald-300/60"
            >
              Open the recap
            </Link>
          ) : null}
          <Link
            href="/app"
            className="mx-auto mt-1 grid h-11 place-items-center rounded-md bg-emerald-400 px-4 text-sm font-semibold text-emerald-950 outline-none hover:bg-emerald-300 focus-visible:ring-[3px] focus-visible:ring-emerald-300/60"
          >
            Back to Connvo
          </Link>
        </div>
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
  const network = useCallNetwork();
  const createTransport = useCallback(
    () =>
      Promise.resolve(
        createP2PTransport({
          signaling: websocketSignaling(signalUrl),
          onPeerConnection: network.onPeerConnection,
        }),
      ),
    [signalUrl, network.onPeerConnection],
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
        network={network.peers}
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
    <CallNotice
      title="Calls need the signaling service"
      body="This build has no call signaling configured, so it cannot connect you to anyone yet."
      failed
    />
  );
}
