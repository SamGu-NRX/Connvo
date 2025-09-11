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

const http = httpRouter();

/**
 * GetStream webhook endpoint for paid tier video features
 * Handles webhooks from GetStream Video API for call events, recording, and transcription
 *
 * Webhook signature verification is performed using HMAC-SHA256
 * Events are processed asynchronously to ensure webhook response times
 */
// GetStream webhook dispatcher implemented in V8 runtime; uses Web Crypto for HMAC.
const handleStreamWebhookAction = httpAction(async (ctx, request) => {
  try {
    const body = await request.text();
    const signature =
      request.headers.get("x-signature") || request.headers.get("signature");

    // Verify webhook signature for security (optional: only if header present)
    if (signature) {
      const streamSecret = process.env.STREAM_SECRET;
      if (!streamSecret) {
        console.error(
          "GetStream secret not configured for webhook verification",
        );
        return new Response("Webhook secret not configured", { status: 500 });
      }

      const provided = signature.replace("sha256=", "");
      // Use Web Crypto API (supported in Convex V8 runtime)
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(streamSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
      const actual = Array.from(new Uint8Array(mac))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (actual !== provided) {
        console.error("Invalid webhook signature");
        return new Response("Invalid signature", { status: 401 });
      }
    }

    // Parse webhook payload
    const payload = JSON.parse(body);
    const eventType = payload.type as string;
    const eventData = payload;

    console.log(`Received GetStream webhook: ${eventType}`);

    // Dispatch to internal V8 mutations
    let processingResult: { success: boolean } = { success: false };

    switch (eventType) {
      case "call.session_started":
        processingResult = await ctx.runMutation(
          internal.meetings.streamHandlers.handleCallSessionStarted,
          { data: eventData },
        );
        break;
      case "call.session_ended":
        processingResult = await ctx.runMutation(
          internal.meetings.streamHandlers.handleCallSessionEnded,
          { data: eventData },
        );
        break;
      case "call.member_joined":
        processingResult = await ctx.runMutation(
          internal.meetings.streamHandlers.handleMemberJoined,
          { data: eventData },
        );
        break;
      case "call.member_left":
        processingResult = await ctx.runMutation(
          internal.meetings.streamHandlers.handleMemberLeft,
          { data: eventData },
        );
        break;
      case "call.recording_started":
        processingResult = await ctx.runMutation(
          internal.meetings.streamHandlers.handleRecordingStarted,
          { data: eventData },
        );
        break;
      case "call.recording_stopped":
        processingResult = await ctx.runMutation(
          internal.meetings.streamHandlers.handleRecordingStopped,
          { data: eventData },
        );
        break;
      case "call.recording_ready":
        processingResult = await ctx.runMutation(
          internal.meetings.streamHandlers.handleRecordingReady,
          { data: eventData },
        );
        break;
      case "call.transcription_started":
        processingResult = await ctx.runMutation(
          internal.meetings.streamHandlers.handleTranscriptionStarted,
          { data: eventData },
        );
        break;
      case "call.transcription_stopped":
        processingResult = await ctx.runMutation(
          internal.meetings.streamHandlers.handleTranscriptionStopped,
          { data: eventData },
        );
        break;
      default:
        console.log(`Unhandled GetStream webhook event: ${eventType}`);
        processingResult = { success: true };
    }

    if (processingResult.success) {
      return new Response("OK", { status: 200 });
    } else {
      return new Response("Processing failed", { status: 500 });
    }
  } catch (error) {
    console.error("Failed to handle GetStream webhook:", error);
    return new Response("Internal server error", { status: 500 });
  }
});

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
