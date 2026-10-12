/**
 * Behavior tests for the in-memory demo backend (src/components/meeting-notes/
 * meeting-notes.demo.ts). It implements the pinned NotesTransport seam, so the
 * assertions are on observable transport behavior: what a fresh subscriber
 * sees, what a batch resolves with, and what each fault does to the doc.
 */

import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { NotesBatchOp, NotesServerSnapshot } from "@/hooks/notes";
import {
  createDemoNotesBackend,
  DEMO_SEED_CONTENT,
} from "@/components/meeting-notes/meeting-notes.demo";

const MEETING_ID = "demo-meeting" as Id<"meetings">;

function insertOp(
  position: number,
  content: string,
  clientOpId: string,
  clientSequence = 0,
): NotesBatchOp {
  return { operation: { type: "insert", position, content }, clientSequence, clientOpId };
}

function deleteOp(
  position: number,
  length: number,
  clientOpId: string,
  clientSequence = 0,
): NotesBatchOp {
  return { operation: { type: "delete", position, length }, clientSequence, clientOpId };
}

function collectSnapshots(
  backend: ReturnType<typeof createDemoNotesBackend>,
  clientId: string,
): { snapshots: NotesServerSnapshot[]; unsubscribe: () => void } {
  const snapshots: NotesServerSnapshot[] = [];
  const unsubscribe = backend.transport.subscribe(
    MEETING_ID,
    clientId,
    (snapshot) => {
      if (snapshot !== undefined) {
        snapshots.push(snapshot);
      }
    },
  );
  return { snapshots, unsubscribe };
}

describe("demo notes backend — transport seam", () => {
  it("a fresh subscriber sees the seed document immediately", () => {
    const backend = createDemoNotesBackend();
    const { snapshots } = collectSnapshots(backend, "client-a");
    expect(snapshots).toEqual([
      {
        content: DEMO_SEED_CONTENT,
        version: 1,
        headSequence: 0,
        clientAcks: [],
      },
    ]);
  });

  it("applies a batch to the doc, bumps version once, echoes identity, acks by clientOpId", async () => {
    const backend = createDemoNotesBackend();
    const { snapshots } = collectSnapshots(backend, "client-a");

    const response = await backend.transport.applyBatch(MEETING_ID, "client-a", {
      operations: [insertOp(0, "hi ", "op-1")],
      expectedVersion: 1,
    });

    expect(response.success).toBe(true);
    expect(response.processed).toBe(1);
    expect(response.failed).toBe(0);
    expect(response.newVersion).toBe(2);
    expect(response.results[0]?.clientOpId).toBe("op-1");
    expect(response.results[0]?.serverSequence).toBe(1);

    // Persist-before-ack: the snapshot emitted during apply already reflects
    // the new doc AND carries the identity ack a fresh read would return.
    const latest = snapshots.at(-1);
    expect(latest?.content).toBe("hi " + DEMO_SEED_CONTENT);
    expect(latest?.version).toBe(2);
    expect(latest?.clientAcks).toEqual([
      expect.objectContaining({ clientOpId: "op-1", serverSequence: 1 }),
    ]);
  });

  it("applies an equal-length replacement as real ops (Agenda→Goals)", async () => {
    const backend = createDemoNotesBackend();
    const { snapshots } = collectSnapshots(backend, "client-a");

    const response = await backend.transport.applyBatch(MEETING_ID, "client-a", {
      operations: [
        deleteOp(0, 6, "op-del"),
        insertOp(0, "Goals", "op-ins"),
      ],
    });

    expect(response.processed).toBe(2);
    // Both sibling ops applied in order — length-equality is not a no-op.
    // (The delete covers exactly "Agenda"; the seed's colon survives it.)
    expect(snapshots.at(-1)?.content).toBe(
      "Goals:\n- ship the notes ledger\n- celebrate\n",
    );
    expect(snapshots.at(-1)?.version).toBe(2); // one bump per batch
  });

  it("a stale expectedVersion rejects with CONFLICT and applies nothing", async () => {
    const backend = createDemoNotesBackend();
    const { snapshots } = collectSnapshots(backend, "client-a");

    // Bring the doc forward first (version 1 → 2) with a successful edit.
    await backend.transport.applyBatch(MEETING_ID, "client-a", {
      operations: [insertOp(0, "x", "op-seed")],
    });
    const before = snapshots.at(-1);

    // Replaying against the old version is now stale: reject with CONFLICT,
    // apply nothing, bump nothing.
    await expect(
      backend.transport.applyBatch(MEETING_ID, "client-a", {
        operations: [insertOp(0, "nope ", "op-2")],
        expectedVersion: 1, // stale
      }),
    ).rejects.toThrow(/CONFLICT/);
    expect(snapshots.at(-1)?.content).toBe(before?.content);
    expect(snapshots.at(-1)?.version).toBe(before?.version);
  });

  it("drop-ack: the doc is updated but the response is lost; clientAcks still prove it", async () => {
    const backend = createDemoNotesBackend();
    const { snapshots } = collectSnapshots(backend, "client-a");
    backend.controls.setDropAck(true);

    await expect(
      backend.transport.applyBatch(MEETING_ID, "client-a", {
        operations: [insertOp(0, "kept ", "op-lost")],
      }),
    ).rejects.toThrow(/lost in transit/);

    // The server applied it — a fresh read must reveal incorporation by
    // identity (this is what the hook resolves unconfirmed edits from).
    const latest = snapshots.at(-1);
    expect(latest?.content).toBe("kept " + DEMO_SEED_CONTENT);
    expect(latest?.clientAcks.some((ack) => ack.clientOpId === "op-lost")).toBe(true);
  });

  it("offline: subscribers receive nothing and batches reject without applying", async () => {
    const backend = createDemoNotesBackend();
    backend.controls.setOffline(true);

    const onSnapshot = vi.fn();
    const unsubscribe = backend.transport.subscribe(MEETING_ID, "client-a", onSnapshot);
    expect(onSnapshot).not.toHaveBeenCalled();
    unsubscribe();

    await expect(
      backend.transport.applyBatch(MEETING_ID, "client-a", {
        operations: [insertOp(0, "queued ", "op-1")],
      }),
    ).rejects.toThrow(/offline/);

    // Turning the network back on restores snapshot delivery.
    backend.controls.setOffline(false);
    const { snapshots } = collectSnapshots(backend, "client-a");
    expect(snapshots.at(-1)?.content).toBe(DEMO_SEED_CONTENT); // nothing applied
  });

  it("slow network delays the response", async () => {
    const backend = createDemoNotesBackend();
    backend.controls.setSlowNetwork(80);

    let settled = false;
    const inFlight = backend.transport
      .applyBatch(MEETING_ID, "client-a", { operations: [insertOp(0, "x", "op-1")] })
      .then(() => {
        settled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    await inFlight;
    expect(settled).toBe(true);
  });

  it("invalid ops fail per-op into failedOps while valid siblings apply", async () => {
    const backend = createDemoNotesBackend();
    const { snapshots } = collectSnapshots(backend, "client-a");

    const response = await backend.transport.applyBatch(MEETING_ID, "client-a", {
      operations: [
        deleteOp(9999, 3, "op-out-of-bounds"),
        insertOp(0, "ok ", "op-good"),
      ],
    });

    expect(response.success).toBe(false);
    expect(response.processed).toBe(1);
    expect(response.failed).toBe(1);
    expect(response.failedOps?.[0]?.clientOpId).toBe("op-out-of-bounds");
    expect(response.newVersion).toBe(2); // one bump: the valid op applied
    expect(snapshots.at(-1)?.content).toBe("ok " + DEMO_SEED_CONTENT);
  });

  it("simulateRemoteEdit bumps version and notifies live subscribers", () => {
    const backend = createDemoNotesBackend();
    const { snapshots } = collectSnapshots(backend, "client-a");

    backend.controls.simulateRemoteEdit("a colleague wrote this");

    expect(snapshots.at(-1)?.content).toBe("a colleague wrote this");
    expect(snapshots.at(-1)?.version).toBe(2);
    expect(snapshots.at(-1)?.headSequence).toBe(1);
  });

  it("reset restores the seed, version and clears faults", async () => {
    const backend = createDemoNotesBackend();
    const { snapshots } = collectSnapshots(backend, "client-a");
    backend.controls.setDropAck(true);
    await backend.transport
      .applyBatch(MEETING_ID, "client-a", { operations: [insertOp(0, "x", "op-1")] })
      .catch(() => {}); // dropped-ack rejection expected

    backend.controls.reset();

    expect(snapshots.at(-1)).toEqual({
      content: DEMO_SEED_CONTENT,
      version: 1,
      headSequence: 0,
      clientAcks: [],
    });
  });

  it("close() stops snapshot delivery", () => {
    const backend = createDemoNotesBackend();
    const { snapshots } = collectSnapshots(backend, "client-a");
    backend.transport.close();
    backend.controls.simulateRemoteEdit("after close");
    expect(snapshots).toHaveLength(1); // only the initial emission
  });
});
