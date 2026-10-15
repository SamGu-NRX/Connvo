import { describe, expect, it } from "vitest";
import { isPublicCallAsset } from "./public-assets";

describe("public blur assets", () => {
  it.each([
    "/call/blur-worker.js",
    "/call/mediapipe/vision_bundle.js",
    "/call/mediapipe/selfie_segmenter.tflite",
    "/call/mediapipe/wasm/vision_wasm_internal.js",
    "/call/mediapipe/wasm/vision_wasm_internal.wasm",
    "/call/mediapipe/wasm/vision_wasm_nosimd_internal.js",
    "/call/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
  ])("allows the bundled asset %s", (path) => {
    expect(isPublicCallAsset(path)).toBe(true);
  });
  it.each([
    "/app/call/meeting",
    "/call",
    "/call/private.json",
    "/call/mediapipe/private.js",
    "/call/blur-worker.js/extra",
    "/call/mediapipe/../private.js",
    "/api/call/blur-worker.js",
  ])("does not exempt %s", (path) => {
    expect(isPublicCallAsset(path)).toBe(false);
  });
});
