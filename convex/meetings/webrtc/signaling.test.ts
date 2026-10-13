/**
 * WebRTC signaling regression tests.
 *
 * These tests assert the FIXED behavior. On the pre-fix baseline they fail,
 * reproducing the defects:
 *  - getPendingSignals took a bounded batch BEFORE filtering by session, so
 *    signals for one session could be skipped when unrelated signals filled
 *    the batch;
 *  - broadcast signals (no toUserId) could never match the recipient query
 *    and could never be acknowledged — they accumulated forever and were
 *    never delivered;
 *  - the ack path silently ignored client-supplied signal ids belonging to
 *    other callers instead of rejecting them.
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
} from "../../../test/convex/helpers";

const ICE_DATA = { candidate: "candidate:1 1 UDP 2122252543 1 typ host" } as const;

interface Fixture {
  meetingId: Id<"meetings">;
  userIds: Record<string, Id<"users">>;
}

describe("WebRTC signaling delivery and acknowledgement", () => {
  let t: ReturnType<typeof createTestEnvironment>;

  beforeEach(() => {
    t = createTestEnvironment();
  });

  /** Creates a user + active meeting, with the user as host participant. */
  async function setupMeeting(subject: string): Promise<Fixture> {
    const userId = await createTestUser(t, {
      workosUserId: subject,
      email: `${subject}@example.com`,
    });
    const meetingId = await createTestMeeting(t, userId, { state: "active" });
    await addMeetingParticipant(t, meetingId, userId, "host");
    return { meetingId, userIds: { [subject]: userId } };
  }

  /** Adds another participant to an existing fixture's meeting. */
  async function addParticipant(fixture: Fixture, subject: string) {
    const userId = await createTestUser(t, {
      workosUserId: subject,
      email: `${subject}@example.com`,
    });
    await addMeetingParticipant(t, fixture.meetingId, userId, "participant");
    fixture.userIds[subject] = userId;
    return userId;
  }

  async function insertSignal(
    fixture: Fixture,
    fromUserId: Id<"users">,
    toUserId: Id<"users"> | undefined,
    sessionId: string,
  ): Promise<Id<"webrtcSignals">> {
    return await t.run(async (ctx) =>
      ctx.db.insert("webrtcSignals", {
        meetingId: fixture.meetingId,
        sessionId,
        fromUserId,
        toUserId,
        type: "ice",
        data: ICE_DATA,
        timestamp: Date.now(),
        processed: false,
      }),
    );
  }

  function asUser(subject: string) {
    return t.withIdentity({
      subject,
      email: `${subject}@example.com`,
      name: subject,
    });
  }

  it("control: a direct signal addressed to the caller is delivered and ackable", async () => {
    const fixture = await setupMeeting("alice-host");
    const bob = await addParticipant(fixture, "bob-peer");

    const signalId = await insertSignal(
      fixture,
      fixture.userIds["alice-host"],
      bob,
      "alice-session",
    );

    const pending = await asUser("bob-peer").query(
      api.meetings.webrtc.signaling.getPendingSignals,
      { meetingId: fixture.meetingId, sessionId: "alice-session" },
    );
    expect(pending.map((s) => s._id)).toEqual([signalId]);

    await asUser("bob-peer").mutation(
      api.meetings.webrtc.signaling.markSignalsProcessed,
      { signalIds: [signalId] },
    );

    const afterAck = await asUser("bob-peer").query(
      api.meetings.webrtc.signaling.getPendingSignals,
      { meetingId: fixture.meetingId },
    );
    expect(afterAck).toEqual([]);
  });

  it("returns signals for session B even when session A has filled the batch with unrelated signals", async () => {
    const fixture = await setupMeeting("alice-host");
    const bob = await addParticipant(fixture, "bob-peer");

    // 200 unprocessed direct signals to bob from session A — enough to fill
    // the old take(200)-then-filter batch.
    await t.run(async (ctx) => {
      for (let i = 0; i < 200; i++) {
        await ctx.db.insert("webrtcSignals", {
          meetingId: fixture.meetingId,
          sessionId: "session-a",
          fromUserId: fixture.userIds["alice-host"],
          toUserId: bob,
          type: "ice",
          data: ICE_DATA,
          timestamp: Date.now() + i,
          processed: false,
        });
      }
    });
    const sessionBSignal = await insertSignal(
      fixture,
      fixture.userIds["alice-host"],
      bob,
      "session-b",
    );

    const pending = await asUser("bob-peer").query(
      api.meetings.webrtc.signaling.getPendingSignals,
      { meetingId: fixture.meetingId, sessionId: "session-b" },
    );
    expect(pending.map((s) => s._id)).toEqual([sessionBSignal]);
  });

  it("delivers broadcast signals, acks them per-caller, and keeps them for other participants", async () => {
    const fixture = await setupMeeting("alice-host");
    await addParticipant(fixture, "bob-peer");
    await addParticipant(fixture, "carol-peer");

    // Broadcast: no targetUserId.
    await asUser("alice-host").mutation(
      api.meetings.webrtc.signaling.exchangeSessionDescription,
      {
        meetingId: fixture.meetingId,
        sessionId: "alice-session",
        description: { type: "offer", sdp: "v=0 offer" },
      },
    );

    const broadcastId = await t.run(async (ctx) => {
      const signal = await ctx.db
        .query("webrtcSignals")
        .withIndex("by_meeting", (q) => q.eq("meetingId", fixture.meetingId))
        .unique();
      if (!signal) throw new Error("broadcast signal not inserted");
      return signal._id;
    });

    const forBob = await asUser("bob-peer").query(
      api.meetings.webrtc.signaling.getPendingSignals,
      { meetingId: fixture.meetingId },
    );
    expect(forBob.map((s) => s._id)).toEqual([broadcastId]);

    // Bob acks: delivered-for-bob, not deleted for everyone.
    await asUser("bob-peer").mutation(
      api.meetings.webrtc.signaling.markSignalsProcessed,
      { signalIds: [broadcastId] },
    );

    const afterBobAck = await asUser("bob-peer").query(
      api.meetings.webrtc.signaling.getPendingSignals,
      { meetingId: fixture.meetingId },
    );
    expect(afterBobAck).toEqual([]);

    const forCarol = await asUser("carol-peer").query(
      api.meetings.webrtc.signaling.getPendingSignals,
      { meetingId: fixture.meetingId },
    );
    expect(forCarol.map((s) => s._id)).toEqual([broadcastId]);

    // Carol acks independently; the ack is per-caller and idempotent.
    await asUser("carol-peer").mutation(
      api.meetings.webrtc.signaling.markSignalsProcessed,
      { signalIds: [broadcastId] },
    );
    await expect(
      asUser("carol-peer").mutation(
        api.meetings.webrtc.signaling.markSignalsProcessed,
        { signalIds: [broadcastId] },
      ),
    ).resolves.toBeNull();
  });

  it("rejects acking a signal addressed to another caller", async () => {
    const fixture = await setupMeeting("alice-host");
    const bob = await addParticipant(fixture, "bob-peer");
    const carol = await addParticipant(fixture, "carol-peer");

    const directToCarol = await insertSignal(
      fixture,
      fixture.userIds["alice-host"],
      carol,
      "alice-session",
    );
    const broadcast = await insertSignal(
      fixture,
      fixture.userIds["alice-host"],
      undefined,
      "alice-session",
    );

    await expect(
      asUser("bob-peer").mutation(
        api.meetings.webrtc.signaling.markSignalsProcessed,
        { signalIds: [directToCarol] },
      ),
    ).rejects.toThrow(/forbidden|not your|another user|access denied/i);

    // Mallory is a participant of a DIFFERENT meeting — she may not ack a
    // broadcast on a meeting she does not belong to.
    const malloryMeeting = await setupMeeting("mallory-outsider");
    await expect(
      t.withIdentity({
        subject: "mallory-outsider",
        email: "mallory-outsider@example.com",
        name: "mallory-outsider",
      }).mutation(api.meetings.webrtc.signaling.markSignalsProcessed, {
        signalIds: [broadcast],
      }),
    ).rejects.toThrow(/forbidden|access denied|participant/i);
    void malloryMeeting;

    void bob;
  });

  it("paginates with the lastSignalId cursor across direct and broadcast signals without repeats or loss", async () => {
    const fixture = await setupMeeting("alice-host");
    const bob = await addParticipant(fixture, "bob-peer");

    const first = await insertSignal(
      fixture,
      fixture.userIds["alice-host"],
      bob,
      "alice-session",
    );
    const second = await insertSignal(
      fixture,
      fixture.userIds["alice-host"],
      undefined,
      "alice-session",
    );
    const third = await insertSignal(
      fixture,
      fixture.userIds["alice-host"],
      bob,
      "alice-session",
    );

    const bobT = asUser("bob-peer");
    const page1 = await bobT.query(
      api.meetings.webrtc.signaling.getPendingSignals,
      { meetingId: fixture.meetingId },
    );
    expect(page1.map((s) => s._id)).toEqual([first, second, third]);

    const page2 = await bobT.query(
      api.meetings.webrtc.signaling.getPendingSignals,
      { meetingId: fixture.meetingId, lastSignalId: page1[0]._id },
    );
    expect(page2.map((s) => s._id)).toEqual([second, third]);

    const page3 = await bobT.query(
      api.meetings.webrtc.signaling.getPendingSignals,
      { meetingId: fixture.meetingId, lastSignalId: page2[0]._id },
    );
    expect(page3.map((s) => s._id)).toEqual([third]);
  });
});
