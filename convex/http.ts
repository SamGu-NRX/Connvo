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
import type { StreamWebhookPayload } from "./types/entities/stream";

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
  // Signature-before-effect: verify the HMAC before parsing or applying
  // anything. A missing header is a rejection (401), never a bypass; a
  // missing secret fails closed (500) so a misconfigured deployment retries
  // via Stream instead of silently accepting forged traffic.
  const body = await request.text();
  const signature =
    request.headers.get("x-signature") || request.headers.get("signature");

  if (!signature) {
    console.error("GetStream webhook rejected: missing signature header");
    return new Response("Missing signature", { status: 401 });
  }

  const streamSecret = process.env.STREAM_SECRET;
  if (!streamSecret) {
    console.error("GetStream secret not configured for webhook verification");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  try {
    const provided = signature.replace(/^sha256=/, "");
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

    // Constant-time compare. Length is public (hex-encoded SHA-256), so the
    // length mismatch shortcut leaks nothing exploitable.
    let diff = provided.length === actual.length ? 0 : 1;
    for (let i = 0; i < Math.min(provided.length, actual.length); i++) {
      diff |= provided.charCodeAt(i) ^ actual.charCodeAt(i);
    }
    if (diff !== 0) {
      console.error("Invalid webhook signature");
      return new Response("Invalid signature", { status: 401 });
    }

    const payload = JSON.parse(body) as StreamWebhookPayload;
    console.log(`Received GetStream webhook: ${payload.type}`);

    // Idempotent dispatch: the dedupe key insert and the handler run in one
    // transaction (see dispatchWebhook), so Stream retries cannot double-
    // schedule post-processing or duplicate recording rows.
    const result = await ctx.runMutation(
      internal.meetings.stream.streamHandlers.dispatchWebhook,
      { data: payload },
    );

    if (result.success) {
      return new Response("OK", { status: 200 });
    }
    return new Response("Processing failed", { status: 500 });
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
