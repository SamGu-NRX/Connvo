"use client";

import { ArrowRight, Check, Clock3, Users, Video } from "lucide-react";
import styles from "./queue.module.css";

export type QueueViewState =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "idle" }
  | { kind: "waiting"; elapsedSeconds: number; notice?: string }
  | {
      kind: "matched";
      name: string;
      reasons: string[];
      secondsLeft: number;
      accepted: boolean;
      partnerAccepted: boolean;
    }
  | { kind: "ready" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

export type QueueViewProps = {
  state: QueueViewState;
  title: string;
  pending: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onRetry: () => void;
};

const noAction = () => {};

export function QueueLoading() {
  // Loading has no action controls; reuse the query-loading view's exact geometry.
  return (
    <QueueView title="Match queue" state={{ kind: "loading" }} pending={false}
      onJoin={noAction} onLeave={noAction} onAccept={noAction}
      onDecline={noAction} onRetry={noAction} />
  );
}

export function elapsedLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function QueueView({
  state,
  title,
  pending,
  onJoin,
  onLeave,
  onAccept,
  onDecline,
  onRetry,
}: QueueViewProps) {
  const announcement =
    state.kind === "matched"
      ? state.accepted
        ? `You accepted. Waiting for ${state.name}.`
        : `Match found with ${state.name}. ${state.reasons.join(". ")}`
      : state.kind === "waiting"
        ? (state.notice ?? "You're in the queue. Looking for someone to meet.")
        : state.kind === "ready"
          ? "You both accepted. Opening your call."
          : state.kind === "expired"
            ? "Your queue session has expired."
            : "";

  return (
    <section
      className={styles.queue}
      aria-labelledby="queue-title"
      data-queue-state={state.kind}
    >
      <header className={styles.header}>
        <p className={styles.eyebrow}>{title}</p>
        <h1 id="queue-title">A conversation starts here.</h1>
        <p>Meet someone through what you have in common.</p>
      </header>
      <p className="sr-only" role="status" aria-atomic="true">
        {announcement}
      </p>
      <div
        className={styles.card}
        aria-busy={pending || state.kind === "loading"}
      >
        {state.kind === "matched" ? (
          <>
            <div className={styles.cardTop}>
              <span className={styles.status}>
                <span className={styles.dot} />
                Match found
              </span>
              <span
                className={styles.timer}
                aria-label={`${state.secondsLeft} seconds to respond`}
              >
                <Clock3 size={15} aria-hidden="true" />
                {elapsedLabel(state.secondsLeft)}
              </span>
            </div>
            <div className={styles.person}>
              <span className={styles.avatar} aria-hidden="true">
                {state.name.trim().slice(0, 1).toUpperCase()}
              </span>
              <div className={styles.personName}>
                <p>Your next conversation</p>
                <h2>{state.name}</h2>
              </div>
            </div>
            <div className={styles.reason}>
              <h3>Why you matched</h3>
              <p>{state.reasons.slice(0, 2).join(" · ")}</p>
            </div>
            <p className={styles.explanation}>
              {state.accepted
                ? "You're ready. Your call opens when they join too."
                : state.partnerAccepted
                  ? "They're ready to meet you. Join when you're ready."
                  : "Join when you're ready. The call opens once you both accept."}
            </p>
            <div className={styles.actions}>
              <button
                className={styles.primary}
                onClick={onAccept}
                disabled={pending || state.accepted || state.secondsLeft <= 0}
              >
                {state.accepted ? (
                  <>
                    <Check size={18} aria-hidden="true" />
                    Waiting for partner
                  </>
                ) : (
                  <>
                    <Video size={18} aria-hidden="true" />
                    Join
                  </>
                )}
              </button>
              <button
                className={styles.secondary}
                onClick={onDecline}
                disabled={pending || state.secondsLeft <= 0}
              >
                Decline
              </button>
            </div>
            <p className={styles.footnote}>
              Your camera and microphone stay off until you join the call lobby.
            </p>
          </>
        ) : state.kind === "waiting" ? (
          <>
            <div className={styles.cardTop}>
              <span className={styles.status}>
                <span className={styles.dot} />
                In the queue
              </span>
              <span className={styles.timer}>
                {elapsedLabel(state.elapsedSeconds)} elapsed
              </span>
            </div>
            {state.notice && <p className={styles.notice}>{state.notice}</p>}
            <div className={styles.emptyIcon}>
              <Users size={30} strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h2>Looking for your next conversation</h2>
            <p className={styles.explanation}>
              We&apos;ll let you know when someone compatible is here. Keep this
              page open while you wait.
            </p>
            <div className={styles.waitDetail}>
              <Check size={16} aria-hidden="true" />
              Your profile helps us find common ground.
            </div>
            <button
              className={styles.secondary}
              onClick={onLeave}
              disabled={pending}
            >
              Leave queue
            </button>
          </>
        ) : state.kind === "error" ? (
          <>
            <p className={styles.status}>Connection interrupted</p>
            <h2>Let&apos;s try that again.</h2>
            <p role="alert" className={styles.explanation}>
              {state.message}
            </p>
            <button
              className={styles.primary}
              onClick={onRetry}
              disabled={pending}
            >
              Retry <ArrowRight size={18} aria-hidden="true" />
            </button>
          </>
        ) : state.kind === "expired" ? (
          <>
            <div className={styles.emptyIcon}>
              <Clock3 size={30} strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h2>Your queue session ended.</h2>
            <p className={styles.explanation}>
              We stopped looking when your availability ran out. Join again when
              you have time for a conversation.
            </p>
            <button
              className={styles.primary}
              onClick={onJoin}
              disabled={pending}
            >
              Rejoin queue <ArrowRight size={18} aria-hidden="true" />
            </button>
          </>
        ) : state.kind === "ready" ? (
          <>
            <div className={styles.emptyIcon}>
              <Check size={30} aria-hidden="true" />
            </div>
            <h2>You&apos;re both ready.</h2>
            <p className={styles.explanation}>
              Opening your shared call lobby.
            </p>
          </>
        ) : state.kind === "signed_out" ? (
          <>
            <h2>Sign in to meet someone.</h2>
            <p className={styles.explanation}>
              Your profile connects you with another person in the queue.
            </p>
            <a className={styles.primary} href="/auth/sign-in">
              Sign in <ArrowRight size={18} aria-hidden="true" />
            </a>
          </>
        ) : state.kind === "idle" ? (
          <>
            <div className={styles.emptyIcon}>
              <Users size={30} aria-hidden="true" />
            </div>
            <h2>Ready to meet someone?</h2>
            <p className={styles.explanation}>
              Join the queue for a one-to-one conversation. You both choose
              whether to join the call.
            </p>
            <button
              className={styles.primary}
              onClick={onJoin}
              disabled={pending}
            >
              Join queue <ArrowRight size={18} aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <p className={styles.status}>Getting ready</p>
            <h2>Checking your queue…</h2>
            <p className={styles.explanation}>
              Restoring your place if you&apos;re already waiting.
            </p>
          </>
        )}
      </div>
      <p className={styles.footer}>
        <Video size={16} aria-hidden="true" />
        One person. One conversation. You choose when to join.
      </p>
    </section>
  );
}
