"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { useConvex } from "convex/react";
import {
  createConvexHistoryTransport,
  type HistoryTransport,
  type HistoryTransportError,
  type TransportResult,
} from "./historyTransport";
import { createFixtureHistoryTransport, FIXTURE_QUERY_FLAG } from "./fixtureTransport";
import { createRequestGate } from "./requestGate";

interface HistoryTransportContextValue {
  transport: HistoryTransport;
  isFixture: boolean;
}

const TransportContext = createContext<HistoryTransportContextValue | null>(null);

function FixtureTransportProvider({ children }: { children: ReactNode }) {
  const value = useMemo<HistoryTransportContextValue>(
    () => ({ transport: createFixtureHistoryTransport(), isFixture: true }),
    [],
  );
  return <TransportContext.Provider value={value}>{children}</TransportContext.Provider>;
}

function ConvexTransportProvider({ children }: { children: ReactNode }) {
  const client = useConvex();
  const value = useMemo<HistoryTransportContextValue>(
    () => ({ transport: createConvexHistoryTransport(client), isFixture: false }),
    [client],
  );
  return <TransportContext.Provider value={value}>{children}</TransportContext.Provider>;
}

/**
 * Chooses the transport per route render: the fixture flag opts the journey
 * into the labeled local fixture; otherwise the real Convex-backed transport.
 */
export function HistoryTransportProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const isFixture = searchParams.get(FIXTURE_QUERY_FLAG) === "1";
  return isFixture ? (
    <FixtureTransportProvider>{children}</FixtureTransportProvider>
  ) : (
    <ConvexTransportProvider>{children}</ConvexTransportProvider>
  );
}

export function useHistoryTransport(): HistoryTransportContextValue {
  const ctx = useContext(TransportContext);
  if (!ctx) throw new Error("useHistoryTransport must be used inside HistoryTransportProvider");
  return ctx;
}

export type ResourceState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: HistoryTransportError };

export interface HistoryResource<T> extends ResourceState<T> {
  retry: () => void;
}

/**
 * Loads a transport resource with stale-response guarding: only the newest
 * request's result may land; late responses from superseded requests are
 * dropped, and the caller can retry after recoverable failures.
 */
export function useHistoryResource<T>(
  load: () => Promise<TransportResult<T>>,
  deps: readonly unknown[],
): HistoryResource<T> {
  const gate = useRef(createRequestGate()).current;
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  const key = JSON.stringify(deps);
  useEffect(() => {
    const requestId = gate.next();
    setState({ status: "loading" });
    let live = true;
    void loadRef.current().then((result) => {
      if (!live || !gate.isCurrent(requestId)) return; // stale response - dropped
      if (result.ok) setState({ status: "ready", data: result.data });
      else setState({ status: "error", error: result.error });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, gate]);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
