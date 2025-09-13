/**
 * Typed helpers for audit logging metadata across categories.
 */

import { Id } from "../_generated/dataModel";
import { ActionCtx, MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

// JSON value helpers
export type JSONPrimitive = string | number | boolean | null;
export type JsonValue = JSONPrimitive | JsonValue[] | { [key: string]: JsonValue };

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

// Event payload expected by internal.audit.logging.createAuditLog
export type AuditEvent = {
  actorUserId?: Id<"users">;
  resourceType: string;
  resourceId: string; // matches schema.v.string()
  action: string;
  category: AuditCategory;
  success: boolean;
  metadata?: Record<string, JsonValue>;
};

// Helper to build a subscription_management audit event with strong metadata typing
export function makeSubscriptionAuditEvent(
  base: Omit<AuditEvent, "category" | "success"> & {
    metadata?: SubscriptionMetadata & Record<string, JsonValue>;
  },
  success: boolean = true,
): AuditEvent {
  return { ...base, category: "subscription_management", success };
}

// Back-compat builder used by realtime modules
export function buildSubscriptionAudit(
  args: Omit<AuditEvent, "category" | "success"> & {
    metadata?: SubscriptionMetadata & Record<string, JsonValue>;
    success?: boolean;
  },
): AuditEvent {
  return makeSubscriptionAuditEvent(args, args.success ?? true);
}

export async function logAudit(
  ctx: MutationCtx | ActionCtx,
  event: AuditEvent,
): Promise<void> {
  await ctx.runMutation(internal.audit.logging.createAuditLog, event);
}
