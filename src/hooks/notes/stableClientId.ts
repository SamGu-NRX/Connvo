/**
 * Stable client identity (docs/notes-ledger-f1/design.md §3):
 * "clientId: UUID, stable per tab per meeting (sessionStorage), sent with
 * every batch and query."
 *
 * The ledger and the production transport must share ONE identity, or
 * identity acknowledgements and server-side dedupe cannot join: the ledger
 * sends `clientId` with every batch while the transport's query reads the
 * `clientAcks` stored for that same id. A per-mount random id would strand
 * unconfirmed operations after every remount and break teardown recovery.
 *
 * SSR-safe: on the server there is no sessionStorage and the ledger never
 * subscribes, so a per-render placeholder is returned; the client hydrates
 * to the persisted id.
 */

import { useMemo } from "react";

const KEY_PREFIX = "notes-ledger:client:";

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Reads (or creates) the per-tab, per-meeting client id from sessionStorage.
 * Falls back to a per-render id when storage is unavailable (privacy modes,
 * non-browser environments) — degradation is honest: operations still sync,
 * they merely lose cross-remount ack continuity.
 */
export function stableNotesClientId(meetingId: string): string {
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") {
    return createId();
  }
  try {
    const key = `${KEY_PREFIX}${meetingId}`;
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = createId();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return createId();
  }
}

/** React binding: one stable id per tab per meeting for the component tree. */
export function useStableNotesClientId(meetingId: string): string {
  return useMemo(() => stableNotesClientId(meetingId), [meetingId]);
}
