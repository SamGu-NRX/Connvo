/* MediaPipe owns inference; camera images stay in this worker and this origin. */
let segmenter;
let canvas;
let context;
let foreground;
let foregroundContext;
let maskCanvas;
let maskContext;

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      canvas = new OffscreenCanvas(data.width, data.height);
      context = canvas.getContext("2d", { alpha: false });
      foreground = new OffscreenCanvas(data.width, data.height);
      foregroundContext = foreground.getContext("2d");
      maskCanvas = new OffscreenCanvas(256, 256);
      maskContext = maskCanvas.getContext("2d");
      if (
        !context ||
        !foregroundContext ||
        !maskContext ||
        !("filter" in context)
      ) {
        self.postMessage({
          type: "error",
          reason: "unsupported",
          message:
            "Background blur is unavailable in this browser. Your camera is still on.",
        });
        return;
      }
      // The pinned CommonJS bundle exports into the worker global. Classic
      // workers also support the WASM loader's importScripts call.
      self.exports = {};
      self.importScripts("/call/mediapipe/vision_bundle.js");
      const { FilesetResolver, ImageSegmenter } = self.exports;
      const files = await FilesetResolver.forVisionTasks(
        "/call/mediapipe/wasm",
      );
      segmenter = await ImageSegmenter.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "/call/mediapipe/selfie_segmenter.tflite",
          delegate: "CPU",
        },
        canvas: new OffscreenCanvas(256, 256),
        runningMode: "VIDEO",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      self.postMessage({ type: "ready" });
    } catch {
      self.postMessage({
        type: "error",
        reason: "failed",
        message: "Background blur could not load. Your camera is still on.",
      });
    }
    return;
  }
  if (data.type !== "frame") return;
  const bitmap = data.bitmap;
  try {
    if (!segmenter) throw new Error("Blur is not ready");
    segmenter.segmentForVideo(bitmap, data.timestamp, (result) => {
      // SelfieSegmenter has one confidence channel: the foreground person.
      const mask = result.confidenceMasks[0];
      const values = mask.getAsFloat32Array();
      if (
        maskCanvas.width !== mask.width ||
        maskCanvas.height !== mask.height
      ) {
        maskCanvas.width = mask.width;
        maskCanvas.height = mask.height;
      }
      const pixels = maskContext.createImageData(mask.width, mask.height);
      for (let index = 0; index < values.length; index++) {
        const offset = index * 4;
        pixels.data[offset] = 255;
        pixels.data[offset + 1] = 255;
        pixels.data[offset + 2] = 255;
        pixels.data[offset + 3] = Math.round(
          Math.min(1, Math.max(0, (values[index] - 0.15) / 0.7)) * 255,
        );
      }
      maskContext.putImageData(pixels, 0, 0);
      foregroundContext.globalCompositeOperation = "source-over";
      foregroundContext.clearRect(0, 0, canvas.width, canvas.height);
      foregroundContext.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      foregroundContext.globalCompositeOperation = "destination-in";
      foregroundContext.drawImage(
        maskCanvas,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      context.filter = "blur(16px)";
      // Overscan prevents transparent blur edges from darkening the picture.
      context.drawImage(
        bitmap,
        -24,
        -24,
        canvas.width + 48,
        canvas.height + 48,
      );
      context.filter = "none";
      context.drawImage(foreground, 0, 0);
    });
    const rendered = canvas.transferToImageBitmap();
    self.postMessage({ type: "frame", bitmap: rendered }, [rendered]);
  } catch {
    self.postMessage({
      type: "error",
      reason: "failed",
      message:
        "Background blur lost the camera image. Your camera is still on.",
    });
  } finally {
    bitmap.close();
  }
};
