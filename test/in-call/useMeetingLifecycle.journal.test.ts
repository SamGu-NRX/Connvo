/**
 * Lifecycle acceptance-journal scenarios: a lost ack can neither
 * double-accept nor re-send an accepted lifecycle mutation, an
 * unknowable outcome is surfaced as unconfirmed state (not a domain
 * failure), and concurrent invocations share one in-flight send.
 *
 * Harness: same fake-transport binding as the notes scenarios. The
 * fake's lifecycle endpoints are stubs ({ success: true }) — the
 * journal logic under test is entirely client-side; server lifecycle
 * behavior is out of scope here. The journal is a module-scoped store
 * (it must survive hook remounts), so each test resets it and the hook
 * is re-rendered after every mutation before its result is read.
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { useMeetingLifecycle, resetLifecycleJournal } from "@/hooks/useMeetingLifecycle";
import {
  createFakeMeetingTransport,
  setCurrentTransport,
  type FakeMeetingTransport,
} from "./fakeMeetingTransport";

vi.mock("convex/react", async () => {
  const mod = await import("./fakeMeetingTransport");
  return {
    useMutation: (ref: unknown) => mod.getCurrentTransport().useMutation(ref),
    useAction: (ref: unknown) => mod.getCurrentTransport().useMutation(ref),
    useQuery: (ref: unknown, args?: unknown) =>
      mod.getCurrentTransport().useQuery(ref, args),
  };
});

vi.mock("@convex/_generated/api", async () => {
  const makeNode = (path: string): unknown =>
    new Proxy(function () {} as object, {
      get: (_target, prop) => {
        if (prop === "__convexPath") return path;
        if (typeof prop !== "string" || prop === "then") return undefined;
        return makeNode(path + "." + prop);
      },
    });
  return { api: makeNode("api") };
});

const meetingId = "lifecycle-journal-meeting" as Id<"meetings">;

type HookResult = ReturnType<typeof useMeetingLifecycle>;

let lastHook: HookResult | null = null;

function HookProbe(): null {
  lastHook = useMeetingLifecycle();
  return null;
}

function renderHook(): HookResult {
  lastHook = null;
  renderToStaticMarkup(React.createElement(HookProbe));
  const hook = lastHook;
  if (!hook) {
    throw new Error("hook did not render");
  }
  return hook;
}

function settle(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (error) => error,
  );
}

const createParams = {
  title: "Journal meeting",
  participantIds: [] as Id<"users">[],
  generatePrompts: false,
};

let transport: FakeMeetingTransport;

beforeEach(() => {
  transport = createFakeMeetingTransport();
  setCurrentTransport(transport);
  resetLifecycleJournal();
});

describe("useMeetingLifecycle acceptance journal", () => {
  it("accepted create is never re-sent — a repeat create returns the recorded outcome with no second send", async () => {
    let hook = renderHook();
    await hook.createMeeting({ ...createParams });
    hook = renderHook();
    expect(hook.lifecycleJournal).toHaveLength(1);
    expect(hook.lifecycleJournal[0]!.operation).toBe("create");
    expect(hook.lifecycleJournal[0]!.state).toBe("accepted");
    expect(hook.lifecycleJournal[0]!.attempts).toBe(1);

    // Same correlation key: the journal answers without a network call.
    await hook.createMeeting({ ...createParams });
    hook = renderHook();
    expect(hook.lifecycleJournal[0]!.state).toBe("accepted");
    expect(hook.lifecycleJournal[0]!.attempts).toBe(1);
    // Only the original create hit the transport: exactly one send.
    expect(transport.sentMutations.length).toBe(1);
  });

  it("start with a lost ack (before apply): journal says unconfirmed, explicit retry sends again and accepts", async () => {
    let hook = renderHook();

    transport.failNextSendBeforeApply();
    const failure = await settle(hook.startMeeting(meetingId));
    expect(failure).toBeInstanceOf(Error);
    hook = renderHook();
    expect(hook.lifecycleJournal[0]!.operation).toBe("start");
    expect(hook.lifecycleJournal[0]!.state).toBe("unconfirmed");
    expect(hook.lifecycleJournal[0]!.attempts).toBe(1);
    // Surfaced as state, not only console: the journal entry carries the
    // failure message (the instance-level `error` field is set the same
    // way in production, where the component instance persists).
    expect(hook.lifecycleJournal[0]!.error).toBeTruthy();

    // The user explicitly retries: a new attempt is recorded and sent.
    await hook.startMeeting(meetingId);
    hook = renderHook();
    expect(hook.lifecycleJournal[0]!.state).toBe("accepted");
    expect(hook.lifecycleJournal[0]!.attempts).toBe(2);
    expect(transport.sentMutations.length).toBe(2);

    // The accepted start is never re-sent again.
    await hook.startMeeting(meetingId);
    hook = renderHook();
    expect(hook.lifecycleJournal[0]!.attempts).toBe(2);
    expect(transport.sentMutations.length).toBe(2);
  });

  it("start with a lost ack (after apply): journal says unconfirmed — NOT failed — and a definite rejection is failed", async () => {
    let hook = renderHook();

    transport.failNextSendAfterApply();
    await settle(hook.startMeeting(meetingId));
    hook = renderHook();
    expect(hook.lifecycleJournal[0]!.state).toBe("unconfirmed");

    // A definite domain rejection (FORBIDDEN) is classified failed; an
    // unknowable transport loss never is.
    transport.failNextLifecycleMutationWith("FORBIDDEN");
    await settle(hook.endMeeting(meetingId));
    hook = renderHook();
    const endEntry = hook.lifecycleJournal.find(
      (entry) => entry.operation === "end",
    )!;
    expect(endEntry.state).toBe("failed");

    // The failed end can be retried (the rejection is definite — the
    // server did not apply it).
    await hook.endMeeting(meetingId);
    hook = renderHook();
    const endAfter = hook.lifecycleJournal.find(
      (entry) => entry.operation === "end",
    )!;
    expect(endAfter.state).toBe("accepted");
    expect(endAfter.attempts).toBe(2);
  });

  it("concurrent start invocations share one in-flight send — no double-send", async () => {
    let hook = renderHook();

    transport.withholdAcks();
    const first = hook.startMeeting(meetingId);
    const second = hook.startMeeting(meetingId);
    hook = renderHook();
    expect(hook.lifecycleJournal[0]!.state).toBe("pending");

    transport.flushAcks();
    await Promise.all([first, second]);
    hook = renderHook();
    expect(hook.lifecycleJournal[0]!.state).toBe("accepted");
    expect(hook.lifecycleJournal[0]!.attempts).toBe(1);
    expect(transport.sentMutations.length).toBe(1);
  });
});
