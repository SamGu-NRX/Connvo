import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import { assertMeetingAccess } from "../../auth/guards";

export const participant = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const member = await assertMeetingAccess(ctx, meetingId);
    return member.userId;
  },
});
