"use client";

/**
 * The two-to-four person call room: lobby, call, and ended screens on one
 * dark stage. Capture is owned by useLocalMedia; the transport (anything
 * implementing src/lib/call/transport.ts) only forwards it.
 *
 * DOM contract (docs/plan/CALL-PLAN.md): `[data-call-phase]` on the root,
 * `[data-testid="remote-media"]` tiles with data-participant-id,
 * data-audio-muted and data-video-off, and buttons toggle-mic,
 * toggle-camera, leave-call and retry-media. Leaving asks for confirmation:
 * leave-call opens the dialog and leave-call-confirm leaves.
 */
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Check,
  Link2,
  Mic,
  MicOff,
  PhoneOff,
  Settings2,
  Video,
  VideoOff,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLocalMedia, type LocalMedia } from "@/hooks/useLocalMedia";
import type {
  CallPhase,
  CallTransport,
  TransportEvents,
} from "@/lib/call/transport";
import { cn } from "@/lib/utils";

import { DeviceSelect, Tile } from "./call-parts";
import styles from "./call.module.css";

export interface CallRoomProps {
  meetingId: string;
  self: { id: string; name: string };
  createTransport: () => Promise<CallTransport>;
  identityToken: () => Promise<string>;
  nameFor: (participantId: string) => string;
  exitHref: string;
  /** The link to share so someone else can join this call. */
  inviteLink: () => string;
}

interface Remote {
  stream: MediaStream | null;
  version: number;
  micOn: boolean;
  cameraOn: boolean;
}

type Screen = "lobby" | "call" | "ended";

const MAX_PEOPLE = 4;

export function CallRoom({
  meetingId,
  self,
  createTransport,
  identityToken,
  nameFor,
  exitHref,
  inviteLink,
}: CallRoomProps) {
  const media = useLocalMedia();
  const [screen, setScreen] = useState<Screen>("lobby");
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [callError, setCallError] = useState<{
    message: string;
    retryable: boolean;
  } | null>(null);
  const [remotes, setRemotes] = useState<Map<string, Remote>>(new Map());
  const [confirmLeave, setConfirmLeave] = useState(false);
  const leaveButtonRef = useRef<HTMLButtonElement>(null);
  const leavingRef = useRef(false);
  const transportRef = useRef<CallTransport | null>(null);
  const mediaRef = useRef(media);
  mediaRef.current = media;

  // Ask for the camera as soon as the lobby opens, so the preview is live.
  const { start } = media;
  useEffect(() => {
    void start();
  }, [start]);

  const updateRemote = useCallback(
    (id: string, patch: (r: Remote) => Remote) => {
      setRemotes((prev) => {
        const next = new Map(prev);
        next.set(
          id,
          patch(
            prev.get(id) ?? {
              stream: null,
              version: 0,
              micOn: true,
              cameraOn: true,
            },
          ),
        );
        return next;
      });
    },
    [],
  );

  const events = useMemo<TransportEvents>(
    () => ({
      onPhase: setPhase,
      onRemoteJoined: ({ participantId }) =>
        updateRemote(participantId, (r) => r),
      onRemoteLeft: ({ participantId }) =>
        setRemotes((prev) => {
          if (!prev.has(participantId)) return prev;
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        }),
      onRemoteStream: ({ participantId, stream }) =>
        updateRemote(participantId, (r) => ({
          ...r,
          stream,
          version: r.version + 1,
        })),
      onRemoteState: ({ participantId, micOn, cameraOn }) =>
        updateRemote(participantId, (r) => ({ ...r, micOn, cameraOn })),
      onError: (e) =>
        setCallError({ message: e.message, retryable: e.retryable }),
    }),
    [updateRemote],
  );

  const join = useCallback(async () => {
    const m = mediaRef.current;
    if (m.status !== "ready") return;
    setCallError(null);
    setRemotes(new Map());
    setScreen("call");
    try {
      await transportRef.current?.leave();
      const transport = await createTransport();
      transportRef.current = transport;
      await transport.connect(
        {
          meetingId,
          selfId: self.id,
          identityToken,
          getLocalStream: () => mediaRef.current.stream,
        },
        events,
      );
      transport.publishLocalStream(m.stream);
      transport.publishLocalState({ micOn: m.micOn, cameraOn: m.cameraOn });
    } catch (err) {
      setCallError({
        message:
          err instanceof Error ? err.message : "The call could not start.",
        retryable: true,
      });
      setPhase("failed");
    }
  }, [createTransport, events, identityToken, meetingId, self.id]);

  // Forward capture changes (device switch, camera on/off) and mute state.
  useEffect(() => {
    transportRef.current?.publishLocalStream(media.stream);
  }, [media.stream, media.version]);
  useEffect(() => {
    transportRef.current?.publishLocalState({
      micOn: media.micOn,
      cameraOn: media.cameraOn,
    });
  }, [media.micOn, media.cameraOn]);

  const leave = useCallback(async () => {
    leavingRef.current = true;
    setConfirmLeave(false);
    await transportRef.current?.leave();
    transportRef.current = null;
    mediaRef.current.release();
    setRemotes(new Map());
    setPhase("left");
    setScreen("ended");
  }, []);

  const rejoin = useCallback(async () => {
    setScreen("lobby");
    setPhase("idle");
    await mediaRef.current.start();
  }, []);

  useEffect(
    () => () => {
      void transportRef.current?.leave();
    },
    [],
  );

  const domPhase: CallPhase =
    screen === "lobby" ? "idle" : screen === "ended" ? "left" : phase;

  return (
    <div
      data-call-phase={domPhase}
      data-testid="call-root"
      className={cn(
        styles.room,
        "relative flex h-full min-h-[34rem] w-full flex-col overflow-hidden rounded-md bg-[var(--stage)] text-[var(--ink)]",
      )}
    >
      {screen === "lobby" ? (
        <Lobby
          media={media}
          selfName={self.name}
          meetingId={meetingId}
          onJoin={join}
        />
      ) : screen === "ended" ? (
        <Ended exitHref={exitHref} onRejoin={rejoin} />
      ) : (
        <InCall
          media={media}
          self={self}
          phase={phase}
          remotes={remotes}
          nameFor={nameFor}
          callError={callError}
          onRetry={join}
          onLeave={() => {
            leavingRef.current = false;
            setConfirmLeave(true);
          }}
          leaveButtonRef={leaveButtonRef}
          inviteLink={inviteLink}
          exitHref={exitHref}
        />
      )}

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent
          className="max-w-sm motion-reduce:animate-none"
          onCloseAutoFocus={(e) => {
            // Stay returns focus to Leave; leaving moves it to the ended
            // screen's heading instead.
            e.preventDefault();
            if (!leavingRef.current) leaveButtonRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Leave the call?</AlertDialogTitle>
            <AlertDialogDescription>
              Your camera and microphone turn off. You can rejoin from this
              page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              data-testid="leave-call-confirm"
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/50"
              onClick={() => void leave()}
            >
              Leave call
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ lobby */

function Lobby({
  media,
  selfName,
  meetingId,
  onJoin,
}: {
  media: LocalMedia;
  selfName: string;
  meetingId: string;
  onJoin: () => void;
}) {
  const blocked =
    media.status === "denied" ||
    media.status === "no-device" ||
    media.status === "error";
  return (
    <div
      className={cn(
        styles.screen,
        "grid flex-1 content-center gap-5 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)] lg:gap-8 lg:p-8",
      )}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-md bg-[var(--tile)]",
          blocked ? "min-h-[16rem]" : "aspect-video",
        )}
      >
        {blocked ? (
          <MediaProblem media={media} />
        ) : media.status === "requesting" || media.status === "idle" ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <p className="max-w-xs text-sm text-[var(--ink-muted)]">
              Waiting for camera and microphone. If your browser asks, choose
              Allow.
            </p>
          </div>
        ) : (
          <Tile
            name={selfName}
            stream={media.stream}
            version={media.version}
            micOn={media.micOn}
            cameraOn={media.cameraOn}
            self
            className="absolute inset-0 rounded-none"
          />
        )}
        {media.status === "ready" ? (
          <div className="absolute right-3 bottom-3 flex gap-2">
            <MicButton media={media} />
            <CameraButton media={media} />
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-medium tracking-tight text-[var(--ink)] sm:text-3xl">
            Ready to join?
          </h1>
          <p className="text-sm text-[var(--ink-muted)]">
            Others will see you as{" "}
            <span className="font-medium text-[var(--ink)]">{selfName}</span>.
          </p>
        </div>
        <div className="grid gap-3">
          <DeviceSelect
            dark
            label="Camera"
            devices={media.devices.videoinput}
            value={media.selected.videoinput}
            disabled={media.status !== "ready"}
            onChange={(id) => void media.selectDevice("videoinput", id)}
          />
          <DeviceSelect
            dark
            label="Microphone"
            devices={media.devices.audioinput}
            value={media.selected.audioinput}
            disabled={media.status !== "ready"}
            onChange={(id) => void media.selectDevice("audioinput", id)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-testid="join-call"
            disabled={media.status !== "ready"}
            onClick={onJoin}
            className={cn(
              styles.press,
              "h-12 w-full rounded-md bg-emerald-400 px-5 text-sm font-semibold text-emerald-950 outline-none hover:bg-emerald-300 focus-visible:ring-[3px] focus-visible:ring-emerald-300/60 disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            Join call
          </button>
          {media.status === "ready" && media.problem ? (
            <p role="alert" className="text-xs text-rose-300">
              {media.problem}
            </p>
          ) : null}
          {media.audioOnly ? (
            <p className="text-xs text-[var(--ink-muted)]">
              No camera found. You can join with your microphone only.
            </p>
          ) : null}
          <p
            className="truncate text-xs text-[var(--ink-muted)]"
            title={meetingId}
          >
            Meeting {meetingId}
          </p>
        </div>
      </div>
    </div>
  );
}

function MediaProblem({ media }: { media: LocalMedia }) {
  const steps =
    media.status === "denied"
      ? "Open the site settings from the icon left of the address bar, allow Camera and Microphone, then try again."
      : media.status === "no-device"
        ? "Connect a camera or microphone, then try again."
        : "Close other apps that might be using them, then try again.";
  return (
    <div
      role="alert"
      className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <VideoOff aria-hidden className="size-8 text-[var(--ink-muted)]" />
      <p
        data-testid="call-error"
        className="max-w-sm text-base font-medium text-[var(--ink)]"
      >
        {media.problem}
      </p>
      <p className="max-w-sm text-sm text-[var(--ink-muted)]">{steps}</p>
      <button
        type="button"
        data-testid="retry-media"
        onClick={() => void media.start()}
        className={cn(
          styles.press,
          "mt-1 h-11 rounded-md bg-white/10 px-4 text-sm font-medium text-[var(--ink)] outline-none hover:bg-white/15 focus-visible:ring-[3px] focus-visible:ring-emerald-400/50",
        )}
      >
        Try again
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- in call */

function InCall({
  media,
  self,
  phase,
  remotes,
  nameFor,
  callError,
  onRetry,
  onLeave,
  leaveButtonRef,
  inviteLink,
  exitHref,
}: {
  media: LocalMedia;
  leaveButtonRef: RefObject<HTMLButtonElement | null>;
  inviteLink: () => string;
  self: { id: string; name: string };
  phase: CallPhase;
  remotes: Map<string, Remote>;
  nameFor: (id: string) => string;
  callError: { message: string; retryable: boolean } | null;
  onRetry: () => void;
  onLeave: () => void;
  exitHref: string;
}) {
  if (phase === "failed") {
    return (
      <div
        className={cn(
          styles.screen,
          "flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center",
        )}
        role="alert"
      >
        <h1 className="text-2xl font-medium tracking-tight">
          The call dropped
        </h1>
        <p
          data-testid="call-error"
          className="max-w-md text-sm text-[var(--ink-muted)]"
        >
          {callError?.message ?? "The connection to the call was lost."}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {callError?.retryable !== false ? (
            <button
              type="button"
              data-testid="retry-call"
              onClick={onRetry}
              className={cn(
                styles.press,
                "h-11 rounded-md bg-emerald-400 px-5 text-sm font-semibold text-emerald-950 outline-none hover:bg-emerald-300 focus-visible:ring-[3px] focus-visible:ring-emerald-300/60",
              )}
            >
              Try again
            </button>
          ) : null}
          <Link
            href={exitHref}
            className={cn(
              styles.press,
              "grid h-11 place-items-center rounded-md bg-white/10 px-5 text-sm font-medium outline-none hover:bg-white/15 focus-visible:ring-[3px] focus-visible:ring-emerald-400/50",
            )}
          >
            Back to Connvo
          </Link>
        </div>
      </div>
    );
  }

  const people = [...remotes.entries()].slice(0, MAX_PEOPLE - 1);
  const alone = people.length === 0;
  const dim = phase === "reconnecting";
  const grid =
    people.length <= 1
      ? "grid-cols-1"
      : people.length === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-2";

  return (
    <div className={cn(styles.screen, "relative flex min-h-0 flex-1 flex-col")}>
      <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
        <StatusNotice
          phase={phase}
          alone={alone}
          inviteLink={inviteLink}
          problem={media.problem}
        />
      </div>

      <div className="relative min-h-0 flex-1 p-2 sm:p-3">
        {alone ? (
          <div className="flex h-full flex-col gap-3">
            <Tile
              name={self.name}
              stream={media.stream}
              version={media.version}
              micOn={media.micOn}
              cameraOn={media.cameraOn}
              self
              dim={dim}
              className="min-h-0 flex-1"
            />
          </div>
        ) : (
          <>
            <div
              className={cn(
                "grid h-full gap-2 sm:gap-3",
                grid,
                people.length > 2 && "grid-rows-2",
              )}
            >
              {people.map(([id, r]) => (
                <Tile
                  key={id}
                  name={nameFor(id)}
                  stream={r.stream}
                  version={r.version}
                  micOn={r.micOn}
                  cameraOn={r.cameraOn}
                  dim={dim}
                  contract={{ participantId: id }}
                  className="min-h-0"
                />
              ))}
            </div>
            <Tile
              name={self.name}
              stream={media.stream}
              version={media.version}
              micOn={media.micOn}
              cameraOn={media.cameraOn}
              self
              className="absolute right-4 bottom-4 z-10 aspect-video w-32 shadow-lg ring-1 ring-white/10 sm:right-5 sm:bottom-5 sm:w-48 lg:w-56"
            />
          </>
        )}
      </div>

      <ControlBar
        media={media}
        onLeave={onLeave}
        leaveButtonRef={leaveButtonRef}
      />
    </div>
  );
}

function StatusNotice({
  phase,
  alone,
  inviteLink,
  problem,
}: {
  phase: CallPhase;
  alone: boolean;
  inviteLink: () => string;
  problem: string | null;
}) {
  const text =
    problem && phase === "connected"
      ? problem
      : phase === "joining"
        ? "Connecting to the call…"
        : phase === "reconnecting"
          ? "Reconnecting. The call continues when your connection comes back."
          : alone && phase === "connected"
            ? "You're the only one here. Others appear when they join."
            : null;
  return (
    <div role="status" aria-live="polite" className="min-h-0">
      {text ? (
        <p
          key={text}
          className={cn(
            styles.notice,
            "pointer-events-auto flex items-center gap-2 rounded-md bg-black/60 px-3 py-2 text-sm backdrop-blur-md",
            phase === "reconnecting"
              ? "text-[var(--warn)]"
              : problem && phase === "connected"
                ? "text-rose-300"
                : "text-[var(--ink)]",
          )}
        >
          {text}
          {alone && phase === "connected" && !problem ? (
            <CopyLink inviteLink={inviteLink} />
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function CopyLink({ inviteLink }: { inviteLink: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(inviteLink()).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className={cn(
        styles.press,
        "ml-1 inline-flex h-9 items-center gap-1 rounded-sm bg-white/10 px-2 text-xs outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-emerald-400/60",
      )}
    >
      {copied ? (
        <Check aria-hidden className="size-3.5" />
      ) : (
        <Link2 aria-hidden className="size-3.5" />
      )}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

const controlClass =
  "grid size-11 place-items-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-emerald-400/60 disabled:opacity-50";

function MicButton({ media }: { media: LocalMedia }) {
  const on = media.micOn;
  return (
    <button
      type="button"
      data-testid="toggle-mic"
      aria-pressed={!on}
      aria-label={on ? "Mute microphone" : "Unmute microphone"}
      title={on ? "Mute microphone" : "Unmute microphone"}
      onClick={() => media.setMicOn(!on)}
      className={cn(
        styles.press,
        controlClass,
        on
          ? "bg-white/10 text-[var(--ink)] hover:bg-white/15"
          : "bg-rose-500/90 text-white hover:bg-rose-500",
      )}
    >
      {on ? (
        <Mic aria-hidden className="size-5" />
      ) : (
        <MicOff aria-hidden className="size-5" />
      )}
    </button>
  );
}

function CameraButton({ media }: { media: LocalMedia }) {
  const on = media.cameraOn;
  return (
    <button
      type="button"
      data-testid="toggle-camera"
      aria-pressed={!on}
      aria-label={on ? "Turn camera off" : "Turn camera on"}
      title={on ? "Turn camera off" : "Turn camera on"}
      onClick={() => void media.setCameraOn(!on)}
      className={cn(
        styles.press,
        controlClass,
        on
          ? "bg-white/10 text-[var(--ink)] hover:bg-white/15"
          : "bg-rose-500/90 text-white hover:bg-rose-500",
      )}
    >
      {on ? (
        <Video aria-hidden className="size-5" />
      ) : (
        <VideoOff aria-hidden className="size-5" />
      )}
    </button>
  );
}

function ControlBar({
  media,
  onLeave,
  leaveButtonRef,
}: {
  media: LocalMedia;
  onLeave: () => void;
  leaveButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div
      className="flex items-center justify-center gap-2 border-t border-white/8 px-3 py-3"
      role="group"
      aria-label="Call controls"
    >
      <MicButton media={media} />
      <CameraButton media={media} />
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="device-settings"
            aria-label="Camera and microphone settings"
            title="Camera and microphone settings"
            className={cn(
              styles.press,
              controlClass,
              "bg-white/10 text-[var(--ink)] hover:bg-white/15",
            )}
          >
            <Settings2 aria-hidden className="size-5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          className="grid w-72 origin-(--radix-popover-content-transform-origin) gap-3 motion-reduce:animate-none"
        >
          <DeviceSelect
            label="Camera"
            devices={media.devices.videoinput}
            value={media.selected.videoinput}
            onChange={(id) => void media.selectDevice("videoinput", id)}
          />
          <DeviceSelect
            label="Microphone"
            devices={media.devices.audioinput}
            value={media.selected.audioinput}
            onChange={(id) => void media.selectDevice("audioinput", id)}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        ref={leaveButtonRef}
        data-testid="leave-call"
        onClick={onLeave}
        className={cn(
          styles.press,
          "ml-2 flex h-11 items-center gap-2 rounded-md bg-rose-600 px-4 text-sm font-semibold text-white outline-none hover:bg-rose-500 focus-visible:ring-[3px] focus-visible:ring-rose-400/60",
        )}
      >
        <PhoneOff aria-hidden className="size-5" />
        <span>Leave</span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ ended */

function Ended({
  exitHref,
  onRejoin,
}: {
  exitHref: string;
  onRejoin: () => void;
}) {
  return (
    <div
      className={cn(
        styles.screen,
        "flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center",
      )}
    >
      <h1
        ref={(el) => el?.focus()}
        tabIndex={-1}
        className="text-2xl font-medium tracking-tight outline-none"
      >
        You left the call
      </h1>
      <p className="max-w-sm text-sm text-[var(--ink-muted)]">
        Your camera and microphone are off.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          data-testid="join-call"
          onClick={onRejoin}
          className={cn(
            styles.press,
            "h-11 rounded-md bg-white/10 px-5 text-sm font-medium outline-none hover:bg-white/15 focus-visible:ring-[3px] focus-visible:ring-emerald-400/50",
          )}
        >
          Rejoin
        </button>
        <Link
          href={exitHref}
          className={cn(
            styles.press,
            "grid h-11 place-items-center rounded-md bg-emerald-400 px-5 text-sm font-semibold text-emerald-950 outline-none hover:bg-emerald-300 focus-visible:ring-[3px] focus-visible:ring-emerald-300/60",
          )}
        >
          Back to Connvo
        </Link>
      </div>
    </div>
  );
}
