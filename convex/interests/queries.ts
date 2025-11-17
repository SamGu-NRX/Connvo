/**
 * Interests Catalog Queries
 */
import {
  query,
  internalQuery,
  internalMutation,
} from "@convex/_generated/server";
import { v } from "convex/values";
import { Id } from "@convex/_generated/dataModel";

/**
 * @summary listCatalog
 * @description Returns the public interest catalog used during onboarding. Results are limited and optionally filtered by category, with deterministic ordering so the client can render stable UI buckets. The list is denormalized to include icon metadata and usage counts for weighting suggestions.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "category": "industry",
 *     "limit": 6
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": [
 *     {
 *       "key": "software-engineering",
 *       "label": "Software Engineering",
 *       "category": "industry",
 *       "iconName": "Code",
 *       "usageCount": 128
 *     },
 *     {
 *       "key": "product-management",
 *       "label": "Product Management",
 *       "category": "industry",
 *       "iconName": "Briefcase",
 *       "usageCount": 94
 *     }
 *   ]
 * }
 * ```
 */
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
 * @summary Gets user interests by user ID (internal use)
 * @description Retrieves the full list of interests associated with a user by their user ID. This internal function joins user interest keys with the interest catalog to return complete interest details including labels, categories, and icons. Used for matching algorithms and profile enrichment.
 *
 * @example request
 * ```json
 * { "args": { "userId": "jd7xn8q9k2h5m6p3r4t7w8y9" } }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": [
 *     {
 *       "key": "software-engineering",
 *       "label": "Software Engineering",
 *       "category": "industry",
 *       "iconName": "Code"
 *     },
 *     {
 *       "key": "ai-ml",
 *       "label": "AI / ML",
 *       "category": "academic",
 *       "iconName": "Brain"
 *     },
 *     {
 *       "key": "startups",
 *       "label": "Startups",
 *       "category": "personal",
 *       "iconName": "Rocket"
 *     }
 *   ]
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": []
 * }
 * ```
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

/**
 * @summary Seeds default interest catalog
 * @description Initializes the interest catalog with a minimal set of default interests if the catalog is empty. This is an idempotent operation that only inserts data when no interests exist. Used during system initialization or database setup.
 *
 * @example request
 * ```json
 * { "args": {} }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": null
 * }
 * ```
 */
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
