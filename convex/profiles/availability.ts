/**
 * Matching preferences and weekly free time (cv6-profile-availability).
 *
 * Every function is scoped to the signed-in user: there is no way to read or
 * write another person's preferences or availability through these, and the
 * matcher packet reads the tables directly in internal functions.
 */

import { mutation, query, type MutationCtx } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity } from "@convex/auth/guards";
import { createError } from "@convex/lib/errors";
import { Id } from "@convex/_generated/dataModel";
import {
  chatsPerWeekV,
  intentsV,
  isValidTimeZone,
  MAX_BLOCKS_PER_WEEK,
  normalizeWeeklyBlocks,
  weeklyBlockFields,
  weeklyBlockProblem,
  weeklyBlockV,
} from "@convex/lib/availability";

/**
 * Finds the caller's profile or creates an empty one, mirroring how
 * convex/profiles/mutations.ts auto-creates on first write.
 */
async function ensureProfile(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Id<"profiles">> {
  const existing = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (existing) return existing._id;
  const user = await ctx.db.get(userId);
  const now = Date.now();
  return await ctx.db.insert("profiles", {
    userId,
    displayName: user?.displayName || user?.email?.split("@")[0] || "User",
    languages: [],
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Sets what the caller wants from conversations and how often: goals (at
 * most three, no duplicates), IANA timezone, and chats per week (0 pauses
 * matching). Fields left out keep their current value.
 */
export const setChatPreferences = mutation({
  args: {
    intents: v.optional(intentsV),
    timezone: v.optional(v.string()),
    chatsPerWeek: v.optional(chatsPerWeekV),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const identity = await requireIdentity(ctx);

    if (args.intents !== undefined) {
      const unique = new Set(args.intents);
      if (unique.size !== args.intents.length) {
        throw createError.validation("Each goal can only be picked once");
      }
      if (args.intents.length > 3) {
        throw createError.validation("Pick at most three goals");
      }
    }
    if (args.timezone !== undefined && !isValidTimeZone(args.timezone)) {
      throw createError.validation("That is not a timezone we know");
    }

    const profileId = await ensureProfile(ctx, identity.userId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.intents !== undefined) patch.intents = args.intents;
    if (args.timezone !== undefined) patch.timezone = args.timezone;
    if (args.chatsPerWeek !== undefined) {
      patch.chatsPerWeek = args.chatsPerWeek;
    }
    await ctx.db.patch(profileId, patch);
    return null;
  },
});

/**
 * The caller's conversation goals, timezone and cadence, or null before
 * they are set. Returns null when signed out so clients can subscribe
 * safely during logged-out states, like getCurrentUserProfile does.
 */
export const getMyChatPreferences = query({
  args: {},
  returns: v.union(
    v.object({
      intents: v.optional(intentsV),
      timezone: v.optional(v.string()),
      chatsPerWeek: v.optional(chatsPerWeekV),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", identity.subject))
      .unique();
    if (!user) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) return null;
    return {
      intents: profile.intents,
      timezone: profile.timezone,
      chatsPerWeek: profile.chatsPerWeek,
    };
  },
});

/**
 * Replaces the caller's whole week of free time. Sending the full grid
 * makes retries safe: the same call twice stores the same thing. Blocks are
 * validated (30-minute steps, inside one day) and merged, so overlaps and
 * duplicates never reach the matcher. Returns how many blocks were stored.
 */
export const replaceAvailability = mutation({
  args: { blocks: v.array(weeklyBlockV) },
  returns: v.number(),
  handler: async (ctx, { blocks }): Promise<number> => {
    const identity = await requireIdentity(ctx);

    if (blocks.length > MAX_BLOCKS_PER_WEEK) {
      throw createError.validation(
        "That is more free time than a week has slots for",
      );
    }
    blocks.forEach((block) => {
      const problem = weeklyBlockProblem(block);
      if (problem) throw createError.validation(problem);
    });
    const normalized = normalizeWeeklyBlocks(blocks);

    const existing = await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    for (const block of normalized) {
      await ctx.db.insert("availabilityBlocks", {
        userId: identity.userId,
        weekday: block.weekday,
        startMinute: block.startMinute,
        endMinute: block.endMinute,
      });
    }
    return normalized.length;
  },
});

/**
 * The caller's own free time; there is no query for anyone else's.
 */
export const getMyAvailability = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("availabilityBlocks"),
      ...weeklyBlockFields,
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", identity.subject))
      .unique();
    if (!user) return [];
    return await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
      .then((rows) =>
        rows.map(({ _id, weekday, startMinute, endMinute }) => ({
          _id,
          weekday,
          startMinute,
          endMinute,
        })),
      );
  },
});
