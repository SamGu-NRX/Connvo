/**
 * Convex signaling adapter: not built yet. It needs per-peer addressed
 * signals, presence heartbeats and cleanup in convex/meetings/webrtc, which
 * PR #35 (local Convex) and the S2A work own. Until then this stub keeps the
 * shape typed and fails loudly instead of pretending to connect.
 */
import type { SignalingAdapter } from "./signaling";

export const CONVEX_SIGNALING_UNAVAILABLE =
  "Convex call signaling is not available yet (waits for local Convex, PR #35).";

export function convexSignaling(): SignalingAdapter {
  return {
    open(_session, handlers) {
      queueMicrotask(() =>
        handlers.onClosed({
          kind: "rejected",
          message: CONVEX_SIGNALING_UNAVAILABLE,
        }),
      );
      return { send: () => {}, publishState: () => {}, close: () => {} };
    },
  };
}
