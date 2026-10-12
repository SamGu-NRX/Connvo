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

/** Options the caller may pass when mounting a transport. The broken-variant
 * defect is NOT caller-settable — it is baked into the registered name. */
export interface TransportOptions {
  /** Eval-only: overrides NEXT_PUBLIC_CONNVO_CALL_SIGNALING_URL (runner hands
   * the spawned signaling server's address to the bench page as `?signal=`). */
  signalUrl?: string;
}

export type TransportFactory = (options: TransportOptions) => Promise<CallTransport>;

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

export async function loadTransport(
  name: string,
  options: TransportOptions = {},
): Promise<CallTransport> {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(`unknown transport: ${name}`);
  }
  return factory(options);
}

// Registered transports — one line each.
// S2A (P2P over Convex signaling) and S2B (self-hosted LiveKit) register
// here in their own tasks. The eval-only "reference" transport (and its
// broken variants) register in tools/call-eval/reference and are added here
// by the S0 harness task.
import { createReferenceTransport } from "../../../../tools/call-eval/reference/reference-transport";

// Eval-only reference transport (CONTRACT.md "Bench route and transports").
registerTransport("reference", (options) => Promise.resolve(createReferenceTransport(options)));
// Broken variants — each fails exactly its named scenario:
// H-02: the audio track is never added to any peer connection, so the
// receiver's tone check cannot pass.
registerTransport(
  "reference-no-audio",
  (options) => Promise.resolve(createReferenceTransport({ ...options, defect: "no-audio" })),
);
// H-11: leave() is a no-op, so the signaling socket and every wrapped peer
// connection stay open after leaving.
registerTransport(
  "reference-never-close",
  (options) => Promise.resolve(createReferenceTransport({ ...options, defect: "never-close" })),
);
// H-07: the reconnect path short-circuits to failed, so a network drop
// never recovers.
registerTransport(
  "reference-no-reconnect",
  (options) => Promise.resolve(createReferenceTransport({ ...options, defect: "no-reconnect" })),
);
// H-14: identical client behavior to "reference" — the variant relaxes
// SERVER-side membership enforcement only (the runner's signaling wrapper
// maps this name to --variant=outsider-allowed). Registered because the
// contract pins it; scenario H-14 itself stays out of scope.
registerTransport(
  "reference-outsider-allowed",
  (options) => Promise.resolve(createReferenceTransport(options)),
);
