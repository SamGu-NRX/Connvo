/**
 * Read and clear the local-send email outbox (convex/schema/emailOutbox.ts).
 *
 * When RESEND_API_KEY is unset, the console provider records every message
 * it would have emailed here, so a tester or a test can read exactly what
 * was sent. Internal functions, run with `npx convex run` or the Convex
 * dashboard:
 *
 *   npx convex run emails/outbox:listForAddress '{"to":"alice@example.com"}'
 *   npx convex run emails/outbox:clearForAddress '{"to":"alice@example.com"}'
 *   npx convex run emails/outbox:clearAll '{}'
 *
 * Recording happens inside the deliver action's send path (deliver.ts), one
 * row per message and recipient, next to the per-recipient idempotency
 * marker — so a duplicate scheduling skips the send and records nothing.
 */

import { internalQuery, internalMutation } from "@convex/_generated/server";
import type { MutationCtx } from "@convex/_generated/server";
import { v } from "convex/values";

/** Largest page a reader can ask for. */
const MAX_LIMIT = 200;
/** Default page size. */
const DEFAULT_LIMIT = 50;
/** Retention window: rows older than this are pruned on every write. */
const RETENTION_MS = 7 * 24 * 60 * 60_000;
/** Row cap: the newest rows kept, older ones evicted on every write. */
const MAX_ROWS = 500;

/** Read one address's outbox, newest first. */
export const listForAddress = internalQuery({
  args: { to: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { to, limit }) => {
    return await ctx.db
      .query("emailOutbox")
      .withIndex("by_to", (q) => q.eq("to", to))
      .order("desc")
      .take(Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  },
});

/** Clear one address's outbox; returns the number of rows deleted. */
export const clearForAddress = internalMutation({
  args: { to: v.string() },
  handler: async (ctx, { to }) => {
    const rows = await ctx.db
      .query("emailOutbox")
      .withIndex("by_to", (q) => q.eq("to", to))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

/** Clear the whole outbox; returns the number of rows deleted. */
export const clearAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("emailOutbox").collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

/**
 * Record one message and apply retention. Called by deliver.ts's send path
 * after the provider succeeds, so a refused or failed send records nothing.
 */
export const record = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    html: v.string(),
    links: v.array(v.string()),
    attachmentNames: v.array(v.string()),
    meetingId: v.optional(v.id("meetings")),
    idempotencyKey: v.optional(v.string()),
    sentAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("emailOutbox", args);
    await prune(ctx);
  },
});

/** Drop rows older than the retention window, then evict past the row cap. */
async function prune(ctx: MutationCtx): Promise<void> {
  const cutoff = Date.now() - RETENTION_MS;
  const expired = await ctx.db
    .query("emailOutbox")
    .withIndex("by_sentAt", (q) => q.lt("sentAt", cutoff))
    .collect();
  for (const row of expired) await ctx.db.delete(row._id);

  const kept = await ctx.db
    .query("emailOutbox")
    .withIndex("by_sentAt", (q) => q.gte("sentAt", cutoff))
    .order("asc")
    .collect();
  const excess = kept.length - MAX_ROWS;
  for (const row of excess > 0 ? kept.slice(0, excess) : []) {
    await ctx.db.delete(row._id);
  }
}
