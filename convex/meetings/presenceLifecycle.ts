import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

/** The first pair of present call sessions starts the recorded conversation. */
export async function recordCallStart(
  ctx: MutationCtx,
  meetingId: Id<"meetings">,
  present: number,
  now: number,
): Promise<void> {
  if (present < 2) return;
  const state = await ctx.db
    .query("meetingState")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .unique();
  if (state) {
    if (state.startedAt === undefined) {
      await ctx.db.patch(state._id, { startedAt: now, updatedAt: now });
    }
  } else {
    await ctx.db.insert("meetingState", {
      meetingId,
      active: true,
      startedAt: now,
      topics: [],
      recordingEnabled: false,
      updatedAt: now,
    });
  }
}

/** Shared by host end and presence expiry; a second end keeps the original time. */
export async function finishMeeting(
  ctx: MutationCtx,
  meetingId: Id<"meetings">,
  now: number,
): Promise<number | undefined> {
  const meeting = await ctx.db.get(meetingId);
  if (!meeting || meeting.state !== "active") return undefined;
  const state = await ctx.db
    .query("meetingState")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .unique();
  await ctx.db.patch(meetingId, { state: "concluded", updatedAt: now });
  if (state) {
    await ctx.db.patch(state._id, {
      active: false,
      endedAt: now,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("meetingState", {
      meetingId,
      active: false,
      endedAt: now,
      topics: [],
      recordingEnabled: false,
      updatedAt: now,
    });
  }
  await ctx.scheduler.runAfter(
    0,
    internal.meetings.postProcessing.handleMeetingEnd,
    { meetingId, endedAt: now },
  );
  return state?.startedAt === undefined ? undefined : now - state.startedAt;
}
