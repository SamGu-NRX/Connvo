/**
 * Pure presentation mapping for the notes panel's honest aggregate states
 * (docs/notes-ledger-f1/design.md §4). Kept framework-free so the mapping is
 * searchable and testable on its own.
 *
 * Honesty rules baked in here:
 *   - "Synced" is the ONLY label that claims server confirmation; nothing
 *     ever renders a plain "Saved" for another state.
 *   - Every state carries a text label (never color alone).
 */

import type {
  NotesLedgerStatus,
  UseNotesLedgerResult,
} from "@/hooks/notes";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  CloudAlert,
  CloudOff,
  CloudUpload,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

export interface NotesStatusPresentation {
  /** Exact visible label (screen readers announce this — keep it self-contained). */
  label: string;
  /** Tailwind classes carrying the tone; always paired with the text label. */
  tone: string;
  /** Decorative icon; the text label carries the meaning (aria-hidden). */
  Icon: LucideIcon;
}

export function presentStatus(
  status: NotesLedgerStatus,
  unconfirmedCount: number,
): NotesStatusPresentation {
  switch (status) {
    case "loading":
      return {
        label: "Loading",
        tone: "text-muted-foreground",
        Icon: Loader2,
      };
    case "synced":
      return {
        label: "Synced",
        tone: "text-emerald-600 dark:text-emerald-400",
        Icon: CheckCircle2,
      };
    case "saving":
      return {
        label: "Saving",
        tone: "text-sky-600 dark:text-sky-400",
        Icon: CloudUpload,
      };
    case "unconfirmed":
      return {
        label: `Unconfirmed (${unconfirmedCount})`,
        tone: "text-amber-600 dark:text-amber-400",
        Icon: CloudAlert,
      };
    case "conflict":
      return {
        label: "Conflict",
        tone: "text-red-600 dark:text-red-400",
        Icon: TriangleAlert,
      };
    case "offline":
      return {
        label: "Offline",
        tone: "text-muted-foreground",
        Icon: CloudOff,
      };
    case "updating":
      return {
        label: "Updating",
        tone: "text-sky-600 dark:text-sky-400",
        Icon: RefreshCw,
      };
  }
}

/** Word/char counts for the quiet metrics row. */
export function notesTextMetrics(text: string): { words: number; characters: number } {
  const trimmed = text.trim();
  return {
    words: trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length,
    characters: text.length,
  };
}

/** Visible word for one unsaved-record state (the loss-proof promise). */
export type UseNotesLedgerRecordState = UseNotesLedgerResult["unsavedRecords"][number]["state"];

export const UNSAVED_STATE_LABELS: Record<
  UseNotesLedgerRecordState,
  string
> = {
  pending: "Pending",
  sending: "Sending",
  unconfirmed: "Unconfirmed",
  rejected: "Rejected",
  conflict: "Conflict",
};

/** Badge variant per record state — color is redundant with the word. */
export function unsavedBadgeVariant(
  state: UseNotesLedgerRecordState,
): "destructive" | "outline" {
  return state === "rejected" || state === "conflict" ? "destructive" : "outline";
}

/** Tone classes per record state, paired with the badge word. */
export function unsavedBadgeTone(state: UseNotesLedgerRecordState): string {
  switch (state) {
    case "unconfirmed":
      return "text-amber-600 dark:text-amber-400";
    case "rejected":
    case "conflict":
      return "";
    default:
      return "text-muted-foreground";
  }
}
