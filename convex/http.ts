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
import { handleStreamWebhook } from "./meetings/stream";

const http = httpRouter();

// Stream webhook endpoint
http.route({
  path: "/webhooks/stream",
  method: "POST",
  handler: handleStreamWebhook,
});

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: async (ctx, request) => {
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
  },
});

export default http;
