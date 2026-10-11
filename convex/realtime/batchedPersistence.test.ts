/**
 * Batched realtime writes: persist-before-ack regression tests.
 *
 * These assert the FIXED behavior. On the pre-fix baseline they fail,
 * reproducing the defects: batchIngestTranscriptChunk and
 * batchUpdatePresence enqueued into an in-memory processor whose flushers
 * only logged, so both mutations acknowledged data they never persisted
 * (guaranteed loss — Convex isolates do not share memory between
 * invocations).
 *
 * The "control" tests pin the legitimate flows that must keep working.
 */

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { describe, expect, it, beforeEach } from "vitest";
import {
  addMeetingParticipant,
  createTestEnvironment,
  createTestMeeting,
  createTestUser,
} from "../../test/convex/helpers";

describe("Batched realtime writes persist before acking", () => {
  let t: ReturnType<typeof createTestEnvironment>;

  beforeEach(() => {
    t = createTestEnvironment();
  });

  function asUser(subject: string) {
    return t.withIdentity({
      subject,
      email: `${subject}@example.com`,
      name: subject,
    });
  }

  /** Active meeting with the caller as a participant and an active state row. */
  async function setupActiveMeeting(subject: string): Promise<{
    meetingId: Id<"meetings">;
    userId: Id<"users">;
  }> {
    const userId = await createTestUser(t, {
      workosUserId: subject,
      email: `${subject}@example.com`,
    });
    const meetingId = await createTestMeeting(t, userId, { state: "active" });
    await addMeetingParticipant(t, meetingId, userId, "participant");
    await t.run(async (ctx) => {
      await ctx.db.insert("meetingState", {
        meetingId,
        active: true,
        topics: [],
        recordingEnabled: false,
        updatedAt: Date.now(),
      });
    });
    return { meetingId, userId };
  }

  async function transcriptCount(meetingId: Id<"meetings">): Promise<number> {
    return await t.run(async (ctx) =>
      (
        await ctx.db
          .query("transcripts")
          .withIndex("by_meeting_time_range", (q) =>
            q.eq("meetingId", meetingId),
          )
          .collect()
      ).length,
    );
  }

  it("control: a final transcript chunk is acknowledged only after it is durable", async () => {
    const { meetingId } = await setupActiveMeeting("alice-host");

    expect(await transcriptCount(meetingId)).toBe(0);

    const result = await asUser("alice-host").mutation(
      api.realtime.batchedOperations.batchIngestTranscriptChunk,
      {
        meetingId,
        text: "final chunk",
        confidence: 0.98,
        startMs: 0,
        endMs: 1200,
      },
    );
    expect(result).toEqual({ queued: true, batchSize: 1 });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("transcripts")
        .withIndex("by_meeting_time_range", (q) => q.eq("meetingId", meetingId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("final chunk");
    expect(rows[0].sequence).toBe(1);
  });

  it("control: an interim chunk is acked as coalesced without a durable write", async () => {
    const { meetingId } = await setupActiveMeeting("alice-host");

    const result = await asUser("alice-host").mutation(
      api.realtime.batchedOperations.batchIngestTranscriptChunk,
      {
        meetingId,
        text: "interim partial",
        confidence: 0.6,
        startMs: 0,
        endMs: 300,
        interim: true,
      },
    );
    expect(result).toEqual({ queued: true, batchSize: 1 });
    expect(await transcriptCount(meetingId)).toBe(0);
  });

  it("control: a presence update patches the participant row durably", async () => {
    const { meetingId, userId } = await setupActiveMeeting("alice-host");

    const result = await asUser("alice-host").mutation(
      api.realtime.batchedOperations.batchUpdatePresence,
      { meetingId, presence: "left" },
    );
    expect(result).toEqual({ queued: true, batchSize: 1 });

    const participant = await t.run(async (ctx) =>
      ctx.db
        .query("meetingParticipants")
        .withIndex("by_meeting_and_user", (q) =>
          q.eq("meetingId", meetingId).eq("userId", userId),
        )
        .unique(),
    );
    expect(participant?.presence).toBe("left");
    expect(participant?.leftAt).toBeTypeOf("number");
  });

  it("rejects transcript chunks for an inactive meeting instead of acking them", async () => {
    const { meetingId } = await setupActiveMeeting("alice-host");
    await t.run(async (ctx) => {
      const state = await ctx.db
        .query("meetingState")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .unique();
      await ctx.db.patch(state!._id, { active: false });
    });

    await expect(
      asUser("alice-host").mutation(
        api.realtime.batchedOperations.batchIngestTranscriptChunk,
        {
          meetingId,
          text: "too late",
          confidence: 0.9,
          startMs: 0,
          endMs: 100,
        },
      ),
    ).rejects.toThrow(/not active/);
    expect(await transcriptCount(meetingId)).toBe(0);
  });

  it("rejects a presence update for a meeting the caller never joined", async () => {
    const { meetingId } = await setupActiveMeeting("alice-host");
    await createTestUser(t, {
      workosUserId: "mallory-outsider",
      email: "mallory-outsider@example.com",
    });

    await expect(
      asUser("mallory-outsider").mutation(
        api.realtime.batchedOperations.batchUpdatePresence,
        { meetingId, presence: "joined" },
      ),
    ).rejects.toThrow();
  });
});
