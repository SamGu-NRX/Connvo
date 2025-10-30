/**
 * Notes Query Functions (Minimal for Insights)
 *
 * This module provides basic notes queries needed for insights generation.
 * Full notes functionality is implemented in other tasks.
 */

import { query, internalQuery } from "@convex/_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess } from "@convex/auth/guards";
import { NoteV } from "@convex/types/validators/note";
import type { MeetingNote } from "@convex/types/entities/note";

/**
 * Gets meeting notes (public, with auth)
 */
export const getMeetingNotes = query({
  args: {
    meetingId: v.id("meetings"),
  },
  returns: v.union(NoteV.meetingNote, v.null()),
  handler: async (ctx, { meetingId }): Promise<MeetingNote | null> => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    const note = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    return note;
  },
});

/**
 * Gets meeting notes (internal use)
 */
export const getMeetingNotesInternal = internalQuery({
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
