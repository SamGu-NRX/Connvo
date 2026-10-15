import { chromium, webkit } from "@playwright/test";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// Deterministic browser proof for the real worker, model, canvas output, and
// cleanup. Route known local assets so it needs neither a backend nor a camera.
const require = createRequire(import.meta.url);
const zodDirectory = path.dirname(require.resolve("zod/package.json"));
const modules = new Map();
for (const name of ["blur-pipeline", "blur-policy"]) {
  const source = await readFile(
    path.join(process.cwd(), "src/lib/call", `${name}.ts`),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  modules.set(
    `/call-tests/${name}.js`,
    compiled
      .replace('"zod"', '"/zod/index.js"')
      .replace('"./blur-policy"', '"/call-tests/blur-policy.js"'),
  );
}

for (const [name, browserType] of Object.entries({ chromium, webkit })) {
  let browser;
  try {
    browser = await browserType.launch({ headless: true });
  } catch (error) {
    console.log(
      JSON.stringify({
        browser: name,
        status: "unavailable",
        reason: error.message.split("\n")[0],
      }),
    );
    if (name === "chromium") process.exitCode = 1;
    continue;
  }
  try {
    const context = await browser.newContext();
    await context.route("http://127.0.0.1:3105/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html lang="en"><title>Blur runtime proof</title><body></body></html>',
        });
      if (modules.has(pathname))
        return route.fulfill({
          contentType: "application/javascript",
          body: modules.get(pathname),
        });
      const file = pathname.startsWith("/zod/")
        ? path.join(zodDirectory, pathname.slice(5))
        : path.join(process.cwd(), "public", pathname);
      try {
        await route.fulfill({
          body: await readFile(file),
          contentType: pathname.endsWith(".wasm")
            ? "application/wasm"
            : pathname.endsWith(".js")
              ? "application/javascript"
              : "application/octet-stream",
        });
      } catch {
        await route.fulfill({ status: 404, body: "Missing test asset" });
      }
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:3105/");
    const result = await page.evaluate(async () => {
      const { createBlurPipeline } = await import(
        "/call-tests/blur-pipeline.js"
      );
      const source = document.createElement("canvas");
      source.width = 640;
      source.height = 360;
      const ctx = source.getContext("2d");
      const paint = () => {
        for (let y = 0; y < 360; y += 10)
          for (let x = 0; x < 640; x += 10) {
            ctx.fillStyle = (x + y) % 20 === 0 ? "#fff" : "#111";
            ctx.fillRect(x, y, 10, 10);
          }
      };
      paint();
      const interval = setInterval(paint, 50);
      const physical = source.captureStream(20);
      const input = physical.getVideoTracks()[0];
      const controller = new AbortController();
      const fallbacks = [];
      let pipeline;
      try {
        const start = performance.now();
        pipeline = await createBlurPipeline({
          input,
          signal: controller.signal,
          onFallback: (error) => fallbacks.push(error.reason),
        });
        const startupMs = performance.now() - start;
        const output = document.createElement("video");
        output.muted = true;
        output.playsInline = true;
        output.srcObject = new MediaStream([pipeline.track]);
        await output.play();
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("No processed video frame")),
            5000,
          );
          output.requestVideoFrameCallback(() => {
            clearTimeout(timeout);
            resolve();
          });
        });
        ctx.drawImage(output, 0, 0, 640, 360);
        const pixels = ctx.getImageData(0, 0, 640, 360).data;
        let total = 0,
          squares = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          total += pixels[index];
          squares += pixels[index] ** 2;
        }
        const count = pixels.length / 4,
          mean = total / count,
          variance = squares / count - mean ** 2;
        const outgoingLive = pipeline.track.readyState;
        pipeline.stop();
        const stoppedOutput = pipeline.track.readyState;
        const retainedInput = input.readyState;
        const cancelled = new AbortController();
        cancelled.abort();
        let cancellation;
        try {
          await createBlurPipeline({
            input,
            signal: cancelled.signal,
            onFallback: () => undefined,
          });
        } catch (error) {
          cancellation = error.name;
        }
        output.pause();
        output.srcObject = null;
        return {
          status: "processed",
          startupMs,
          mean,
          variance,
          outgoingLive,
          stoppedOutput,
          retainedInput,
          cancellation,
          fallbacks,
        };
      } catch (error) {
        return {
          status: error.reason || "error",
          message: error.message,
          inputState: input.readyState,
        };
      } finally {
        controller.abort();
        pipeline?.stop();
        clearInterval(interval);
        physical.getTracks().forEach((track) => track.stop());
      }
    });
    console.log(JSON.stringify({ browser: name, ...result }));
    if (result.status === "processed") {
      if (
        result.variance >= 100 ||
        result.mean < 20 ||
        result.outgoingLive !== "live" ||
        result.stoppedOutput !== "ended" ||
        result.retainedInput !== "live" ||
        result.cancellation !== "AbortError" ||
        result.fallbacks.length
      )
        process.exitCode = 1;
    } else if (name === "chromium" || result.inputState !== "live")
      process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
