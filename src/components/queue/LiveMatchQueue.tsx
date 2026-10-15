"use client";

import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useConvexAuth,
  useConvexConnectionState,
  useMutation,
  useQuery,
} from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import { QueueView, type QueueViewState } from "./QueueView";
import { callQueueDestination } from "./queue-navigation";

type QueueType = "casual" | "professional";
const notices = {
  partner_declined:
    "Your partner declined. You're still in the queue, and we'll look for someone else.",
  declined: "Match declined. You're back in the queue for someone else.",
  match_expired:
    "The invitation timed out. You're still in the queue for another conversation.",
};

/** Query failures need a retry boundary because useQuery throws during render. */
class QueueBoundary extends Component<
  { children: ReactNode; title: string },
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed)
      return <div key={this.state.attempt}>{this.props.children}</div>;
    const retry = () =>
      this.setState(({ attempt }) => ({ failed: false, attempt: attempt + 1 }));
    return (
      <QueueView
        title={this.props.title}
        state={{
          kind: "error",
          message:
            "We couldn't load your queue. Check your connection and try again.",
        }}
        pending={false}
        onRetry={retry}
        onJoin={retry}
        onLeave={retry}
        onAccept={retry}
        onDecline={retry}
      />
    );
  }
}

export default function LiveMatchQueue({
  queueType = "casual",
}: {
  queueType?: QueueType;
}) {
  const title =
    queueType === "casual" ? "Match queue" : "Professional conversations";
  return (
    <QueueBoundary title={title}>
      <ConnectedQueue queueType={queueType} title={title} />
    </QueueBoundary>
  );
}

function ConnectedQueue({
  queueType,
  title,
}: {
  queueType: QueueType;
  title: string;
}) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const connection = useConvexConnectionState();
  const status = useQuery(
    api.matching.queue.status,
    isAuthenticated ? {} : "skip",
  );
  const join = useMutation(api.matching.queue.join);
  const leave = useMutation(api.matching.queue.leave);
  const respond = useMutation(api.matching.queue.respond);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [retryAction, setRetryAction] = useState<
    (() => Promise<unknown>) | null
  >(null);
  const entered = useRef(false);
  const busy = useRef(false);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      setRetryAction(null);
    } catch {
      setRetryAction(() => action);
      setError(
        "We couldn't update your queue. Your place is saved if the request reached us. Retry to check and continue.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!status || entered.current) return;
    entered.current = true;
    if (status.state === "idle") void run(() => join({ queueType }));
  }, [status, join, queueType, run]);

  useEffect(() => {
    if (status?.state !== "ready") return;
    router.replace(
      callQueueDestination(
        status.meetingId,
        window.location.search,
        process.env.NEXT_PUBLIC_CONNVO_TEST_AUTH === "1",
      ),
    );
  }, [status, router]);

  let view: QueueViewState;
  if (error) view = { kind: "error", message: error };
  else if (!connection.isWebSocketConnected && connection.hasEverConnected)
    view = {
      kind: "error",
      message:
        "Your connection dropped. We can't confirm your queue status yet. Reconnect, then retry.",
    };
  else if (isLoading) view = { kind: "loading" };
  else if (!isAuthenticated) view = { kind: "signed_out" };
  else if (!status) view = { kind: "loading" };
  else
    switch (status.state) {
      case "idle":
        view = { kind: "idle" };
        break;
      case "waiting":
        view = {
          kind: "waiting",
          elapsedSeconds: (now - status.joinedAt) / 1000,
          notice: status.notice && notices[status.notice.type],
        };
        break;
      case "matched":
        view = {
          kind: "matched",
          name: status.partner.displayName,
          reasons: status.reasons,
          secondsLeft: Math.max(0, Math.ceil((status.expiresAt - now) / 1000)),
          accepted: status.accepted,
          partnerAccepted: status.partnerAccepted,
        };
        break;
      case "ready":
        view = { kind: "ready" };
        break;
      case "expired":
        view = { kind: "expired" };
        break;
      default: {
        const unreachable: never = status;
        throw new Error(`Unknown queue state: ${unreachable}`);
      }
    }

  return (
    <QueueView
      title={
        status && "queueType" in status && status.queueType === "professional"
          ? "Professional conversations"
          : title
      }
      state={view}
      pending={pending}
      onJoin={() => void run(() => join({ queueType }))}
      onLeave={() =>
        void run(async () => {
          await leave({});
          router.push("/app");
        })
      }
      onAccept={() => {
        if (status?.state === "matched")
          void run(() => respond({ matchId: status.matchId, accept: true }));
      }}
      onDecline={() => {
        if (status?.state === "matched")
          void run(() => respond({ matchId: status.matchId, accept: false }));
      }}
      onRetry={() => {
        if (retryAction) void run(retryAction);
        else window.location.reload();
      }}
    />
  );
}
