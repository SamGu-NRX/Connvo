#!/usr/bin/env node
/**
 * Screenshots of the two call-page states that only exist on the Convex
 * path, at 1440x900 and 390x844:
 *
 * - "Getting your call ready": the page is still finding out who is signed
 *   in. The test sign-in token request is held open, so the state stays up.
 * - "Sign in to join this call": nobody is signed in. The token request is
 *   refused, which leaves the page with no user, as a signed-out WorkOS
 *   session does.
 *
 * Needs the local backend and next dev from scripts/local-backend.mjs
 * (Convex configured, test sign-in on).
 *
 *   node tools/call-eval/scripts/convex-call-states-shots.mjs --base-url=http://localhost:3035 [--out=docs/call-page/screenshots]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const flags = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const baseUrl = flags["base-url"] ?? "http://localhost:3035";
const outDir = path.resolve(REPO, flags.out ?? "docs/call-page/screenshots");
fs.mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const TOKEN_ROUTE = "**/api/test-auth/token**";

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of VIEWPORTS) {
    for (const [name, heading, answer] of /** @type {const} */ ([
      ["call-getting-ready", "Getting your call ready", "hold"],
      ["call-sign-in-required", "Sign in to join this call", "refuse"],
    ])) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      await context.route(TOKEN_ROUTE, (route) =>
        answer === "refuse" ? route.fulfill({ status: 401, body: "signed out" }) : undefined,
      );
      const page = await context.newPage();
      await page.goto(`${baseUrl}/app/call/demo-meeting?as=A`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: heading }).waitFor({ timeout: 60000 });
      // next dev's own issue badge is not part of the page.
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.waitForTimeout(400);
      const file = path.join(outDir, `${name}-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: file });
      console.log(`shot ${path.relative(REPO, file)}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
