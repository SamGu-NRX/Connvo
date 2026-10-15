/**
 * After-call Connect tests (docs/plan/MATCHING-PLAN.md, "After the call").
 *
 * Adversarial coverage for the parts where a bug would leak private choices
 * or fabricate relationships: mutuality of connections, invisibility of a
 * lone tap, per-person feedback isolation, and participant-only access.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  addMeetingParticipant,
  cleanupTestMocks,
  createCompleteTestUser,
  createTestEnvironment,
  createTestInterest,
  createTestMeeting,
  resetAllMocks,
  setupTestMocks,
} from "../../test/convex/helpers";

let t: ReturnType<typeof createTestEnvironment>;

beforeEach(() => {
  t = createTestEnvironment();
  setupTestMocks();
  resetAllMocks();
});

afterEach(() => {
  cleanupTestMocks();
});

/** An authenticated caller context for a test user. */
function asUser(
  user: { workosUserId: string; email?: string; displayName?: string },
  overrides: Partial<{ email: string; displayName: string }> = {},
) {
  return t.withIdentity({
    subject: user.workosUserId,
    email: overrides.email ?? user.email ?? "user@example.com",
    name: overrides.displayName ?? user.displayName ?? "Test User",
    org_id: "test-org",
    org_role: "member" as const,
  });
}

/** Two users who both took part in one concluded meeting. */
async function makePair() {
  const a = await createCompleteTestUser(
    t,
    { email: "ada@example.com", displayName: "Ada Quinn" },
    { jobTitle: "Engineer", company: "Acme" },
    ["software-engineering"],
  );
  const b = await createCompleteTestUser(
    t,
    { email: "bo@example.com", displayName: "Bo Rivera" },
    { jobTitle: "Designer", company: "Globex" },
    ["software-engineering", "design"],
  );
  const meetingId = await createTestMeeting(t, a.userId, {
    state: "concluded",
  });
  await addMeetingParticipant(t, meetingId, a.userId, "host", "left");
  await addMeetingParticipant(t, meetingId, b.userId, "participant", "left");
  return { a, b, meetingId };
}

async function connectionRows(): Promise<
  Array<{ userLow: Id<"users">; userHigh: Id<"users"> }>
> {
  return await t.run(async (ctx) => ctx.db.query("connections").collect());
}

describe("recordTalkAgainFeedback", () => {
  test("stores the answer and the optional reasons", async () => {
    const { a, meetingId } = await makePair();
    const caller = asUser(a);

    const result = await caller.mutation(
      api.network.mutations.recordTalkAgainFeedback,
      { meetingId, talkAgain: false, reasons: ["  Bad timing  ", ""] },
    );

    expect(result).toEqual({ talkAgain: false, reasons: ["Bad timing"] });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("meetingFeedback").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      meetingId,
      userId: a.userId,
      talkAgain: false,
      reasons: ["Bad timing"],
    });
  });

  test("keeps one row per person per meeting and keeps the latest answer", async () => {
    const { a, meetingId } = await makePair();
    const caller = asUser(a);

    await caller.mutation(api.network.mutations.recordTalkAgainFeedback, {
      meetingId,
      talkAgain: false,
      reasons: ["Bad timing"],
    });
    const second = await caller.mutation(
      api.network.mutations.recordTalkAgainFeedback,
      { meetingId, talkAgain: true },
    );

    expect(second).toEqual({ talkAgain: true, reasons: [] });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("meetingFeedback").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ talkAgain: true, reasons: [] });
  });

  test("refuses someone who did not take part in the meeting", async () => {
    const { meetingId } = await makePair();
    const outsider = await createCompleteTestUser(t, {
      email: "outsider@example.com",
      displayName: "Out Sider",
    });

    await expect(
      asUser(outsider).mutation(api.network.mutations.recordTalkAgainFeedback, {
        meetingId,
        talkAgain: true,
      }),
    ).rejects.toThrow(/Access denied/i);
  });

  test("refuses an unauthenticated caller without revealing whether the meeting exists", async () => {
    const { meetingId } = await makePair();
    // A well-formed id for a meeting that does not exist: Convex ids encode
    // the table name at the tail, so flip the leading character — that only
    // scrambles the random portion and leaves the meetings suffix intact.
    const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    const fakeMeetingId =
      alphabet[(alphabet.indexOf(meetingId[0]) + 1) % alphabet.length] +
      meetingId.slice(1);
    await expect(
      t.mutation(api.network.mutations.recordTalkAgainFeedback, {
        meetingId: meetingId,
        talkAgain: true,
      }),
    ).rejects.toThrow(/Authentication required/i);
    await expect(
      t.mutation(api.network.mutations.recordTalkAgainFeedback, {
        meetingId: fakeMeetingId as Id<"meetings">,
        talkAgain: true,
      }),
    ).rejects.toThrow(/Authentication required/i);
  });
});

describe("connectWith", () => {
  test("creates a connection only when both people tap, exactly once", async () => {
    const { a, b, meetingId } = await makePair();
    const asA = asUser(a);
    const asB = asUser(b);

    await asA.mutation(api.network.mutations.connectWith, { meetingId });
    expect(await connectionRows()).toHaveLength(0);

    const first = await asB.mutation(api.network.mutations.connectWith, {
      meetingId,
    });
    expect(first.connectedWith).toEqual([a.userId]);

    const rows = await connectionRows();
    expect(rows).toHaveLength(1);
    const [low, high] = [a.userId, b.userId].sort();
    expect(rows[0]).toMatchObject({ userLow: low, userHigh: high });

    // Repeat taps change nothing: still exactly one connection.
    await asA.mutation(api.network.mutations.connectWith, { meetingId });
    await asB.mutation(api.network.mutations.connectWith, { meetingId });
    expect(await connectionRows()).toHaveLength(1);
  });

  test("keeps a lone tap invisible to the other person", async () => {
    const { a, b, meetingId } = await makePair();
    const asA = asUser(a);
    const asB = asUser(b);

    await asA.mutation(api.network.mutations.connectWith, { meetingId });

    const seenByA = await asA.query(
      api.network.queries.getMeetingAfterCallState,
      { meetingId },
    );
    expect(seenByA).toEqual({
      feedback: null,
      connectTapped: true,
      connected: false,
    });

    // B sees none of A's tap — only B's own (empty) state.
    const seenByB = await asB.query(
      api.network.queries.getMeetingAfterCallState,
      { meetingId },
    );
    expect(seenByB).toEqual({
      feedback: null,
      connectTapped: false,
      connected: false,
    });
  });

  test("refuses someone who did not take part in the meeting", async () => {
    const { meetingId } = await makePair();
    const outsider = await createCompleteTestUser(t, {
      email: "outsider2@example.com",
      displayName: "Out Sider Two",
    });

    await expect(
      asUser(outsider).mutation(api.network.mutations.connectWith, {
        meetingId,
      }),
    ).rejects.toThrow(/Access denied/i);
    expect(await connectionRows()).toHaveLength(0);
  });
});

describe("getMeetingAfterCallState", () => {
  test("returns the caller's own answer without exposing the other person's", async () => {
    const { a, b, meetingId } = await makePair();
    const asA = asUser(a);
    const asB = asUser(b);

    await asA.mutation(api.network.mutations.recordTalkAgainFeedback, {
      meetingId,
      talkAgain: false,
      reasons: ["Not a good fit"],
    });

    const seenByA = await asA.query(
      api.network.queries.getMeetingAfterCallState,
      { meetingId },
    );
    expect(seenByA.feedback).toEqual({
      talkAgain: false,
      reasons: ["Not a good fit"],
    });

    const seenByB = await asB.query(
      api.network.queries.getMeetingAfterCallState,
      { meetingId },
    );
    expect(seenByB.feedback).toBeNull();
  });
});

describe("listMyConnections", () => {
  test("lists the other person with role, company, shared interests, and the meeting where they met", async () => {
    await createTestInterest(t, "software-engineering", "Software Engineering");
    await createTestInterest(t, "design", "Design");
    const { a, b, meetingId } = await makePair();
    const asA = asUser(a);
    const asB = asUser(b);

    await asA.mutation(api.network.mutations.connectWith, { meetingId });
    await asB.mutation(api.network.mutations.connectWith, { meetingId });

    const aNetwork = await asA.query(api.network.queries.listMyConnections, {});
    expect(aNetwork).toHaveLength(1);
    const connection = aNetwork.find((c) => c.userId === b.userId);
    expect(connection).toMatchObject({
      userId: b.userId,
      name: "Bo Rivera",
      jobTitle: "Designer",
      company: "Globex",
      sharedInterests: ["Software Engineering"],
      meetingId,
    });
    expect(connection?.metAt).toBeTypeOf("number");

    // The connection reads the same from the other side.
    const bNetwork = await asB.query(api.network.queries.listMyConnections, {});
    expect(bNetwork).toHaveLength(1);
    expect(bNetwork[0]).toMatchObject({ userId: a.userId, name: "Ada Quinn" });
  });

  test("never shows someone else's connections", async () => {
    const { a, b, meetingId } = await makePair();
    const asA = asUser(a);
    const asB = asUser(b);

    await asA.mutation(api.network.mutations.connectWith, { meetingId });
    await asB.mutation(api.network.mutations.connectWith, { meetingId });

    const outsider = await createCompleteTestUser(t, {
      email: "outsider3@example.com",
      displayName: "Out Sider Three",
    });
    const network = await asUser(outsider).query(
      api.network.queries.listMyConnections,
      {},
    );
    expect(network).toHaveLength(0);
  });
});
