/**
 * Monotonic request gate: each new load invalidates every earlier request, so
 * late responses from superseded fetches can be identified and dropped.
 */
export interface RequestGate {
  next(): number;
  isCurrent(requestId: number): boolean;
}

export function createRequestGate(): RequestGate {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (requestId) => requestId === current,
  };
}
