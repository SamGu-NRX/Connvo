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

      // Newest-first by MEETING time: the older meeting's participant row
      // was created last (late join) yet must sort after the later meeting.
      expect(titles).toEqual(["My Meeting", "Older Meeting"]);
      const scheduled = page.page.map((item: any) => item.meeting.scheduledAt);
      for (let i = 1; i < scheduled.length; i++) {
        expect(scheduled[i - 1]).toBeGreaterThanOrEqual(scheduled[i]);
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
      // The scan reads one meeting past a full page, so the page that takes
      // the last meeting already knows nothing is left.
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

      // Shape-agnostic: works for a raw ConvexError (data envelope), for
      // re-thrown wrappers carrying code/message directly, and for the
      // serialized-envelope forms convex-test can produce.
      const catchData = (error: unknown): { code?: string; message?: string } => {
        const anyError = error as {
          data?: { code?: string; message?: string };
          code?: string;
          message?: string;
        };
        const direct = anyError.data ?? anyError;
        if (direct?.code) return { code: direct.code, message: direct.message };
        // The payload may be serialized into the error message (optionally
        // behind a prefix). Recover the envelope when present.
        const text = anyError.message ?? "";
        const start = text.indexOf("{");
        if (start >= 0) {
          try {
            const end = text.lastIndexOf("}");
            const parsed = JSON.parse(text.slice(start, end + 1)) as {
              data?: { code?: string; message?: string };
              code?: string;
              message?: string;
            };
            const fromMessage = parsed?.data ?? parsed;
            if (fromMessage?.code) {
              return { code: fromMessage.code, message: fromMessage.message };
            }
          } catch {
            // Not a JSON envelope — fall through to the plain fields.
          }
        }
        return { code: direct?.code, message: direct?.message || text };
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
      // The refusal must be the forbidden access-denied error; accept the
      // envelope shape convex-test actually delivers.
      expect(
        nonParticipantData.code === "FORBIDDEN" ||
          (nonParticipantData.message ?? "").includes(
            "Not a meeting participant",
          ),
      ).toBe(true);

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
      expect(
        nonexistentData.code === "FORBIDDEN" ||
          (nonexistentData.message ?? "").includes(
            "Not a meeting participant",
          ),
      ).toBe(true);

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
      expect(status.contacts).toEqual([]);

      const afterEnable = await caller.mutation(
        api.history.mutations.setStayInTouch,
        { meetingId, enabled: true },
      );
      expect(afterEnable.enabled).toBe(true);
      expect(afterEnable.contacts).toEqual([]);

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
      expect(afterDisable.contacts).toEqual([]);

      status = await caller.query(api.history.queries.getStayInTouchStatus, {
        meetingId,
      });
      expect(status.enabled).toBe(false);
    });

    test("two people: a contact shows only once both opted in, and never before the caller's own opt-in", async () => {
      const { meetingId, organizerWorkosId, participantWorkosIds } =
        await createTestMeetingWithParticipants(t, {}, 1, {}, {});
      const host = identityFor(organizerWorkosId);
      const participant = identityFor(participantWorkosIds[0]);

      // The participant opts in first: the host, not opted in, sees nothing.
      const mine = await participant.mutation(api.history.mutations.setStayInTouch, {
        meetingId,
        enabled: true,
      });
      expect(mine.contacts).toEqual([]);
      let hostView = await host.query(api.history.queries.getStayInTouchStatus, { meetingId });
      expect(hostView).toEqual({ enabled: false, contacts: [] });

      // Both opted in: each sees the other, and only the other.
      hostView = await host.mutation(api.history.mutations.setStayInTouch, {
        meetingId,
        enabled: true,
      });
      const participantView = await participant.query(api.history.queries.getStayInTouchStatus, {
        meetingId,
      });
      expect(hostView.contacts).toHaveLength(1);
      expect(participantView.contacts).toHaveLength(1);
      expect(hostView.contacts[0].email).not.toBe(participantView.contacts[0].email);

      // Withdrawing hides the contact again from the other side.
      await participant.mutation(api.history.mutations.setStayInTouch, {
        meetingId,
        enabled: false,
      });
      hostView = await host.query(api.history.queries.getStayInTouchStatus, { meetingId });
      expect(hostView).toEqual({ enabled: true, contacts: [] });
    });

    test("three people: pairwise, each sees exactly the others who opted in too", async () => {
      const { meetingId, organizerWorkosId, participantWorkosIds } =
        await createTestMeetingWithParticipants(t, {}, 2, {}, {});
      const host = identityFor(organizerWorkosId);
      const first = identityFor(participantWorkosIds[0]);
      const second = identityFor(participantWorkosIds[1]);

      await host.mutation(api.history.mutations.setStayInTouch, { meetingId, enabled: true });
      await first.mutation(api.history.mutations.setStayInTouch, { meetingId, enabled: true });
      let hostView = await host.query(api.history.queries.getStayInTouchStatus, { meetingId });
      expect(hostView.contacts).toHaveLength(1);
      const secondView = await second.query(api.history.queries.getStayInTouchStatus, { meetingId });
      expect(secondView).toEqual({ enabled: false, contacts: [] });

      await second.mutation(api.history.mutations.setStayInTouch, { meetingId, enabled: true });
      hostView = await host.query(api.history.queries.getStayInTouchStatus, { meetingId });
      expect(hostView.contacts).toHaveLength(2);
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
          usedAt: undefined,
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
      expect(status.contacts).toEqual([]);
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
        { title: "Meeting 1", scheduledAt: 1000 },
        {},
      );
      const hostUserId = first.participantIds[0];
      const hostWorkosId = first.participantWorkosIds[0];
      for (let i = 2; i <= 5; i++) {
        await createTestMeetingWithParticipants(
          t,
          {},
          0,
          { title: `Meeting ${i}`, scheduledAt: i * 1000 },
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

      // Ordered by meeting time, not participant-row creation.
      const scheduled = all.map((item: any) => item.meeting.scheduledAt);
      for (let i = 1; i < scheduled.length; i++) {
        expect(scheduled[i - 1]).toBeGreaterThan(scheduled[i]);
      }    });

    test("late join: a participant row created last on an older meeting sorts by meeting time", async () => {
      // The caller joins the LATER meeting first, then an OLD meeting:
      // their newest participant row belongs to the older meeting, yet the
      // list must still order by the meeting's own time.
      const later = await createTestMeetingWithParticipants(
        t,
        {},
        1,
        { title: "Later Meeting", scheduledAt: 9000, duration: 600 },
        {},
      );
      await createTestMeetingWithParticipants(
        t,
        {},
        0,
        { title: "Older Meeting", scheduledAt: 400, duration: 600 },
        {
          organizerOverride: {
            userId: later.participantIds[0],
            workosUserId: later.participantWorkosIds[0],
          },
        },
      );

      const caller = identityFor(later.participantWorkosIds[0]);
      const page = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(page.page.map((item: any) => item.meeting.title)).toEqual([
        "Later Meeting",
        "Older Meeting",
      ]);
    });

    test("stable keyset cursor: insertion after page 1 shows up eventually and never duplicates (review race)", async () => {
      // Directed sequence: B and C exist; page 1 returns B with a cursor
      // keyed on B's meeting time + id; a newer meeting A then arrives;
      // page 2 from that cursor returns C and never B again, and A shows
      // up on the next fresh walk instead of being hidden by the race.
      const b = await createTestMeetingWithParticipants(
        t,
        {},
        1,
        { title: "Meeting B", scheduledAt: 2000, duration: 600 },
        {},
      );
      const hostUserId = b.participantIds[0];
      const hostWorkosId = b.participantWorkosIds[0];
      await createTestMeetingWithParticipants(
        t,
        {},
        0,
        { title: "Meeting C", scheduledAt: 1000, duration: 600 },
        {
          organizerOverride: { userId: hostUserId, workosUserId: hostWorkosId },
        },
      );

      const caller = identityFor(hostWorkosId);
      const page1 = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 1, cursor: null },
      });
      expect(page1.page.map((item: any) => item.meeting.title)).toEqual([
        "Meeting B",
      ]);
      expect(page1.isDone).toBe(false);

      // A newer meeting A arrives AFTER page 1 was served.
      await createTestMeetingWithParticipants(
        t,
        {},
        0,
        { title: "Meeting A", scheduledAt: 3000, duration: 600 },
        {
          organizerOverride: { userId: hostUserId, workosUserId: hostWorkosId },
        },
      );

      // Page 2 from B's keyset cursor: C is next; B never repeats.
      const page2 = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 1, cursor: page1.continueCursor },
      });
      expect(page2.page.map((item: any) => item.meeting.title)).toEqual([
        "Meeting C",
      ]);
      const page3 = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 1, cursor: page2.continueCursor },
      });
      expect(page3.page).toHaveLength(0);
      expect(page3.isDone).toBe(true);

      // A is not lost: a fresh walk from the top surfaces it, and a full
      // page shows every meeting exactly once in meeting-time order.
      const fresh1 = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 1, cursor: null },
      });
      expect(fresh1.page.map((item: any) => item.meeting.title)).toEqual([
        "Meeting A",
      ]);
      const full = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(full.page.map((item: any) => item.meeting.title)).toEqual([
        "Meeting A",
        "Meeting B",
        "Meeting C",
      ]);
      expect(full.isDone).toBe(true);
    });
  });

  describe("listMyMeetings cursor (review of dc593f8)", () => {
    /** Meetings the caller (host of the first fixture) also organizes. */
    async function hostWith(meetings: Array<{ title: string; scheduledAt?: number }>) {
      const first = await createTestMeetingWithParticipants(t, {}, 1, meetings[0], {});
      const host = { userId: first.participantIds[0], workosUserId: first.participantWorkosIds[0] };
      const ids: Record<string, Id<"meetings">> = { [meetings[0].title]: first.meetingId };
      for (const m of meetings.slice(1)) {
        const made = await createTestMeetingWithParticipants(t, {}, 0, m, { organizerOverride: host });
        ids[m.title] = made.meetingId;
      }
      return { caller: identityFor(host.workosUserId), ids, host };
    }

    /** Every page at the given size, until isDone (with a safety bound). */
    async function walk(caller: ReturnType<typeof identityFor>, numItems: number) {
      const titles: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 20; i++) {
        const page: any = await caller.query(api.history.queries.listMyMeetings, {
          paginationOpts: { numItems, cursor },
        });
        titles.push(...page.page.map((item: any) => item.meeting.title));
        if (page.isDone) return titles;
        cursor = page.continueCursor;
      }
      throw new Error(`no isDone after 20 pages: ${titles.join(",")}`);
    }

    test("unscheduled meetings only, one per page: each once, newest created first", async () => {
      const { caller } = await hostWith([
        { title: "U1", scheduledAt: undefined },
        { title: "U2", scheduledAt: undefined },
        { title: "U3", scheduledAt: undefined },
      ]);
      expect(await walk(caller, 1)).toEqual(["U3", "U2", "U1"]);
    });

    test("scheduled then unscheduled, one per page: S, then the unscheduled ones, no repeat", async () => {
      const { caller } = await hostWith([
        { title: "S", scheduledAt: 5000 },
        { title: "U1", scheduledAt: undefined },
        { title: "U2", scheduledAt: undefined },
      ]);
      expect(await walk(caller, 1)).toEqual(["S", "U2", "U1"]);
    });

    test("equal meeting times: deleting the row the cursor points at repeats nothing", async () => {
      const { caller, ids } = await hostWith([
        { title: "A", scheduledAt: 7000 },
        { title: "B", scheduledAt: 7000 },
        { title: "C", scheduledAt: 7000 },
      ]);
      const page1: any = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 2, cursor: null },
      });
      const first = page1.page.map((item: any) => item.meeting.title);
      expect(first).toEqual(["C", "B"]);
      // The meeting the cursor points at goes away between pages.
      await t.run(async (ctx) => {
        await ctx.db.delete(ids[first[1]]);
      });
      const page2: any = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 2, cursor: page1.continueCursor },
      });
      expect(page2.page.map((item: any) => item.meeting.title)).toEqual(["A"]);
      expect(page2.isDone).toBe(true);
    });

    test("a newer meeting arriving mid-scroll is neither repeated nor makes older ones repeat", async () => {
      const { caller, host } = await hostWith([
        { title: "M3", scheduledAt: 3000 },
        { title: "M2", scheduledAt: 2000 },
        { title: "M1", scheduledAt: 1000 },
      ]);
      const page1: any = await caller.query(api.history.queries.listMyMeetings, {
        paginationOpts: { numItems: 1, cursor: null },
      });
      expect(page1.page.map((item: any) => item.meeting.title)).toEqual(["M3"]);
      await createTestMeetingWithParticipants(t, {}, 0, { title: "M4", scheduledAt: 4000 }, {
        organizerOverride: host,
      });
      const rest: string[] = [];
      let cursor = page1.continueCursor;
      for (let i = 0; i < 5; i++) {
        const page: any = await caller.query(api.history.queries.listMyMeetings, {
          paginationOpts: { numItems: 1, cursor },
        });
        rest.push(...page.page.map((item: any) => item.meeting.title));
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      expect(rest).toEqual(["M2", "M1"]);
      expect(await walk(caller, 2)).toEqual(["M4", "M3", "M2", "M1"]);
    });
  });
});