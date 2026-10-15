import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalMedia } from "./useLocalMedia";
import { BlurPipelineError } from "@/lib/call/blur-policy";
import type { BlurPipeline } from "@/lib/call/blur-pipeline";

const pipeline = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/call/blur-pipeline", () => ({
  createBlurPipeline: pipeline.create,
}));

class Track {
  enabled = true;
  readyState: MediaStreamTrackState = "live";
  applyConstraints = vi.fn(async () => undefined);
  constructor(
    public kind: "audio" | "video",
    private settings: MediaTrackSettings = {},
  ) {}
  stop() {
    this.readyState = "ended";
  }
  getSettings() {
    return this.settings;
  }
}
const track = (kind: "audio" | "video", settings: MediaTrackSettings = {}) =>
  new Track(kind, settings) as unknown as MediaStreamTrack;
class Stream {
  private tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getVideoTracks() {
    return this.tracks.filter((entry) => entry.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((entry) => entry.kind === "audio");
  }
  addTrack(entry: MediaStreamTrack) {
    this.tracks.push(entry);
  }
  removeTrack(entry: MediaStreamTrack) {
    this.tracks = this.tracks.filter((value) => value !== entry);
  }
}
const stream = (...tracks: MediaStreamTrack[]) =>
  new Stream(tracks) as unknown as MediaStream;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let devices: EventTarget & {
  getUserMedia: ReturnType<typeof vi.fn>;
  enumerateDevices: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  devices = Object.assign(new EventTarget(), {
    getUserMedia: vi.fn(),
    enumerateDevices: vi.fn(async () => []),
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: devices,
  });
  vi.stubGlobal("MediaStream", Stream);
  pipeline.create.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function opened() {
  const audio = track("audio", { deviceId: "mic" });
  const video = track("video", {
    deviceId: "front",
    facingMode: "user",
    width: 1280,
    height: 720,
    frameRate: 30,
  });
  devices.getUserMedia.mockResolvedValueOnce(stream(audio, video));
  const hook = renderHook(() => useLocalMedia());
  await act(async () => hook.result.current.start());
  return { ...hook, audio, video };
}

describe("camera and blur ownership", () => {
  it("publishes processed video in the stable stream and restores the live camera when disabled", async () => {
    const { result, video } = await opened();
    const originalStream = result.current.stream;
    const processed = track("video");
    const stop = vi.fn(() => processed.stop());
    pipeline.create.mockResolvedValue({ track: processed, stop });
    await act(async () => result.current.setBlurEnabled(true));
    expect(result.current.blurStatus).toBe("active");
    expect(result.current.stream).toBe(originalStream);
    expect(result.current.stream?.getVideoTracks()).toEqual([processed]);
    expect(video.readyState).toBe("live");
    await act(async () => result.current.setBlurEnabled(false));
    expect(result.current.stream?.getVideoTracks()).toEqual([video]);
    expect(result.current.blurStatus).toBe("off");
    expect(processed.readyState).toBe("ended");
    expect(video.readyState).toBe("live");
  });

  it("turns itself off on unsupported and slow processing while publishing the original camera", async () => {
    const { result, video } = await opened();
    pipeline.create.mockRejectedValueOnce(
      new BlurPipelineError("unsupported", "No worker"),
    );
    await act(async () => result.current.setBlurEnabled(true));
    expect({
      status: result.current.blurStatus,
      enabled: result.current.blurEnabled,
      problem: result.current.blurProblem,
    }).toEqual({ status: "unsupported", enabled: false, problem: "No worker" });
    expect(result.current.stream?.getVideoTracks()).toEqual([video]);
    let fallback!: (error: BlurPipelineError) => void;
    const processed = track("video");
    pipeline.create.mockImplementation(async (options) => {
      fallback = options.onFallback;
      return { track: processed, stop: () => processed.stop() };
    });
    await act(async () => result.current.setBlurEnabled(true));
    act(() => fallback(new BlurPipelineError("slow", "Video too slow")));
    expect({
      status: result.current.blurStatus,
      enabled: result.current.blurEnabled,
      problem: result.current.blurProblem,
    }).toEqual({ status: "slow", enabled: false, problem: "Video too slow" });
    expect(result.current.stream?.getVideoTracks()).toEqual([video]);
    expect(processed.readyState).toBe("ended");
  });

  it("discards a blur result after camera-off and releases both camera and processed output", async () => {
    const { result, video, audio } = await opened();
    const pending = deferred<BlurPipeline>();
    const processed = track("video");
    pipeline.create.mockReturnValueOnce(pending.promise);
    let toggle!: Promise<void>;
    act(() => {
      toggle = result.current.setBlurEnabled(true);
    });
    await act(async () => result.current.setCameraOn(false));
    await act(async () => {
      pending.resolve({ track: processed, stop: () => processed.stop() });
      await toggle;
    });
    expect(result.current.cameraOn).toBe(false);
    expect(result.current.stream?.getTracks()).toEqual([audio]);
    expect({
      camera: video.readyState,
      processed: processed.readyState,
      audio: audio.readyState,
    }).toEqual({ camera: "ended", processed: "ended", audio: "live" });
  });

  it("release during blur startup cannot reopen capture", async () => {
    const { result, video, audio } = await opened();
    const pending = deferred<BlurPipeline>();
    const processed = track("video");
    pipeline.create.mockReturnValueOnce(pending.promise);
    let toggle!: Promise<void>;
    act(() => {
      toggle = result.current.setBlurEnabled(true);
    });
    act(() => result.current.release());
    await act(async () => {
      pending.resolve({ track: processed, stop: () => processed.stop() });
      await toggle;
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.stream).toBeNull();
    expect([video.readyState, audio.readyState, processed.readyState]).toEqual([
      "ended",
      "ended",
      "ended",
    ]);
  });

  it("replaces a blurred camera without stopping the new physical input", async () => {
    const { result, video } = await opened();
    const firstProcessed = track("video");
    pipeline.create.mockResolvedValueOnce({
      track: firstProcessed,
      stop: () => firstProcessed.stop(),
    });
    await act(async () => result.current.setBlurEnabled(true));
    const back = track("video", {
      deviceId: "rear",
      facingMode: "environment",
    });
    const nextProcessed = track("video");
    devices.getUserMedia.mockResolvedValueOnce(stream(back));
    pipeline.create.mockResolvedValueOnce({
      track: nextProcessed,
      stop: () => nextProcessed.stop(),
    });
    await act(async () => result.current.switchCamera());
    expect(result.current.facing).toBe("environment");
    expect(result.current.selected.videoinput).toBe("rear");
    expect(result.current.stream?.getVideoTracks()).toEqual([nextProcessed]);
    expect([
      video.readyState,
      firstProcessed.readyState,
      back.readyState,
    ]).toEqual(["ended", "ended", "live"]);
    expect(
      devices.getUserMedia.mock.calls.at(-1)?.[0].video.facingMode,
    ).toEqual({ exact: "environment" });
  });

  it.each(["camera", "quality"] as const)(
    "pauses outgoing video during a blurred %s replacement",
    async (change) => {
      const { result, video, audio } = await opened();
      const firstProcessed = track("video");
      pipeline.create.mockResolvedValueOnce({
        track: firstProcessed,
        stop: () => firstProcessed.stop(),
      });
      await act(async () => result.current.setBlurEnabled(true));
      const outgoing = result.current.stream!;
      const publish = vi.spyOn(outgoing, "addTrack");
      const replacement =
        change === "camera"
          ? track("video", { deviceId: "rear", facingMode: "environment" })
          : video;
      if (change === "camera")
        devices.getUserMedia.mockResolvedValueOnce(stream(replacement));
      const pending = deferred<BlurPipeline>();
      pipeline.create.mockReturnValueOnce(pending.promise);
      let transition!: Promise<void>;
      await act(async () => {
        transition =
          change === "camera"
            ? result.current.switchCamera()
            : result.current.setQuality("hd");
      });
      expect(result.current.blurEnabled).toBe(true);
      expect(result.current.blurStatus).toBe("loading");
      expect(outgoing.getTracks()).toEqual([audio]);
      expect(replacement.readyState).toBe("live");
      expect(firstProcessed.readyState).toBe("ended");
      expect(publish.mock.calls).toEqual([]);
      const processed = track("video");
      await act(async () => {
        pending.resolve({ track: processed, stop: () => processed.stop() });
        await transition;
      });
      expect(result.current.stream).toBe(outgoing);
      expect(outgoing.getTracks()).toEqual([audio, processed]);
      expect(result.current.blurStatus).toBe("active");
      expect(publish.mock.calls).toEqual([[processed]]);
    },
  );

  it.each(["camera-off", "blur-off", "release", "unmount"] as const)(
    "%s cancels a pending blurred camera replacement without publishing its late result",
    async (cancel) => {
      const { result, unmount, video, audio } = await opened();
      const firstProcessed = track("video");
      pipeline.create.mockResolvedValueOnce({
        track: firstProcessed,
        stop: () => firstProcessed.stop(),
      });
      await act(async () => result.current.setBlurEnabled(true));
      const outgoing = result.current.stream!;
      const publish = vi.spyOn(outgoing, "addTrack");
      const replacement = track("video", { deviceId: "rear" });
      devices.getUserMedia.mockResolvedValueOnce(stream(replacement));
      const pending = deferred<BlurPipeline>();
      pipeline.create.mockReturnValueOnce(pending.promise);
      let transition!: Promise<void>;
      await act(async () => {
        transition = result.current.switchCamera();
      });
      expect(result.current.blurStatus).toBe("loading");
      expect(outgoing.getTracks()).toEqual([audio]);
      const signal = pipeline.create.mock.calls.at(-1)![0].signal;
      await act(async () => {
        if (cancel === "camera-off") await result.current.setCameraOn(false);
        else if (cancel === "blur-off")
          await result.current.setBlurEnabled(false);
        else if (cancel === "release") result.current.release();
        else unmount();
      });
      const processed = track("video");
      await act(async () => {
        pending.resolve({ track: processed, stop: () => processed.stop() });
        await transition;
      });
      expect(signal.aborted).toBe(true);
      expect([
        video.readyState,
        firstProcessed.readyState,
        processed.readyState,
      ]).toEqual(["ended", "ended", "ended"]);
      if (cancel === "blur-off") {
        expect(result.current.blurEnabled).toBe(false);
        expect(outgoing.getTracks()).toEqual([audio, replacement]);
        expect(replacement.readyState).toBe("live");
        expect(publish.mock.calls).toEqual([[replacement]]);
      } else {
        expect(replacement.readyState).toBe("ended");
        expect(publish.mock.calls).toEqual([]);
        expect(outgoing.getVideoTracks()).toEqual([]);
      }
      if (cancel === "release") {
        expect(result.current.status).toBe("idle");
        expect(result.current.stream).toBeNull();
      }
    },
  );

  it("discards a superseded blurred camera result and ignores its fallback", async () => {
    const { result } = await opened();
    const firstProcessed = track("video");
    pipeline.create.mockResolvedValueOnce({
      track: firstProcessed,
      stop: () => firstProcessed.stop(),
    });
    await act(async () => result.current.setBlurEnabled(true));
    const outgoing = result.current.stream!;
    const publish = vi.spyOn(outgoing, "addTrack");
    const obsolete = track("video", { deviceId: "obsolete" });
    const newest = track("video", { deviceId: "newest" });
    devices.getUserMedia
      .mockResolvedValueOnce(stream(obsolete))
      .mockResolvedValueOnce(stream(newest));
    const pending = deferred<BlurPipeline>();
    pipeline.create.mockReturnValueOnce(pending.promise);
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.selectDevice("videoinput", "obsolete");
    });
    const { signal, onFallback } = pipeline.create.mock.calls.at(-1)![0];
    const processed = track("video");
    pipeline.create.mockResolvedValueOnce({
      track: processed,
      stop: () => processed.stop(),
    });
    await act(async () => result.current.selectDevice("videoinput", "newest"));
    const obsoleteProcessed = track("video");
    await act(async () => {
      onFallback(new BlurPipelineError("failed", "Obsolete worker failed"));
      pending.resolve({
        track: obsoleteProcessed,
        stop: () => obsoleteProcessed.stop(),
      });
      await first;
    });
    expect(result.current.blurEnabled).toBe(true);
    expect(result.current.blurStatus).toBe("active");
    expect(result.current.selected.videoinput).toBe("newest");
    expect(outgoing.getVideoTracks()).toEqual([processed]);
    expect(publish.mock.calls).toEqual([[processed]]);
    expect(signal.aborted).toBe(true);
    expect([
      obsolete.readyState,
      obsoleteProcessed.readyState,
      newest.readyState,
    ]).toEqual(["ended", "ended", "live"]);
  });

  it("restores raw video only after a replacement blur failure disables blur", async () => {
    const { result, audio } = await opened();
    const firstProcessed = track("video");
    pipeline.create.mockResolvedValueOnce({
      track: firstProcessed,
      stop: () => firstProcessed.stop(),
    });
    await act(async () => result.current.setBlurEnabled(true));
    const replacement = track("video", { deviceId: "rear" });
    devices.getUserMedia.mockResolvedValueOnce(stream(replacement));
    const pending = deferred<BlurPipeline>();
    pipeline.create.mockReturnValueOnce(pending.promise);
    let transition!: Promise<void>;
    await act(async () => {
      transition = result.current.switchCamera();
    });
    expect(result.current.blurEnabled).toBe(true);
    expect(result.current.stream?.getTracks()).toEqual([audio]);
    await act(async () => {
      pending.reject(new BlurPipelineError("failed", "Replacement failed"));
      await transition;
    });
    expect(result.current.blurEnabled).toBe(false);
    expect(result.current.blurStatus).toBe("failed");
    expect(result.current.blurProblem).toBe("Replacement failed");
    expect(result.current.stream?.getTracks()).toEqual([audio, replacement]);
    expect(replacement.readyState).toBe("live");
  });

  it("camera-off during a pending permission prompt prevents the returned camera from publishing", async () => {
    const pending = deferred<MediaStream>();
    devices.getUserMedia.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useLocalMedia());
    let start!: Promise<void>;
    act(() => {
      start = result.current.start();
    });
    await act(async () => result.current.setCameraOn(false));
    const video = track("video");
    const audio = track("audio");
    await act(async () => {
      pending.resolve(stream(audio, video));
      await start;
    });
    expect(result.current.cameraOn).toBe(false);
    expect(result.current.stream?.getTracks()).toEqual([audio]);
    expect(video.readyState).toBe("ended");
  });

  it("newer device changes win over slow capture, while muted replacements remain muted", async () => {
    const { result } = await opened();
    const pending = deferred<MediaStream>();
    const obsolete = track("video", { deviceId: "old" });
    const newest = track("video", { deviceId: "new" });
    devices.getUserMedia
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(stream(newest));
    let first!: Promise<void>;
    act(() => {
      first = result.current.selectDevice("videoinput", "old");
    });
    await act(async () => result.current.selectDevice("videoinput", "new"));
    await act(async () => {
      pending.resolve(stream(obsolete));
      await first;
    });
    expect(result.current.stream?.getVideoTracks()).toEqual([newest]);
    expect(result.current.selected.videoinput).toBe("new");
    expect(obsolete.readyState).toBe("ended");
    act(() => result.current.setMicOn(false));
    const microphone = track("audio", { deviceId: "new-mic" });
    devices.getUserMedia.mockResolvedValueOnce(stream(microphone));
    await act(async () => result.current.selectDevice("audioinput", "new-mic"));
    expect(result.current.stream?.getAudioTracks()).toEqual([microphone]);
    expect(microphone.enabled).toBe(false);
  });

  it("applies the requested resolution and framerate and keeps the last choice on rejection", async () => {
    const { result, video } = await opened();
    await act(async () => result.current.setQuality("data-saver"));
    expect(result.current.quality).toBe("data-saver");
    expect(video.applyConstraints).toHaveBeenLastCalledWith({
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 15, max: 15 },
      deviceId: { exact: "front" },
    });
    vi.mocked(video.applyConstraints).mockRejectedValueOnce(
      new DOMException("Unsupported", "OverconstrainedError"),
    );
    await act(async () => result.current.setQuality("hd"));
    expect(result.current.quality).toBe("data-saver");
    expect(result.current.problem).toBe(
      "This camera could not use that video quality. Your previous setting is still selected.",
    );
  });

  it("refreshes hot-plugged device choices and removes the listener on unmount", async () => {
    const { result, unmount } = await opened();
    const microphone = {
      kind: "audioinput",
      deviceId: "usb-mic",
      label: "USB mic",
    };
    devices.enumerateDevices.mockResolvedValue([microphone]);
    act(() => devices.dispatchEvent(new Event("devicechange")));
    await waitFor(() =>
      expect(result.current.devices.audioinput).toEqual([microphone]),
    );
    unmount();
    devices.enumerateDevices.mockResolvedValue([
      { kind: "videoinput", deviceId: "usb-camera" },
    ]);
    devices.dispatchEvent(new Event("devicechange"));
    expect(result.current.devices.audioinput).toEqual([microphone]);
  });

  it("repeating blur enable keeps the active output and unmount ends every owned track", async () => {
    const { result, unmount, audio, video } = await opened();
    const processed = track("video");
    pipeline.create.mockResolvedValue({
      track: processed,
      stop: () => processed.stop(),
    });
    await act(async () => result.current.setBlurEnabled(true));
    await act(async () => result.current.setBlurEnabled(true));
    expect(result.current.stream?.getVideoTracks()).toEqual([processed]);
    expect(pipeline.create.mock.calls.length).toBe(1);
    unmount();
    expect([audio.readyState, video.readyState, processed.readyState]).toEqual([
      "ended",
      "ended",
      "ended",
    ]);
  });

  it("releases an exclusive phone camera before retrying a front/back switch", async () => {
    const { result, video } = await opened();
    const rear = track("video", {
      deviceId: "rear",
      facingMode: "environment",
    });
    devices.getUserMedia
      .mockRejectedValueOnce(
        new DOMException("Camera busy", "NotReadableError"),
      )
      .mockImplementationOnce(async () => {
        expect(video.readyState).toBe("ended");
        return stream(rear);
      });
    await act(async () => result.current.switchCamera());
    expect(result.current.stream?.getVideoTracks()).toEqual([rear]);
    expect({
      cameraOn: result.current.cameraOn,
      facing: result.current.facing,
      selected: result.current.selected.videoinput,
    }).toEqual({ cameraOn: true, facing: "environment", selected: "rear" });
  });

  it("a missing rear camera keeps the working front camera selected", async () => {
    const { result, video } = await opened();
    devices.getUserMedia.mockRejectedValueOnce(
      new DOMException("No rear camera", "OverconstrainedError"),
    );
    await act(async () => result.current.switchCamera());
    expect(result.current.stream?.getVideoTracks()).toEqual([video]);
    expect({
      cameraOn: result.current.cameraOn,
      facing: result.current.facing,
      selected: result.current.selected.videoinput,
      track: video.readyState,
    }).toEqual({
      cameraOn: true,
      facing: "user",
      selected: "front",
      track: "live",
    });
    expect(result.current.problem).toBe(
      "That camera could not start. No camera or microphone was found.",
    );
  });
});
