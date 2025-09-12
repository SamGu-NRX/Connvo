import { defineTable } from "convex/server";
import { v } from "convex/values";

export const legacyTables = {
  // Legacy Support (for migration)
  connections: defineTable({
    requesterId: v.id("users"),
    addresseeId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_requester", ["requesterId"])
    .index("by_addressee", ["addresseeId"])
    .index("by_status", ["status"]),
};

