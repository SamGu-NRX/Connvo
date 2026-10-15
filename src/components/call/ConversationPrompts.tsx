"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import styles from "./prompts.module.css";

export type PromptViewState = FunctionReturnType<
  typeof api.prompts.live.current
>;

/** A standalone side-slot component. It never owns media or call layout. */
export function ConversationPrompts({
  meetingId,
  inCall,
}: {
  meetingId: Id<"meetings">;
  inCall: boolean;
}) {
  return (
    <PromptBoundary key={meetingId}>
      <ConnectedPrompts meetingId={meetingId} inCall={inCall} />
    </PromptBoundary>
  );
}

function ConnectedPrompts({
  meetingId,
  inCall,
}: {
  meetingId: Id<"meetings">;
  inCall: boolean;
}) {
  const state = useQuery(api.prompts.live.current, { meetingId });
  const pick = useAction(api.prompts.live.pick);
  const markUsed = useMutation(api.prompts.live.markUsed);
  const pause = useMutation(api.prompts.live.pauseAuto);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const retryAfter = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function request(automatic: boolean) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await pick({ meetingId, automatic });
      if (result.status === "rate_limited")
        setError(
          "Give this one a moment. You can request up to five ideas every ten minutes.",
        );
    } catch {
      setError(
        "Couldn't update the prompt. Your call can continue. Try again.",
      );
    } finally {
      inflight.current = false;
      // Prevent repeated requests while a subscription catches up or is offline.
      retryAfter.current = Date.now() + 15_000;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (
      !state ||
      !inCall ||
      !state.active ||
      state.autoPaused ||
      state.exhausted ||
      error ||
      now < state.nextAutoAt ||
      now < state.pendingUntil ||
      now < retryAfter.current ||
      document.visibilityState !== "visible"
    )
      return;
    void request(true);
    // State/clock drives this check; request is intentionally not a timer dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, now, inCall, error]);

  async function toggleAuto() {
    try {
      await pause({ meetingId, paused: !state?.autoPaused });
      setError(null);
    } catch {
      setError("Couldn't change automatic prompts. Try again.");
    }
  }

  async function markCurrentUsed() {
    if (!state?.prompt) return;
    setError(null);
    try {
      await markUsed({ meetingId, promptId: state.prompt.id });
    } catch {
      setError("Couldn't save that you used this prompt. Try again.");
    }
  }

  return (
    <PromptPanel
      state={state}
      inCall={inCall}
      now={now}
      busy={busy}
      error={error}
      onAnother={() => void request(false)}
      onUsed={() => void markCurrentUsed()}
      onPause={() => void toggleAuto()}
    />
  );
}

export function PromptPanel({
  state,
  inCall,
  now,
  busy,
  error,
  onAnother,
  onUsed,
  onPause,
}: {
  state: PromptViewState | undefined;
  inCall: boolean;
  now: number;
  busy: boolean;
  error: string | null;
  onAnother: () => void;
  onUsed: () => void;
  onPause: () => void;
}) {
  const [keyboard, setKeyboard] = useState(false);
  const pending = busy || Boolean(state && now < state.pendingUntil);
  const available = inCall && state?.active && !state.exhausted;
  const waitSeconds = state
    ? Math.max(0, Math.ceil((state.nextManualAt - now) / 1000))
    : 0;
  const waiting = waitSeconds > 0;
  return (
    <section
      className={styles.panel}
      data-keyboard={keyboard}
      onKeyDownCapture={() => setKeyboard(true)}
      onPointerDownCapture={() => setKeyboard(false)}
      aria-labelledby="conversation-prompts-title"
      data-testid="conversation-prompts"
    >
      <header className={styles.header}>
        <h2 id="conversation-prompts-title">A little inspiration</h2>
        <span className={styles.shared}>Shared with your partner</span>
      </header>
      <div
        className={styles.body}
        aria-live="polite"
        aria-atomic="true"
        aria-busy={pending}
      >
        {state === undefined ? (
          <p className={styles.hint}>Loading conversation prompts…</p>
        ) : state.prompt ? (
          <>
            <p className={styles.eyebrow}>Something to ask</p>
            <p
              key={state.prompt.id}
              className={styles.question}
              data-testid="current-prompt"
            >
              {state.prompt.content}
            </p>
            <p className={styles.saved}>
              {state.prompt.used
                ? "Marked as used. Saved to your recap."
                : "Take it wherever you like."}
            </p>
          </>
        ) : (
          <p className={styles.question}>
            {!inCall
              ? "A good conversation starts with a little curiosity."
              : !state.active
                ? "No prompts were shown during this call."
                : state.autoPaused
                  ? "Ready for an idea? Get one whenever you like."
                  : error
                    ? "Get an idea when you're ready to try again."
                    : "An idea for your conversation is on its way."}
          </p>
        )}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {state ? (
        <>
          <div className={styles.actions}>
            {state.prompt ? (
              <button
                type="button"
                onClick={onUsed}
                disabled={!inCall || !state.active || state.prompt.used}
              >
                {state.prompt.used ? "Used ✓" : "We used this"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onAnother}
              disabled={!available || pending || waiting}
            >
              {pending
                ? "Finding an idea…"
                : state.prompt
                  ? "Another one"
                  : "Get an idea"}
            </button>
          </div>
          <p className={styles.hint}>
            {!inCall
              ? "Prompts are ready when you join."
              : !state.active
                ? "This call has ended. Your prompts are saved."
                : state.exhausted
                  ? "You've reached the prompt limit for this call. Enjoy the conversation."
                  : waiting
                    ? `Another idea in ${waitSeconds >= 60 ? `${Math.ceil(waitSeconds / 60)} min` : `${waitSeconds}s`}.`
                    : "You both see the same prompt."}
          </p>
          {inCall && state.active && !state.exhausted ? (
            <div className={styles.auto}>
              <p>
                {state.autoPaused
                  ? "Automatic prompts are paused for both of you."
                  : "A fresh idea after 90 seconds without shared-note edits."}
              </p>
              <button type="button" onClick={onPause}>
                {state.autoPaused ? "Resume" : "Pause"}
                <span className={styles.srOnly}> automatic prompts</span>
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

class PromptBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section className={styles.panel} aria-label="Conversation prompts">
          <h2>Prompts unavailable</h2>
          <p className={styles.hint} role="alert">
            Only meeting participants can see these prompts. If you were
            invited, check your connection and try again.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              onClick={() => this.setState({ failed: false })}
            >
              Try again
            </button>
          </div>
        </section>
      );
    return this.props.children;
  }
}
