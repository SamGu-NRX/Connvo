/**
 * Notes Query Functions (Minimal for Insights)
 *
 * This module provides basic notes queries needed for insights generation.
 * Full notes functionality is implemented in other tasks.
 */

import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Gets meeting notes (internal use)
 */
export const getMeetingNotes = internalQuery({
  args: {
    meetingId: v.id("meetings"),
  },
  returns: v.union(
    v.object({
      _id: v.id("meetingNotes"),
      meetingId: v.id("meetings"),
      content: v.string(),
      version: v.number(),
      lastRebasedAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { meetingId }) => {
    const note = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();
    if (!note) return null;
    return {
      _id: note._id,
      meetingId: note.meetingId,
      content: note.content,
      version: note.version,
      lastRebasedAt: note.lastRebasedAt,
      updatedAt: note.updatedAt,
    };
  },
});
