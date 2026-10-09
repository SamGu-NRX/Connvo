/**
 * Queue-type query-param normalization for the smart-connection page.
 *
 * The page used to derive this inline on every render:
 *
 *   const queueType =
 *     rawQueueType === "professional" ? "professional" : "casual";
 *
 * Exact-match semantics are intentional and preserved: only the precise
 * string "professional" selects the professional queue. Missing values
 * (null/undefined), the empty string, different casing, and surrounding
 * whitespace all fall back to "casual".
 */

export type QueueType = "casual" | "professional";

export function normalizeQueueType(raw: string | null | undefined): QueueType {
  return raw === "professional" ? "professional" : "casual";
}
