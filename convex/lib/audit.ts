/**
 * Typed helpers for audit logging metadata across categories.
 */

import { Id } from "../_generated/dataModel";
import { ActionCtx, MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

export type AuditCategory = "subscription_management" | "auth" | "data_access" | "meeting";

export type SubscriptionEventAction =
  | "subscription_established"
  | "subscription_terminated"
  | "subscription_validation_failed";

export type SubscriptionMetadata = {
  subscriptionId: string;
  reason?: string;
  priority?: "critical" | "high" | "normal" | "low";
  permissions?: string[];
  latency?: number;
  terminatedAt?: number;
  performance?: Record<string, number | boolean>;
};

export type AuditEvent = {
  actorUserId?: Id<"users">;
  resourceType: string;
  // Use string to match schema (auditLogs.resourceId is v.string())
  resourceId: string;
  action: string;
  category: AuditCategory;
  success: boolean;
  metadata?: Record<string, string | number | boolean>;
};

export function buildSubscriptionAudit(
  base: Omit<AuditEvent, "category" | "success"> & {
    metadata?:
      | (SubscriptionMetadata & Record<string, string | number | boolean>)
      | undefined;
  },
  success = true,
): AuditEvent {
  return {
    ...base,
    category: "subscription_management",
    success,
  };
}

export async function logAudit(
  ctx: MutationCtx | ActionCtx,
  event: AuditEvent,
): Promise<void> {
  await ctx.runMutation(internal.audit.logging.createAuditLog, event);
}
