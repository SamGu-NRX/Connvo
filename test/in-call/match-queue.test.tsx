import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { QueueLoading, QueueView, type QueueViewProps } from "@/components/queue/QueueView";
import SmartConnectionPage from "@/app/app/smart-connection/page";
import { renderToString } from "react-dom/server";
import LiveMatchQueue from "@/components/queue/LiveMatchQueue";
import {
  callQueueDestination,
  enterQueueCall,
} from "@/components/queue/queue-navigation";

type Status = FunctionReturnType<typeof api.matching.queue.status>;
const mock = vi.hoisted(() => ({
  status: undefined as Status | undefined,
  authenticated: true,
  loading: false,
  connected: true,
  mutation: vi.fn(),
  time: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  suspendSearch: false,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mock.replace, push: mock.push }),
  useSearchParams: () => {
    if (mock.suspendSearch) throw new Promise(() => {});
    return new URLSearchParams();
  },
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: mock.authenticated,
    isLoading: mock.loading,
  }),
  useConvexConnectionState: () => ({
    isWebSocketConnected: mock.connected,
    hasEverConnected: true,
  }),
  useQuery: () => mock.status,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "matching/queue:time"
      ? mock.time
      : (args: unknown) => mock.mutation(getFunctionName(ref), args),
}));

beforeEach(() => {
  mock.suspendSearch = false;
  mock.status = undefined;
  mock.authenticated = true;
  mock.loading = false;
  mock.connected = true;
  mock.mutation.mockReset().mockResolvedValue(null);
  mock.time
    .mockReset()
    .mockImplementation(async () =>
      mock.status && "serverNow" in mock.status
        ? mock.status.serverNow
        : Date.now(),
    );
  mock.replace.mockReset();
  mock.push.mockReset();
});

it("keeps the normal queue-loading geometry while search params suspend without joining", () => {
  mock.suspendSearch = true;
  const { container } = render(<SmartConnectionPage />);
  expect(screen.getByRole("heading", { name: "Checking your queue…" })).toBeVisible();
  expect(container.querySelector('[data-queue-state="loading"]')).not.toBeNull();
  expect(mock.mutation).not.toHaveBeenCalled();
  const noAction = () => {};
  expect(renderToString(<QueueLoading />)).toBe(renderToString(
    <QueueView title="Match queue" state={{ kind: "loading" }} pending={false}
      onJoin={noAction} onLeave={noAction} onAccept={noAction}
      onDecline={noAction} onRetry={noAction} />,
  ));
});
afterEach(() => vi.useRealTimers());

function view(state: QueueViewProps["state"]) {
  const callbacks = {
    onJoin: vi.fn(),
    onLeave: vi.fn(),
    onAccept: vi.fn(),
    onDecline: vi.fn(),
    onRetry: vi.fn(),
  };
  return {
    ...render(
      <QueueView
        state={state}
        title="Match queue"
        pending={false}
        {...callbacks}
      />,
    ),
    ...callbacks,
  };
}

describe("match queue interface", () => {
  it("announces the real partner and scorer reasons without announcing every countdown tick", () => {
    const state = {
      kind: "matched",
      name: "Bob Brown",
      reasons: ["Strong interest alignment", "Strong language compatibility"],
      secondsLeft: 54,
      accepted: false,
      partnerAccepted: false,
    } satisfies QueueViewProps["state"];
    const rendered = view(state);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Match found with Bob Brown. Strong interest alignment. Strong language compatibility",
    );
    expect(screen.getByText("0:54")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Join$/ }));
    expect(rendered.onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(rendered.onDecline).toHaveBeenCalledTimes(1);
  });

  it("shows elapsed time from the server join time across remounts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    mock.status = {
      state: "waiting",
      queueType: "casual",
      joinedAt: Date.now() - 75_000,
      serverNow: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const mounted = render(<LiveMatchQueue />);
    expect(screen.getByText("1:15 elapsed")).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText("1:17 elapsed")).toBeVisible();
    mounted.unmount();
    mock.status.serverNow = Date.now();
    render(<LiveMatchQueue />);
    expect(screen.getByText("1:17 elapsed")).toBeVisible();
  });

  it("uses server time even when the device clock is two minutes fast", async () => {
    vi.useFakeTimers();
    const serverNow = Date.parse("2026-10-15T12:00:00Z");
    vi.setSystemTime(serverNow + 120_000);
    mock.status = {
      state: "waiting",
      queueType: "casual",
      serverNow,
      joinedAt: serverNow - 75_000,
      expiresAt: serverNow + 60_000,
    };
    render(<LiveMatchQueue />);
    expect(screen.getByText("1:15 elapsed")).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText("1:17 elapsed")).toBeVisible();
  });

  it("does not extend a fresh invitation when the clock sample arrived late", async () => {
    const serverNow = Date.now();
    mock.time.mockResolvedValue(serverNow - 1000);
    mock.status = {
      state: "matched",
      queueType: "casual",
      matchId: "match-42" as Id<"callQueueMatches">,
      joinedAt: serverNow - 5000,
      serverNow,
      expiresAt: serverNow + 60_000,
      accepted: false,
      partnerAccepted: false,
      partner: {
        id: "bob" as Id<"users">,
        displayName: "Bob Brown",
        avatarUrl: undefined,
      },
      reasons: ["Strong interest alignment"],
    };
    render(<LiveMatchQueue />);
    await act(async () => {});
    expect(screen.getByText("1:00")).toBeVisible();
    expect(screen.queryByText("1:01")).not.toBeInTheDocument();
  });

  it("joins once on entry with the requested queue type", async () => {
    mock.status = { state: "idle" };
    render(
      <React.StrictMode>
        <LiveMatchQueue queueType="professional" />
      </React.StrictMode>,
    );
    await waitFor(() =>
      expect(mock.mutation.mock.calls).toEqual([
        ["matching/queue:join", { queueType: "professional" }],
      ]),
    );
    expect(screen.getByText("Professional conversations")).toBeVisible();
  });

  it("refreshes elapsed time when the subscription restores a cached queue result", async () => {
    mock.status = {
      state: "waiting",
      queueType: "casual",
      joinedAt: 1_000,
      serverNow: 1_000,
      expiresAt: 901_000,
    };
    mock.time.mockResolvedValue(76_000);
    render(<LiveMatchQueue />);
    expect(await screen.findByText("1:15 elapsed")).toBeVisible();
  });

  it("holds an expired session for explicit rejoin", async () => {
    mock.status = {
      state: "expired",
      queueType: "casual",
      joinedAt: 1,
      serverNow: Date.now(),
      expiresAt: 2,
    };
    render(<LiveMatchQueue />);
    expect(
      screen.getByRole("heading", { name: "Your queue session ended." }),
    ).toBeVisible();
    expect(mock.mutation.mock.calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Rejoin queue" }));
    await waitFor(() =>
      expect(mock.mutation.mock.calls).toEqual([
        ["matching/queue:join", { queueType: "casual" }],
      ]),
    );
  });

  it("renders partner decline as waiting and announces the recovery", () => {
    mock.status = {
      state: "waiting",
      queueType: "casual",
      joinedAt: Date.now(),
      serverNow: Date.now(),
      expiresAt: Date.now() + 60_000,
      notice: { id: "decline-1", type: "partner_declined" },
    };
    render(<LiveMatchQueue />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your partner declined. You're still in the queue",
    );
    expect(screen.getByRole("button", { name: "Leave queue" })).toBeVisible();
  });

  it("retries a failed join and preserves the requested operation", async () => {
    mock.status = { state: "idle" };
    mock.mutation.mockRejectedValueOnce(new Error("request failed"));
    render(<LiveMatchQueue />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't update your queue",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(mock.mutation.mock.calls).toEqual([
        ["matching/queue:join", { queueType: "casual" }],
        ["matching/queue:join", { queueType: "casual" }],
      ]),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Ready to meet someone?" }),
      ).toBeVisible(),
    );
  });

  it("does not navigate away until leaving succeeds", async () => {
    mock.status = {
      state: "waiting",
      queueType: "casual",
      joinedAt: Date.now(),
      serverNow: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    mock.mutation.mockRejectedValueOnce(new Error("offline"));
    render(<LiveMatchQueue />);
    fireEvent.click(screen.getByRole("button", { name: "Leave queue" }));
    await screen.findByRole("alert");
    expect(mock.push.mock.calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mock.push.mock.calls).toEqual([["/app"]]));
  });

  it("shows an offline error instead of presenting stale match actions", () => {
    mock.connected = false;
    render(<LiveMatchQueue />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your connection dropped",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("keeps join disabled after acceptance and when the deadline passes", () => {
    const rendered = view({
      kind: "matched",
      name: "Bob Brown",
      reasons: ["Strong interest alignment"],
      secondsLeft: 25,
      accepted: true,
      partnerAccepted: false,
    });
    expect(
      screen.getByRole("button", { name: "Waiting for partner" }),
    ).toBeDisabled();
    rendered.unmount();
    view({
      kind: "matched",
      name: "Bob Brown",
      reasons: ["Strong interest alignment"],
      secondsLeft: 0,
      accepted: false,
      partnerAccepted: false,
    });
    expect(screen.getByRole("button", { name: /^Join$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
  });

  it("loads a fresh call document to avoid removing a shared auth provider during navigation", () => {
    const location = { search: "?as=B", replace: vi.fn() };
    enterQueueCall("meeting-42", location, true);
    expect(location.replace).toHaveBeenCalledExactlyOnceWith(
      "/app/call/meeting-42?as=B",
    );
    expect(mock.replace).not.toHaveBeenCalled();
  });

  it("keeps test identity only in the local handoff", () => {
    expect(callQueueDestination("meeting-42", "?as=B", true)).toBe(
      "/app/call/meeting-42?as=B",
    );
    expect(callQueueDestination("meeting-42", "?as=B", false)).toBe(
      "/app/call/meeting-42",
    );
    expect(callQueueDestination("meeting-42", "?as=unknown", true)).toBe(
      "/app/call/meeting-42",
    );
  });

  it.each([
    { kind: "loading" },
    { kind: "idle" },
    { kind: "signed_out" },
    { kind: "waiting", elapsedSeconds: 72 },
    {
      kind: "matched",
      name: "Alexandra Catherine Montgomery-Wellington",
      reasons: ["Strong interest alignment"],
      secondsLeft: 55,
      accepted: false,
      partnerAccepted: false,
    },
    { kind: "expired" },
    { kind: "ready" },
    { kind: "error", message: "Connection interrupted. Please retry." },
  ] satisfies QueueViewProps["state"][])(
    "has no axe violations in $kind",
    async (state) => {
      const { container } = view(state);
      const result = await axe(container);
      expect(result.violations).toEqual([]);
    },
  );
});
