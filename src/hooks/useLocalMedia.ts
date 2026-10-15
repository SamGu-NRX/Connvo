"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createBlurPipeline,
  type BlurPipeline,
} from "@/lib/call/blur-pipeline";
import { blurFailure, type BlurStatus } from "@/lib/call/blur-policy";
import {
  cameraConstraints,
  type CameraFacing,
  type CameraQuality,
} from "@/lib/call/camera-quality";

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
  problem: string | null;
  stream: MediaStream | null;
  /** A stable stream changes tracks in place; callers republish on version. */
  version: number;
  micOn: boolean;
  cameraOn: boolean;
  audioOnly: boolean;
  devices: LocalMediaDevices;
  selected: { audioinput: string | null; videoinput: string | null };
  blurEnabled: boolean;
  blurStatus: BlurStatus;
  blurProblem: string | null;
  quality: CameraQuality;
  facing: CameraFacing;
  start: () => Promise<void>;
  setMicOn: (on: boolean) => void;
  setCameraOn: (on: boolean) => Promise<void>;
  setBlurEnabled: (on: boolean) => Promise<void>;
  setQuality: (quality: CameraQuality) => Promise<void>;
  switchCamera: () => Promise<void>;
  selectDevice: (
    kind: "audioinput" | "videoinput",
    deviceId: string,
  ) => Promise<void>;
  release: () => void;
}

function describe(err: unknown): { status: LocalMediaStatus; problem: string } {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return {
      status: "denied",
      problem:
        "Your browser is blocking the camera and microphone for this site.",
    };
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return {
      status: "no-device",
      problem: "No camera or microphone was found.",
    };
  if (name === "NotReadableError" || name === "AbortError")
    return {
      status: "error",
      problem: "Another app is using your camera or microphone.",
    };
  return {
    status: "error",
    problem: "The camera and microphone could not start.",
  };
}
const audioConstraint = (
  deviceId: string | null,
): MediaTrackConstraints | boolean =>
  deviceId ? { deviceId: { exact: deviceId } } : true;
const stopAll = (stream: MediaStream | null) =>
  stream?.getTracks().forEach((track) => track.stop());

/** Owns both physical capture and processed outgoing tracks; transport owns neither. */
export function useLocalMedia(): LocalMedia {
  const streamRef = useRef<MediaStream | null>(null);
  const rawVideoRef = useRef<MediaStreamTrack | null>(null);
  const pipelineRef = useRef<BlurPipeline | null>(null);
  const blurAbortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<LocalMediaStatus>("idle");
  const statusRef = useRef(status);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [micOn, setMicState] = useState(true);
  const micOnRef = useRef(true);
  const [cameraOn, setCameraState] = useState(true);
  const cameraWantedRef = useRef(true);
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
  const [blurEnabled, setBlurState] = useState(false);
  const blurWantedRef = useRef(false);
  const [blurStatus, setBlurStatus] = useState<BlurStatus>("off");
  const [blurProblem, setBlurProblem] = useState<string | null>(null);
  const [quality, setQualityState] = useState<CameraQuality>("standard");
  const qualityRef = useRef(quality);
  const [facing, setFacing] = useState<CameraFacing>("user");
  const facingRef = useRef(facing);
  const sessionRef = useRef(0);
  const videoGenRef = useRef(0);
  const audioGenRef = useRef(0);
  const blurGenRef = useRef(0);
  const mountedRef = useRef(true);
  const bump = useCallback(() => setVersion((value) => value + 1), []);

  const rememberDevice = useCallback(
    (kind: "audioinput" | "videoinput", id: string | null) => {
      selectedRef.current = { ...selectedRef.current, [kind]: id };
      setSelected(selectedRef.current);
    },
    [],
  );
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!mountedRef.current) return;
      setDevices({
        audioinput: all.filter(
          (device) => device.kind === "audioinput" && device.deviceId,
        ),
        videoinput: all.filter(
          (device) => device.kind === "videoinput" && device.deviceId,
        ),
      });
    } catch {
      // Enumeration can reject during permission changes. Capture remains live;
      // the next devicechange or successful capture refreshes the list.
    }
  }, []);

  const swapIn = useCallback((track: MediaStreamTrack) => {
    const stream = streamRef.current ?? new MediaStream();
    streamRef.current = stream;
    for (const previous of stream.getTracks()) {
      if (previous === track || previous.kind !== track.kind) continue;
      stream.removeTrack(previous);
      // A processed video track still needs its physical camera as input.
      if (previous !== rawVideoRef.current) previous.stop();
    }
    if (track.kind === "audio") track.enabled = micOnRef.current;
    if (!stream.getTracks().includes(track)) stream.addTrack(track);
  }, []);

  const stopBlur = useCallback(() => {
    blurGenRef.current++;
    blurAbortRef.current?.abort();
    blurAbortRef.current = null;
    pipelineRef.current?.stop();
    pipelineRef.current = null;
  }, []);

  const dropVideo = useCallback(() => {
    stopBlur();
    rawVideoRef.current?.stop();
    rawVideoRef.current = null;
    const stream = streamRef.current;
    for (const track of stream?.getVideoTracks() ?? []) {
      stream?.removeTrack(track);
      track.stop();
    }
  }, [stopBlur]);

  const applyBlur = useCallback(async () => {
    const stream = streamRef.current;
    const outgoing = stream?.getVideoTracks() ?? [];
    // Pause video while the replacement starts so blur never exposes raw frames.
    for (const track of outgoing) stream?.removeTrack(track);
    if (outgoing.length > 0) {
      bump();
    }
    stopBlur();
    const input = rawVideoRef.current;
    if (!input || input.readyState === "ended" || !blurWantedRef.current)
      return;
    const generation = blurGenRef.current;
    const controller = new AbortController();
    blurAbortRef.current = controller;
    const current = () =>
      generation === blurGenRef.current &&
      rawVideoRef.current === input &&
      blurWantedRef.current;
    setBlurStatus("loading");
    setBlurProblem(null);
    const fallback = (error: unknown) => {
      if (!current()) return;
      const failure = blurFailure(error);
      stopBlur();
      blurWantedRef.current = false;
      setBlurState(false);
      setBlurStatus(failure.status);
      setBlurProblem(failure.problem);
      swapIn(input);
      bump();
    };
    try {
      const pipeline = await createBlurPipeline({
        input,
        signal: controller.signal,
        onFallback: fallback,
      });
      if (!current()) {
        pipeline.stop();
        return;
      }
      pipelineRef.current = pipeline;
      swapIn(pipeline.track);
      setBlurStatus("active");
      bump();
    } catch (error) {
      if (!controller.signal.aborted) fallback(error);
    }
  }, [bump, stopBlur, swapIn]);

  const installCamera = useCallback(
    async (track: MediaStreamTrack) => {
      stopBlur();
      rawVideoRef.current?.stop();
      rawVideoRef.current = track;
      if (!blurWantedRef.current) swapIn(track);
      rememberDevice("videoinput", track.getSettings().deviceId ?? null);
      const actualFacing = track.getSettings().facingMode;
      if (actualFacing === "user" || actualFacing === "environment") {
        facingRef.current = actualFacing;
        setFacing(actualFacing);
      }
      setCameraState(true);
      setAudioOnly(false);
      bump();
      if (blurWantedRef.current) await applyBlur();
    },
    [applyBlur, bump, rememberDevice, stopBlur, swapIn],
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setProblem("This browser cannot use a camera or microphone.");
      return;
    }
    const session = ++sessionRef.current;
    const videoGeneration = ++videoGenRef.current;
    const audioGeneration = ++audioGenRef.current;
    cameraWantedRef.current = true;
    const current = () => session === sessionRef.current;
    statusRef.current = "requesting";
    setStatus("requesting");
    setProblem(null);
    let captured: MediaStream | null = null;
    let firstError: unknown = null;
    try {
      captured = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraint(selectedRef.current.audioinput),
        video: cameraConstraints({
          quality: qualityRef.current,
          facing: facingRef.current,
          deviceId: selectedRef.current.videoinput,
        }),
      });
    } catch (error) {
      firstError = error;
      if (
        current() &&
        error instanceof DOMException &&
        (error.name === "NotFoundError" || error.name === "NotReadableError")
      ) {
        captured = await navigator.mediaDevices
          .getUserMedia({
            audio: audioConstraint(selectedRef.current.audioinput),
          })
          .catch(() => null);
      }
    }
    if (!current()) {
      stopAll(captured);
      return;
    }
    if (!captured) {
      const failure = describe(firstError);
      statusRef.current = failure.status;
      setStatus(failure.status);
      setProblem(failure.problem);
      return;
    }
    for (const track of captured.getAudioTracks()) {
      if (audioGeneration !== audioGenRef.current) {
        track.stop();
        continue;
      }
      swapIn(track);
      rememberDevice("audioinput", track.getSettings().deviceId ?? null);
    }
    const video = captured.getVideoTracks()[0];
    const videoCurrent =
      videoGeneration === videoGenRef.current && cameraWantedRef.current;
    if (video && videoCurrent) void installCamera(video);
    else {
      captured.getVideoTracks().forEach((track) => track.stop());
      if (videoCurrent) {
        dropVideo();
        cameraWantedRef.current = false;
        setCameraState(false);
        setAudioOnly(true);
      }
    }
    statusRef.current = "ready";
    setStatus("ready");
    bump();
    await refreshDevices();
  }, [bump, dropVideo, installCamera, refreshDevices, rememberDevice, swapIn]);

  const setMicOn = useCallback((on: boolean) => {
    micOnRef.current = on;
    for (const track of streamRef.current?.getAudioTracks() ?? [])
      track.enabled = on;
    setMicState(on);
  }, []);

  const captureCamera = useCallback(
    async ({
      deviceId,
      facing: wantedFacing,
      flip = false,
    }: {
      deviceId: string | null;
      facing: CameraFacing;
      flip?: boolean;
    }) => {
      const generation = ++videoGenRef.current;
      const session = sessionRef.current;
      const current = () =>
        generation === videoGenRef.current &&
        session === sessionRef.current &&
        cameraWantedRef.current;
      const constraints = cameraConstraints({
        quality: qualityRef.current,
        facing: wantedFacing,
        deviceId,
      });
      if (flip) constraints.facingMode = { exact: wantedFacing };
      let fresh: MediaStream;
      try {
        try {
          fresh = await navigator.mediaDevices.getUserMedia({
            video: constraints,
          });
        } catch (error) {
          // iOS may allow only one physical camera at once. Release and retry
          // only for a device-busy failure; permissions and missing cameras do
          // not disturb the working input.
          if (
            !flip ||
            !(error instanceof DOMException) ||
            error.name !== "NotReadableError" ||
            !current()
          )
            throw error;
          dropVideo();
          setCameraState(false);
          bump();
          fresh = await navigator.mediaDevices.getUserMedia({
            video: constraints,
          });
        }
      } catch (error) {
        if (current())
          setProblem(`That camera could not start. ${describe(error).problem}`);
        return;
      }
      if (!current()) {
        stopAll(fresh);
        return;
      }
      const track = fresh.getVideoTracks()[0];
      if (!track) {
        stopAll(fresh);
        setProblem("That camera did not provide a video track.");
        return;
      }
      facingRef.current = wantedFacing;
      setFacing(wantedFacing);
      setProblem(null);
      await installCamera(track);
      await refreshDevices();
    },
    [bump, dropVideo, installCamera, refreshDevices],
  );

  const setCameraOn = useCallback(
    async (on: boolean) => {
      cameraWantedRef.current = on;
      if (!on) {
        videoGenRef.current++;
        dropVideo();
        setCameraState(false);
        setBlurStatus("off");
        bump();
        return;
      }
      await captureCamera({
        deviceId: selectedRef.current.videoinput,
        facing: facingRef.current,
      });
    },
    [bump, captureCamera, dropVideo],
  );

  const selectDevice = useCallback(
    async (kind: "audioinput" | "videoinput", deviceId: string) => {
      if (
        statusRef.current !== "ready" ||
        (kind === "videoinput" && !cameraWantedRef.current)
      ) {
        rememberDevice(kind, deviceId);
        return;
      }
      if (kind === "videoinput") {
        await captureCamera({ deviceId, facing: facingRef.current });
        return;
      }
      const generation = ++audioGenRef.current;
      const session = sessionRef.current;
      let fresh: MediaStream;
      try {
        fresh = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint(deviceId),
        });
      } catch (error) {
        if (
          generation === audioGenRef.current &&
          session === sessionRef.current
        )
          setProblem(
            `That microphone could not start. ${describe(error).problem}`,
          );
        return;
      }
      if (
        generation !== audioGenRef.current ||
        session !== sessionRef.current
      ) {
        stopAll(fresh);
        return;
      }
      for (const track of fresh.getTracks()) swapIn(track);
      rememberDevice(kind, deviceId);
      setProblem(null);
      bump();
      await refreshDevices();
    },
    [bump, captureCamera, refreshDevices, rememberDevice, swapIn],
  );

  const setBlurEnabled = useCallback(
    async (on: boolean) => {
      if (on && blurWantedRef.current) return;
      blurWantedRef.current = on;
      setBlurState(on);
      setBlurProblem(null);
      if (on) await applyBlur();
      else {
        stopBlur();
        if (rawVideoRef.current?.readyState === "live") {
          swapIn(rawVideoRef.current);
          bump();
        }
        setBlurStatus("off");
      }
    },
    [applyBlur, bump, stopBlur, swapIn],
  );

  const setQuality = useCallback(
    async (next: CameraQuality) => {
      const previous = qualityRef.current;
      qualityRef.current = next;
      setQualityState(next);
      const track = rawVideoRef.current;
      if (!track || track.readyState === "ended") return;
      const generation = ++videoGenRef.current;
      try {
        await track.applyConstraints(
          cameraConstraints({
            quality: next,
            facing: facingRef.current,
            deviceId: selectedRef.current.videoinput,
          }),
        );
        if (generation !== videoGenRef.current || track !== rawVideoRef.current)
          return;
        setProblem(null);
        if (blurWantedRef.current) await applyBlur();
      } catch {
        if (generation !== videoGenRef.current || track !== rawVideoRef.current)
          return;
        qualityRef.current = previous;
        setQualityState(previous);
        setProblem(
          "This camera could not use that video quality. Your previous setting is still selected.",
        );
      }
    },
    [applyBlur],
  );

  const switchCamera = useCallback(async () => {
    const next = facingRef.current === "user" ? "environment" : "user";
    if (statusRef.current !== "ready" || !cameraWantedRef.current) {
      facingRef.current = next;
      setFacing(next);
      rememberDevice("videoinput", null);
      return;
    }
    await captureCamera({ deviceId: null, facing: next, flip: true });
  }, [captureCamera, rememberDevice]);

  const disposeCapture = useCallback(() => {
    sessionRef.current++;
    videoGenRef.current++;
    audioGenRef.current++;
    dropVideo();
    stopAll(streamRef.current);
    streamRef.current = null;
  }, [dropVideo]);

  const release = useCallback(() => {
    disposeCapture();
    statusRef.current = "idle";
    setStatus("idle");
    setBlurStatus("off");
    bump();
  }, [bump, disposeCapture]);

  useEffect(() => {
    mountedRef.current = true;
    const mediaDevices = navigator.mediaDevices;
    const onChange = () => void refreshDevices();
    mediaDevices?.addEventListener?.("devicechange", onChange);
    void refreshDevices();
    return () => {
      mountedRef.current = false;
      disposeCapture();
      mediaDevices?.removeEventListener?.("devicechange", onChange);
    };
  }, [disposeCapture, refreshDevices]);

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
    blurEnabled,
    blurStatus,
    blurProblem,
    quality,
    facing,
    start,
    setMicOn,
    setCameraOn,
    setBlurEnabled,
    setQuality,
    switchCamera,
    selectDevice,
    release,
  };
}
