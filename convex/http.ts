/**
 * HTTP Router Configuration
 *
 * This module defines HTTP endpoints for external integrations including
 * Stream webhooks and other third-party service callbacks.
 *
 * Requirements: 6.3
 * Compliance: steering/convex_rules.mdc - Uses proper HTTP action patterns
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const http = httpRouter();

/**
 * GetStream webhook endpoint for paid tier video features
 * Handles webhooks from GetStream Video API for call events, recording, and transcription
 *
 * Webhook signature verification is performed using HMAC-SHA256
 * Events are processed asynchronously to ensure webhook response times
 */
http.route({
  path: "/webhooks/getstream",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Parse webhook payload
      const body = await request.text();
      let webhookData;

      try {
        webhookData = JSON.parse(body);
      } catch (parseError) {
        console.error("Failed to parse GetStream webhook body:", parseError);
        return new Response("Invalid JSON payload", { status: 400 });
      }

      // Verify webhook signature for security
      const signature = request.headers.get("x-signature");
      const streamSecret = process.env.STREAM_SECRET;

      if (signature && streamSecret) {
        // Verify HMAC signature
        const crypto = await import("crypto");
        const expectedSignature = crypto
          .createHmac("sha256", streamSecret)
          .update(body)
          .digest("hex");

        if (signature !== expectedSignature) {
          console.error("GetStream webhook signature verification failed");
          return new Response("Invalid signature", { status: 401 });
        }
      } else if (process.env.NODE_ENV === "production") {
        // Require signature verification in production
        console.error("Missing webhook signature or secret in production");
        return new Response("Missing signature", { status: 401 });
      }

      // Process webhook asynchronously
      const result = await ctx.runAction(
        internal.meetings.stream.handleStreamWebhook,
        webhookData,
      );

      if (!result.success) {
        console.error("Failed to process GetStream webhook:", webhookData.type);
        return new Response("Webhook processing failed", { status: 500 });
      }

      console.log(
        `Successfully processed GetStream webhook: ${webhookData.type}`,
      );
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("GetStream webhook handler error:", error);
      return new Response("Internal server error", { status: 500 });
    }
  }),
});

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    return new Response(
      JSON.stringify({
        status: "healthy",
        timestamp: Date.now(),
        version: "1.0.0",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }),
});

export default http;
