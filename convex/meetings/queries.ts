import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertMeetingAccess } from "../auth/guards";

export const getMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.union(
    v.object({
      _id: v.id("meetings"),
      organizerId: v.id("users"),
      title: v.string(),
      description: v.optional(v.string()),
      scheduledAt: v.optional(v.number()),
      duration: v.optional(v.number()),
      streamRoomId: v.optional(v.string()),
      state: v.union(
        v.literal("scheduled"),
        v.literal("active"),
        v.literal("concluded"),
        v.literal("cancelled"),
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await assertMeetingAccess(ctx, args.meetingId);
    return await ctx.db.get(args.meetingId);
  },
});

export const getMeetingParticipants = query({
  args: { meetingId: v.id("meetings") },
  returns: v.array(
    v.object({
      _id: v.id("meetingParticipants"),
      meetingId: v.id("meetings"),
      userId: v.id("users"),
      role: v.union(v.literal("host"), v.literal("participant")),
      joinedAt: v.optional(v.number()),
      leftAt: v.optional(v.number()),
      presence: v.union(
        v.literal("invited"),
        v.literal("joined"),
        v.literal("left"),
      ),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await assertMeetingAccess(ctx, args.meetingId);

    return await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();
  },
});

export const getMeetingState = query({
  args: { meetingId: v.id("meetings") },
  returns: v.union(
    v.object({
      _id: v.id("meetingState"),
      meetingId: v.id("meetings"),
      active: v.boolean(),
      startedAt: v.optional(v.number()),
      endedAt: v.optional(v.number()),
      speakingStats: v.optional(v.any()),
      lullState: v.optional(
        v.object({
          detected: v.boolean(),
          lastActivity: v.number(),
          duration: v.number(),
        }),
      ),
      topics: v.array(v.string()),
      recordingEnabled: v.boolean(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await assertMeetingAccess(ctx, args.meetingId);

    return await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .unique();
  },
});

export const getUserMeetings = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("meetings"),
      organizerId: v.id("users"),
      title: v.string(),
      description: v.optional(v.string()),
      scheduledAt: v.optional(v.number()),
      duration: v.optional(v.number()),
      streamRoomId: v.optional(v.string()),
      state: v.union(
        v.literal("scheduled"),
        v.literal("active"),
        v.literal("concluded"),
        v.literal("cancelled"),
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
      // Include participant info
      userRole: v.union(v.literal("host"), v.literal("participant")),
      userPresence: v.union(
        v.literal("invited"),
        v.literal("joined"),
        v.literal("left"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const { userId } = requireIdentity(ctx);

    // Get user to find their ID
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", userId))
      .unique();

    if (!user) {
      return [];
    }

    // Get user's meeting participations
    const participations = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(args.limit || 50);

    // Get meeting details for each participation
    const meetings = [];
    for (const participation of participations) {
      const meeting = await ctx.db.get(participation.meetingId);
      if (meeting) {
        meetings.push({
          ...meeting,
          userRole: participation.role,
          userPresence: participation.presence,
        });
      }
    }

    // Sort by creation time (most recent first)
    return meetings.sort((a, b) => b.createdAt - a.createdAt);
  },
});
