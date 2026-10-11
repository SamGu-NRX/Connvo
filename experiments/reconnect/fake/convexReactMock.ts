/**
 * Active-client registry + drop-in `convex/react` mock.
 *
 * The REAL hooks under test (`src/hooks/useCollaborativeNotes.ts`,
 * `src/hooks/useMeetingLifecycle.ts`) import `useQuery` / `useMutation` /
 * `useAction` from "convex/react". In the vitest suite we `vi.mock`
 * "convex/react" with this module, which delegates every call to the
 * active FakeConvexClient. The hooks stay 100% real; only the transport is
 * ours.
 */

import type { FakeConvexClient } from "./fakeConvex";

let active: FakeConvexClient | undefined;

export function setActiveClient(client: FakeConvexClient | undefined): void {
  active = client;
}

export function getActiveClient(): FakeConvexClient {
  if (!active) {
    throw new Error(
      "No active FakeConvexClient — call setActiveClient() in the test setup before rendering.",
    );
  }
  return active;
}

export function useQuery(
  ref: unknown,
  args?: Record<string, unknown>,
): unknown {
  return getActiveClient().useQuery(ref, args);
}

export function useMutation(ref: unknown): (args: Record<string, unknown>) => Promise<unknown> {
  return getActiveClient().useMutation(ref);
}

export function useAction(ref: unknown): (args: Record<string, unknown>) => Promise<unknown> {
  return getActiveClient().useAction(ref);
}

export function useConvex(): unknown {
  return getActiveClient();
}
