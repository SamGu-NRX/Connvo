/**
 * After-call history data layer tests
 *
 * Follows the convex-test idiom of convex/auth/guards.test.ts:
 * createTestEnvironment, helper-based fixtures, and t.withIdentity for
 * authenticated contexts.
 */

import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  createTestEnvironment,
  createCompleteTestUser,
  createTestMeetingWithParticipants,
  setupTestMocks,
  resetAllMocks,
  cleanupTestMocks,
} from "../../test/convex/helpers";
import { buildRecap, RecapInput } from "../../src/lib/history/recap";

describe("After-call history data layer", () => {
  let t: ReturnType<typeof createTestEnvironment>;
  let envSavedFlag: string | undefined;

  beforeEach(() => {
    t = createTestEnvironment();
    setupTestMocks();
    resetAllMocks();
    // Default the server flag ON for the existing suites; the flag-gating
    // describe toggles it explicitly and afterEach restores the prior value.
    envSavedFlag = process.env.CONNVO_AFTER_CALL;
    process.env.CONNVO_AFTER_CALL = "1";
  });

  afterEach(() => {
    if (envSavedFlag === undefined) delete process.env.CONNVO_AFTER_CALL;
    else process.env.CONNVO_AFTER_CALL = envSavedFlag;
    cleanupTestMocks();
  });

  const identityFor = (workosUserId: string) =>
    t.withIdentity({ subject: workosUserId });

  describe("listMyMeetings", () => {
    test("returns only the caller's meetings, newest first", async () => {
      const mine = await createTestMeetingWithParticipants(
        t,
        {},
        1,
        { title: "My Meeting", scheduledAt: 1000, duration: 600 },
        {},
      );
      const other = await createTestMeetingWithParticipants(
        t,
        {},
        1,
        { title: "Other Meeting", scheduledAt: 2000, duration: 600 },
        {},
      );

      // The caller organizes an older meeting of their own.
      await createTestMeetingWithParticipants(
        t,
        {},
        0,
        { title: "Older Meeting", scheduledAt: 500, duration: 600 },
        {
          organizerOverride: {
            userId: mine.participantIds[0],
            workosUserId: mine.participantWorkosIds[0],
          },
        },
      );

      const page = await identityFor(mine.participantWorkosIds[0]).query(
        api.history.queries.listMyMeetings,
        { paginationOpts: { numItems: 10, cursor: null } },
      );

      expect(page.isDone).toBe(true);
      const titles = page.page.map((item: any) => item.meeting.title);
      expect(titles).toContain("My Meeting");
      expect(titles).toContain("Older Meeting");
      // The other meeting must never appear for this caller.
      expect(titles).not.toContain("Other Meeting");

      // Newest-first by meeting createdAt.
      const createdAts = page.page.map((item: any) => item.meeting.createdAt);
      for (let i = 1; i < createdAts.length; i++) {
        expect(createdAts[i - 1]).toBeGreaterThanOrEqual(createdAts[i]);
      }
      // Caller's role rides on each item; no state rows exist yet.
      expect(page.page.every((item: any) => typeof item.role === "string")).toBe(true);
      expect(page.page.every((item: any) => item.startedAt === null)).toBe(true);
      expect(other.meetingId).toBeDefined();
    });

    test("paginates with cursor and reports isDone", async () => {
      const first = await createTestMeetingWithParticipants(
        t,
        {},
        1,
        { title: "Meeting A" },
        {},
      );
      // The same caller also organizes a second meeting.
      const second = await createTestMeetingWithParticipants(
        t,
        {},
        0,
        { title: "Meeting B" },
        {
          organizerOverride: {
            userId: first.participantIds[0],
            workosUserId: first.participantWorkosIds[0],
          },
        },
      );

      const caller = identityFor(first.participantWorkosIds[0]);
      const firstPage = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 1, cursor: null },
      });
      expect(firstPage.page).toHaveLength(1);
      expect(firstPage.isDone).toBe(false);

      const secondPage = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
      });
      expect(secondPage.page).toHaveLength(1);
      expect(secondPage.isDone).toBe(true);
      expect(second.meetingId).toBeDefined();
    });

    test("refuses unauthenticated callers", async () => {
      await expect(
        t.query(api.history.queries.listMyMeetings, {
          paginationOpts: { numItems: 10, cursor: null },
        }),
      ).rejects.toThrow(/Authentication required/);
    });
  });

  describe("getMeetingHistory", () => {
    test("returns the full payload for a participant", async () => {
      const { meetingId, organizerId, participantWorkosIds } =
        await createTestMeetingWithParticipants(
          t,
          { displayName: "Host User" },
          1,
          { title: "History Meeting", scheduledAt: 111, duration: 60 },
          {},
        );
      const callerWorkosId = participantWorkosIds[0];

      // Meeting state, events, and prompts.
      await t.run(async (ctx) => {
        const now = Date.now();
        await ctx.db.insert("meetingState", {
          meetingId,
          active: false,
          startedAt: 1000,
          endedAt: 190000,
          topics: [],
          recordingEnabled: false,
          updatedAt: now,
        });
        await ctx.db.insert("meetingEvents", {
          meetingId,
          event: "meeting_started",
          success: true,
          metadata: {},
          timestamp: 1000,
          createdAt: now,
        });
        await ctx.db.insert("prompts", {
          meetingId,
          type: "precall",
          content: "Prep prompt",
          tags: [],
          relevance: 1,
          usedAt: 1234,
          createdAt: 900,
        });
        await ctx.db.insert("prompts", {
          meetingId,
          type: "incall",
          content: "Incall prompt",
          tags: [],
          relevance: 1,
          createdAt: 1000,
        });
      });

      // Notes: exactly what getMeetingNotesInternal reads.
      await t.run(async (ctx) => {
        await ctx.db.insert("meetingNotes", {
          meetingId,
          content: "Shared agenda notes",
          version: 3,
          lastRebasedAt: 1,
          updatedAt: 2,
        });
      });

      const history = await identityFor(callerWorkosId).query(
        api.history.queries.getMeetingHistory,
        { meetingId },
      );

      expect(history.meeting._id).toBe(meetingId);
      expect(history.meeting.title).toBe("History Meeting");
      expect(history.myRole).toBe("participant");
      expect(history.state?.startedAt).toBe(1000);
      expect(history.state?.endedAt).toBe(190000);

      const names = history.participants.map((p: any) => p.displayName);
      expect(names).toContain("Host User");
      expect(names).toContain("Participant 1");
      for (const p of history.participants as any[]) {
        expect(["host", "participant", "observer"]).toContain(p.role);
        expect(["invited", "joined", "left"]).toContain(p.presence);
      }

      expect(history.lifecycleEvents.map((e: any) => e.event)).toEqual([
        "meeting_started",
      ]);

      expect(history.notes?.content).toBe("Shared agenda notes");
      expect(history.notes?.version).toBe(3);

      const promptContents = history.prompts.map((p: any) => p.content);
      expect(promptContents).toEqual(["Prep prompt", "Incall prompt"]);
      expect(organizerId).toBeDefined();
    });

    test("throws the identical forbidden error for a non-participant and a nonexistent meeting (no existence leak)", async () => {
      const { meetingId, participantWorkosIds } =
        await createTestMeetingWithParticipants(t, {}, 1, {}, {});

      const outsider = await createCompleteTestUser(t, {
        email: "outsider@example.com",
        displayName: "Outsider",
      });

      // Shape-agnostic: works for a raw ConvexError (data envelope) and
      // for re-thrown wrappers carrying code/message directly.
      const catchData = (error: unknown): { code?: string; message?: string } => {
        const anyError = error as {
          data?: { code?: string; message?: string };
          code?: string;
          message?: string;
        };
        const payload = anyError.data ?? anyError;
        return { code: payload?.code, message: payload?.message };
      };

      let nonParticipantData: { code?: string; message?: string } = {};
      let nonParticipantThrew = false;
      try {
        await identityFor(outsider.workosUserId).query(
          api.history.queries.getMeetingHistory,
          { meetingId },
        );
      } catch (error) {
        nonParticipantThrew = true;
        nonParticipantData = catchData(error);
      }
      expect(nonParticipantThrew).toBe(true);
      expect(nonParticipantData.code).toBe("FORBIDDEN");
      expect(nonParticipantData.message).toBe(
        "Access denied: Not a meeting participant",
      );

      // A properly formatted but nonexistent meeting id.
      const nonExistentId: Id<"meetings"> = await t.run(async (ctx) => {
        const tempId = await ctx.db.insert("meetings", {
          organizerId: outsider.userId,
          title: "Temp",
          state: "scheduled",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await ctx.db.delete(tempId);
        return tempId;
      });

      let nonexistentData: { code?: string; message?: string } = {};
      let nonexistentThrew = false;
      try {
        await identityFor(participantWorkosIds[0]).query(
          api.history.queries.getMeetingHistory,
          { meetingId: nonExistentId },
        );
      } catch (error) {
        nonexistentThrew = true;
        nonexistentData = catchData(error);
      }
      expect(nonexistentThrew).toBe(true);
      expect(nonexistentData.code).toBe("FORBIDDEN");
      expect(nonexistentData.message).toBe(
        "Access denied: Not a meeting participant",
      );

      // Identical code and message: no meeting-existence leak.
      expect(nonexistentData.code).toBe(nonParticipantData.code);
      expect(nonexistentData.message).toBe(nonParticipantData.message);
    });

    test("refuses unauthenticated callers", async () => {
      const { meetingId } = await createTestMeetingWithParticipants(
        t,
        {},
        1,
        {},
        {},
      );
      await expect(
        t.query(api.history.queries.getMeetingHistory, { meetingId }),
      ).rejects.toThrow(/Authentication required/);
    });
  });

  describe("getStayInTouchStatus and setStayInTouch", () => {
    test("opt-in persists, is idempotent, and disable removes", async () => {
      const { meetingId, participantIds, participantWorkosIds } =
        await createTestMeetingWithParticipants(t, {}, 1, {}, {});
      const caller = identityFor(participantWorkosIds[0]);

      let status = await caller.query(
        api.history.queries.getStayInTouchStatus,
        { meetingId },
      );
      expect(status.enabled).toBe(false);
      expect(status.mutual).toBe(false);

      const afterEnable = await caller.mutation(
        api.history.mutations.setStayInTouch,
        { meetingId, enabled: true },
      );
      expect(afterEnable.enabled).toBe(true);
      expect(afterEnable.mutual).toBe(false);

      // Idempotent: repeat leaves identical state.
      const repeat = await caller.mutation(
        api.history.mutations.setStayInTouch,
        { meetingId, enabled: true },
      );
      expect(repeat.enabled).toBe(true);

      // The opt-in row exists for the caller.
      const row = await t.run(async (ctx) =>
        ctx.db
          .query("stayInTouch")
          .withIndex("by_meeting_and_user", (q) =>
            q.eq("meetingId", meetingId).eq("userId", participantIds[0]),
          )
          .unique(),
      );
      expect(row).toBeDefined();

      const afterDisable = await caller.mutation(
        api.history.mutations.setStayInTouch,
        { meetingId, enabled: false },
      );
      expect(afterDisable.enabled).toBe(false);
      expect(afterDisable.mutual).toBe(false);

      status = await caller.query(api.history.queries.getStayInTouchStatus, {
        meetingId,
      });
      expect(status.enabled).toBe(false);
    });

    test("mutual flips true only when every participant has opted in (2-person meeting)", async () => {
      const { meetingId, organizerWorkosId, participantWorkosIds } =
        await createTestMeetingWithParticipants(t, {}, 1, {}, {});

      const host = identityFor(organizerWorkosId);
      const participant = identityFor(participantWorkosIds[0]);

      await host.mutation(api.history.mutations.setStayInTouch, {
        meetingId,
        enabled: true,
      });
      let status = await host.query(api.history.queries.getStayInTouchStatus, {
        meetingId,
      });
      expect(status.mutual).toBe(false);

      await participant.mutation(api.history.mutations.setStayInTouch, {
        meetingId,
        enabled: true,
      });
      status = await host.query(api.history.queries.getStayInTouchStatus, {
        meetingId,
      });
      expect(status.enabled).toBe(true);
      expect(status.mutual).toBe(true);
    });

    test("mutual flips true only when every participant has opted in (3-person meeting)", async () => {
      const { meetingId, organizerWorkosId, participantWorkosIds } =
        await createTestMeetingWithParticipants(t, {}, 2, {}, {});

      const host = identityFor(organizerWorkosId);
      const first = identityFor(participantWorkosIds[0]);
      const second = identityFor(participantWorkosIds[1]);

      await host.mutation(api.history.mutations.setStayInTouch, {
        meetingId,
        enabled: true,
      });
      await first.mutation(api.history.mutations.setStayInTouch, {
        meetingId,
        enabled: true,
      });
      let status = await host.query(api.history.queries.getStayInTouchStatus, {
        meetingId,
      });
      expect(status.mutual).toBe(false);

      await second.mutation(api.history.mutations.setStayInTouch, {
        meetingId,
        enabled: true,
      });
      status = await host.query(api.history.queries.getStayInTouchStatus, {
        meetingId,
      });
      expect(status.mutual).toBe(true);
    });

    test("refuses a non-participant and unauthenticated callers", async () => {
      const { meetingId } = await createTestMeetingWithParticipants(
        t,
        {},
        1,
        {},
        {},
      );
      const outsider = await createCompleteTestUser(t, {
        email: "outside-stayintouch@example.com",
        displayName: "Outsider",
      });

      await expect(
        identityFor(outsider.workosUserId).mutation(
          api.history.mutations.setStayInTouch,
          { meetingId, enabled: true },
        ),
      ).rejects.toThrow(/Access denied: Not a meeting participant/);

      await expect(
        identityFor(outsider.workosUserId).query(
          api.history.queries.getStayInTouchStatus,
          { meetingId },
        ),
      ).rejects.toThrow(/Access denied: Not a meeting participant/);

      await expect(
        t.query(api.history.queries.getStayInTouchStatus, { meetingId }),
      ).rejects.toThrow(/Authentication required/);
    });
  });

  describe("buildRecap", () => {
    const baseInput = (): RecapInput => ({
      meeting: {
        _id: "m1",
        title: "Recap Meeting",
        state: "concluded",
        scheduledAt: 1,
        duration: 60,
        createdAt: 0,
      },
      participants: [
        {
          userId: "u1",
          displayName: "Alice",
          role: "host",
          presence: "joined",
          joinedAt: 1,
          leftAt: 2,
        },
        {
          userId: "u2",
          displayName: "Bob",
          role: "participant",
          presence: "left",
          joinedAt: 1,
          leftAt: 2,
        },
      ],
      state: { startedAt: 60000, endedAt: 180000 },
      lifecycleEvents: [
        { _id: "e1", event: "meeting_started", timestamp: 10 },
        { _id: "e2", event: "meeting_ended", timestamp: 20 },
        { _id: "e3", event: "meeting_started", timestamp: 30 },
      ],
      notes: { content: "Shared notes verbatim", version: 7 },
      prompts: [
        {
          _id: "p1",
          content: "Used prompt",
          type: "precall",
          usedAt: 5,
          createdAt: 1,
        },
        {
          _id: "p2",
          content: "Unused prompt",
          type: "incall",
          usedAt: null,
          createdAt: 2,
        },
      ],
    });

    test("is deterministic: two builds are deeply equal", () => {
      const first = buildRecap(baseInput());
      const second = buildRecap(baseInput());
      expect(second).toEqual(first);
    });

    test("covers participants, duration, events, notes, and prompts verbatim", () => {
      const recap = buildRecap(baseInput());
      const byKind = new Map(recap.sections.map((s) => [s.kind, s]));

      const participants = byKind.get("participants");
      expect(participants?.items).toEqual([
        "Alice (host)",
        "Bob (participant)",
      ]);

      const duration = byKind.get("duration");
      expect(duration?.items).toEqual(["2 minutes"]);

      const events = byKind.get("lifecycleEvents");
      expect(events?.items).toEqual([
        "meeting_started \u00d72",
        "meeting_ended \u00d71",
      ]);

      const notes = byKind.get("notes");
      expect(notes?.items).toEqual(["Shared notes verbatim (version 7)"]);

      const used = byKind.get("prompts-used");
      expect(used?.items).toEqual(["Used prompt"]);
      const served = byKind.get("prompts-served");
      expect(served?.items).toEqual(["Unused prompt"]);

      expect(recap.sources).toEqual({
        participants: true,
        duration: true,
        lifecycleEvents: true,
        notes: true,
        prompts: true,
      });
    });

    test("never invents: empty inputs produce the literal not-recorded items", () => {
      const recap = buildRecap({
        meeting: {
          _id: "m2",
          title: "Empty Meeting",
          state: "scheduled",
          scheduledAt: null,
          duration: null,
          createdAt: 0,
        },
        participants: [],
        state: null,
        lifecycleEvents: [],
        notes: null,
        prompts: [],
      });

      const byKind = new Map(recap.sections.map((s) => [s.kind, s]));
      expect(byKind.get("duration")?.items).toEqual(["Not recorded"]);
      expect(byKind.get("notes")?.items).toEqual([
        "No notes were shared during this meeting",
      ]);
      expect(byKind.get("prompts-used")?.items).toEqual([
        "No prompts were recorded",
      ]);
      expect(recap.sources).toEqual({
        participants: false,
        duration: false,
        lifecycleEvents: false,
        notes: false,
        prompts: false,
      });
    });
  });
  describe("server-side flag gating (CONNVO_AFTER_CALL)", () => {
    test("listMyMeetings: refused when flag off, works when flag on", async () => {
      const { participantWorkosIds } = await createTestMeetingWithParticipants(
        t,
        {},
        1,
        {},
        {},
      );
      delete process.env.CONNVO_AFTER_CALL;
      await expect(
        identityFor(participantWorkosIds[0]).query(
          api.history.queries.listMyMeetings,
          { paginationOpts: { numItems: 10, cursor: null } },
        ),
      ).rejects.toThrow(/After-call history is disabled/);

      process.env.CONNVO_AFTER_CALL = "1";
      const page = await identityFor(participantWorkosIds[0]).query(
        api.history.queries.listMyMeetings,
        { paginationOpts: { numItems: 10, cursor: null } },
      );
      expect(page.isDone).toBe(true);
    });

    test("getMeetingHistory: refused when flag off, works when flag on", async () => {
      const { meetingId, participantWorkosIds } =
        await createTestMeetingWithParticipants(t, {}, 1, {}, {});
      delete process.env.CONNVO_AFTER_CALL;
      await expect(
        identityFor(participantWorkosIds[0]).query(
          api.history.queries.getMeetingHistory,
          { meetingId },
        ),
      ).rejects.toThrow(/After-call history is disabled/);

      process.env.CONNVO_AFTER_CALL = "1";
      const history = await identityFor(participantWorkosIds[0]).query(
        api.history.queries.getMeetingHistory,
        { meetingId },
      );
      expect(history.meeting._id).toBe(meetingId);
    });

    test("getStayInTouchStatus: refused when flag off, works when flag on", async () => {
      const { meetingId, participantWorkosIds } =
        await createTestMeetingWithParticipants(t, {}, 1, {}, {});
      delete process.env.CONNVO_AFTER_CALL;
      await expect(
        identityFor(participantWorkosIds[0]).query(
          api.history.queries.getStayInTouchStatus,
          { meetingId },
        ),
      ).rejects.toThrow(/After-call history is disabled/);

      process.env.CONNVO_AFTER_CALL = "1";
      const status = await identityFor(participantWorkosIds[0]).query(
        api.history.queries.getStayInTouchStatus,
        { meetingId },
      );
      expect(status.enabled).toBe(false);
      expect(status.mutual).toBe(false);
    });

    test("setStayInTouch: refused when flag off, works when flag on", async () => {
      const { meetingId, participantWorkosIds } =
        await createTestMeetingWithParticipants(t, {}, 1, {}, {});
      delete process.env.CONNVO_AFTER_CALL;
      await expect(
        identityFor(participantWorkosIds[0]).mutation(
          api.history.mutations.setStayInTouch,
          { meetingId, enabled: true },
        ),
      ).rejects.toThrow(/After-call history is disabled/);

      process.env.CONNVO_AFTER_CALL = "1";
      const after = await identityFor(participantWorkosIds[0]).mutation(
        api.history.mutations.setStayInTouch,
        { meetingId, enabled: true },
      );
      expect(after.enabled).toBe(true);
    });

    test("flag gate runs before identity: unauthenticated caller sees the flag error", async () => {
      const { meetingId } = await createTestMeetingWithParticipants(
        t,
        {},
        1,
        {},
        {},
      );
      delete process.env.CONNVO_AFTER_CALL;
      await expect(
        t.query(api.history.queries.getStayInTouchStatus, { meetingId }),
      ).rejects.toThrow(/After-call history is disabled/);
    });
  });

  describe("listMyMeetings pagination ordering", () => {
    test("globally newest-first across pages, no duplicates or gaps", async () => {
      const first = await createTestMeetingWithParticipants(
        t,
        {},
        1,
        { title: "Meeting 1" },
        {},
      );
      const hostUserId = first.participantIds[0];
      const hostWorkosId = first.participantWorkosIds[0];
      for (let i = 2; i <= 5; i++) {
        await createTestMeetingWithParticipants(
          t,
          {},
          0,
          { title: `Meeting ${i}` },
          {
            organizerOverride: { userId: hostUserId, workosUserId: hostWorkosId },
          },
        );
      }

      const caller = identityFor(hostWorkosId);
      const page1 = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 2, cursor: null },
      });
      const page2 = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 2, cursor: page1.continueCursor },
      });
      const page3 = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 2, cursor: page2.continueCursor },
      });

      expect(page1.page).toHaveLength(2);
      expect(page2.page).toHaveLength(2);
      expect(page3.page).toHaveLength(1);
      expect(page3.isDone).toBe(true);

      const all = [...page1.page, ...page2.page, ...page3.page];
      const ids = all.map((item: any) => item.meeting._id);
      expect(new Set(ids).size).toBe(5);

      // Exact global order: reverse of creation sequence, across page
      // boundaries — no duplicates, no gaps.
      expect(all.map((item: any) => item.meeting.title)).toEqual([
        "Meeting 5",
        "Meeting 4",
        "Meeting 3",
        "Meeting 2",
        "Meeting 1",
      ]);

      const createdAts = all.map((item: any) => item.meeting.createdAt);
      for (let i = 1; i < createdAts.length; i++) {
        expect(createdAts[i - 1]).toBeGreaterThanOrEqual(createdAts[i]);
      }
    });
  });

