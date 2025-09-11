/**
 * Subscription Actions: Orchestrate validation + audit logging
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";
import { requireIdentity } from "../auth/guards";

type ValidateResult = {
  valid: boolean;
  permissions: string[];
  reason?: string;
  shouldReconnect: boolean;
  validUntil?: number;
  rateLimited: boolean;
  resourceType: string;
  resourceId: string;
};

export const validateAndLogSubscription = action({
  args: {
    subscriptionId: v.string(),
    lastValidated: v.number(),
  },
  returns: v.object({
    valid: v.boolean(),
    permissions: v.array(v.string()),
    reason: v.optional(v.string()),
    shouldReconnect: v.boolean(),
    validUntil: v.optional(v.number()),
    rateLimited: v.boolean(),
    resourceType: v.string(),
    resourceId: v.string(),
  }),
  handler: async (ctx, args): Promise<ValidateResult> => {
    const identity = await requireIdentity(ctx);

    const result: ValidateResult = await ctx.runQuery(
      api.realtime.subscriptionManager.validateAndUpdateSubscription,
      args,
    );

    // Log invalid outcomes for debuggability and auditing
    if (!result.valid) {
      await ctx.runMutation(internal.audit.logging.createAuditLog, {
        actorUserId: undefined,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        action: "subscription_validation_failed",
        category: "subscription_management",
        metadata: {
          subscriptionId: args.subscriptionId,
          lastValidated: args.lastValidated,
          reason: result.reason ?? "",
          actorExternalId: identity.userId,
        },
        success: false,
      });
    }

    return result;
  },
});
