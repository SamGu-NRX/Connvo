/**
 * Transport registry (CALL-PLAN.md, step S0).
 *
 * One entry per transport, so later tasks add one line each:
 *   S2A adds "p2p-convex", S2B adds "livekit".
 *
 * The registry is only imported by the dev-only bench route
 * (`src/app/dev/call-bench/[transport]/page.tsx`), which 404s unless
 * `NEXT_PUBLIC_CONNVO_CALL_BENCH=1`.
 */
import type { CallTransport } from "../transport";

export type TransportFactory = () => Promise<CallTransport>;

const registry = new Map<string, TransportFactory>();

export function registerTransport(
  name: string,
  factory: TransportFactory,
): void {
  if (registry.has(name)) {
    throw new Error(`transport already registered: ${name}`);
  }
  registry.set(name, factory);
}

export function listTransports(): string[] {
  return [...registry.keys()];
}

export async function loadTransport(name: string): Promise<CallTransport> {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(`unknown transport: ${name}`);
  }
  return factory();
}

// Registered transports — one line each.
// S2A (P2P over Convex signaling) and S2B (self-hosted LiveKit) register
// here in their own tasks. The eval-only "reference" transport (and its
// broken variants) register in tools/call-eval/reference and are added here
// by the S0 harness task.
