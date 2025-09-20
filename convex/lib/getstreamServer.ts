"use node";

/**
 * Server-side helpers for interacting with the GetStream Video SDK.
 *
 * Consolidates client initialization and SDK surface typing so Convex actions
 * can share a single implementation without duplicating boilerplate.
 */

export interface StreamRecording {
  id?: string;
  url?: string;
  duration?: number;
}

export interface StreamRecordingConfig {
  mode: string;
  audio_only: boolean;
  quality: string;
  layout: {
    name: string;
    options?: Record<string, unknown>;
  };
}

export interface StreamRecordingQuery {
  session_id: string;
}

export interface StreamCall {
  create: (opts: { data: Record<string, unknown> }) => Promise<void>;
  startRecording: (
    config: StreamRecordingConfig,
  ) => Promise<{ recording?: StreamRecording }>;
  stopRecording: () => Promise<unknown>;
  queryRecordings: (
    query: StreamRecordingQuery,
  ) => Promise<{ recordings?: StreamRecording[] }>;
  delete: () => Promise<void>;
}

export interface StreamVideoClient {
  call: (callType: string, callId: string) => StreamCall;
  createToken: (userId: string, claims: Record<string, unknown>) => string;
}

export const STREAM_DEFAULT_CALL_TYPE = "default";

export interface StreamCredentials {
  apiKey: string;
  secret: string;
}

function resolveCredentials(): StreamCredentials {
  const apiKey = process.env.STREAM_API_KEY;
  const secret = process.env.STREAM_SECRET;

  if (!apiKey || !secret) {
    throw new Error(
      "GetStream credentials not configured. Set STREAM_API_KEY and STREAM_SECRET environment variables.",
    );
  }

  return { apiKey, secret };
}

let streamVideoClient: StreamVideoClient | null = null;

type StreamVideoClientCtor = new (
  apiKey: string,
  opts: { secret: string },
) => StreamVideoClient;

function loadStreamCtor(): StreamVideoClientCtor {
  const module = require("@stream-io/video-react-sdk") as {
    StreamVideoClient: StreamVideoClientCtor;
  };

  return module.StreamVideoClient;
}

export function getStreamVideoClient(): StreamVideoClient {
  if (streamVideoClient) {
    return streamVideoClient;
  }

  const { apiKey, secret } = resolveCredentials();
  const StreamCtor = loadStreamCtor();
  streamVideoClient = new StreamCtor(apiKey, { secret });
  return streamVideoClient;
}

export function getStreamCall(
  callId: string,
  callType: string = STREAM_DEFAULT_CALL_TYPE,
): StreamCall {
  return getStreamVideoClient().call(callType, callId);
}

export function createStreamToken(
  userId: string,
  claims: Record<string, unknown>,
): string {
  return getStreamVideoClient().createToken(userId, claims);
}

export function resetStreamClientForTesting(): void {
  streamVideoClient = null;
}
