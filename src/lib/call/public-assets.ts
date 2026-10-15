// The blur worker fetches these bundled public assets without an auth redirect.
// Keep the allowlist exact so call pages and future /call APIs stay protected.
const assets = new Set([
  "/call/blur-worker.js",
  "/call/mediapipe/vision_bundle.js",
  "/call/mediapipe/selfie_segmenter.tflite",
  "/call/mediapipe/wasm/vision_wasm_internal.js",
  "/call/mediapipe/wasm/vision_wasm_internal.wasm",
  "/call/mediapipe/wasm/vision_wasm_nosimd_internal.js",
  "/call/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
]);

export function isPublicCallAsset(pathname: string): boolean {
  return assets.has(pathname);
}
