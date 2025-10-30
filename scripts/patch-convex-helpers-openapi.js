#!/usr/bin/env node

/**
 * Convex helpers (0.1.x) do not yet translate `v.bytes()` validators when generating
 * OpenAPI specs. This script patches the installed binary on the fly so the generator
 * emits a binary string schema instead of crashing.
 */

const fs = require("fs");
const path = require("path");

function patchConvexHelpers() {
  let binPath;
  try {
    const moduleDir = path.dirname(require.resolve("convex-helpers"));
    binPath = path.join(moduleDir, "bin.cjs");
  } catch (error) {
    console.warn("convex-helpers not installed; skipping patch.");
    return;
  }

  const fileContent = fs.readFileSync(binPath, "utf8");
  const target = 'case "bytes":\n      throw new Error("bytes unsupported");';
  const replacement =
    'case "bytes":\n      return "type: string\\nformat: binary";';

  if (!fileContent.includes(target) && !fileContent.includes(replacement)) {
    // Either already patched or a newer version that handles bytes natively.
    return;
  }

  if (fileContent.includes(replacement)) {
    // Already patched in this install.
    return;
  }

  const updated = fileContent.replace(target, replacement);
  fs.writeFileSync(binPath, updated, "utf8");
  console.log("Patched convex-helpers OpenAPI generator to support bytes.");
}

patchConvexHelpers();
