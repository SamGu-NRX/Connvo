import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blurSupported, createBlurPipeline } from "./blur-pipeline";

class Bitmap {
  closed = false;
  close() {
    this.closed = true;
  }
}
class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  stopped = false;
  messages: unknown[] = [];
  constructor() {
    WorkerStub.instances.push(this);
  }
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  terminate() {
    this.stopped = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}
class StreamStub {
  constructor(private tracks: MediaStreamTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks;
  }
}
const input = () =>
  ({
    kind: "video",
    readyState: "live",
    getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
    stop: vi.fn(),
  }) as unknown as MediaStreamTrack;
let output: MediaStreamTrack;
let draw: ReturnType<typeof vi.fn>;
let capture: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  WorkerStub.instances = [];
  output = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack;
  vi.stubGlobal("Worker", WorkerStub);
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("ImageBitmap", Bitmap);
  vi.stubGlobal("MediaStream", StreamStub);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => new Bitmap()),
  );
  draw = vi.fn();
  capture = vi.fn(() => new StreamStub([output]));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage: draw }) as unknown as CanvasRenderingContext2D,
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
    value: capture,
    configurable: true,
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    () => undefined,
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
async function active(onFallback = vi.fn()) {
  const camera = input();
  const controller = new AbortController();
  const pending = createBlurPipeline({
    input: camera,
    signal: controller.signal,
    onFallback,
  });
  const worker = WorkerStub.instances[0];
  await tick();
  worker.emit({ type: "ready" });
  await tick();
  const bitmap = new Bitmap();
  worker.emit({ type: "frame", bitmap });
  return {
    camera,
    controller,
    worker,
    pipeline: await pending,
    bitmap,
    onFallback,
  };
}

describe("blur pipeline fallbacks and lifetime", () => {
  it("publishes a painted processed stream, closes frame memory, and leaves input ownership with the hook", async () => {
    const { camera, pipeline, bitmap, worker } = await active();
    expect(pipeline.track).toBe(output);
    expect(draw.mock.calls[0]).toEqual([bitmap, 0, 0, 1280, 720]);
    expect(bitmap.closed).toBe(true);
    expect(capture.mock.calls[0]).toEqual([24]);
    pipeline.stop();
    pipeline.stop();
    expect(worker.stopped).toBe(true);
    expect(vi.mocked(output.stop).mock.calls.length).toBe(1);
    expect(camera.readyState).toBe("live");
  });

  it("rejects unsupported capture before creating a worker", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    expect(blurSupported()).toBe(false);
    await expect(
      createBlurPipeline({
        input: input(),
        signal: new AbortController().signal,
        onFallback: vi.fn(),
      }),
    ).rejects.toMatchObject({ reason: "unsupported" });
    expect(WorkerStub.instances).toEqual([]);
  });

  it("reports initialization load failure and terminates the worker without ending physical capture", async () => {
    const camera = input();
    const pending = createBlurPipeline({
      input: camera,
      signal: new AbortController().signal,
      onFallback: vi.fn(),
    });
    const failure = expect(pending).rejects.toMatchObject({
      reason: "failed",
      message: "Model unavailable",
    });
    const worker = WorkerStub.instances[0];
    worker.emit({
      type: "error",
      reason: "failed",
      message: "Model unavailable",
    });
    await failure;
    expect(worker.stopped).toBe(true);
    expect(camera.readyState).toBe("live");
  });

  it("a cancelled load rejects immediately and closes late transferred bitmaps", async () => {
    const controller = new AbortController();
    const pending = createBlurPipeline({
      input: input(),
      signal: controller.signal,
      onFallback: vi.fn(),
    });
    const failure = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await failure;
    const bitmap = new Bitmap();
    WorkerStub.instances[0].emit({ type: "frame", bitmap });
    expect(bitmap.closed).toBe(true);
    expect(WorkerStub.instances[0].stopped).toBe(true);
  });

  it("a stalled worker cannot freeze outgoing video indefinitely", async () => {
    const { worker, onFallback } = await active();
    await vi.advanceTimersByTimeAsync(5100);
    expect(onFallback.mock.calls[0]?.[0]).toMatchObject({
      reason: "failed",
      message: "Background blur stopped responding. Your camera is still on.",
    });
    expect(worker.stopped).toBe(true);
    expect(vi.mocked(output.stop).mock.calls.length).toBe(1);
  });

  it("sustained slow frames stop processing and return an explicit slow fallback", async () => {
    const { worker, onFallback } = await active();
    for (let index = 0; index < 10; index++) {
      await vi.advanceTimersByTimeAsync(200);
      worker.emit({ type: "frame", bitmap: new Bitmap() });
    }
    expect(onFallback.mock.calls[0]?.[0]).toMatchObject({
      reason: "slow",
      message:
        "Blur turned off to keep your video smooth. Your camera is still on.",
    });
    expect(worker.stopped).toBe(true);
  });

  it("a malformed worker response fails closed instead of publishing an invalid frame", async () => {
    const pending = createBlurPipeline({
      input: input(),
      signal: new AbortController().signal,
      onFallback: vi.fn(),
    });
    const failure = expect(pending).rejects.toMatchObject({ reason: "failed" });
    const worker = WorkerStub.instances[0];
    worker.emit({ type: "frame", bitmap: "not an image" });
    await failure;
    expect(worker.stopped).toBe(true);
    expect(capture.mock.calls).toEqual([]);
  });
});
