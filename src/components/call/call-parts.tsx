"use client";

import { useEffect, useRef, useState, useId } from "react";
import { MicOff, VideoOff } from "lucide-react";

import { cn } from "@/lib/utils";
import styles from "./call.module.css";

let sharedAudio: AudioContext | null = null;
function audioContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  if (!sharedAudio) {
    sharedAudio = new AudioContext();
    // Chrome starts an AudioContext made before any user gesture suspended,
    // which would leave the lobby's mic meter flat. Resume on the first one.
    const resume = () => void sharedAudio?.resume().catch(() => {});
    window.addEventListener("pointerdown", resume, {
      once: true,
      capture: true,
    });
    window.addEventListener("keydown", resume, { once: true, capture: true });
  }
  return sharedAudio;
}

/**
 * Tracks the microphone level of `stream` and writes it to the line element
 * each frame (transform, or opacity under reduced motion). No React state
 * changes per frame.
 */
export function VoiceLine({
  stream,
  version,
  active,
  ring = false,
}: {
  stream: MediaStream | null;
  version: number;
  active: boolean;
  ring?: boolean;
}) {
  const lineRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const line = lineRef.current;
    const track = stream?.getAudioTracks()[0];
    const ctx = audioContext();
    if (!line || !track || !ctx || !active) {
      if (line) line.style.transform = line.style.opacity = "";
      return;
    }
    void ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let level = 0;
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      // This visual activity heuristic is not a calibrated speech detector.
      // Quick attack and slower release keep the line from flickering.
      const target = Math.min(1, rms * 6);
      level = target > level ? target : level * 0.9 + target * 0.1;
      // Set both each frame, so switching the preference mid-call never
      // leaves a stale value from the other mode behind.
      if (ring) {
        line.style.opacity = String(
          level > 0.08 ? Math.min(1, 0.35 + level) : 0,
        );
        line
          .closest("figure")
          ?.setAttribute("data-speaking", String(level > 0.08));
      } else if (reduce.matches) {
        line.style.transform = "";
        line.style.opacity = String(0.25 + level * 0.75);
      } else {
        line.style.opacity = "";
        line.style.transform = `scaleX(${level.toFixed(3)})`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      line.style.transform = line.style.opacity = "";
    };
  }, [stream, version, active, ring]);

  if (ring)
    return <span ref={lineRef} aria-hidden className={styles.speakingRing} />;

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
    >
      <span
        ref={lineRef}
        className={cn(styles.voiceLine, "block h-full w-full bg-[var(--live)]")}
      />
    </span>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (
    parts.length === 1
      ? parts[0].slice(0, 2)
      : parts[0][0] + parts[parts.length - 1][0]
  ).toUpperCase();
}

/** Plays a stream in a video element; audio plays unless `muted`. */
export function StreamVideo({
  stream,
  version,
  muted,
  mirrored,
  hidden,
  testId,
}: {
  stream: MediaStream | null;
  version: number;
  muted: boolean;
  mirrored?: boolean;
  hidden?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    let current = true;
    const play = () => {
      if (stream)
        void el
          .play()
          .then(() => {
            if (current) setBlocked(false);
          })
          .catch((error: unknown) => {
            if (
              current &&
              error instanceof DOMException &&
              error.name === "NotAllowedError"
            )
              setBlocked(true);
          });
    };
    play();
    el.addEventListener("loadedmetadata", play);
    return () => {
      current = false;
      el.removeEventListener("loadedmetadata", play);
      el.srcObject = null;
    };
  }, [stream, version]);
  return (
    <>
      <video
        ref={ref}
        data-testid={testId}
        autoPlay
        playsInline
        muted={muted}
        className={cn(
          "absolute inset-0 h-full w-full object-cover",
          mirrored && "-scale-x-100",
          hidden && "invisible",
        )}
      />
      {blocked && !muted ? (
        <button
          type="button"
          className={styles.enableAudio}
          onClick={() => {
            void ref.current
              ?.play()
              .then(() => setBlocked(false))
              .catch(() => setBlocked(true));
          }}
        >
          Tap to hear the call
        </button>
      ) : null}
    </>
  );
}

export interface TileProps {
  name: string;
  stream: MediaStream | null;
  version: number;
  micOn: boolean;
  cameraOn: boolean;
  self?: boolean;
  dim?: boolean;
  className?: string;
  /** The DOM-contract wrapper attributes for remote tiles. */
  contract?: { participantId: string };
}

export function Tile({
  name,
  stream,
  version,
  micOn,
  cameraOn,
  self,
  dim,
  className,
  contract,
}: TileProps) {
  const hasVideo =
    cameraOn && !!stream?.getVideoTracks().some((t) => t.readyState === "live");
  return (
    <figure
      className={cn(
        styles.tile,
        "relative isolate m-0 overflow-hidden rounded-xl bg-[var(--tile)]",
        className,
      )}
      data-dim={dim ? "true" : "false"}
      {...(contract
        ? {
            "data-testid": "remote-media",
            "data-participant-id": contract.participantId,
            "data-audio-muted": String(!micOn),
            "data-video-off": String(!cameraOn),
          }
        : {})}
    >
      <StreamVideo
        stream={stream}
        version={version}
        muted={!!self}
        mirrored={self}
        hidden={!hasVideo}
        testId={self ? "local-video" : undefined}
      />
      {!hasVideo ? (
        <div className="absolute inset-0 grid place-items-center">
          <span className="grid size-16 place-items-center rounded-full bg-white/8 text-xl font-medium tracking-wide text-[var(--ink)] sm:size-20 sm:text-2xl">
            {initials(name)}
          </span>
        </div>
      ) : null}
      <figcaption className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-sm bg-black/55 px-2 py-1 text-xs text-[var(--ink)] backdrop-blur-sm">
        {!micOn ? (
          <MicOff
            aria-label="Microphone off"
            className="size-3.5 shrink-0 text-rose-300"
          />
        ) : null}
        {!cameraOn ? (
          <VideoOff
            aria-label="Camera off"
            className="size-3.5 shrink-0 text-[var(--ink-muted)]"
          />
        ) : null}
        <span className="truncate">{self ? `${name} (you)` : name}</span>
      </figcaption>
      <VoiceLine stream={stream} version={version} active={micOn} ring />
    </figure>
  );
}

export function DeviceSelect({
  label,
  devices,
  value,
  onChange,
  disabled,
  dark,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value: string | null;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
  dark?: boolean;
}) {
  const unique = useId();
  const id =
    label === "Camera"
      ? "device-camera"
      : `device-${label.toLowerCase().replace(/\s+/g, "-")}-${unique}`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        htmlFor={id}
        className={cn(
          "text-xs font-medium",
          dark ? "text-[var(--ink-muted)]" : "text-muted-foreground",
        )}
      >
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled || devices.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-11 w-full min-w-0 truncate rounded-md border px-2.5 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-emerald-400/50 disabled:opacity-60 sm:h-10 sm:text-sm",
          dark
            ? "border-white/15 bg-white/5 text-[var(--ink)] [&>option]:text-black"
            : "border-input bg-background",
        )}
      >
        {devices.length === 0 ? <option value="">None found</option> : null}
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}
