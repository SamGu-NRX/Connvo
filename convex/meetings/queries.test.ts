/**
 * Tests for listMeetingParticipantNames (convex/meetings/queries.ts) on a
 * real in-memory Convex runtime via convex-test.
 *
 * The call tiles and the lobby trust this query for who is in the meeting,
 * so the adversarial cases are the privacy ones: a signed-in user who is
 * not a participant reads nothing, and the query hands out exactly an id
 * and a display name — never an email or another private field.
 */

import { describe, expect, it } from "vitest";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createTestEnvironment } from "../../test/convex/helpers";

type TestServer = ReturnType<typeof createTestEnvironment>;

/** Alice and Bob share an active meeting; Mallory is signed in but nobody in it. */
async function seedMeeting(t: TestServer): Promise<Id<"meetings">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const mk = async (name: string, displayName: string) =>
      ctx.db.insert("users", {
        workosUserId: name,
        email: `${name.toLowerCase()}@example.com`,
        displayName,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const aliceId = await mk("Alice", "Alice Anderson");
    const bobId = await mk("Bob", "Bob Brown");
    await mk("Mallory", "Mallory Reed");

    const meetingId = await ctx.db.insert("meetings", {
      organizerId: aliceId,
      title: "Connvo match: Alice & Bob",
      scheduledAt: now,
      duration: 30 * 60_000,
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId: aliceId,
      role: "host",
      presence: "joined",
      joinedAt: now,
      createdAt: now,
    });
    await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId: bobId,
      role: "participant",
      presence: "invited",
      createdAt: now,
    });
    return meetingId;
  });
}

describe("listMeetingParticipantNames", () => {
  it("refuses a signed-in user who is not a meeting participant", async () => {
    const t = createTestEnvironment();
    const meetingId = await seedMeeting(t);
    const mallory = t.withIdentity({ subject: "Mallory" });

    await expect(
      mallory.query(api.meetings.queries.listMeetingParticipantNames, {
        meetingId,
      }),
    ).rejects.toThrow(/Access denied|not a meeting participant/i);
  });

  it("returns only each participant's call id and display name, never an email or another private field", async () => {
    const t = createTestEnvironment();
    const meetingId = await seedMeeting(t);
    const alice = t.withIdentity({ subject: "Alice" });

    const names = await alice.query(
      api.meetings.queries.listMeetingParticipantNames,
      { meetingId },
    );

    expect(names).toEqual([
      { id: "Alice", displayName: "Alice Anderson" },
      { id: "Bob", displayName: "Bob Brown" },
    ]);
    // The exact row shape: no email, avatar, org, role or presence leaks
    // alongside the name.
    for (const row of names) {
      expect(Object.keys(row).sort()).toEqual(["displayName", "id"]);
    }
    expect(JSON.stringify(names)).not.toContain("@example.com");
  });
});
