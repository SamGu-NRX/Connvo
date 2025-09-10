import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireIdentity, assertMeetingAccess } from "../auth/guards";

export const createMeeting = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    duration: v.optional(v.number()),
  },
  returns: v.id("meetings"),
  handler: async (ctx, args) => {
    const { userId } = await requireIdentity(ctx);

    // Get the user to use as organizer
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosUserId", userId))
      .unique();

    if (!user) {
      throw new Error("User not found");
    }

    const now = Date.now();

    // Create the meeting
    const meetingId = await ctx.db.insert("meetings", {
      organizerId: user._id,
      title: args.title,
      description: args.description,
      scheduledAt: args.scheduledAt,
      duration: args.duration,
      state: "scheduled" as const,
      createdAt: now,
      updatedAt: now,
    });

    // Add organizer as host participant
    await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId: user._id,
      role: "host" as const,
      presence: "invited" as const,
      createdAt: now,
    });

    // Create initial meeting state
    await ctx.db.insert("meetingState", {
      meetingId,
      active: false,
      topics: [],
      recordingEnabled: false,
      updatedAt: now,
    });

    return meetingId;
  },
});

export const startMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const mp = await assertMeetingAccess(ctx, args.meetingId, "host");
    const now = Date.now();

    // Update meeting state to active
    await ctx.db.patch(args.meetingId, {
      state: "active" as const,
      updatedAt: now,
    });

    // Update meeting state
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        active: true,
        startedAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});

export const endMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const mp = await assertMeetingAccess(ctx, args.meetingId, "host");
    const now = Date.now();

    // Update meeting state to concluded
    await ctx.db.patch(args.meetingId, {
      state: "concluded" as const,
      updatedAt: now,
    });

    // Update meeting state
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        active: false,
        endedAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});

export const addParticipant = mutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    role: v.union(v.literal("host"), v.literal("participant")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Only hosts can add participants
    await assertMeetingAccess(ctx, args.meetingId, "host");

    // Check if participant already exists
    const existingParticipant = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting_and_user", (q) =>
        q.eq("meetingId", args.meetingId).eq("userId", args.userId),
      )
      .unique();

    if (existingParticipant) {
      throw new Error("User is already a participant");
    }

    // Add participant
    await ctx.db.insert("meetingParticipants", {
      meetingId: args.meetingId,
      userId: args.userId,
      role: args.role,
      presence: "invited" as const,
      createdAt: Date.now(),
    });

    return null;
  },
});
