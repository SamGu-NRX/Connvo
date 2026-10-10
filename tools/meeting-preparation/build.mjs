/**
 * Offline build: bundles src/index.ts into a single self-contained app.js
 * next to page/index.html. The page loads only local files — no CDN, no
 * fetch, no external origins. Run: node build.mjs (from this directory).
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "page");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(here, "src", "index.ts")],
  outfile: join(outDir, "app.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  sourcemap: false,
  minify: false,
  logLevel: "info",
});

console.log("Offline build complete: page/index.html + page/app.js");
