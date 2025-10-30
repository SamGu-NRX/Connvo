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
 *
 * @summary Retrieves the materialized notes document for a meeting
 * @description Fetches the current state of collaborative notes for a meeting,
 * including the full text content, version number, and metadata. This returns
 * the materialized document that represents the result of applying all operations
 * in sequence. Used internally by insights generation and other backend processes.
 * Returns null if no notes exist for the meeting yet.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "meetingId": "meeting_123example"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "_id": "meetingNote_789example",
 *     "_creationTime": 1704063600000,
 *     "meetingId": "meeting_123example",
 *     "content": "Meeting Notes - Q4 Planning\n\nAttendees:\n- Alice (Product Manager)\n- Bob (Engineering Lead)\n- Carol (Design Lead)\n\nAgenda:\n1. Review Q3 results\n2. Plan Q4 objectives\n3. Resource allocation\n\nAction Items:\n- Alice: Draft Q4 roadmap by Friday\n- Bob: Estimate engineering capacity\n- Carol: Prepare design system updates\n\nNext Meeting: October 15, 2024",
 *     "version": 42,
 *     "lastRebasedAt": 1704063600000,
 *     "updatedAt": 1704067200000
 *   }
 * }
 * ```
 *
 * @example response-empty
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": null
 * }
 * ```
 *
 * @example dataModel
 * ```json
 * {
 *   "_id": "meetingNote_789example",
 *   "_creationTime": 1704063600000,
 *   "meetingId": "meeting_123example",
 *   "content": "Meeting Notes - Q4 Planning\n\nAttendees:\n- Alice (Product Manager)\n- Bob (Engineering Lead)\n- Carol (Design Lead)\n\nAgenda:\n1. Review Q3 results\n2. Plan Q4 objectives\n3. Resource allocation\n\nAction Items:\n- Alice: Draft Q4 roadmap by Friday\n- Bob: Estimate engineering capacity\n- Carol: Prepare design system updates\n\nNext Meeting: October 15, 2024",
 *   "version": 42,
 *   "lastRebasedAt": 1704063600000,
 *   "updatedAt": 1704067200000
 * }
 * ```
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
