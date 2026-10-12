/**
 * W5 honest states: a send the ledger cannot settle must become VISIBLE
 * unconfirmed work after sendTimeoutMs - not a silent stuck 'sending' -
 * while every resolution path still holds (a late identity echo retires;
 * a fresh read with no ack re-pends and resends under the SAME id; 0
 * disables the deadline).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { NotesLedger } from "../../src/hooks/notes/notesLedger";
import {
  deterministicLedgerClock,
  ScriptedTransport,
  tick,
} from "./harness/scriptedTransport";

const MEETING = "m-deadline" as unknown as Id<"meetings">;
const CLIENT = "client-deadline";

function makeLedger(transport: ScriptedTransport, sendTimeoutMs: number) {
  const ledger = new NotesLedger({
    meetingId: MEETING,
    clientId: CLIENT,
    storage: null,
    debounceMs: 30_000,
    sendTimeoutMs,
    ...deterministicLedgerClock(),
  });
  ledger.start(transport);
  return ledger;
}

describe("unconfirmed send deadline (r2 W5)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a parked send flips visibly to unconfirmed at the deadline and releases the slot", async () => {
    const transport = new ScriptedTransport();
    transport.serverText = "hello world";
    transport.serverVersion = 1;
    transport.headSequence = 1;
    const ledger = makeLedger(transport, 1_000);
    transport.deliver({
      content: "hello world",
      version: 1,
      headSequence: 1,
      clientAcks: [],
    });
    await tick();

    ledger.onEdit("hello world x");
    ledger.flushNow();
    await tick();
    expect(ledger.getSnapshot().status).toBe("saving");

    vi.advanceTimersByTime(1_001);
    const snapshot = ledger.getSnapshot();
    expect(snapshot.status).toBe("unconfirmed");
    expect(snapshot.unconfirmedCount).toBe(1);

    // The slot is released: a follow-up edit sends as a second batch.
    ledger.onEdit("hello world xy");
    ledger.flushNow();
    await tick();
    expect(transport.calls.length).toBe(2);
  });

  test("a late identity echo after the deadline still retires by identity", async () => {
    const transport = new ScriptedTransport();
    transport.serverText = "hello world";
    transport.serverVersion = 1;
    transport.headSequence = 1;
    const ledger = makeLedger(transport, 1_000);
    transport.deliver({
      content: "hello world",
      version: 1,
      headSequence: 1,
      clientAcks: [],
    });
    await tick();

    ledger.onEdit("hello world x");
    ledger.flushNow();
    await tick();
    vi.advanceTimersByTime(1_001);
    expect(ledger.getSnapshot().status).toBe("unconfirmed");

    // The server HAD accepted it; the late response echoes the identity.
    transport.applyCall(transport.calls[0]!);
    transport.calls[0]!.resolve();
    await tick();
    const snapshot = ledger.getSnapshot();
    expect(snapshot.status).toBe("synced");
    expect(snapshot.unconfirmedCount).toBe(0);
    // No duplicate send happened.
    expect(transport.calls.length).toBe(1);
  });

  test("a fresh read with no ack re-pends and resends under the SAME clientOpId", async () => {
    const transport = new ScriptedTransport();
    transport.serverText = "hello world";
    transport.serverVersion = 1;
    transport.headSequence = 1;
    const ledger = makeLedger(transport, 1_000);
    transport.deliver({
      content: "hello world",
      version: 1,
      headSequence: 1,
      clientAcks: [],
    });
    await tick();

    ledger.onEdit("hello world x");
    ledger.flushNow();
    await tick();
    const firstId = transport.calls[0]!.operations[0]!.clientOpId;
    vi.advanceTimersByTime(1_001);

    // Fresh read past the op's basis with NO ack: evidence it never landed.
    transport.deliver({
      content: "hello world remote",
      version: 3,
      headSequence: 2,
      clientAcks: [],
    });
    await tick();

    ledger.flushNow();
    await tick();
    expect(transport.calls.length).toBe(2);
    expect(transport.calls[1]!.operations[0]!.clientOpId).toBe(firstId);
  });

  test("sendTimeoutMs: 0 disables the deadline entirely", async () => {
    const transport = new ScriptedTransport();
    transport.serverText = "hello world";
    transport.serverVersion = 1;
    transport.headSequence = 1;
    const ledger = makeLedger(transport, 0);
    transport.deliver({
      content: "hello world",
      version: 1,
      headSequence: 1,
      clientAcks: [],
    });
    await tick();

    ledger.onEdit("hello world x");
    ledger.flushNow();
    await tick();
    vi.advanceTimersByTime(60_000);
    const snapshot = ledger.getSnapshot();
    expect(snapshot.status).toBe("saving");
    expect(snapshot.unconfirmedCount).toBe(0);
    expect(transport.calls.length).toBe(1);
  });
});
