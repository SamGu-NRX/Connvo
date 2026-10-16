/**
 * The local-send email outbox.
 *
 * When RESEND_API_KEY is unset, the console provider cannot deliver
 * anything — it only logs. This table records each message it would have
 * emailed (to, subject, text, html, links, attachment names, meeting id,
 * idempotency key, time) so a tester or a test can read exactly what was
 * sent: through the internal query and mutation in convex/emails/outbox.ts
 * (`npx convex run` or the Convex dashboard). It holds only what would
 * have been emailed — no provider is called and nothing leaves the
 * deployment.
 *
 * Retention: the outbox is a dev convenience, not a mailbox — writes prune
 * rows older than 7 days and keep at most the 500 most recent rows.
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

export const emailOutbox = defineTable({
  /** Recipient address. */
  to: v.string(),
  subject: v.string(),
  text: v.string(),
  html: v.string(),
  /** Every http(s) URL in the message, in first-seen order. */
  links: v.array(v.string()),
  /** Attachment file names (no content — nothing executable is stored). */
  attachmentNames: v.array(v.string()),
  /** The meeting the message is about, when one exists (confirmations and reminders). */
  meetingId: v.optional(v.id("meetings")),
  /** The readable per-message-and-recipient idempotency key (deliver.ts). */
  idempotencyKey: v.optional(v.string()),
  /** When the message would have been sent (ms since epoch). */
  sentAt: v.number(),
})
  .index("by_to", ["to"])
  .index("by_sentAt", ["sentAt"]);
