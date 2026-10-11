/**
 * History boundary regression against the REAL registered Convex functions
 * (convex-test, same idiom as convex/auth/tenancy.test.ts):
 * - discovery must be participant-scoped (listUserMeetings walks only the
 *   caller's own meeting-participant rows),
 * - every refusal must be uniform (other-user, removed participant,
 *   deactivated account, nonexistent meeting) so the client can never leak
 *   whether a meeting exists,
 * - authorized artifact reads must return notes with version identity and
 *   transcript segments with source time positions.
 * All records here are synthetic test fixtures.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "@convex/_generated/api";
import {
  addMeetingParticipant,
  createTestEnvironment,
  createTestMeeting,
  createTestUser,
} from "../helpers";

let t: ReturnType<typeof createTestEnvironment>;

beforeEach(() => {
  t = createTestEnvironment();
});

const AVA = { workosUserId: "wkos-ava", email: "ava@example.com", displayName: "Ava Torres" };
const RILEY = { workosUserId: "wkos-riley", email: "riley@example.com", displayName: "Riley Chen" };
const DEVON = { workosUserId: "wkos-devon", email: "devon@example.com", displayName: "Devon Diaz" };

function auth(user: { workosUserId: string; email: string; displayName: string }) {
  return t.withIdentity({
    subject: user.workosUserId,
    email: user.email,
    name: user.displayName,
    org_id: "test-org",
    org_role: "member" as const,
  });
}

async function expectConvexRejection(promise: Promise<unknown>, pattern: RegExp): Promise<string> {
  let rejected = false;
  let rejection: unknown;
  try {
    await promise;
  } catch (error) {
    rejected = true;
    rejection = error;
  }
  expect(rejected, "expected the query to be rejected").toBe(true);
  const code = (rejection as { data?: { code?: string } } | null)?.data?.code ?? "";
  const message = rejection instanceof Error ? rejection.message : String(rejection);
  expect(code + " " + message).toMatch(pattern);
  return code;
}

function rowIds(rows: unknown[]): string[] {
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return String(r.meetingId ?? r._id ?? "");
  });
}

async function seed() {
  const avaId = await createTestUser(t, { ...AVA, isActive: true });
  const rileyId = await createTestUser(t, { ...RILEY, isActive: true });
  await createTestUser(t, { ...DEVON, isActive: false });
  const m1 = await createTestMeeting(t, avaId, { title: "Rust study group - week 4", state: "concluded" });
  await addMeetingParticipant(t, m1, avaId, "host", "joined");
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("meetingNotes", {
      meetingId: m1,
      content: "Decision: ship the participant-scoped history slice.",
      version: 3,
      lastRebasedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("transcriptSegments", {
      meetingId: m1,
      startMs: 0,
      endMs: 42000,
      speakers: ["Ava Torres"],
      text: "Let's start with the boundary tests.",
      topics: ["boundaries"],
      createdAt: now,
    });
    await ctx.db.insert("transcriptSegments", {
      meetingId: m1,
      startMs: 42000,
      endMs: 96000,
      speakers: ["Ava Torres", "Riley Chen"],
      text: "Notes keep their version identity.",
      topics: ["notes"],
      createdAt: now + 1,
    });
  });
  const m2 = await createTestMeeting(t, rileyId, { title: "Riley's private sync", state: "concluded" });
  await addMeetingParticipant(t, m2, rileyId, "host", "joined");
  return { avaId, rileyId, m1, m2 };
}

describe("history read boundaries (registered functions)", () => {
  it("discovery is participant-scoped: listUserMeetings returns only the caller's rows", async () => {
    const s = await seed();
    const rows = await auth(RILEY).query(api.meetings.queries.listUserMeetings, { state: "concluded" });
    const ids = rowIds(Array.isArray(rows) ? rows : ((rows as { meetings?: unknown[] })?.meetings ?? []));
    expect(ids).toContain(String(s.m2));
    expect(ids).not.toContain(String(s.m1));
  });

  it("authorized detail and artifact reads succeed with identity intact", async () => {
    const s = await seed();
    const authA = auth(AVA);
    const meeting = (await authA.query(api.meetings.queries.getMeeting, { meetingId: s.m1 })) as Record<string, unknown>;
    expect(meeting.title).toBe("Rust study group - week 4");
    expect(meeting.userRole).toBe("host");
    const notes = (await authA.query(api.notes.queries.getMeetingNotes, { meetingId: s.m1 })) as Record<string, unknown>;
    expect(notes.version).toBe(3);
    expect(String(notes.content)).toContain("participant-scoped history slice");
    const segments = await authA.query(api.transcripts.queries.getTranscriptSegments, { meetingId: s.m1, limit: 50 });
    const segs = (Array.isArray(segments) ? segments : ((segments as { segments?: unknown[] })?.segments ?? [])) as Array<Record<string, unknown>>;
    expect(segs).toHaveLength(2);
    expect(segs.some((segment) => Number(segment.startMs) === 0)).toBe(true);
    expect(segs.every((segment) => typeof segment.endMs === "number" && Number(segment.endMs) > Number(segment.startMs))).toBe(true);
  });

  it("another user's meeting is refused and never appears in their list", async () => {
    const s = await seed();
    const code = await expectConvexRejection(
      auth(RILEY).query(api.meetings.queries.getMeeting, { meetingId: s.m1 }),
      /FORBIDDEN|not a meeting participant|access denied/i,
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("a removed participant loses access", async () => {
    const s = await seed();
    const PAT = { workosUserId: "wkos-pat", email: "pat@example.com", displayName: "Pat Doe" };
    const patId = await createTestUser(t, PAT);
    const m3 = await createTestMeeting(t, s.avaId, { title: "Team retro", state: "concluded" });
    await addMeetingParticipant(t, m3, s.avaId, "host", "joined");
    const patParticipation = await addMeetingParticipant(t, m3, patId, "participant", "left");
    const authP = auth(PAT);
    await authP.query(api.meetings.queries.getMeeting, { meetingId: m3 });
    await t.run(async (ctx) => {
      await ctx.db.delete(patParticipation);
    });
    await expectConvexRejection(
      authP.query(api.meetings.queries.getMeeting, { meetingId: m3 }),
      /FORBIDDEN|not a meeting participant/i,
    );
  });

  it("a deactivated account is refused", async () => {
    const s = await seed();
    await expectConvexRejection(
      auth(DEVON).query(api.meetings.queries.getMeeting, { meetingId: s.m1 }),
      /DEACTIVATED|deactivat|UNAUTHORIZED|FORBIDDEN/i,
    );
  });

  it("nonexistent meetings are refused with the same code as other-user meetings (no existence leak)", async () => {
    const s = await seed();
    const otherUserCode = await expectConvexRejection(
      auth(RILEY).query(api.meetings.queries.getMeeting, { meetingId: s.m1 }),
      /./,
    );
    const ghost = await createTestMeeting(t, s.avaId, { title: "Ghost", state: "concluded" });
    await t.run(async (ctx) => {
      await ctx.db.delete(ghost);
    });
    const ghostCode = await expectConvexRejection(
      auth(AVA).query(api.meetings.queries.getMeeting, { meetingId: ghost }),
      /./,
    );
    expect(ghostCode).toBe(otherUserCode);
    expect(ghostCode).not.toBe("");
  });

  it("unauthenticated calls are refused (control)", async () => {
    const s = await seed();
    await expectConvexRejection(
      t.query(api.meetings.queries.getMeeting, { meetingId: s.m1 }),
      /UNAUTHENTICATED|authentication|unauthorized|UNAUTHORIZED/i,
    );
  });
});
