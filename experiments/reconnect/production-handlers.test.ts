/**
 * Pins the PRODUCTION-OBSERVED duplicate-delivery receipts (see
 * production-handlers.ts). These are observations of the real registered
 * handlers through convex-test — the fake transport plays no role here.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { runProductionHandlers } from "./production-handlers";

describe("production handlers under duplicate delivery (convex-test, real handlers)", () => {
  const results = runProductionHandlers();

  it("accepts the first applyNoteOperation delivery", async () => {
    const o = (await results).observations.find((x) => x.id === "notes/first-delivery");
    expect(o?.observed).toBe("accepted");
  });

  it("REJECTS an exact duplicate redelivery with a CONFLICT (version guard)", async () => {
    const o = (await results).observations.find(
      (x) => x.id === "notes/duplicate-identical-args",
    );
    expect(o?.observed).toBe("rejected");
    const err = JSON.stringify(o?.evidence);
    expect(err).toContain("Version mismatch");
    expect(o?.evidence.noteOpsCount).toBe(1); // applied exactly once
  });

  it("ACCEPTS a version-aware duplicate and applies it twice (no idempotency key)", async () => {
    const o = (await results).observations.find(
      (x) => x.id === "notes/duplicate-version-aware",
    );
    expect(o?.observed).toBe("accepted");
    expect(o?.evidence.noteOpsCount).toBe(2);
    expect(o?.evidence.duplicateContentApplied).toBe(true);
  });

  it("startMeeting duplicate is rejected by the state guard", async () => {
    const o = (await results).observations.find((x) => x.id === "lifecycle/start-duplicate");
    expect(o?.observed).toBe("rejected");
  });

  it("endMeeting duplicate is rejected by the state guard", async () => {
    const o = (await results).observations.find((x) => x.id === "lifecycle/end-duplicate");
    expect(o?.observed).toBe("rejected");
  });

  it("dispatchWebhook redelivery is DEDUPED by withIdempotency (no second execution)", async () => {
    const o = (await results).observations.find(
      (x) => x.id === "webhook/duplicate-redelivery",
    );
    expect(o?.observed).toBe("deduped");
    const keys = o?.evidence.idempotencyKeys as Record<string, number>;
    expect(keys.afterFirst).toBe(1);
    expect(keys.afterDuplicate).toBe(1);
  });
});
