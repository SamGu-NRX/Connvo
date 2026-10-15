// Run from the checkout with the real-page dev server on :3105:
// ~/.long-run/bin/heavy node docs/call-ui/check.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium, webkit } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { RunContext } from "../../tools/call-eval/runner/context.mjs";
import { joinPair, leaveCall } from "../../tools/call-eval/runner/scenario-kit.mjs";

const base = "http://localhost:3105";
const shots = "docs/call-ui/screenshots";
const results = [];
const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }];
await fs.mkdir(shots, { recursive: true });
async function capture(page, name, all = true) {
  // The development inspector is not part of the shipped call UI.
  await page.addStyleTag({content:"nextjs-portal { display: none !important; }"});
  for (const viewport of all ? viewports : [page.viewportSize()]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ animations: "disabled", path: `${shots}/${name}-${viewport.width}x${viewport.height}.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `${name} horizontal overflow`);
  }
}
async function axe(page, name, include = "[data-call-phase]") {
  const scan = new AxeBuilder({ page });
  if (include) scan.include(include);
  const result = await scan.analyze();
  const violations = result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }));
  results.push({ check: `axe-${name}`, violations });
  assert.equal(violations.length, 0, `${name}: ${JSON.stringify(violations)}`);
}
const ctx = new RunContext({ transport: "p2p", page: "real", baseUrl: base, warmUp: false });
try {
  await ctx.start();
  ctx.newMeeting("lane5-ui");
  const a = await ctx.launchPeer("A", { autojoin: "0" });
  await a.page.getByTestId("join-call").waitFor();
  await a.page.waitForFunction(() => !document.querySelector('[data-testid="join-call"]').disabled);
  await a.page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
  await capture(a.page, "lobby");
  await axe(a.page, "lobby");
  await a.page.locator("summary").click();
  await capture(a.page, "lobby-settings");
  await a.page.locator("summary").click();
  await a.page.getByTestId("toggle-camera").click();
  await capture(a.page, "lobby-camera-off");
  await a.page.getByTestId("toggle-camera").click();
  await a.page.getByTestId("toggle-blur").click();
  await a.page.waitForFunction(() => !document.querySelector('[data-testid="toggle-blur"]').disabled, null, { timeout: 20000 });
  const blurActive = await a.page.getByTestId("toggle-blur").getAttribute("aria-pressed");
  results.push({ check: "real-page-blur", active: blurActive === "true", text: await a.page.getByTestId("toggle-blur").innerText() });
  await capture(a.page, blurActive === "true" ? "lobby-blur-active" : "lobby-blur-fallback");
  if (blurActive === "true") await a.page.getByTestId("toggle-blur").click();
  await a.page.goto(`${base}/app/call/unconfigured`, {waitUntil:"domcontentloaded"});
  await a.page.getByText("Calls need the signaling service").waitFor();
  await capture(a.page, "no-signaling");
  await axe(a.page, "no-signaling");
  await a.close();
  const denied = await ctx.launchPeer("A", {autojoin:"0"}, undefined, {fullChromium:true});
  await denied.page.getByTestId("retry-media").waitFor();
  await capture(denied.page, "permission-denied");
  await denied.close();
  ctx.newMeeting("lane5-interactions");
  const { peerA, peerB } = await joinPair(ctx);
  const page = peerA.page;
  await page.getByTestId("self-preview").waitFor();
  await capture(page, "connected");
  await axe(page, "connected");
  const mic = page.getByTestId("toggle-mic");
  await page.keyboard.press("m");
  assert.equal(await mic.getAttribute("aria-pressed"), "true");
  await page.keyboard.press("m");
  assert.equal(await mic.getAttribute("aria-pressed"), "false");
  const handle = page.getByRole("button", { name: /Move self view/ });
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.getByTestId("self-preview").getAttribute("data-corner"), "top left");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByTestId("self-preview").getAttribute("data-corner"), "top right");
  await capture(page, "connected-reduced-motion");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(viewports[0]);
  // Wait for the resized handle to settle before using its current geometry.
  await handle.hover();
  const rect = await handle.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(90, 720, { steps: 20 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-testid="self-preview"]').getAttribute("data-corner") === "bottom left", null, {timeout:3000});
  results.push({ check: "mic-shortcut-and-pip-pointer-keyboard", pass: true });
  await peerB.page.getByTestId("toggle-camera").click();
  await page.locator('[data-testid="remote-media"][data-video-off="true"]').waitFor();
  await capture(page, "partner-camera-off");
  await peerB.page.getByTestId("toggle-camera").click();
  await page.getByTestId("device-settings").click();
  await capture(page, "call-settings");
  await axe(page, "call-settings", "[data-testid=call-settings-panel]");
  await page.keyboard.press("Escape");
  await page.getByTestId("leave-call").click();
  await capture(page, "leave-confirmation");
  await page.getByRole("button", { name: "Stay", exact: true }).click();
  await page.routeWebSocket(/.*/, ws => ws.close());
  await ctx.killPeerSocket("A");
  await page.locator('[data-call-phase="reconnecting"]').waitFor();
  await capture(page, "reconnecting");
  await page.locator('[data-call-phase="failed"]').waitFor({ timeout: 70000 });
  await capture(page, "failed");
  await peerA.close();
  await peerB.close();
  ctx.newMeeting("lane5-ended");
  const endedPair = await joinPair(ctx);
  await leaveCall(endedPair.peerA);
  await capture(endedPair.peerA.page, "ended");
  await ctx.closePeers();
  ctx.newMeeting("lane5-network-blocked");
  // The existing probe forces relay-only ICE with no relay server.
  // This exercises the transport's real failure message without backend writes.
  await ctx.launchPeer("A", {}, {iceTransportPolicy:"relay",iceServers:[]});
  const blockedB = await ctx.launchPeer("B", {}, {iceTransportPolicy:"relay",iceServers:[]});
  await blockedB.page.locator('[data-call-phase="joining"]').waitFor();
  await capture(blockedB.page, "joining");
  await blockedB.page.locator('[data-call-phase="failed"]').waitFor({timeout:70000});
  assert.match(await blockedB.page.getByTestId("call-error").innerText(), /network may be blocking calls/);
  await capture(blockedB.page, "network-blocked");
  await axe(blockedB.page, "network-blocked");
  results.push({check:"merged-transport-network-error",pass:true});
  await ctx.closePeers();
} catch (error) {
  results.push({ check: "chromium-ui", error: error.message });
  process.exitCode = 1;
} finally { await ctx.stop(); }

// The actual side-panel component in an isolated fixture. No production test route.
// This checks native modal behavior and draft persistence, not Convex saving.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CallSidePanel} from './src/components/call/CallSidePanel'; import styles from './src/components/call/call.module.css'; createRoot(document.getElementById('root')).render(<div className={styles.page}><div className={styles.room} style={{height:'100%',position:'relative',display:'flex',flexDirection:'column',overflow:'hidden',background:'var(--stage)',color:'var(--ink)'}}><header className={styles.header}>Connvo</header><div className={styles.workspace}><div className={styles.callContent}><button id="outside">Call control</button></div><CallSidePanel><label>Notes draft<textarea style={{width:'100%',height:220,fontSize:16}} aria-label="Notes draft" /></label></CallSidePanel></div></div></div>);`, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, outdir: "/tmp/connvo-lane5-panel", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
});
for (const [name, browserType] of Object.entries({ chromium, webkit })) {
  let browser;
  try {
    browser = await browserType.launch({ headless: true });
    const context = await browser.newContext({ viewport: viewports[1] });
    const page = await context.newPage();
    const css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
    const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
    await page.setContent(`<!doctype html><html lang="en"><title>Call notes panel fixture</title><style>${css}</style><style>body{margin:0;font:16px system-ui}*{box-sizing:border-box}button{font:inherit;color:inherit;background:none;border:0}h2{font:inherit;margin:0}textarea{font:inherit}</style><main id="root"></main><script>${js.replaceAll("</script", "<\\/script")}</script></html>`);
    await page.locator("#outside").click();
    await page.getByTestId("toggle-side-panel").click();
    await page.getByRole("textbox").fill("A thought that survives closing the sheet.");
    await capture(page, `${name}-side-panel-component`, false);
    await axe(page, `${name}-panel`, "dialog");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByTestId("toggle-side-panel").evaluate(el => el === document.activeElement), true);
    await page.locator("#outside").click();
    await page.getByTestId("toggle-side-panel").click();
    assert.equal(await page.getByRole("textbox").inputValue(), "A thought that survives closing the sheet.");
    await page.setViewportSize(viewports[2]);
    await capture(page, `${name}-side-panel-component`, false);
    await page.setViewportSize(viewports[0]);
    await page.locator('dialog[open]').waitFor();
    await capture(page, `${name}-side-panel-component`, false);
    results.push({ check: `${name}-native-sheet`, pass: true });
  } catch (error) { results.push({ check: `${name}-native-sheet`, error: error.message }); process.exitCode = 1; }
  finally { await browser?.close(); }
}
await fs.writeFile("docs/call-ui/verification/ui.json", JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
