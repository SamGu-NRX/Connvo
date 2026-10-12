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
 * Ack payload for one operation the server applied on behalf of a client
 * (notes-ledger F1). Lets a client retire its own records by identity after a
 * lost response instead of guessing from text or version numbers.
 */
interface ClientOperationAck {
  clientOpId: string;
  clientSequence: number;
  serverSequence: number;
  appliedAt: number;
}

/**
 * getMeetingNotes return type: the legacy materialized row, plus the
 * watermark fields when the caller passes `clientId`. Optional so legacy
 * consumers are unaffected.
 */
type MeetingNotesWithWatermark = MeetingNote & {
  headSequence?: number;
  clientAcks?: ClientOperationAck[];
};

// Extended return validator: legacy meetingNote fields + additive optional
// watermark fields. Built by spreading NoteV.meetingNote.fields so the legacy
// shape cannot drift from its single source of truth.
const meetingNotesResultV = v.object({
  ...NoteV.meetingNote.fields,
  headSequence: v.optional(v.number()),
  clientAcks: v.optional(
    v.array(
      v.object({
        clientOpId: v.string(),
        clientSequence: v.number(),
        serverSequence: v.number(),
        appliedAt: v.number(),
      }),
    ),
  ),
});

/**
 * Gets meeting notes (public, with auth)
 */
export const getMeetingNotes = query({
  args: {
    meetingId: v.id("meetings"),
    // Additive (notes-ledger F1). When provided, the response gains the
    // headSequence watermark and this client's acks; legacy shape otherwise.
    clientId: v.optional(v.string()),
  },
  returns: v.union(meetingNotesResultV, v.null()),
  handler: async (
    ctx,
    { meetingId, clientId },
  ): Promise<MeetingNotesWithWatermark | null> => {
    // Verify user has access to this meeting
    await assertMeetingAccess(ctx, meetingId);

    const note = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    // Legacy shape: exactly the stored row, nothing added.
    if (!note || clientId === undefined) {
      return note;
    }

    // headSequence: the incorporated-history watermark W — the max noteOps
    // sequence for the meeting (0 when none exist yet).
    const lastOp = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
      .order("desc")
      .first();
    const headSequence = lastOp?.sequence ?? 0;

    // The ≤100 most recent applied ops carrying THIS client's identity,
    // ascending by serverSequence. Rows without clientId are not in the
    // by_meeting_client index; the JS-side filter guards the (clientOpId,
    // clientSequence) pair for any hypothetical partial-identity row.
    const clientRows = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_client", (q) =>
        q.eq("meetingId", meetingId).eq("clientId", clientId),
      )
      .order("desc")
      .filter((q) => q.eq(q.field("applied"), true))
      .take(100);

    const clientAcks: ClientOperationAck[] = clientRows
      .filter(
        (
          row,
        ): row is typeof row & {
          clientOpId: string;
          clientSequence: number;
        } => row.clientOpId !== undefined && row.clientSequence !== undefined,
      )
      .map((row) => ({
        clientOpId: row.clientOpId,
        clientSequence: row.clientSequence,
        serverSequence: row.sequence,
        appliedAt: row.timestamp,
      }))
      .reverse();

    return { ...note, headSequence, clientAcks };
  },
});

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
