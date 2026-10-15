# MediaPipe assets

These files run background segmentation locally in `../blur-worker.js`. No camera frames leave the browser for inference.

Runtime: `@mediapipe/tasks-vision@0.10.21`, Apache-2.0. Source tarball:
`https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.21.tgz`.
The original `vision_bundle.cjs` is served as `vision_bundle.js` so browsers receive a JavaScript MIME type. Both WASM variants are needed because FilesetResolver chooses SIMD support at runtime.

Selfie model, float16 version 1, Apache-2.0:
`https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite`.
Model card: `https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf`.

SHA-256 of the shipped files:

```
8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8  LICENSE
191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b  selfie_segmenter.tflite
bf58c9b3f592304422947b51e1f7de360c67d4dfeaa900064352da0c5a7c9115  vision_bundle.js
4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb  wasm/vision_wasm_internal.js
f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7  wasm/vision_wasm_internal.wasm
927def7b465c51b86e4b3060f93646aca4e27121f4b8fc0483786e407ea9cf1f  wasm/vision_wasm_nosimd_internal.js
3821ea9b1f7fb8c549ef2a064ef5c85750bf375c545a49fd6eea0df44a95f1f4  wasm/vision_wasm_nosimd_internal.wasm
```
