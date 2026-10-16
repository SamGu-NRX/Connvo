import { describe, expect, it } from "vitest";
import { validate } from "convex-helpers/validators";
import { createTestEnvironment } from "../../test/convex/helpers";
import { storedProfileV } from "./queries";

// convex-test does not check return validators, so check the stored document
// against the one getCurrentUserProfile declares. When they disagree, the
// query throws for everyone with a profile: the Profile page loads empty and
// the recap's block/report menu never appears.
describe("storedProfileV", () => {
  it("accepts a profile document as the database stores it", async () => {
    const t = createTestEnvironment();
    const doc = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        workosUserId: "Alice",
        email: "alice@example.com",
        displayName: "Alice",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const id = await ctx.db.insert("profiles", {
        userId,
        displayName: "Alice",
        languages: [],
        intents: ["peers"],
        timezone: "America/Chicago",
        chatsPerWeek: 2,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.get(id);
    });
    expect(validate(storedProfileV, doc)).toBe(true);
  });
});
