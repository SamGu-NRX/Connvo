/**
 * Default-provider remount + recovery proof (M4 review item).
 *
 * Every other mounted suite drives the panel through a test transport
 * mounted ABOVE it. This suite mounts MeetingNotesPanel with NO
 * NotesTransportProvider above it, so the panel's own production wiring
 * runs end to end:
 *
 *   MeetingNotesPanel → TransportGuard → DefaultNotesTransportProvider
 *     → NotesConvexTransportProvider (the real production bridge)
 *     → convex/react hooks (shimmed at the hook boundary)
 *     → the REAL convex-test notes server (real mutations/queries/OT)
 *
 * The only double is the convex/react hook plumbing (ConvexReactClient's
 * subscription lifecycle — a live backend dependency deferred to the
 * harness task per design.md §5). The hook shim mirrors ConvexReactClient's
 * observable contract: `useQuery` returns `undefined` until its first read
 * completes, then the latest result; a resolved mutation is followed by a
 * query resync.
 *
 * The scenario: type and sync a first edit through the default provider,
 * lose the second batch's send (the promise rejects before the server sees
 * it), unmount the panel (the real teardown persists the pending record to
 * sessionStorage), then remount over the SAME backend with the SAME stable
 * client id. The recovered ledger must resend the pending op under its
 * original identity and converge the real server row — no word loss, no
 * double-apply.
 */

import { useEffect, useReducer } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { describe, expect, it, vi } from "vitest";
import { MeetingNotesPanel } from "@/components/meeting-notes/MeetingNotesPanel";
import type { BatchApplyNoteOperationsResponse } from "@/hooks/notes/types";
import {
  NotesBackend,
  type BackendParticipant,
  type OutgoingBatch,
} from "../notes/harness/backend";
import { setupParticipant } from "../notes/matrixHarness";

type SimFace = BackendParticipant["face"];

/** Raw getMeetingNotes result shape (what Convex's useQuery would return). */
type RawQueryResult = {
  content: string;
  version: number;
  headSequence?: number;
  clientAcks?: Array<{ clientOpId: string; clientSequence: number }>;
} | null;

interface QueryArgs {
  meetingId: Id<"meetings">;
  clientId: string;
}

/** Every applyBatch attempt the shim observed, including rejected ones. */
interface AttemptedBatch {
  clientId: string;
  clientOpIds: string[];
}

/**
 * The convex/react hook shim. One instance per test = one fake deployment.
 * `failNextBatches` rejects sends before the server sees them (a network
 * loss), like the matrix harness's ECONNRESET fault.
 */
class ConvexReactSim {
  private readonly entries = new Map<
    string,
    {
      args: QueryArgs;
      value: RawQueryResult | undefined;
      listeners: Set<() => void>;
    }
  >();
  failNextBatches = 0;
  attemptedBatches: AttemptedBatch[] = [];

  constructor(
    private readonly backend: NotesBackend,
    private readonly face: SimFace,
  ) {}

  useQuery(_query: unknown, args: QueryArgs): RawQueryResult | undefined {
    const key = `${String(args.meetingId)}|${args.clientId}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { args, value: undefined, listeners: new Set() };
      this.entries.set(key, entry);
    }
    const captured = entry;
    const [, bump] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
      captured.listeners.add(bump);
      void this.refreshEntry(key);
      return () => {
        captured.listeners.delete(bump);
      };
    }, [key]);
    return captured.value;
  }

  useMutation(): (batch: OutgoingBatch) => Promise<BatchApplyNoteOperationsResponse> {
    return async (batch: OutgoingBatch) => {
      this.attemptedBatches.push({
        clientId: (batch as unknown as { clientId: string }).clientId,
        clientOpIds: batch.operations.map((op) => op.clientOpId),
      });
      if (this.failNextBatches > 0) {
        this.failNextBatches--;
        throw new Error("simulated network failure (ECONNRESET)");
      }
      const args = batch as unknown as {
        meetingId: Id<"meetings">;
        clientId: string;
      };
      const response = (await this.backend.applyBatch(
        this.face,
        args.meetingId,
        args.clientId,
        batch,
        { push: false },
      )) as BatchApplyNoteOperationsResponse;
      await this.refreshAll();
      return response;
    };
  }

  /** Re-runs the real query for one registered entry and notifies. */
  private async refreshEntry(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    const raw = (await this.face.query(api.notes.queries.getMeetingNotes, {
      meetingId: entry.args.meetingId,
      clientId: entry.args.clientId,
    })) as RawQueryResult;
    entry.value = raw;
    entry.listeners.forEach((listener) => listener());
  }

  /** Mutation completed → resync every live query (Convex invalidation). */
  private async refreshAll(): Promise<void> {
    for (const key of [...this.entries.keys()]) {
      await this.refreshEntry(key);
    }
  }
}

/** Hoisted holder so the vi.mock factory can reach the per-test instance. */
const convexSim = vi.hoisted(() => ({
  current: null as ConvexReactSim | null,
}));

vi.mock("convex/react", () => {
  const sim = () => convexSim.current as ConvexReactSim;
  return {
    useQuery: (query: unknown, args: QueryArgs) => sim().useQuery(query, args),
    useMutation: () => sim().useMutation(),
  } as unknown as Record<string, unknown>;
});

/** Badge text on the notes status pill. */
async function badgeShows(expected: string | RegExp) {
  await waitFor(() =>
    expect(screen.getByTestId("notes-status")).toHaveTextContent(expected),
  );
}

/** One committed change (change + blur → the panel's immediate flush). */
function typeAndCommit(next: string) {
  const editor = screen.getByTestId("notes-editor");
  fireEvent.change(editor, { target: { value: next } });
  fireEvent.blur(editor);
}

/** Waits until the real server row reads exactly `expected`. */
async function waitForServerText(
  backend: NotesBackend,
  meetingId: Id<"meetings">,
  expected: string,
) {
  await waitFor(async () => {
    const server = await backend.readServerText(meetingId);
    expect(server.content).toBe(expected);
  });
}

/** All recovery-store keys the ledger wrote this session. */
function recoveryKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.sessionStorage.length; i++) {
    const key = window.sessionStorage.key(i);
    if (key?.startsWith("connvo-notes-ledger:")) keys.push(key);
  }
  return keys;
}

describe("MeetingNotesPanel — default provider (production wiring) mounted proof", () => {
  it("syncs through the default Convex transport and recovers an unsent batch across a real remount", async () => {
    const backend = new NotesBackend();
    const participant = await setupParticipant(backend, "defaultprov");
    const sim = new ConvexReactSim(backend, participant.face);
    convexSim.current = sim;

    window.sessionStorage.clear();

    // --- Mount 1: the panel boots its OWN production provider chain. ---
    const view = render(
      <main>
        <MeetingNotesPanel meetingId={participant.meetingId} />
      </main>,
    );

    // The rowless first read normalizes to the version-0 empty snapshot and
    // the honest Synced state — through DefaultNotesTransportProvider, not
    // a test transport.
    await badgeShows(/Synced/i);
    expect(screen.getByTestId("notes-editor")).toHaveValue("");

    // First edit flows: buffer → flush → real convex-test mutation →
    // query resync → ledger ingest → Synced.
    typeAndCommit("alpha ");
    await waitForServerText(backend, participant.meetingId, "alpha ");
    await badgeShows(/Synced/i);

    // Second edit: the send is lost before the server sees it (one
    // attempt - the ledger holds the record pending for the reconnect
    // read rather than auto-retrying, so the remount recovery is what
    // must save it).
    sim.failNextBatches = 1;
    typeAndCommit("alpha bravo ");
    await waitFor(() => {
      expect(screen.getByTestId("notes-status")).not.toHaveTextContent(
        "Synced",
      );
    });
    // No word loss on the client: the composed text keeps everything.
    expect(screen.getByTestId("notes-editor")).toHaveValue("alpha bravo ");
    // Exactly two attempts: the alpha batch (succeeded) and one bravo
    // attempt (rejected). No auto-retry while the transport is down -
    // the record stays pending with its identity intact.
    expect(sim.attemptedBatches).toHaveLength(2);
    const alphaOpId = sim.attemptedBatches[0].clientOpIds[0];
    const lostClientOpId = sim.attemptedBatches[1].clientOpIds[0];
    expect(alphaOpId).toEqual(expect.any(String));
    expect(lostClientOpId).toEqual(expect.any(String));
    expect(lostClientOpId).not.toBe(alphaOpId);

    // --- Real unmount: teardown persists the pending record. ---
    view.unmount();
    const keys = recoveryKeys();
    expect(keys).toHaveLength(1);
    const payload = window.sessionStorage.getItem(keys[0]) ?? "{}";
    // The unsent edit survives teardown in the recovery store.
    expect(payload).toContain("bravo");

    // --- Mount 2: same backend ("deployment"), same stable client id. ---
    render(
      <main>
        <MeetingNotesPanel meetingId={participant.meetingId} />
      </main>,
    );

    // Recovery: the remounted ledger restores the pending record and resends
    // it under the SAME identity once fresh evidence arrives.
    await waitForServerText(backend, participant.meetingId, "alpha bravo ");
    await badgeShows(/Synced/i);

    // Exactly three attempts: alpha, the rejected bravo send, and the
    // recovery resend under the SAME clientOpId as the rejection.
    expect(sim.attemptedBatches).toHaveLength(3);
    expect(sim.attemptedBatches[2].clientOpIds[0]).toBe(lostClientOpId);

    // No word loss on the client after recovery.
    expect(screen.getByTestId("notes-editor")).toHaveValue("alpha bravo ");

    // The real server applied exactly two operations, once each: the first
    // batch's insert and the recovered batch's insert. The recovered resend
    // reused the lost batch's identity, so the two applied rows carry two
    // distinct clientOpIds — no double-apply of the recovered identity.
    const ops = await backend.readNoteOps(participant.meetingId);
    const applied = ops.filter((op) => op.applied);
    expect(applied).toHaveLength(2);
    const appliedIds = applied.map((op) => op.clientOpId);
    expect(new Set(appliedIds).size).toBe(2);
    expect(new Set(appliedIds)).toEqual(
      new Set([alphaOpId, lostClientOpId]),
    );
  });
});
