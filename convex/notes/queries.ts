/**
 * Notes Query Functions (Minimal for Insights)
 *
 * This module provides basic notes queries needed for insights generation.
 * Full notes functionality is implemented in other tasks.
 */

import { internalQuery } from "@convex/_generated/server";
import { v } from "convex/values";
import { NoteV } from "@convex/types/validators/note";
import type { MeetingNote } from "@convex/types/entities/note";

/**
 * Gets meeting notes (internal use)
 */
export const getMeetingNotes = internalQuery({
  args: {
    meetingId: v.id("meetings"),
  },
  returns: v.union(NoteV.meetingNote, v.null()),
  handler: async (ctx, { meetingId }): Promise<MeetingNote | null> => {
    const note = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    // Return the note directly - it already matches the MeetingNote type
    return note;
  },
});
