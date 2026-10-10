/**
 * Stream webhook endpoint reproduction tests.
 *
 * These drive the REAL registered HTTP route (POST /webhooks/getstream) via
 * convex-test's `t.fetch`. They assert the FIXED behavior; on the pre-fix
 * baseline the negative tests fail, reproducing the defects:
 *  - unsigned webhooks are processed (signature verification is optional),
 *  - a retried session_ended schedules post-processing twice,
 *  - webhooks for unmapped calls return 500 so Stream retries forever,
 *  - a retried recording_ready inserts a duplicate meetingRecordings row.
 *
 * The "control" tests pass before AND after the fix and pin the legitimate
 * signed-delivery flow.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createTestEnvironment,
} from "../../../test/convex/helpers";

const SECRET = "whsec-test-secret-0123456789abcdef";
const ROOM = "room-xyz-123";

type TestEnv = ReturnType<typeof createTestEnvironment>;

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

function webhookBody(type: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type, call: { id: ROOM }, ...extra });
}

async function seedMeetingWithRoom(t: TestEnv) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const organizerId = await ctx.db.insert("users", {
      workosUserId: "organizer-subject",
      email: "organizer@example.com",
      displayName: "Organizer",
      orgId: "test-org",
      orgRole: "member",
      isActive: true,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.insert("meetings", {
      organizerId,
      title: "Webhook Test Meeting",
      state: "scheduled",
      streamRoomId: ROOM,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function scheduledJobCount(
  t: TestEnv,
  nameSubstring: string,
): Promise<number> {
  // _scheduled_functions is a system table: absent from the schema types but
  // queryable in the convex-test mock backend (which stores scheduled jobs
  // there, proven by the runtime behavior this suite asserts).
  const jobs = (await t.run(async (ctx) => {
    return await (ctx.db as unknown as { query: (n: string) => { collect: () => Promise<Array<{ name: string }>> } }["query"])("_scheduled_functions").collect();
  })) as Array<{ name: string }>;
  return jobs.filter((j) => j.name.includes(nameSubstring)).length;
}

describe("Stream webhook endpoint (signature-before-effect)", () => {
  let t: TestEnv;

  beforeEach(() => {
    t = createTestEnvironment();
    process.env.STREAM_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.STREAM_SECRET;
  });

  it("control: a validly signed webhook is accepted and applied", async () => {
    const meetingId = await seedMeetingWithRoom(t);
    const body = webhookBody("call.session_started");

    const res = await t.fetch("/webhooks/getstream", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sign(body) },
      body,
    });
    expect(res.status).toBe(200);

    const meeting = await t.run(async (ctx) => ctx.db.get(meetingId));
    expect(meeting?.state).toBe("active");
  });

  it("rejects webhooks without a signature header", async () => {
    await seedMeetingWithRoom(t);
    const res = await t.fetch("/webhooks/getstream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: webhookBody("call.session_started"),
    });
    expect(res.status).toBe(401);
  });

  it("replaying session_ended schedules post-processing exactly once", async () => {
    await seedMeetingWithRoom(t);
    const body = webhookBody("call.session_ended", {
      call_session: { id: "sess-1", duration_ms: 60000 },
    });
    const headers = {
      "content-type": "application/json",
      "x-signature": sign(body),
    };

    const first = await t.fetch("/webhooks/getstream", {
      method: "POST",
      headers,
      body,
    });
    expect(first.status).toBe(200);

    // Stream retries on 5xx / network errors; a redelivered webhook must not
    // schedule post-processing a second time.
    const replay = await t.fetch("/webhooks/getstream", {
      method: "POST",
      headers,
      body,
    });
    expect(replay.status).toBe(200);

    expect(await scheduledJobCount(t, "handleMeetingEnd")).toBe(1);
  });

  it("reports success for events about unmapped calls so Stream stops retrying", async () => {
    const body = JSON.stringify({
      type: "call.session_ended",
      call: { id: "no-such-room" },
      call_session: { id: "sess-404" },
    });

    const res = await t.fetch("/webhooks/getstream", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sign(body) },
      body,
    });
    expect(res.status).toBe(200);
  });

  it("replaying recording_ready does not duplicate the recording row", async () => {
    const meetingId = await seedMeetingWithRoom(t);
    const body = webhookBody("call.recording_ready", {
      call_recording: { id: "rec-1", url: "https://storage.example/rec/1" },
    });
    const headers = {
      "content-type": "application/json",
      "x-signature": sign(body),
    };

    expect((await t.fetch("/webhooks/getstream", { method: "POST", headers, body })).status).toBe(200);
    expect((await t.fetch("/webhooks/getstream", { method: "POST", headers, body })).status).toBe(200);

    const recordings = await t.run(async (ctx) =>
      ctx.db
        .query("meetingRecordings")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .collect(),
    );
    expect(recordings).toHaveLength(1);
  });
});
