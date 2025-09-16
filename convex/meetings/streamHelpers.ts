import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { metadataRecordV } from "../lib/validators";

export const updateRecordingState = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    recordingEnabled: v.boolean(),
    recordingId: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { meetingId, recordingEnabled, recordingId, recordingUrl },
  ) => {
    const meetingState = await ctx.db
      .query("meetingState")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();

    if (meetingState) {
      await ctx.db.patch(meetingState._id, {
        recordingEnabled,
        updatedAt: Date.now(),
      });
    }

    if (recordingId && recordingUrl) {
      await ctx.db.insert("meetingRecordings", {
        meetingId,
        recordingId,
        recordingUrl,
        provider: "getstream",
        status: recordingEnabled ? "recording" : "ready",
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

export const trackStreamEvent = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    event: v.string(),
    success: v.boolean(),
    duration: v.optional(v.number()),
    error: v.optional(v.string()),
    metadata: v.optional(metadataRecordV),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("meetingEvents", {
      meetingId: args.meetingId,
      event: args.event,
      success: args.success,
      duration: args.duration,
      error: args.error,
      metadata: args.metadata || {},
      timestamp: Date.now(),
      createdAt: Date.now(),
    });
    return null;
  },
});

export const sendStreamAlert = internalMutation({
  args: {
    alertType: v.string(),
    meetingId: v.id("meetings"),
    error: v.string(),
    metadata: v.optional(metadataRecordV),
  },
  returns: v.null(),
  handler: async (ctx, { alertType, meetingId, error, metadata }) => {
    const alertConfig = {
      id: `stream_${alertType}_${meetingId}_${Date.now()}`,
      severity: "error" as const,
      category: "video_provider" as const,
      title: `GetStream ${alertType.replace(/_/g, " ")}`,
      message: `GetStream operation failed for meeting ${meetingId}: ${error}`,
      metadata: {
        meetingId,
        provider: "getstream",
        ...metadata,
      },
      actionable: true,
    };

    await ctx.db.insert("alerts", {
      alertId: alertConfig.id,
      severity: alertConfig.severity,
      category: alertConfig.category,
      title: alertConfig.title,
      message: alertConfig.message,
      metadata: alertConfig.metadata,
      actionable: alertConfig.actionable,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});
