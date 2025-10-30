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

/**
 * @summary validateAndLogSubscription
 * @description Validates a realtime subscription using `subscriptionManager.validateAndUpdateSubscription` and records an audit trail whenever the subscription is rejected. Call this from websocket heartbeats to keep permissions fresh; the result mirrors the registry state so the client can decide whether to reconnect, downgrade, or tear down the stream.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "subscriptionId": "sub_meetingNotes_7c88",
 *     "lastValidated": 1716489600000
 *   }
 * }
 * ```
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "valid": true,
 *     "permissions": ["read", "write"],
 *     "shouldReconnect": false,
 *     "validUntil": 1716493200000,
 *     "rateLimited": false,
 *     "resourceType": "meetingNotes",
 *     "resourceId": "me_a12bc34def567890"
 *   }
 * }
 * ```
 * @example response-denied
 * ```json
 * {
 *   "status": "success",
 *   "errorMessage": "",
 *   "errorData": {},
 *   "value": {
 *     "valid": false,
 *     "permissions": [],
 *     "reason": "Subscription not found",
 *     "shouldReconnect": false,
 *     "rateLimited": false,
 *     "resourceType": "unknown",
 *     "resourceId": "unknown"
 *   }
 * }
 * ```
 */
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
