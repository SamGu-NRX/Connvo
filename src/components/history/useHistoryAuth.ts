"use client";

/**
 * The history queries need the signed-in user. A query sent before the
 * Convex client has its token is refused ("Authentication required"), and
 * the refusal would stick, so the history components wait for auth first and
 * skip their queries until then.
 */
import { useConvexAuth } from "convex/react";

export type HistoryAuth = "loading" | "signed-out" | "ready";

export function useHistoryAuth(): HistoryAuth {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return "loading";
  return isAuthenticated ? "ready" : "signed-out";
}

export const SIGNED_OUT_MESSAGE = "Sign in to see your meetings.";
