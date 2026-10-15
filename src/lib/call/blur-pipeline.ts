import { z } from "zod";
import { BlurPipelineError, blurFrameHealth } from "./blur-policy";

export interface BlurPipeline {
  track: MediaStreamTrack;
  /** Releases processed output and worker. The camera track belongs to the caller. */
  stop(): void;
}

const workerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({
    type: z.literal("error"),
    reason: z.enum(["unsupported", "failed"]),
    message: z.string(),
  }),
  z.object({
    type: z.literal("frame"),
    bitmap: z.custom<ImageBitmap>(
      (value) =>
        typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap,
    ),
  }),
]);

export function blurSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

/** Segmentation and compositing run off-thread; only the finished bitmap is painted here. */
export async function createBlurPipeline({
  input,
  signal,
  onFallback,
}: {
  input: MediaStreamTrack;
  signal: AbortSignal;
  onFallback: (error: BlurPipelineError) => void;
}): Promise<BlurPipeline> {
  if (!blurSupported()) {
    throw new BlurPipelineError(
      "unsupported",
      "Background blur is unavailable in this browser. Your camera is still on.",
    );
  }
  if (signal.aborted) throw new DOMException("Blur cancelled", "AbortError");
  const video = document.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([input]);
  const settings = input.getSettings();
  // Limit compositing cost independently of capture resolution. This is a
  // conservative cap; no device benchmark has established an optimal size.
  const scale = Math.min(1, 1280 / (settings.width || 1280));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((settings.width || 1280) * scale);
  canvas.height = Math.round((settings.height || 720) * scale);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    video.srcObject = null;
    throw new BlurPipelineError(
      "unsupported",
      "Background blur needs canvas support. Your camera is still on.",
    );
  }
  let worker: Worker;
  try {
    worker = new Worker("/call/blur-worker.js");
  } catch {
    video.srcObject = null;
    throw new BlurPipelineError(
      "unsupported",
      "Background blur cannot run in this browser. Your camera is still on.",
    );
  }
  let output: MediaStream | null = null;
  let stopped = false;
  let published = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let sentAt = 0;
  let health = { frames: 0, slowFrames: 0, shouldStop: false };
  let resolveReady: (pipeline: BlurPipeline) => void;
  let rejectReady: (error: unknown) => void;
  const ready = new Promise<BlurPipeline>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    signal.removeEventListener("abort", abort);
    worker.terminate();
    video.pause();
    video.srcObject = null;
    output?.getTracks().forEach((track) => track.stop());
  };
  const abort = () => {
    stop();
    rejectReady(new DOMException("Blur cancelled", "AbortError"));
  };
  const fail = (error: BlurPipelineError) => {
    if (stopped) return;
    stop();
    if (published) onFallback(error);
    else rejectReady(error);
  };
  const armWatchdog = (milliseconds: number) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(
      () =>
        fail(
          new BlurPipelineError(
            "failed",
            "Background blur stopped responding. Your camera is still on.",
          ),
        ),
      milliseconds,
    );
  };
  const sendFrame = async () => {
    if (stopped) return;
    try {
      sentAt = performance.now();
      const frame = await createImageBitmap(video, {
        resizeWidth: canvas.width,
        resizeHeight: canvas.height,
      });
      if (stopped) {
        frame.close();
        return;
      }
      worker.postMessage({ type: "frame", bitmap: frame, timestamp: sentAt }, [
        frame,
      ]);
      armWatchdog(5000);
    } catch {
      fail(
        new BlurPipelineError(
          "failed",
          "Background blur lost the camera image. Your camera is still on.",
        ),
      );
    }
  };
  signal.addEventListener("abort", abort, { once: true });
  worker.onerror = () =>
    fail(
      new BlurPipelineError(
        "failed",
        "Background blur could not load. Your camera is still on.",
      ),
    );
  worker.onmessageerror = () =>
    fail(
      new BlurPipelineError(
        "failed",
        "Background blur returned an unreadable frame. Your camera is still on.",
      ),
    );
  worker.onmessage = (event: MessageEvent<unknown>) => {
    const parsed = workerMessage.safeParse(event.data);
    if (!parsed.success) {
      fail(
        new BlurPipelineError(
          "failed",
          "Background blur returned an invalid frame. Your camera is still on.",
        ),
      );
      return;
    }
    const message = parsed.data;
    if (stopped) {
      if (message.type === "frame") message.bitmap.close();
      return;
    }
    if (message.type === "error") {
      fail(new BlurPipelineError(message.reason, message.message));
      return;
    }
    if (message.type === "ready") {
      void sendFrame();
      return;
    }
    clearTimeout(watchdog);
    try {
      context.drawImage(message.bitmap, 0, 0, canvas.width, canvas.height);
    } catch {
      message.bitmap.close();
      fail(
        new BlurPipelineError(
          "failed",
          "Background blur could not draw a frame. Your camera is still on.",
        ),
      );
      return;
    }
    message.bitmap.close();
    health = blurFrameHealth(health, performance.now() - sentAt);
    if (health.shouldStop) {
      fail(
        new BlurPipelineError(
          "slow",
          "Blur turned off to keep your video smooth. Your camera is still on.",
        ),
      );
      return;
    }
    if (!output) {
      try {
        output = canvas.captureStream(Math.min(settings.frameRate || 30, 24));
        const track = output.getVideoTracks()[0];
        if (!track) throw new Error("No canvas track");
        published = true;
        resolveReady({ track, stop });
      } catch {
        fail(
          new BlurPipelineError(
            "unsupported",
            "This browser cannot share blurred video. Your camera is still on.",
          ),
        );
        return;
      }
    }
    timer = setTimeout(
      () => void sendFrame(),
      Math.max(0, 1000 / 24 - (performance.now() - sentAt)),
    );
  };
  armWatchdog(15000);
  // Attach the rejection handler before playback can yield; abort and worker
  // failure must never become an unhandled rejection while play() is pending.
  void video
    .play()
    .then(() => {
      if (!stopped)
        worker.postMessage({
          type: "init",
          width: canvas.width,
          height: canvas.height,
        });
    })
    .catch(() =>
      fail(
        new BlurPipelineError(
          "failed",
          "Your browser paused the blur preview. Try turning blur on again.",
        ),
      ),
    );
  return ready;
}
