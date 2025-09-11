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
import { handleStreamWebhook as handleStreamWebhookAction } from "./meetings/stream";

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
  handler: handleStreamWebhookAction,
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
