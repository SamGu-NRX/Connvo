/**
 * The recap's duration is how long the call ran, not how long ago the meeting
 * was created.
 *
 * Adversarial walk of the real order of events: a meeting created to start
 * immediately, minutes of waiting, both people joining the live call through
 * the mesh, a short talk, and the last leave ending it. Before the fix the
 * meeting's creation or host-open wrote meetingState.startedAt, so the recap
 * counted the wait; the mesh's recordCallStart only fills an undefined start.
 *
 * Follows the convex-test idiom of ../meetings/webrtc/mesh.test.ts and
 * ./history.test.ts.
 */

import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  createTestEnvironment,
  setupTestMocks,
  resetAllMocks,
  cleanupTestMocks,
} from "../../test/convex/helpers";
import { createMeetingRecords } from "../meetings/lifecycle";
import { formatRecordedDuration } from "../../src/lib/history/duration";
import { buildRecap, RecapInput } from "../../src/lib/history/recap";

const T0 = 1_700_000_000_000; // the meeting is created
const JOIN = T0 + 3 * 60_000; // both people join three minutes later
const TALK = 5 * 60_000; // they talk for five minutes
const END = JOIN + TALK; // the last leave ends it

describe("recap duration counts from the call's start", () => {
  let t: ReturnType<typeof createTestEnvironment>;
  let meetingId: Id<"meetings">;
  let asA: ReturnType<ReturnType<typeof createTestEnvironment>["withIdentity"]>;
  let asB: ReturnType<ReturnType<typeof createTestEnvironment>["withIdentity"]>;
  let envSavedFlag: string | undefined;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    t = createTestEnvironment();
    setupTestMocks();
    resetAllMocks();
    envSavedFlag = process.env.CONNVO_AFTER_CALL;
    process.env.CONNVO_AFTER_CALL = "1";

    // The real creation path, in the shape that used to write startedAt at
    // creation: start immediately, WebRTC flag off (convex/meetings/
    // lifecycle.ts used to set startedAt for exactly this shape).
    meetingId = await t.run(async (ctx) => {
      const now = Date.now();
      const mkUser = (k: string) =>
        ctx.db.insert("users", {
          workosUserId: `recap-${k}`,
          email: `${k}@recap.test`,
          displayName: k.toUpperCase(),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      const a = await mkUser("a");
      const b = await mkUser("b");
      return await createMeetingRecords(ctx, {
        organizerId: a,
        title: "Recap duration walk",
        duration: 30 * 60_000,
        webrtcEnabled: false,
        recordingEnabled: false,
        participantIds: [a, b],
        startImmediately: true,
      });
    });

    const who = (k: string) =>
      t.withIdentity({
        subject: `recap-${k}`,
        email: `${k}@recap.test`,
        name: k.toUpperCase(),
      });
    asA = who("a");
    asB = who("b");
  });

  afterEach(async () => {
    await t.finishInProgressScheduledFunctions();
    vi.clearAllTimers();
    vi.useRealTimers();
    cleanupTestMocks();
    if (envSavedFlag === undefined) delete process.env.CONNVO_AFTER_CALL;
    else process.env.CONNVO_AFTER_CALL = envSavedFlag;
  });

  test("created, a wait, both join, they talk, the call ends: the recap counts only the talk", async () => {
    vi.setSystemTime(JOIN);
    await asA.mutation(api.meetings.webrtc.mesh.joinCall, {
      meetingId,
      sessionId: "session-a-1",
    });
    await asB.mutation(api.meetings.webrtc.mesh.joinCall, {
      meetingId,
      sessionId: "session-b-1",
    });

    // The talk: both clients renew their sessions well inside the 10 s
    // heartbeat expiry (HEARTBEAT_EXPIRY_MS), like real tabs do.
    for (let at = JOIN + 8_000; at < END - 30_000; at += 8_000) {
      vi.setSystemTime(at);
      await asA.mutation(api.meetings.webrtc.mesh.heartbeat, {
        meetingId,
        sessionId: "session-a-1",
      });
      await asB.mutation(api.meetings.webrtc.mesh.heartbeat, {
        meetingId,
        sessionId: "session-b-1",
      });
    }

    vi.setSystemTime(END - 30_000);
    await asA.mutation(api.meetings.webrtc.mesh.heartbeat, {
      meetingId,
      sessionId: "session-a-1",
    });
    await asB.mutation(api.meetings.webrtc.mesh.heartbeat, {
      meetingId,
      sessionId: "session-b-1",
    });
    await asA.mutation(api.meetings.webrtc.mesh.leaveCall, {
      meetingId,
      sessionId: "session-a-1",
    });

    vi.setSystemTime(END - 2_000);
    await asB.mutation(api.meetings.webrtc.mesh.heartbeat, {
      meetingId,
      sessionId: "session-b-1",
    });
    vi.setSystemTime(END);
    await asB.mutation(api.meetings.webrtc.mesh.leaveCall, {
      meetingId,
      sessionId: "session-b-1",
    });

    // The recap: the start is the pair-join, the end is the last leave, and
    // the duration line counts the five talk minutes, not the eight since
    // the meeting was created.
    const history = await asA.query(api.history.queries.getMeetingHistory, {
      meetingId,
    });
    expect(history.state?.startedAt).toBe(JOIN);
    expect(history.state?.endedAt).toBe(END);
    const recap = buildRecap(history as unknown as RecapInput);
    const durationSection = recap.sections.find((s) => s.kind === "duration");
    expect(durationSection?.items).toEqual(["5 minutes"]);
    expect(recap.sources.duration).toBe(true);

    // The history list agrees with the recap.
    const page = await asA.query(api.history.queries.listMyMeetings, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    const mine = page.page.find((item: any) => item.meeting._id === meetingId);
    expect(mine?.startedAt).toBe(JOIN);
    expect(formatRecordedDuration(mine?.startedAt, mine?.endedAt)).toBe(
      "5 minutes",
    );
  });

  test("the live prompt timer counts from the call's start, not the meeting's creation", async () => {
    vi.setSystemTime(JOIN);
    await asA.mutation(api.meetings.webrtc.mesh.joinCall, {
      meetingId,
      sessionId: "session-a-1",
    });
    await asB.mutation(api.meetings.webrtc.mesh.joinCall, {
      meetingId,
      sessionId: "session-b-1",
    });

    vi.setSystemTime(JOIN + 10_000);
    const reservation: any = await asA.mutation(internal.prompts.live.reserve, {
      meetingId,
      automatic: true,
      reservationId: "r1",
    });
    expect(reservation.status).toBe("reserved");
    expect(reservation.context.elapsedSeconds).toBe(10);
  });
});
