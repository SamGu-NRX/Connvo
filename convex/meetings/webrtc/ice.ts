import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { iceProvider, type IceCredentials } from "../../../src/server/call/ice-provider";

export const configuration = action({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }): Promise<IceCredentials> => {
    // Query runs with the action caller's identity, using the unchanged meeting guard.
    const participant = await ctx.runQuery(internal.meetings.webrtc.iceAccess.participant, { meetingId });
    return iceProvider({
      TURN_CLOUDFLARE_KEY_ID: process.env.TURN_CLOUDFLARE_KEY_ID,
      TURN_CLOUDFLARE_API_TOKEN: process.env.TURN_CLOUDFLARE_API_TOKEN,
      TURN_SHARED_SECRET: process.env.TURN_SHARED_SECRET,
      TURN_URLS: process.env.TURN_URLS,
    }).issue(`${meetingId}:${participant}`);
  },
});
