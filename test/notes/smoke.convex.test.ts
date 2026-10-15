/**
 * Smoke test: the convex-test harness works under the isolated notes project
 * and exercises the REAL merged notes mutation + query end to end.
 */

import { describe, expect, test } from "vitest";
import { NotesBackend } from "./harness/backend";

describe("convex-test backend smoke", () => {
  test("applies a real batch and reads back the real snapshot with identity acks", async () => {
    const backend = new NotesBackend();
    const a = await backend.addParticipant("smoke-a");

    const response = await backend.applyBatch(a.face, a.meetingId, "smoke-c", {
      operations: [
        {
          operation: { type: "insert", position: 0, content: "hello real backend" },
          clientSequence: 0,
          clientOpId: "smoke-op-1",
        },
      ],
    });
    expect(response.success).toBe(true);
    expect(response.results[0]?.clientOpId).toBe("smoke-op-1");
    expect(response.newVersion).toBe(1);

    const server = await backend.readServerText(a.meetingId);
    expect(server.content).toBe("hello real backend");

    const snapshot = await backend.readSnapshot(a.face, a.meetingId, "smoke-c");
    expect(snapshot?.content).toBe("hello real backend");
    expect(snapshot?.headSequence).toBe(1);
    expect(snapshot?.clientAcks[0]?.clientOpId).toBe("smoke-op-1");

    const ops = await backend.readNoteOps(a.meetingId);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.clientOpId).toBe("smoke-op-1");
  });
});
