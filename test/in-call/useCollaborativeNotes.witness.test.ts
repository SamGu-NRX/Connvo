/**
 * RED contract witnesses for the in-call collaborative-notes client.
 *
 * These tests drive the REAL `useCollaborativeNotes` hook through
 * `fakeMeetingTransport` (a convex/react-compatible binding whose strict
 * validator mirrors cite the real registered endpoints). Each test asserts
 * the DESIRED client/server contract and therefore FAILS on today's hook —
 * this is the red milestone; the hook is intentionally not fixed here.
 *
 * PROVENANCE RULE: the fake transport is a stand-in, not evidence of real
 * server behavior. Hook-behavior claims below are witnessed here; every
 * server-behavior claim (validators, participant guard, dedupe, version
 * conflict) is proven against the real registered endpoints in
 * test/convex/in-call-server-contract.test.ts (convex-test harness) and
 * recorded in docs/in-call-client-20261010/witnesses.md.
 *
 * Harness note: these tests run in the plain node environment on purpose —
 * React 19's server renderer executes the real hook and exposes its
 * callbacks without jsdom, so no new test dependencies are added. The hook
 * is re-mounted (against the same transport, which holds the durable
 * state) whenever updated hook output must be observed.
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { useCollaborativeNotes } from "@/hooks/useCollaborativeNotes";
import {
  createFakeMeetingTransport,
  setCurrentTransport,
  type FakeMeetingTransport,
} from "./fakeMeetingTransport";

// Route the hook's convex/react bindings to the fake transport installed
// by the current test. The factory cannot close over test locals, so it
// resolves the transport lazily at render time.
vi.mock("convex/react", async () => {
  const mod = await import("./fakeMeetingTransport");
  return {
    useMutation: (ref: unknown) => mod.getCurrentTransport().useMutation(ref),
    useQuery: (ref: unknown, args?: unknown) =>
      mod.getCurrentTransport().useQuery(ref, args),
  };
});

// The generated api module's function references are Proxied, throw on
// inspection, and are not identity-stable across property reads in this
// Convex version, so the witnesses mock it with refs tagged with their own
// api path — the transport reads __convexPath to route by endpoint name.
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

const meetingId = "fake-meeting-in-call" as Id<"meetings">;

type HookResult = ReturnType<typeof useCollaborativeNotes>;

let lastHook: HookResult | null = null;

function HookProbe(): null {
  lastHook = useCollaborativeNotes(meetingId);
  return null;
}

/** Mount the real hook and return its latest rendered result. */
function renderHook(): HookResult {
  lastHook = null;
  renderToStaticMarkup(React.createElement(HookProbe));
  const hook = lastHook;
  if (!hook) {
    throw new Error("hook did not render");
  }
  return hook;
}

function installTransport(): FakeMeetingTransport {
  const transport = createFakeMeetingTransport();
  setCurrentTransport(transport);
  return transport;
}

function insertOp(text: string) {
  return { type: "insert" as const, position: 0, text, length: text.length };
}

describe("useCollaborativeNotes contract witnesses (RED — desired contract)", () => {
  it("witness: payload mismatch — hook payload accepted by real batchApplyNoteOperations validator", async () => {
    const transport = installTransport();
    const hook = renderHook();

    await hook.applyOperations([insertOp("hello")]);

    const sent = transport.sentMutations.find((m) =>
      m.name.endsWith("batchApplyNoteOperations"),
    );
    expect(sent).toBeDefined();
    const entries =
      (sent?.args as { operations?: Array<Record<string, unknown>> })
        ?.operations ?? [];
    expect(entries).toHaveLength(1);
    for (const entry of entries) {
      expect(
        entry,
        "witness: batch entries must be wrapped as { operation, clientSequence } per convex/notes/mutations.ts:392-400 — the hook sends bare operations carrying `text` instead",
      ).toHaveProperty("operation");
    }
  });

  it("witness: removed participation — optimistic edit surfaced as rejected with explicit unsaved/rolled-back state", async () => {
    const transport = installTransport();
    const hook = renderHook();

    transport.cutConnection();
    const pending = hook.applyOperation(insertOp("optimistic"));
    transport.removeParticipant();
    await transport.restore();

    let rejection: unknown;
    try {
      await pending;
    } catch (err) {
      rejection = err;
    }
    expect(rejection).toBeDefined();
    expect(
      (rejection as Error)?.message ?? "",
      "witness: the rejection must carry the real assertMeetingAccess guard message (convex/meetings/guards.ts:143)",
    ).toContain("Access denied: Not a meeting participant");
    expect(
      (rejection as { unsavedOperationIds?: string[] })?.unsavedOperationIds,
      "witness: the rejection must carry explicit per-operation unsaved marking (unsavedOperationIds) so the UI can tell the edit was NOT persisted",
    ).toBeDefined();
    expect(
      (rejection as { unsavedOperationIds?: string[] })
        ?.unsavedOperationIds?.length ?? 0,
      "witness: the unsaved marking must name the operation that was rolled back",
    ).toBeGreaterThan(0);
  });

  it("witness: late response — re-sent accepted operation deduplicated, no double application", async () => {
    const transport = installTransport();
    const hook = renderHook();

    transport.withholdAcks();
    const first = hook.applyOperation(insertOp("once"));
    // The first ack never arrives, so the client re-sends the same accepted
    // operation; the contract is that the server/sender dedupes it.
    const second = hook.applyOperation(insertOp("once"));
    transport.flushAcks();
    await Promise.all([first.catch(() => undefined), second]);

    const content = transport.docContent();
    expect(
      content,
      `witness: the re-sent accepted operation must be deduplicated (applied exactly once); today it was applied again on re-send, so the text reads: ${JSON.stringify(content)}`,
    ).toBe("once");
  });

  it("witness: optimistic-save confusion — accepted vs never-acked edits distinguishable (per-op pending/saved state)", async () => {
    const transport = installTransport();
    const hook = renderHook();

    await hook.applyOperation(insertOp("acked"));
    transport.withholdAcks();
    const pending = hook.applyOperation(insertOp("lost"));

    const fresh = renderHook();
    const states = (
      fresh as unknown as { operationStates?: Map<string, unknown> }
    ).operationStates;
    expect(
      states,
      "witness: the hook must expose a live per-operation state ledger (operationStates) distinguishing saved from never-acked edits — today only a global isSyncing boolean exists",
    ).toBeDefined();
    const values = [...(states?.values() ?? [])];
    expect(
      values,
      "witness: the ledger must mark the accepted edit as saved",
    ).toContain("saved");
    expect(
      values,
      "witness: the ledger must mark the never-acked edit as pending",
    ).toContain("pending");

    transport.flushAcks();
    await pending.catch(() => undefined);
  });
});
