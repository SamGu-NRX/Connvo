"use client";

import {
  Component,
  cloneElement,
  isValidElement,
  type ReactNode,
} from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { isAccessDeniedError } from "@/lib/history/view";

interface HistoryErrorBoundaryProps {
  children: ReactNode;
  /** Surface name shown in the error heading, e.g. "meeting history". */
  label: string;
}

interface HistoryErrorBoundaryState {
  error: Error | null;
  attempt: number;
}

/**
 * Renders the honest error state for Convex query failures and remounts
 * the failed subtree on retry so subscriptions are re-created. Access
 * denied failures (feature disabled, non-participant) offer no retry —
 * repeating an access-denied request cannot succeed.
 */
export class HistoryErrorBoundary extends Component<
  HistoryErrorBoundaryProps,
  HistoryErrorBoundaryState
> {
  state: HistoryErrorBoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<HistoryErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  private readonly retry = (): void => {
    this.setState((previous) => ({
      error: null,
      attempt: previous.attempt + 1,
    }));
  };

  render(): ReactNode {
    const { error, attempt } = this.state;
    if (error === null) {
      if (isValidElement(this.props.children)) {
        // Re-key on retry so the failing subtree remounts and its Convex
        // subscriptions are re-created from scratch.
        return cloneElement(this.props.children, { key: `attempt-${attempt}` });
      }
      return this.props.children;
    }

    const denied = isAccessDeniedError(error);
    return (
      <div
        className="mx-auto w-full max-w-3xl px-4 py-8"
        role="alert"
        data-testid="history-error"
      >
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load {this.props.label}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
        {denied ? (
          <p className="text-muted-foreground mt-3 text-sm">
            If you believe this is a mistake, contact the meeting organizer.
          </p>
        ) : (
          <Button
            className="mt-4"
            onClick={this.retry}
            data-testid="history-error-retry"
          >
            Try again
          </Button>
        )}
      </div>
    );
  }
}
