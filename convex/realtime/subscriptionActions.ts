/**
 * Subscription Actions: Orchestrate validation + audit logging
 */

import { action } from "@convex/_generated/server";
import { v } from "convex/values";
import { api, internal } from "@convex/_generated/api";
import { requireIdentity } from "@convex/auth/guards";
import { SubscriptionValidationResultV } from "@convex/types/validators/realTime";

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
  returns: SubscriptionValidationResultV.full,
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
