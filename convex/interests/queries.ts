/**
 * Interests Catalog Queries
 */
import { query, internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

export const listCatalog = query({
  args: {
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      category: v.string(),
      iconName: v.optional(v.string()),
      usageCount: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { category, limit = 200 }) => {
    const q = category
      ? ctx.db
          .query("interests")
          .withIndex("by_category", (qi) => qi.eq("category", category))
      : ctx.db.query("interests");
    const rows = await q.order("desc").take(limit);
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      category: r.category,
      iconName: r.iconName,
      usageCount: r.usageCount,
    }));
  },
});

/**
 * Gets user interests by user ID (internal use)
 */
export const getUserInterests = internalQuery({
  args: { userId: v.id("users") },
  returns: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      category: v.string(),
      iconName: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { userId }) => {
    // Get user interest keys
    const userInterests = await ctx.db
      .query("userInterests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Get full interest details
    const interests = [];
    for (const userInterest of userInterests) {
      const interest = await ctx.db
        .query("interests")
        .withIndex("by_key", (q) => q.eq("key", userInterest.interestKey))
        .unique();

      if (interest) {
        interests.push({
          key: interest.key,
          label: interest.label,
          category: interest.category,
          iconName: interest.iconName,
        });
      }
    }

    return interests;
  },
});

export const seedDefault = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Seed a minimal catalog if empty
    const any = await ctx.db.query("interests").take(1);
    if (any.length > 0) return null;
    const now = Date.now();
    const defaults: Array<{
      key: string;
      label: string;
      category: string;
      iconName?: string;
    }> = [
      {
        key: "software-engineering",
        label: "Software Engineering",
        category: "industry",
        iconName: "Code",
      },
      {
        key: "data-science",
        label: "Data Science",
        category: "industry",
        iconName: "Code",
      },
      {
        key: "product-management",
        label: "Product Management",
        category: "industry",
        iconName: "Briefcase",
      },
      {
        key: "ai-ml",
        label: "AI / ML",
        category: "academic",
        iconName: "Brain",
      },
      {
        key: "startups",
        label: "Startups",
        category: "personal",
        iconName: "Rocket",
      },
      {
        key: "design",
        label: "Design",
        category: "skill",
        iconName: "Palette",
      },
    ];
    for (const d of defaults) {
      await ctx.db.insert("interests", {
        key: d.key,
        label: d.label,
        category: d.category,
        iconName: d.iconName,
        usageCount: 0,
        createdAt: now,
      });
    }
    return null;
  },
});
