#!/usr/bin/env node
/** Capture the real page's relay, exhausted-network and retry states. Local backend only. */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { RunContext } from "../runner/context.mjs";
import { createTurn } from "../runner/turn.mjs";
import { setLocalIceEnvironment } from "../runner/ice-endpoint.mjs";
import { waitFor, phaseIs } from "../runner/scenario-kit.mjs";
import { measureFps } from "../runner/page-helpers.mjs";
import AxeBuilder from "@axe-core/playwright";
const baseUrl = process.argv.find((value) => value.startsWith("--base-url="))?.slice(11) ?? "http://localhost:3102";
const out = path.resolve("docs/lane2c/screenshots");
fs.mkdirSync(out, { recursive: true });
const ctx = new RunContext({ transport: "reference", page: "real", signaling: "convex", baseUrl });
const secret = randomBytes(32).toString("base64url");
let turn = await createTurn({ sharedSecret: secret });
const port = turn.port;
let restore;
/** @type {Array<{ state: string, width: number, violations: string[] }>} */
const accessibility = [];
try {
  await ctx.start();
  ctx.newMeeting("ICE states");
  restore = await setLocalIceEnvironment({ TURN_SHARED_SECRET: secret, TURN_URLS: `turn:127.0.0.1:${port}?transport=udp` });
  const a = await ctx.launchPeer("A", { autojoin: "0" }, { iceTransportPolicy: "relay" });
  const b = await ctx.launchPeer("B", { autojoin: "0" }, { iceTransportPolicy: "relay" });
  const shots = async (/** @type {string} */ state) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await a.page.setViewportSize(viewport);
      await a.page.emulateMedia({ reducedMotion: "reduce" });
      const audit = await new AxeBuilder({ page: a.page }).include("[data-call-phase]").analyze();
      const violations = audit.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
      accessibility.push({ state, width: viewport.width, violations });
      if (violations.length) throw new Error(`${state}: accessibility violations: ${violations.join(", ")}`);
      await a.page.screenshot({ path: path.join(out, `${state}-${viewport.width}x${viewport.height}.png`) });
    }
  };
  await a.page.locator('[data-testid="join-call"]:not([disabled])').waitFor();
  await shots("lobby");
  await Promise.all([ctx.joinFromLobby(a), ctx.joinFromLobby(b)]);
  await waitFor(a, phaseIs("connected"), { timeoutMs: 30000 });
  await waitFor(b, phaseIs("connected"), { timeoutMs: 30000 });
  await a.page.locator('[data-call-connection-path="relay"]').waitFor();
  await a.page.locator('[data-testid="remote-media"] video').first().waitFor();
  await shots("relay-connected");
  // Remove the actual media relay. ICE restarts can no longer reach either
  // person, so the transport must finish recovery with an actionable error.
  turn.stop();
  await Promise.all([a, b].map((peer) => peer.page.evaluate(() => {
    if (!("__probeRestartIce" in window) || typeof window.__probeRestartIce !== "function") throw new Error("Missing ICE restart probe.");
    window.__probeRestartIce();
  })));
  await waitFor(a, phaseIs("reconnecting"), { timeoutMs: 30000 });
  await shots("reconnecting");
  await waitFor(a, phaseIs("failed"), { timeoutMs: 95000 });
  await waitFor(b, phaseIs("failed"), { timeoutMs: 95000 });
  const error = await a.page.getByTestId("call-error").textContent();
  if (!error?.includes("network may be blocking calls")) throw new Error("Missing network explanation.");
  // Reach Retry through the natural tab order, including the app shell.
  let keyboardRetry = false;
  for (let i = 0; i < 40; i++) {
    await a.page.keyboard.press("Tab");
    keyboardRetry = await a.page.getByTestId("retry-call").evaluate((button) => button === document.activeElement);
    if (keyboardRetry) break;
  }
  if (!keyboardRetry) throw new Error("Retry cannot receive keyboard focus.");
  await shots("network-failed");
  turn = await createTurn({ port, sharedSecret: secret });
  await a.page.keyboard.press("Enter");
  await b.page.getByTestId("retry-call").click();
  await waitFor(a, phaseIs("connected"), { timeoutMs: 30000 });
  await waitFor(b, phaseIs("connected"), { timeoutMs: 30000 });
  const fps = await measureFps(a, "B", 2000);
  if (fps.fps < 15) throw new Error("Retry did not restore advancing remote frames.");
  await shots("retry-connected");
  fs.writeFileSync(path.join(out, "states-result.json"), JSON.stringify({ pass: true, networkError: error, keyboardRetry, reducedMotion: true, remoteFpsAfterRetry: fps.fps, accessibility }, null, 2) + "\n");
  console.log("ICE state proof passed: relay, failed-network explanation, keyboard retry, media restored.");
} finally {
  await ctx.stop();
  await restore?.();
  turn.stop();
}
