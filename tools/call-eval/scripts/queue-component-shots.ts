#!/usr/bin/env -S pnpm exec tsx
// Capture short-lived states of the real QueueView in the app shell. The
// temporary, test-auth-only route is removed even when a screenshot fails.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "@playwright/test";

async function main() {
  const root = process.cwd();
  const routeDir = path.join(root, "src/app/auth/queue-component-proof");
  const route = path.join(routeDir, "page.tsx");
  const out = path.join(root, "docs/match-to-call/screenshots");
  const port = Number(
    process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? 3101,
  );
  assert.equal(port, 3101, "Lane 1 uses port 3101");
  mkdirSync(routeDir); // Refuse to replace a route that somebody else owns.
  writeFileSync(
    route,
    `"use client";
import { Suspense } from "react";
import { useSearchParams, notFound } from "next/navigation";
import AppLayout from "@/app/app/layout";
import { QueueView, type QueueViewState } from "@/components/queue/QueueView";
const states: Record<string, QueueViewState> = {
  loading: { kind: "loading" }, idle: { kind: "idle" },
  signed_out: { kind: "signed_out" }, ready: { kind: "ready" },
};
function State() {
  const params = useSearchParams();
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_PUBLIC_CONNVO_TEST_AUTH !== "1") notFound();
  const state = states[params.get("state") ?? "loading"];
  if (!state) notFound();
  const noop = () => {};
  return <AppLayout><QueueView state={state} title="Match queue" pending={false}
    onJoin={noop} onLeave={noop} onAccept={noop} onDecline={noop} onRetry={noop} /></AppLayout>;
}
export default function Page() { return <Suspense><State /></Suspense>; }
`,
    { flag: "wx" },
  );
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    mkdirSync(out, { recursive: true });
    const page = await browser.newPage();
    for (const state of ["loading", "idle", "signed_out", "ready"]) {
      await page.goto(
        `http://localhost:${port}/auth/queue-component-proof?as=O&state=${state}`,
      );
      await page.locator(`[data-queue-state="${state}"]`).waitFor();
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: path.join(
            out,
            `component-${state}-${viewport.width}x${viewport.height}.png`,
          ),
          animations: "disabled",
        });
      }
    }
    console.log(
      "PASS: 8 component-state captures. These are fixtures, not live queue transitions.",
    );
  } finally {
    await browser?.close();
    unlinkSync(route);
    rmdirSync(routeDir);
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
