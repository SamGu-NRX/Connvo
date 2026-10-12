"use client";

/**
 * The bench call surface (CONTRACT.md DOM contract).
 *
 * Owns minimal local-media handling (getUserMedia via the Chromium fake
 * devices), mounts the transport from the registry by name, and renders the
 * pinned selectors the runner drives: `[data-call-phase]`,
 * `remote-media`/`participant-id` tiles with state attributes, the control
 * testids, `call-error`, and the bench identity line. Accessibility bar:
 * native focusable controls with visible focus rings, no non-essential
 * motion, live-region error reporting.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  CallPhase,
  CallTransport,
  TransportContext,
  TransportEvents,
} from "@/lib/call/transport";
import { loadTransport } from "@/lib/call/transports";

interface RemoteTileState {
  stream: MediaStream | null;
  micOn: boolean;
  cameraOn: boolean;
}

export interface BenchClientProps {
  transportName: string;
  /** A | B | C | O (the harness identity). */
  participant: string;
  /** The JWT `sub` for the participant. */
  selfId: string;
  meetingId: string;
  displayName: string | null;
  delayJoinMs: number;
  showAvatar: boolean;
  autoJoin: boolean;
  forcedState: string | null;
  /** Eval-only signaling override from the runner's `?signal=` param. */
  signalUrl: string | null;
}

/** P-01 forced visual states use the same 1.5 s delay the mock bench uses. */
const FORCED_STATE_DELAY_MS = 1500;

/** Second fake camera fill (CONTRACT.md fixtures: rgb(170,40,170)). */
const SECOND_CAMERA_COLOR = "rgb(170, 40, 170)";

export function BenchClient({
  transportName,
  participant,
  selfId,
  meetingId,
  displayName,
  delayJoinMs,
  showAvatar,
  autoJoin,
  forcedState,
  signalUrl,
}: BenchClientProps) {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [remotes, setRemotes] = useState<Map<string, RemoteTileState>>(new Map());
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);

  const transportRef = useRef<CallTransport | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micRef = useRef(true);
  const cameraRef = useRef(true);
  const secondCameraTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoJoinedRef = useRef(false);

  const identityText = useMemo(
    () =>
      `identity: ${participant}${displayName && displayName !== participant ? ` (${displayName})` : ""} · meeting: ${meetingId}`,
    [participant, displayName, meetingId],
  );

  const stopSecondCamera = useCallback(() => {
    if (secondCameraTimerRef.current) {
      clearInterval(secondCameraTimerRef.current);
      secondCameraTimerRef.current = null;
    }
  }, []);

  const publishLocalState = useCallback((next: { micOn: boolean; cameraOn: boolean }) => {
    micRef.current = next.micOn;
    cameraRef.current = next.cameraOn;
    transportRef.current?.publishLocalState(next);
  }, []);

  const events = useMemo<TransportEvents>(
    () => ({
      onPhase: setPhase,
      onRemoteJoined: ({ participantId }) => {
        setRemotes((prev) => {
          if (prev.has(participantId)) return prev;
          const next = new Map(prev);
          next.set(participantId, { stream: null, micOn: true, cameraOn: true });
          return next;
        });
      },
      onRemoteLeft: ({ participantId }) => {
        setRemotes((prev) => {
          if (!prev.has(participantId)) return prev;
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
      },
      onRemoteStream: ({ participantId, stream }) => {
        setRemotes((prev) => {
          const next = new Map(prev);
          const tile = prev.get(participantId) ?? { stream: null, micOn: true, cameraOn: true };
          next.set(participantId, { ...tile, stream });
          return next;
        });
      },
      onRemoteState: (state) => {
        setRemotes((prev) => {
          if (!prev.has(state.participantId)) return prev;
          const next = new Map(prev);
          next.set(state.participantId, {
            ...prev.get(state.participantId)!,
            micOn: state.micOn,
            cameraOn: state.cameraOn,
          });
          return next;
        });
      },
      onError: (e) => {
        setError({ message: e.message, retryable: e.retryable });
      },
    }),
    [],
  );

  /** H-06: capture failure is actionable and retryable via retry-media. */
  const capture = useCallback(async (): Promise<MediaStream> => {
    const existing = streamRef.current;
    if (existing && existing.getVideoTracks().some((t) => t.readyState === "live")) {
      return existing;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    streamRef.current = stream;
    return stream;
  }, []);

  const join = useCallback(async () => {
    setError(null);
    setPhase("joining");
    let transport = transportRef.current;
    if (!transport) {
      transport = await loadTransport(transportName, { signalUrl: signalUrl ?? undefined });
      transportRef.current = transport;
    }
    try {
      await capture();
    } catch (err) {
      const reason = err instanceof Error ? err.name : "error";
      setError({
        message: `Microphone and camera access was denied (${reason}). Allow access to join this call.`,
        retryable: true,
      });
      setPhase("failed");
      return;
    }
    try {
      const context: TransportContext = {
        meetingId,
        selfId,
        identityToken: async () => {
          // The bench mints on the reference signaling server itself (no
          // Convex, no JWKS, no backend): swap the signal URL's ws scheme for
          // http and POST the participant id; the minted subject IS that id.
          if (!signalUrl) {
            throw new Error("bench has no ?signal= URL; run it through pnpm call-eval");
          }
          // new URL, not string concatenation: the normalized signal URL
          // ends in "/", and "//mint" missed the server's route.
          const res = await fetch(new URL("/mint", signalUrl.replace(/^ws/, "http")), {
            method: "POST",
            // text/plain keeps this a CORS "simple" request: the page and the
            // signaling server are different origins, and no preflight means
            // no browser policy can block the mint before it is sent.
            headers: { "content-type": "text/plain" },
            body: JSON.stringify({ user: participant }),
          });
          if (!res.ok) throw new Error(`bench mint unavailable (${res.status})`);
          const data = (await res.json()) as { token: string };
          return data.token;
        },
        getLocalStream: () => streamRef.current,
      };
      await transport.connect(context, events);
      transport.publishLocalStream(streamRef.current);
      publishLocalState({ micOn: micRef.current, cameraOn: cameraRef.current });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setError({ message: `Could not reach the call (${reason}).`, retryable: true });
      setPhase("failed");
    }
  }, [capture, events, meetingId, participant, publishLocalState, selfId, signalUrl, transportName]);

  // Auto-join (H scenarios) with the P-05 slow-join delay.
  // React StrictMode (on by default under `next dev`) runs this effect twice
  // on mount. Two joins built two transports that said hello with the same
  // identity, and the server kept swapping one socket for the other. The ref
  // survives StrictMode's remount, so the auto-join fires once; it is set
  // when the join fires, so a cleared delay timer re-arms on the remount.
  useEffect(() => {
    if (!autoJoin || autoJoinedRef.current) return;
    const fire = () => {
      if (autoJoinedRef.current) return;
      autoJoinedRef.current = true;
      void join();
    };
    if (delayJoinMs > 0) {
      joinTimerRef.current = setTimeout(fire, delayJoinMs);
    } else {
      fire();
    }
    return () => {
      if (joinTimerRef.current) {
        clearTimeout(joinTimerRef.current);
        joinTimerRef.current = null;
      }
    };
    // join() is stable for this mount's fixed props; an empty dep list keeps
    // the auto-join exactly once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // P-01: deterministic failed/reconnecting/ended states.
  useEffect(() => {
    if (!forcedState) return;
    if (!["failed", "reconnecting", "ended"].includes(forcedState)) return;
    const timer = setTimeout(() => {
      if (forcedState === "failed") {
        setError({ message: "Connection failed (forced state for polish checks).", retryable: false });
        setPhase("failed");
      } else if (forcedState === "ended") {
        setPhase("left");
      } else {
        setPhase("reconnecting");
      }
    }, FORCED_STATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [forcedState]);

  // D5/H-13: leaving releases the transport and every capture track.
  const leave = useCallback(async () => {
    stopSecondCamera();
    await transportRef.current?.leave();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    micRef.current = true;
    cameraRef.current = true;
    setMicOn(true);
    setCameraOn(true);
    setRemotes(new Map());
  }, [stopSecondCamera]);

  useEffect(() => {
    return () => {
      void transportRef.current?.leave();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      stopSecondCamera();
      if (joinTimerRef.current) clearTimeout(joinTimerRef.current);
    };
  }, [stopSecondCamera]);

  const toggleMic = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
    publishLocalState({ micOn: track.enabled, cameraOn: cameraRef.current });
  }, [publishLocalState]);

  /** H-04: camera off releases the capture track (it becomes `ended`). */
  const toggleCamera = useCallback(() => {
    if (cameraRef.current) {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;
      stopSecondCamera();
      track.stop();
      setCameraOn(false);
      publishLocalState({ micOn: micRef.current, cameraOn: false });
    } else {
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          const fresh = stream.getVideoTracks()[0];
          const current = streamRef.current;
          if (current) {
            for (const old of current.getVideoTracks()) current.removeTrack(old);
            current.addTrack(fresh);
          } else {
            streamRef.current = stream;
          }
          setCameraOn(true);
          transportRef.current?.publishLocalStream(streamRef.current);
          publishLocalState({ micOn: micRef.current, cameraOn: true });
        } catch {
          setError({ message: "Camera restart failed. Retry to rejoin with video.", retryable: true });
        }
      })();
    }
  }, [publishLocalState, stopSecondCamera]);

  /**
   * H-05: the second fake device is the pinned second-camera fixture painted
   * on a canvas (the same mechanism the runner's mock bench pins), so the
   * switch works without a second physical device.
   */
  const switchCamera = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    stopSecondCamera();
    let counter = 0;
    secondCameraTimerRef.current = setInterval(() => {
      ctx.fillStyle = SECOND_CAMERA_COLOR;
      ctx.fillRect(0, 0, 320, 200);
      ctx.fillStyle = "rgb(235, 235, 235)";
      ctx.fillRect(0, 200, 320, 40);
      ctx.fillStyle = "rgb(20, 20, 20)";
      const bits = (counter & 4095).toString(2).padStart(12, "0");
      for (let i = 0; i < 12; i++) {
        if (bits[i] === "1") ctx.fillRect(24 + i * 12, 200, 12, 40);
      }
      ctx.fillRect(8, 200, 16, 40);
      ctx.fillRect(168, 200, 16, 40);
      counter++;
    }, 33);
    const canvasTrack = canvas.captureStream(30).getVideoTracks()[0];
    for (const old of stream.getVideoTracks()) {
      stream.removeTrack(old);
      old.stop();
    }
    stream.addTrack(canvasTrack);
    transportRef.current?.publishLocalStream(stream);
  }, [stopSecondCamera]);

  const joined = phase === "joining" || phase === "connected" || phase === "reconnecting";

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-6">
      <div
        data-testid="call-root"
        data-call-phase={phase}
        className="mx-auto flex w-full max-w-4xl flex-col gap-4"
      >
        <header className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Dev call bench — not production
          </p>
          <h1 className="text-lg font-semibold">Connvo call bench · {transportName}</h1>
          <p data-testid="bench-identity" className="text-sm text-muted-foreground">
            {identityText}
          </p>
          <p data-testid="bench-signaling" className="text-xs text-muted-foreground">
            signaling: {signalUrl ?? process.env.NEXT_PUBLIC_CONNVO_CALL_SIGNALING_URL ?? "ws://127.0.0.1:9301"}
          </p>
        </header>

        {error ? (
          <div
            role="alert"
            data-testid="call-error"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error.message}
          </div>
        ) : (
          <div data-testid="call-error" hidden />
        )}

        {phase === "idle" ? (
          <p data-testid="lobby-panel" className="text-sm text-muted-foreground">
            Waiting to join…
          </p>
        ) : null}

        {phase === "left" ? (
          <div
            data-testid="ended-panel"
            className="rounded-md border bg-card px-3 py-2 text-sm text-card-foreground"
          >
            Call ended. All capture tracks were released.
          </div>
        ) : null}

        {joined || phase === "failed" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="participants">
            <div data-testid="local-tile" className="flex flex-col gap-2">
              <video
                data-testid="local-video"
                autoPlay
                muted
                playsInline
                aria-label="Your camera preview"
                className="aspect-video w-full rounded-md border bg-black object-cover"
                ref={(node) => {
                  if (node && streamRef.current && node.srcObject !== streamRef.current) {
                    node.srcObject = streamRef.current;
                  }
                }}
              />
              <div className="flex items-center gap-2 text-sm">
                <span
                  data-testid="local-avatar"
                  className={
                    showAvatar
                      ? "flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-medium"
                      : "flex size-6 items-center justify-center rounded-full border border-dashed text-xs text-muted-foreground"
                  }
                >
                  {showAvatar ? participant : ""}
                </span>
                <span data-testid="local-name" className="truncate">
                  {displayName ?? participant}
                </span>
              </div>
            </div>

            {[...remotes.entries()].map(([participantId, tile]) => (
              <div
                key={participantId}
                data-testid="remote-media"
                data-participant-id={participantId}
                data-audio-muted={String(!tile.micOn)}
                data-video-off={String(!tile.cameraOn)}
                className="flex flex-col gap-2"
              >
                <video
                  autoPlay
                  muted
                  playsInline
                  aria-label={`Remote video from ${participantId}`}
                  className="aspect-video w-full rounded-md border bg-black object-cover"
                  ref={(node) => {
                    if (node && tile.stream && node.srcObject !== tile.stream) {
                      node.srcObject = tile.stream;
                    }
                  }}
                />
                <audio
                  autoPlay
                  aria-label={`Remote audio from ${participantId}`}
                  ref={(node) => {
                    if (node && tile.stream && node.srcObject !== tile.stream) {
                      node.srcObject = tile.stream;
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground">{participantId}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div data-testid="call-controls" className="flex flex-wrap items-center gap-2">
          {!joined ? (
            <Button
              data-testid="join-call"
              type="button"
              onClick={() => void join()}
              className="motion-reduce:transition-none"
            >
              Join call
            </Button>
          ) : null}
          <Button
            data-testid="toggle-mic"
            type="button"
            variant="outline"
            disabled={!joined}
            onClick={toggleMic}
            className="motion-reduce:transition-none"
          >
            {micOn ? "Mute mic" : "Unmute mic"}
          </Button>
          <Button
            data-testid="toggle-camera"
            type="button"
            variant="outline"
            disabled={!joined}
            onClick={toggleCamera}
            className="motion-reduce:transition-none"
          >
            {cameraOn ? "Turn camera off" : "Turn camera on"}
          </Button>
          <Button
            data-testid="switch-camera"
            type="button"
            variant="outline"
            disabled={!joined}
            onClick={switchCamera}
            className="motion-reduce:transition-none"
          >
            Switch camera
          </Button>
          <Button
            data-testid="leave-call"
            type="button"
            variant="destructive"
            disabled={!joined}
            onClick={() => void leave()}
            className="motion-reduce:transition-none"
          >
            Leave call
          </Button>
          {error?.retryable ? (
            <Button
              data-testid="retry-media"
              type="button"
              variant="secondary"
              onClick={() => void join()}
              className="motion-reduce:transition-none"
            >
              Retry media
            </Button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
