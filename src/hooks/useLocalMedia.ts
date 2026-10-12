"use client";

/**
 * Owns the local camera and microphone for a call (CALL-PLAN D5): the
 * transport only forwards what this hook captures and never stops a track.
 *
 * - One MediaStream object lives for the whole call; device switches and
 *   camera on/off swap tracks inside it, and `version` changes so the caller
 *   can re-publish it.
 * - Muting the mic disables the track (instant, keeps the device open).
 *   Turning the camera off stops the track, so the camera light goes out.
 * - `release()` stops every track; call it on leave and on unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type LocalMediaStatus =
  | "idle"
  | "requesting"
  | "ready"
  | "denied"
  | "no-device"
  | "error";

export interface LocalMediaDevices {
  audioinput: MediaDeviceInfo[];
  videoinput: MediaDeviceInfo[];
}

export interface LocalMedia {
  status: LocalMediaStatus;
  /** Plain-language reason when status is denied, no-device or error. */
  problem: string | null;
  stream: MediaStream | null;
  /** Bumps whenever the stream's tracks change. */
  version: number;
  micOn: boolean;
  cameraOn: boolean;
  /** True when no camera could be opened but the mic works. */
  audioOnly: boolean;
  devices: LocalMediaDevices;
  selected: { audioinput: string | null; videoinput: string | null };
  start: () => Promise<void>;
  setMicOn: (on: boolean) => void;
  setCameraOn: (on: boolean) => Promise<void>;
  selectDevice: (
    kind: "audioinput" | "videoinput",
    deviceId: string,
  ) => Promise<void>;
  release: () => void;
}

function describe(err: unknown): { status: LocalMediaStatus; problem: string } {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      status: "denied",
      problem:
        "Your browser is blocking the camera and microphone for this site.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return {
      status: "no-device",
      problem: "No camera or microphone was found.",
    };
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return {
      status: "error",
      problem: "Another app is using your camera or microphone.",
    };
  }
  return {
    status: "error",
    problem: "The camera and microphone could not start.",
  };
}

const constraint = (
  deviceId: string | null,
): MediaTrackConstraints | boolean =>
  deviceId ? { deviceId: { exact: deviceId } } : true;

export function useLocalMedia(): LocalMedia {
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<LocalMediaStatus>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [micOn, setMicState] = useState(true);
  const [cameraOn, setCameraState] = useState(true);
  const [audioOnly, setAudioOnly] = useState(false);
  const [devices, setDevices] = useState<LocalMediaDevices>({
    audioinput: [],
    videoinput: [],
  });
  const [selected, setSelected] = useState<LocalMedia["selected"]>({
    audioinput: null,
    videoinput: null,
  });
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const micOnRef = useRef(true);

  const bump = () => setVersion((v) => v + 1);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices({
      audioinput: all.filter((d) => d.kind === "audioinput" && d.deviceId),
      videoinput: all.filter((d) => d.kind === "videoinput" && d.deviceId),
    });
  }, []);

  /** Puts `track` into the stream in place of any track of its kind. */
  const swapIn = useCallback((track: MediaStreamTrack) => {
    const stream = streamRef.current ?? new MediaStream();
    streamRef.current = stream;
    for (const old of stream.getTracks()) {
      if (old.kind === track.kind) {
        stream.removeTrack(old);
        old.stop();
      }
    }
    if (track.kind === "audio") track.enabled = micOnRef.current;
    stream.addTrack(track);
    setSelected((s) => ({
      ...s,
      [track.kind === "audio" ? "audioinput" : "videoinput"]:
        track.getSettings().deviceId ?? null,
    }));
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setProblem("This browser cannot use a camera or microphone.");
      return;
    }
    setStatus("requesting");
    setProblem(null);
    const wanted = selectedRef.current;
    let captured: MediaStream | null = null;
    let firstError: unknown = null;
    try {
      captured = await navigator.mediaDevices.getUserMedia({
        audio: constraint(wanted.audioinput),
        video: constraint(wanted.videoinput),
      });
    } catch (err) {
      firstError = err;
      // A missing camera should not keep someone out of a call they can
      // still hear and speak in.
      if (
        err instanceof DOMException &&
        (err.name === "NotFoundError" || err.name === "NotReadableError")
      ) {
        captured = await navigator.mediaDevices
          .getUserMedia({ audio: true })
          .catch(() => null);
      }
    }
    if (!captured) {
      const { status: next, problem: why } = describe(firstError);
      setStatus(next);
      setProblem(why);
      return;
    }
    for (const track of captured.getTracks()) swapIn(track);
    const hasVideo = captured.getVideoTracks().length > 0;
    setAudioOnly(!hasVideo);
    setCameraState(hasVideo);
    setStatus("ready");
    bump();
    await refreshDevices();
  }, [refreshDevices, swapIn]);

  const setMicOn = useCallback((on: boolean) => {
    micOnRef.current = on;
    for (const track of streamRef.current?.getAudioTracks() ?? [])
      track.enabled = on;
    setMicState(on);
  }, []);

  const setCameraOn = useCallback(
    async (on: boolean) => {
      const stream = streamRef.current;
      if (!on) {
        for (const track of stream?.getVideoTracks() ?? []) {
          stream?.removeTrack(track);
          track.stop();
        }
        setCameraState(false);
        bump();
        return;
      }
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: constraint(selectedRef.current.videoinput),
        });
        swapIn(fresh.getVideoTracks()[0]);
        setCameraState(true);
        setAudioOnly(false);
        bump();
      } catch (err) {
        setProblem(describe(err).problem);
      }
    },
    [swapIn],
  );

  const selectDevice = useCallback(
    async (kind: "audioinput" | "videoinput", deviceId: string) => {
      setSelected((s) => ({ ...s, [kind]: deviceId }));
      selectedRef.current = { ...selectedRef.current, [kind]: deviceId };
      if (status !== "ready") return;
      if (kind === "videoinput" && !cameraOn) return;
      try {
        const fresh = await navigator.mediaDevices.getUserMedia(
          kind === "audioinput"
            ? { audio: constraint(deviceId) }
            : { video: constraint(deviceId) },
        );
        for (const track of fresh.getTracks()) swapIn(track);
        bump();
      } catch (err) {
        setProblem(describe(err).problem);
      }
    },
    [cameraOn, status, swapIn],
  );

  const release = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setStatus("idle");
    bump();
  }, []);

  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void refreshDevices();
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [refreshDevices]);

  useEffect(
    () => () => {
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    },
    [],
  );

  return {
    status,
    problem,
    stream: streamRef.current,
    version,
    micOn,
    cameraOn,
    audioOnly,
    devices,
    selected,
    start,
    setMicOn,
    setCameraOn,
    selectDevice,
    release,
  };
}
