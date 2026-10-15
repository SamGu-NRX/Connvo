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

import { ConversationPrompts } from "@/components/call/ConversationPrompts";
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
  const onScreenChange = useCallback(
    (screen: "lobby" | "call" | "ended") => {
      setEnded(screen === "ended");
      setInCall(screen === "call");
    },
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
  // The shared notes sit beside the call on wide screens and below it on
  // narrow ones; they work in the lobby too, before anyone joins. On phones
  // the app shell's floating navigation covers the bottom of the screen, so
  // the page leaves room to scroll the notes clear of it.
  return (
    <div
      data-call-connection-path={path}
      className="grid gap-3 pb-48 md:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]"
    >
      <div className="h-[calc(100dvh-19rem)] min-h-[28rem] md:h-[calc(100dvh-7rem)]">
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
        />
      </div>
      <aside
        aria-label="Meeting notes"
        className="min-w-0 lg:h-[calc(100dvh-7rem)] lg:overflow-y-auto"
      >
        {ended ? <EndedRecap meetingId={meetingId} /> : null}
        {!ended ? (
          <ConversationPrompts
            meetingId={meetingId as Id<"meetings">}
            inCall={inCall}
          />
        ) : null}
        <NotesBoundary>
          <MeetingNotesPanel meetingId={meetingId as Id<"meetings">} />
        </NotesBoundary>
      </aside>
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

function CallNotice({
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
    <div
      data-call-phase={recapMeetingId ? "left" : failed ? "failed" : "idle"}
      role={failed ? "alert" : "status"}
      className="grid h-full min-h-[24rem] place-items-center p-6"
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
          className="text-muted-foreground text-sm"
        >
          {body}
        </p>
        {recapMeetingId ? (
          <Link
            href={`/app/meetings/${recapMeetingId}`}
            data-testid="open-recap"
            className="text-primary focus-visible:ring-ring/50 inline-flex min-h-11 items-center justify-center rounded-md underline underline-offset-4 focus-visible:ring-[3px]"
          >
            Open the recap
          </Link>
        ) : null}
        <Link
          href="/app"
          className="bg-primary text-primary-foreground focus-visible:ring-ring/50 mx-auto mt-1 grid h-11 place-items-center rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-[3px]"
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
    // Phones: the app shell's floating navigation dock overlays the bottom
    // of this panel, so the call area ends above it.
    <div className="h-[calc(100dvh-19rem)] min-h-[28rem] md:h-[calc(100dvh-7rem)]">
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
