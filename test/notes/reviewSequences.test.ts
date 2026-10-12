/**
 * Reproduced review sequences (r2 W3) - ledger level.
 *
 * Each test reproduces the exact ordering the review reported and asserts
 * the survival outcome: teardown persistence (S1), multi-region remote
 * changes never collapsing into a prefix/suffix replacement (S2), a
 * snapshot landing mid-debounce rebasing against the ORIGINAL basis (S3),
 * a lost response resolved by an identity snapshot still letting the
 * FOLLOW-UP edit send (S4), and equal-length replacements sending real
 * watermark-confirmed operations (S5).
 */

import { describe, expect, test } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { NotesLedger } from "../../src/hooks/notes/notesLedger";
import { applyBatchOps } from "../../src/hooks/notes/notesDiff";
import type { NotesServerSnapshot } from "../../src/hooks/notes/types";
import {
  deterministicLedgerClock,
  ScriptedTransport,
  tick,
} from "./harness/scriptedTransport";

const MEETING = "m-seq" as unknown as Id<"meetings">;
const CLIENT = "client-seq";

/** In-memory Storage stand-in (recovery must survive a remount). */
function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function makeLedger(storage: Storage, clientId = CLIENT): NotesLedger {
  return new NotesLedger({
    meetingId: MEETING,
    clientId,
    storage,
    debounceMs: 30_000, // never fires on its own; tests flush explicitly
    ...deterministicLedgerClock(),
  });
}

/** Seed the server and ledger with a synced base text. */
async function seedSynced(
  ledger: NotesLedger,
  transport: ScriptedTransport,
  text: string,
): Promise<void> {
  transport.serverText = text;
  transport.serverVersion = 1;
  transport.headSequence = 1;
  transport.deliver({
    content: text,
    version: 1,
    headSequence: 1,
    clientAcks: [],
  });
  await tick();
}

describe("r2 review sequences", () => {
  test("S1: teardown persists the original-basis edit and recovery keeps the remote word", async () => {
    const storage = memStorage();
    const transport = new ScriptedTransport();
    const ledger = makeLedger(storage);
    ledger.start(transport);
    await seedSynced(ledger, transport, "base");

    // Local edit is debounce-pending when the remote lands.
    ledger.onEdit("base alpha");
    transport.deliver({
      content: "base bravo",
      version: 2,
      headSequence: 2,
      clientAcks: [],
    });
    await tick();

    // Unmount inside the debounce window: teardown must persist the edit
    // diffed from its ORIGINAL basis ('base'), not re-diffed over the
    // moved composed view - the old defect persisted delete(5,5) +
    // insert(5,'alpha'), erasing 'bravo' on recovery.
    ledger.destroy();

    // Remount: the persisted pending op must flush and must not carry a
    // delete over the remote text.
    const remountTransport = new ScriptedTransport();
    remountTransport.serverText = "base bravo";
    remountTransport.serverVersion = 2;
    remountTransport.headSequence = 2;
    const remounted = makeLedger(storage);
    remounted.start(remountTransport);
    await tick();

    expect(remountTransport.calls.length).toBe(1);
    const ops = remountTransport.calls[0]!.operations.map((e) => e.operation);
    expect(
      ops.every((op) => op.type === "insert" || (op.length ?? 0) === 0),
    ).toBe(true);
    const serverText = applyBatchOps("base bravo", ops);
    expect(serverText).toContain("bravo");
    expect(serverText).toContain("alpha");
  });

  test("S2: a replacement transforms as one hunk against multi-region remote changes", async () => {
    const storage = memStorage();
    const transport = new ScriptedTransport();
    const ledger = makeLedger(storage);
    ledger.start(transport);
    await seedSynced(ledger, transport, "ab");

    ledger.onEdit("ac"); // same-length replacement, debounce-pending
    // Remote lands TWO inserts (a multi-region remote change) while the
    // edit is still pending.
    transport.deliver({
      content: "XabY",
      version: 2,
      headSequence: 2,
      clientAcks: [],
    });
    await tick();

    ledger.flushNow();
    await tick();
    expect(transport.calls.length).toBe(1);
    const ops = transport.calls[0]!.operations.map((e) => e.operation);
    const serverText = applyBatchOps("XabY", ops);
    // The old prefix/suffix collapse produced 'XabYc' (or 'XaYc'): the
    // replacement must transform as ONE hunk unit against the real remote
    // operations instead.
    expect(serverText).toBe("XacY");
  });

  test("S3: a snapshot landing mid-debounce rebases; the flush cannot delete the remote word", async () => {
    const storage = memStorage();
    const transport = new ScriptedTransport();
    const ledger = makeLedger(storage);
    ledger.start(transport);
    await seedSynced(ledger, transport, "base");

    ledger.onEdit("base alpha");
    transport.deliver({
      content: "base bravo",
      version: 2,
      headSequence: 2,
      clientAcks: [],
    });
    await tick();

    ledger.flushNow();
    await tick();
    expect(transport.calls.length).toBe(1);
    const ops = transport.calls[0]!.operations.map((e) => e.operation);
    // The outgoing batch must not delete 'bravo' (the old code diffed the
    // buffer against the moved composed view).
    expect(
      ops.every((op) => op.type === "insert" || (op.length ?? 0) === 0),
    ).toBe(true);
    const serverText = applyBatchOps("base bravo", ops);
    expect(serverText).toContain("bravo");
    expect(serverText).toContain("alpha");
  });

  test("S4: an identity snapshot retires a lost batch AND a follow-up edit sends", async () => {
    const storage = memStorage();
    const transport = new ScriptedTransport();
    const ledger = makeLedger(storage);
    ledger.start(transport);
    await seedSynced(ledger, transport, "hello world");

    // First edit: batch parks, then the RESPONSE is lost - only a later
    // identity snapshot (a fresh read's clientAcks) reveals the server
    // accepted it.
    ledger.onEdit("hello world synced");
    ledger.flushNow();
    await tick();
    expect(transport.calls.length).toBe(1);
    const lostOpId = transport.calls[0]!.operations[0]!.clientOpId;
    transport.applyCall(transport.calls[0]!);
    const ackSnapshot: NotesServerSnapshot = {
      content: "hello world synced",
      version: 2,
      headSequence: 1,
      clientAcks: [
        {
          clientOpId: lostOpId,
          serverSequence: 1,
          clientSequence: 0,
          appliedAt: 2,
        },
      ],
    };
    transport.deliver(ackSnapshot);
    await tick();

    // The follow-up edit MUST send a second batch (the old code left
    // batchInFlight stuck after a read-side retirement).
    ledger.onEdit("hello world synced next");
    ledger.flushNow();
    await tick();
    expect(transport.calls.length).toBe(2);
    transport.applyCall(transport.calls[1]!);
    transport.calls[1]!.resolve();
    await tick();
    expect(transport.serverText).toContain("next");
  });

  test("S5: an equal-length replacement sends a real operation confirmed by watermark", async () => {
    const storage = memStorage();
    const transport = new ScriptedTransport();
    const ledger = makeLedger(storage);
    ledger.start(transport);
    await seedSynced(ledger, transport, "cat");

    ledger.onEdit("car"); // same length: the old no-op collapse dropped it
    ledger.flushNow();
    await tick();
    expect(transport.calls.length).toBe(1);
    expect(transport.calls[0]!.operations.length).toBeGreaterThan(0);

    transport.applyCall(transport.calls[0]!);
    transport.calls[0]!.resolve();
    await tick();
    expect(transport.serverText).toBe("car");
    // Confirmation is by identity echo (watermark), not text matching.
    expect(ledger.getSnapshot().status).toBe("synced");
  });
});
