"use client";

/**
 * Catches a failed history query (Convex useQuery throws on refusal) and
 * shows one plain sentence instead of taking the page down. The refusals are
 * the server's: not a participant, or the feature switched off.
 */
import { Component, type ReactNode } from "react";

export type HistoryErrorKind = "refused" | "disabled" | "failed";

export function classifyHistoryError(error: unknown): HistoryErrorKind {
  const text = error instanceof Error ? error.message : String(error);
  if (/after-call history is disabled/i.test(text)) return "disabled";
  if (/not a meeting participant|access denied|forbidden/i.test(text))
    return "refused";
  return "failed";
}

const MESSAGES: Record<HistoryErrorKind, string> = {
  refused: "This meeting's recap is only for the people who were in it.",
  disabled: "Meeting history isn't available.",
  failed: "This couldn't load. Reload the page to try again.",
};

export class HistoryBoundary extends Component<
  { children: ReactNode; className?: string },
  { error: unknown }
> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error === null) return this.props.children;
    const kind = classifyHistoryError(this.state.error);
    return (
      <p
        role="alert"
        data-testid="history-error"
        data-kind={kind}
        className={
          this.props.className ??
          // A card surface: on the bare page backdrop this muted text
          // measured 3.76:1 where a tinted blob sits behind it; on the card
          // it is 4.73:1, like the muted text in the recap's own cards.
          "bg-card text-muted-foreground rounded-md border p-4 text-sm"
        }
      >
        {MESSAGES[kind]}
      </p>
    );
  }
}
