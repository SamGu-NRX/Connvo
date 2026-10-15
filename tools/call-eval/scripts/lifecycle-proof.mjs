/** Real-page proof of last-leave, ended rejoin, duration and outsider capture. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { createEvalMeeting } from "../runner/convex-signaling.mjs";
import { tapConvex } from "../runner/convex-tap.mjs";

const baseUrl =
  process.argv.find((a) => a.startsWith("--base-url="))?.slice(11) ??
  "http://localhost:3103";
const out = path.resolve("docs/lane3");
const shots = path.join(out, "screenshots");
fs.mkdirSync(shots, { recursive: true });
const state = JSON.parse(
  fs.readFileSync("tools/call-eval/out/state.json", "utf8"),
);
const client = new ConvexHttpClient(state.convexUrl);
const meetingId = createEvalMeeting("Lifecycle proof");
/** @type {import('@playwright/test').Browser[]} */
const browsers = [];
/** @type {Array<{state: string, width: number, reducedMotion: boolean, violations: string[]}>} */
const audits = [];

/** @param {string} id @param {"hold" | "fail" | "unavailable"} [statusFault] */
async function person(id, statusFault) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--mute-audio",
    ],
  });
  browsers.push(browser);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(() => {
    let requests = 0;
    /** @type {MediaStreamTrack[]} */
    const tracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      requests++;
      const stream = await original(constraints);
      tracks.push(...stream.getTracks());
      return stream;
    };
    Object.defineProperty(window, "lifecycleCapture", {
      value: () => ({
        requests,
        live: tracks.filter((t) => t.readyState === "live").length,
      }),
    });
  });
  const tap = await tapConvex(context);
  if (statusFault === "unavailable") {
    // Scheduled-call UI fixture: change only this query's delivered value.
    await context.routeWebSocket(/\/api\/[^/]+\/sync$/, (socket) => {
      const server = socket.connectToServer();
      const queryIds = new Set();
      socket.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        for (const modification of message.modifications ?? []) {
          if (modification.udfPath === "meetings/webrtc/mesh:callStatus")
            queryIds.add(modification.queryId);
        }
        server.send(raw);
      });
      server.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        for (const modification of message.modifications ?? []) {
          if (modification.type === "QueryUpdated" && queryIds.has(modification.queryId))
            modification.value = "unavailable";
        }
        socket.send(JSON.stringify(message));
      });
      socket.onClose(() => void server.close().catch(() => {}));
      server.onClose(() => void socket.close().catch(() => {}));
    });
  }
  if (statusFault === "hold")
    tap.holdQueries = ["meetings/webrtc/mesh:callStatus"];
  if (statusFault === "fail")
    tap.failQueries = ["meetings/webrtc/mesh:callStatus"];
  const page = await context.newPage();
  await page.goto(`${baseUrl}/app/call/${meetingId}?as=${id}`);
  return page;
}

/** @param {import('@playwright/test').Page} page */
const captureState = (page) =>
  page.evaluate(() => {
    // Installed in every new document by this proof's context init script.
    const probe =
      /** @type {Window & {lifecycleCapture?: () => {requests: number, live: number}}} */ (
        window
      );
    if (!probe.lifecycleCapture)
      throw new Error("Capture probe was not installed");
    return probe.lifecycleCapture();
  });

/** @param {import('@playwright/test').Page} page @param {string} name @param {string} scope */
async function capture(page, name, scope) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator(scope).first().waitFor();
    await page.addStyleTag({
      content: "nextjs-portal { display:none!important }",
    });
    const audit = await new AxeBuilder({ page }).include(scope).analyze();
    const violations = audit.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    audits.push({
      state: name,
      width: viewport.width,
      reducedMotion: false,
      violations: violations.map((v) => v.id),
    });
    await page.screenshot({
      path: path.join(
        shots,
        `${name}-${viewport.width}x${viewport.height}.png`,
      ),
    });
    assert.equal(
      violations.length,
      0,
      `${name}: serious/critical accessibility violations`,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await new AxeBuilder({ page }).include(scope).analyze();
    const reducedViolations = reduced.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    audits.push({
      state: name,
      width: viewport.width,
      reducedMotion: true,
      violations: reducedViolations.map((v) => v.id),
    });
    assert.equal(
      reducedViolations.length,
      0,
      `${name}: reduced-motion accessibility violations`,
    );
  }
}

/** @param {import('@playwright/test').Page} page */
async function leave(page) {
  await page.getByTestId("leave-call").click();
  await page.getByTestId("leave-call-confirm").click();
  await page.locator('[data-call-phase="left"]').waitFor();
  assert.equal(
    (await captureState(page)).live,
    0,
    "leave must release capture",
  );
}

try {
  const loading = await person("A", "hold");
  await loading
    .getByText("Checking whether the call is still open…", { exact: true })
    .waitFor();
  assert.deepEqual(await captureState(loading), { requests: 0, live: 0 });
  await capture(loading, "checking-call", "[data-call-phase]");
  await loading.context().close();
  const failed = await person("A", "fail");
  await failed
    .getByRole("heading", { name: "This call couldn't load", exact: true })
    .waitFor();
  assert.deepEqual(await captureState(failed), { requests: 0, live: 0 });
  await capture(failed, "call-check-failed", "[data-call-phase]");
  await failed.context().close();
  const unavailable = await person("A", "unavailable");
  await unavailable.getByRole("heading", { name: "This call isn't open", exact: true }).waitFor();
  assert.deepEqual(await captureState(unavailable), { requests: 0, live: 0 });
  await capture(unavailable, "call-unavailable", "[data-call-phase]");
  await unavailable.context().close();
  const a = await person("A");
  const b = await person("B");
  for (const page of [a, b]) await page.getByTestId("join-call").click();
  for (const page of [a, b])
    await page.locator('[data-call-phase="connected"]').waitFor();
  await leave(a);
  await leave(b);
  // A left first. The final leave must remove its old Rejoin control too.
  await a
    .getByRole("heading", { name: "This call has ended", exact: true })
    .waitFor();
  assert.equal(await a.getByRole("button", { name: /rejoin/i }).count(), 0);
  const before = await captureState(a);
  await capture(a, "ended-link", "[data-call-phase]");
  assert.deepEqual(
    await captureState(a),
    before,
    "ended notice must not reopen capture",
  );
  await a.reload();
  await a.getByTestId("open-recap").waitFor();
  assert.equal(
    await a
      .getByRole("heading", { name: "This call has ended", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
    "ended heading receives focus",
  );
  assert.deepEqual(
    await captureState(a),
    { requests: 0, live: 0 },
    "ended rejoin must not capture",
  );
  await capture(a, "ended-rejoin", "[data-call-phase]");
  // Exercise the new link using the keyboard, including its focus indicator.
  await a.evaluate(
    () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.blur(),
  );
  for (let i = 0; i < 30; i++) {
    await a.keyboard.press("Tab");
    if (
      await a
        .getByTestId("open-recap")
        .evaluate((el) => el === document.activeElement)
    )
      break;
  }
  assert.equal(
    await a
      .getByTestId("open-recap")
      .evaluate((el) => el.matches(":focus-visible")),
    true,
  );
  await a.keyboard.press("Enter");
  await a.getByTestId("meeting-recap").waitFor();
  // Provisioning tokens expire after ten minutes; queued browser proofs must
  // obtain the same fresh local identity the page uses.
  const authResponse = await fetch(`${baseUrl}/api/test-auth/token?user=A`);
  assert.ok(authResponse.ok, "local proof identity must be available");
  const auth = z.object({ token: z.string() }).parse(await authResponse.json());
  client.setAuth(auth.token);
  const history = z
    .object({
      meeting: z.object({ state: z.literal("concluded") }),
      state: z.object({ startedAt: z.number(), endedAt: z.number() }),
    })
    .parse(
      await client.query(
        /** @type {import("convex/server").FunctionReference<"query">} */ (
          makeFunctionReference("history/queries:getMeetingHistory")
        ),
        { meetingId },
      ),
    );
  assert.equal(history.meeting.state, "concluded");
  assert.equal(typeof history.state?.startedAt, "number");
  assert.equal(typeof history.state?.endedAt, "number");
  const seconds = Math.floor(
    (history.state.endedAt - history.state.startedAt) / 1000,
  );
  assert.ok(
    seconds >= 0 && seconds < 60,
    "short proof call must finish within a minute",
  );
  const duration = `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  assert.ok(
    (await a.getByTestId("meeting-recap").innerText()).includes(duration),
  );
  await capture(a, "recap", '[data-testid="meeting-recap"]');
  await a.goto(`${baseUrl}/app/meetings?as=A`);
  const row = a.locator(`a[href="/app/meetings/${meetingId}"]`);
  await row.waitFor();
  assert.ok((await row.innerText()).includes(duration));
  await capture(a, "history", '[data-testid="meeting-list"]');
  const outsider = await person("O");
  await outsider.getByTestId("call-error").waitFor();
  assert.match(
    await outsider.getByTestId("call-error").innerText(),
    /access denied/i,
  );
  assert.deepEqual(await captureState(outsider), { requests: 0, live: 0 });
  await capture(outsider, "outsider", "[data-call-phase]");
  fs.writeFileSync(
    path.join(out, "lifecycle-proof.json"),
    JSON.stringify(
      {
        pass: true,
        meetingId,
        duration,
        timestamps: history.state,
        audits,
        assertions: [
          "last leave ends",
          "first leaver loses rejoin",
          "ended reload requests no media",
          "duration matches stored timestamps in recap and history",
          "recap link works by keyboard",
          "outsider requests no media",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ pass: true, duration, captures: audits.length }),
  );
} finally {
  await Promise.all(browsers.map((browser) => browser.close()));
}
