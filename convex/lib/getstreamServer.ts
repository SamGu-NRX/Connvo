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
let streamVideoClientPromise: Promise<StreamVideoClient> | null = null;

type StreamVideoClientCtor = new (
  apiKey: string,
  opts: { secret: string },
) => StreamVideoClient;

// Lazy, async SDK load. Convex bundles with esbuild `splitting: false`
// (node_modules/convex/dist/cjs/cli/lib/components/definition/bundle.js), so a
// dynamic import's bytes are still inlined into the same bundle - there is no
// separate chunk. What changes is execution: esbuild rewrites the dynamic
// import to `Promise.resolve().then(() => initSDK())`, so the SDK's top-level
// initialization (dominated by @stream-io/video-client/chart.js/rxjs) no longer
// runs when the backend loads the module - only on the first call that needs a
// client. Behavior is unchanged: same client, same credentials check, same
// errors, just resolved through the awaited promise.
async function loadStreamCtor(): Promise<StreamVideoClientCtor> {
  const sdk = (await import("@stream-io/video-react-sdk")) as unknown as {
    StreamVideoClient: StreamVideoClientCtor;
  };

  return sdk.StreamVideoClient;
}

export async function getStreamVideoClient(): Promise<StreamVideoClient> {
  if (streamVideoClient) {
    return streamVideoClient;
  }

  if (!streamVideoClientPromise) {
    streamVideoClientPromise = (async () => {
      const { apiKey, secret } = resolveCredentials();
      const StreamCtor = await loadStreamCtor();
      return new StreamCtor(apiKey, { secret });
    })();
    // Memoize the constructed client; on failure clear the in-flight promise
    // so the next call retries resolveCredentials (rejections still propagate
    // to every caller of this promise).
    streamVideoClientPromise.then(
      (client) => {
        streamVideoClient = client;
      },
      () => {
        streamVideoClientPromise = null;
      },
    );
  }

  return streamVideoClientPromise;
}

export async function getStreamCall(
  callId: string,
  callType: string = STREAM_DEFAULT_CALL_TYPE,
): Promise<StreamCall> {
  const client = await getStreamVideoClient();
  return client.call(callType, callId);
}

export async function createStreamToken(
  userId: string,
  claims: Record<string, unknown>,
): Promise<string> {
  const client = await getStreamVideoClient();
  return client.createToken(userId, claims);
}

export function resetStreamClientForTesting(): void {
  streamVideoClient = null;
  streamVideoClientPromise = null;
}
