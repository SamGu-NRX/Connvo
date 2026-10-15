/**
 * A convex/react shim over the REAL convex-test backend (mirrors the shape of
 * convexReactSim.ts: class state + module-level use* functions bound to it).
 * Mounted components call genuine handlers as their mounted identity; a
 * resolved mutation or action resyncs every live query, mirroring Convex's
 * resync behaviour after writes.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { FunctionReference } from "convex/server";
import { getFunctionName } from "convex/server";
import { createTestEnvironment } from "../../convex/helpers";

/** One real convex-test deployment (convex-test environment). */
export type TestEnvironment = ReturnType<typeof createTestEnvironment>;

/** The convex-test face type: one authenticated caller against the backend. */
export type SimFace = ReturnType<TestEnvironment["withIdentity"]>;

type AnyArgs = Record<string, unknown>;
type MutationRef = FunctionReference<"mutation">;
type ActionRef = FunctionReference<"action">;
type StableFn = (args: AnyArgs) => Promise<unknown>;

interface Entry {
  value: unknown;
  /** The rejected query (thrown in render), or undefined while healthy. */
  error: unknown;
  listeners: Set<() => void>;
  run: () => Promise<void>;
}

/**
 * Stable per-function key — Convex's anyApi manufactures a new ref object on
 * every property access, so identity must ride the function's stable name
 * ("module/file:function"), not object identity. Convex exposes exactly this
 * via getFunctionName.
 */
function refPath(ref: object): string {
  return getFunctionName(ref as FunctionReference<"query">);
}

/** Args key independent of property order (Convex ids are plain strings). */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableKey).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableKey(item)}`)
    .join(",")}}`;
}

interface TaggedFace {
  tag: string;
  face: SimFace;
}

const SimFaceContext = createContext<TaggedFace | null>(null);

/**
 * Mounts a panel under one authenticated identity. Every convex/react hook
 * below resolves its caller through this context.
 */
export function SimFaceProvider({
  sim,
  face,
  children,
}: {
  sim: ConvexReactSimLive;
  face: SimFace;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ tag: sim.tagOf(face), face }), [sim, face]);
  return (
    <SimFaceContext.Provider value={value}>{children}</SimFaceContext.Provider>
  );
}

/**
 * One instance per test = one fake deployment backed by the REAL convex-test
 * environment. Queries, mutations, and actions run as the mounted identity.
 */
export class ConvexReactSimLive {
  // Module-level use* hooks (bound below) read these directly, so they stay
  // public the way convexReactSim.ts keeps its shared state accessible.
  readonly entries = new Map<string, Entry>();
  private readonly faceTags = new WeakMap<SimFace, string>();
  private readonly stableFns = new Map<string, StableFn>();
  readonly connectionListeners = new Set<() => void>();
  connected = true;

  constructor(private readonly t: TestEnvironment) {}

  /** A convex-test face tagged for this sim — pass the result to SimFaceProvider. */
  authFace(tag: string, subject: string): SimFace {
    const face = this.t.withIdentity({ subject });
    this.faceTags.set(face, tag);
    return face;
  }

  /** The stable tag for a face created by authFace. */
  tagOf(face: SimFace): string {
    const tag = this.faceTags.get(face);
    if (tag === undefined) {
      throw new Error(
        "ConvexReactSimLive: unknown face — pass the face returned by authFace().",
      );
    }
    return tag;
  }

  useQuery = useConvexReactSimLiveQuery.bind(this);
  useMutation = useConvexReactSimLiveMutation.bind(this);
  useAction = useConvexReactSimLiveAction.bind(this);
  useConvexConnectionState = useConvexReactSimLiveConnectionState.bind(this);

  stableRunner(
    cacheKey: string,
    run: (args: AnyArgs) => Promise<unknown>,
  ): StableFn {
    let fn = this.stableFns.get(cacheKey);
    if (!fn) {
      fn = async (args: AnyArgs) => {
        const result = await run(args);
        // A resolved write resyncs every live query (Convex invalidation).
        await this.refreshAll();
        return result;
      };
      this.stableFns.set(cacheKey, fn);
    }
    return fn;
  }

  /** Re-runs the real query for one registered entry and notifies. */
  async refreshEntry(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    await entry.run();
  }

  /** Re-runs every registered query (mutation/action resync). */
  async refreshAll(): Promise<void> {
    for (const entry of [...this.entries.values()]) {
      await entry.run();
    }
  }
}

function useConvexReactSimLiveQuery(
  this: ConvexReactSimLive,
  ref: FunctionReference<"query">,
  args: AnyArgs,
): unknown {
  const tagged = useContext(SimFaceContext);
  if (!tagged) {
    throw new Error(
      "ConvexReactSimLive: mount under <SimFaceProvider sim face>.",
    );
  }
  const key = `${tagged.tag}|${refPath(ref)}|${stableKey(args)}`;
  let entry = this.entries.get(key);
  if (!entry) {
    const created: Entry = {
      value: undefined,
      error: undefined,
      listeners: new Set(),
      run: async () => {
        try {
          created.value = await tagged.face.query(ref, args);
          created.error = undefined;
        } catch (error) {
          created.error = error;
        }
        created.listeners.forEach((listener) => listener());
      },
    };
    entry = created;
    this.entries.set(key, created);
  }
  const captured = entry;
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    captured.listeners.add(bump);
    void this.refreshEntry(key);
    return () => {
      captured.listeners.delete(bump);
    };
  }, [key]);
  // Convex throws a rejected query in render so the nearest error boundary
  // (PromptBoundary, NotesBoundary) owns the refusal.
  if (captured.error !== undefined) throw captured.error;
  return captured.value;
}

/** convex/react useMutation: one stable function per ref and identity. */
function useConvexReactSimLiveMutation(
  this: ConvexReactSimLive,
  ref: MutationRef,
): StableFn {
  const tagged = useContext(SimFaceContext);
  if (!tagged) {
    throw new Error(
      "ConvexReactSimLive: mount under <SimFaceProvider sim face>.",
    );
  }
  const cacheKey = `${tagged.tag}|mutation|${refPath(ref)}`;
  return this.stableRunner(cacheKey, (args) => tagged.face.mutation(ref, args));
}

/** convex/react useAction: one stable function per ref and identity. */
function useConvexReactSimLiveAction(
  this: ConvexReactSimLive,
  ref: ActionRef,
): StableFn {
  const tagged = useContext(SimFaceContext);
  if (!tagged) {
    throw new Error(
      "ConvexReactSimLive: mount under <SimFaceProvider sim face>.",
    );
  }
  const cacheKey = `${tagged.tag}|action|${refPath(ref)}`;
  return this.stableRunner(cacheKey, (args) => tagged.face.action(ref, args));
}

function useConvexReactSimLiveConnectionState(this: ConvexReactSimLive): {
  isWebSocketConnected: boolean;
  hasEverConnected: boolean;
} {
  const connected = useSyncExternalStore(
    (listener) => {
      this.connectionListeners.add(listener);
      return () => this.connectionListeners.delete(listener);
    },
    () => this.connected,
  );
  return { isWebSocketConnected: connected, hasEverConnected: true };
}
