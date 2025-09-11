import { v } from "convex/values";

// Primitive metadata value (no nested objects to keep it cheap and portable)
export const primitiveValueV = v.union(v.string(), v.number(), v.boolean());

// Generic metadata record: string -> primitive
export const metadataRecordV = v.record(v.string(), primitiveValueV);

// Labels map: string -> string (for metrics labels)
export const labelsRecordV = v.record(v.string(), v.string());

// Speaking statistics for meetings
export const speakingStatsV = v.object({
  totalMs: v.number(),
  byUserMs: v.record(v.string(), v.number()),
});

// Feature/weight maps used in matching analytics
export const numericMapV = v.record(v.string(), v.number());

// Feature flag value: simple primitive (no objects) for deterministic behavior
export const featureFlagValueV = primitiveValueV;

// Message attachment shape (kept minimal but typed)
export const attachmentV = v.object({
  kind: v.union(v.literal("file"), v.literal("url"), v.literal("image")),
  url: v.string(),
  name: v.optional(v.string()),
  size: v.optional(v.number()),
  contentType: v.optional(v.string()),
});

