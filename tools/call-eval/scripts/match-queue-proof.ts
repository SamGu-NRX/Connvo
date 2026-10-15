#!/usr/bin/env -S pnpm exec tsx
/** Run against the existing local backend, under ~/.long-run/bin/heavy:
 * pnpm exec tsx tools/call-eval/scripts/match-queue-proof.ts --port=3101
 * Captures use shipped routes and local fixture mutations, never injected UI state.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { parse as parseEnv } from "dotenv";
import { z } from "zod";
import {
  checkedConvexEnvironment,
  selectedLocalBackend,
  requireLoopbackUrl,
} from "./local-backend-core.mjs";
import { installSignalingCut } from "../runner/convex-signaling.mjs";
import { peerLaunchArgs } from "../runner/peers.mjs";
import { decodeRemoteFrame, matchPeerColor } from "../runner/page-helpers.mjs";

const REPO = path.resolve(
  path.dirname(path.resolve(process.argv[1])),
  "../../..",
);
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const SCOPE = "[data-queue-state]";
const browsers: Browser[] = [];
const captures: string[] = [];
const audits: unknown[] = [];
const checks: string[] = [];
const startedAt = new Date().toISOString();
const runDir = path.join(
  REPO,
  "tools/call-eval/out/match-queue-proof",
  startedAt.replace(/[:.]/g, "-"),
);
const docsDir = path.join(REPO, "docs/match-to-call");
const shotsDir = path.join(docsDir, "screenshots");
let stage = "local-target-guard";
let pass = false;
let meetingId: string | undefined;
let failure: string | undefined;
let gitSha: string | undefined;
const errors: { peer: string; stage: string; name: string }[] = [];

const argv = process.argv.slice(2);
assert(
  argv.every((arg) => /^--port=\d+$/.test(arg)),
  "Only --port=<local Next port> is supported",
);
const port = Number(
  argv.find((arg) => arg.startsWith("--port="))?.split("=")[1] ?? 3101,
);
assert(
  Number.isInteger(port) && port > 0 && port <= 65535,
  "Invalid local port",
);
const baseUrl = `http://localhost:${port}`;

function fixture(
  fn: "prepare" | "expire" | "meeting",
  args: Record<string, string> = {},
): unknown {
  const envLocalPath = path.join(REPO, ".env.local");
  const envLocalContent = fs.readFileSync(envLocalPath, "utf8");
  const local = parseEnv(envLocalContent);
  const clean = checkedConvexEnvironment({ env: process.env, envLocalContent });
  const target = selectedLocalBackend({
    cwd: REPO,
    env: { ...local, ...clean, NODE_ENV: "development" },
  });
  // --env-file prevents the CLI loading another dotenv file after this guard.
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPO, "node_modules/convex/bin/main.js"),
      "run",
      `devEval/queueProof:${fn}`,
      JSON.stringify(args),
      "--env-file",
      envLocalPath,
    ],
    {
      cwd: REPO,
      env: {
        ...clean,
        NODE_ENV: "development",
        CONVEX_DEPLOYMENT: target.deployment,
        NEXT_PUBLIC_CONVEX_URL: target.url,
        CONVEX_URL: target.url,
      },
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // CLI output may contain credentials or server document contents. Never print it.
  assert.equal(result.status, 0, `Local queue fixture ${fn} failed`);
  const stdout = result.stdout;
  const first = stdout.indexOf("{");
  const last = stdout.lastIndexOf("}");
  assert(
    first >= 0 && last >= first,
    `Local queue fixture ${fn} returned no object`,
  );
  return JSON.parse(stdout.slice(first, last + 1));
}

async function person(id: "A" | "B") {
  const browser = await chromium.launch({
    headless: true,
    args: peerLaunchArgs({
      fixtureVideo: path.join(REPO, `tools/call-eval/fixtures/peer-${id}.y4m`),
      fixtureAudio: path.join(REPO, `tools/call-eval/fixtures/peer-${id}.wav`),
    }),
  });
  browsers.push(browser);
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: VIEWPORTS[0],
    deviceScaleFactor: 1,
    permissions: ["camera", "microphone"],
    recordVideo: { dir: path.join(runDir, id), size: VIEWPORTS[0] },
  });
  const cut = await installSignalingCut(context);
  // tsx preserves function names with this helper inside serialized evaluate
  // callbacks. It changes no application state or behavior.
  await context.addInitScript("globalThis.__name = (value) => value;");
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) =>
    errors.push({ peer: id, stage, name: error.name }),
  );
  return { id, context, page, cut };
}
type Person = Awaited<ReturnType<typeof person>>;

async function state(page: Page, kind: string) {
  await expect(page.locator(SCOPE)).toHaveAttribute("data-queue-state", kind, {
    timeout: 30_000,
  });
  await expect(page.locator(`${SCOPE} [aria-busy]`)).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function openQueue(peer: Person) {
  await peer.page.goto(`/app/match-queue?as=${peer.id}`, {
    waitUntil: "domcontentloaded",
  });
}
async function capture(page: Page, name: string, queue = true) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => document.fonts.ready);
    if (queue) await expect(page.locator(SCOPE)).toBeVisible();
    const filename = `${name}-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({
      path: path.join(shotsDir, filename),
      animations: "disabled",
    });
    captures.push(`docs/match-to-call/screenshots/${filename}`);
    if (queue) {
      const audit = await new AxeBuilder({ page })
        .include(SCOPE)
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      audits.push({
        state: name,
        viewport,
        violations: audit.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          targets: v.nodes.map((n) => n.target),
        })),
        incomplete: audit.incomplete.map((v) => v.id),
        passes: audit.passes.length,
      });
    }
  }
  await page.setViewportSize(VIEWPORTS[0]);
}
async function freshPair(a: Person, b: Person) {
  fixture("prepare");
  await openQueue(a);
  // Existing pages retain their entered flag; reload after fixture cleanup to rejoin.
  await expect(a.page.locator(SCOPE)).toHaveAttribute(
    "data-queue-state",
    /waiting|matched/,
    { timeout: 30_000 },
  );
  await openQueue(b);
  await Promise.all([state(a.page, "matched"), state(b.page, "matched")]);
}

async function keyboardAndHover(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("light");
  });
  await expect(page.locator("html")).toHaveClass(/dark/);
  const join = page
    .locator(SCOPE)
    .getByRole("button", { name: "Join", exact: true });
  const decline = page
    .locator(SCOPE)
    .getByRole("button", { name: "Decline", exact: true });
  await join.focus();
  await page.keyboard.press("Tab");
  await expect(decline).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(join).toBeFocused();
  const focus = await join.evaluate((node) => ({
    width: parseFloat(getComputedStyle(node).outlineWidth),
    style: getComputedStyle(node).outlineStyle,
  }));
  assert(
    focus.width >= 2 && focus.style !== "none",
    "Queue keyboard focus needs a visible outline",
  );
  const movement = await page
    .locator(`${SCOPE} button`)
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        return {
          transition: style.transitionDuration,
          animation: style.animationDuration,
        };
      }),
    );
  assert(
    movement.every((row) =>
      [row.transition, row.animation].every((value) =>
        value.split(",").every((duration) => parseFloat(duration) === 0),
      ),
    ),
    "Reduced motion retains timed animation",
  );
  for (const [name, button] of [
    ["join", join],
    ["decline", decline],
  ] as const) {
    await button.hover();
    const contrast = await button.evaluate((node) => {
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) throw new Error("Contrast canvas unavailable");
      function rgba(css: string) {
        if (!ctx) throw new Error("Contrast canvas unavailable");
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      }
      const style = getComputedStyle(node);
      const fg = rgba(style.color);
      let background: Element | null = node;
      let bg = rgba(style.backgroundColor);
      while (bg[3] === 0 && background?.parentElement) {
        background = background.parentElement;
        bg = rgba(getComputedStyle(background).backgroundColor);
      }
      if (bg[3] !== 255 || fg[3] !== 255)
        throw new Error("Hover contrast requires opaque text and background");
      const luminance = (rgb: number[]) =>
        rgb
          .slice(0, 3)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const [lo, hi] = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
      return (hi + 0.05) / (lo + 0.05);
    });
    audits.push({
      check: "dark-hover-contrast",
      button: name,
      ratio: contrast,
    });
    assert(contrast >= 4.5, `${name} dark hover contrast below 4.5:1`);
  }
  await capture(page, "matched-dark-reduced-motion");
  await page.emulateMedia({
    reducedMotion: "no-preference",
    colorScheme: "light",
  });
  await page.evaluate(() => {
    localStorage.setItem("theme", "light");
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  });
  checks.push(
    "Keyboard Tab and Shift+Tab, visible focus, reduced-motion durations, dark hover text contrast",
  );
}

async function connected(peer: Person) {
  await expect(peer.page.locator("[data-call-phase]")).toHaveAttribute(
    "data-call-phase",
    "connected",
    { timeout: 60_000 },
  );
  await expect(peer.page.locator('[data-testid="remote-media"]')).toHaveCount(
    1,
  );
  await expect(
    peer.page.locator('[data-testid="remote-media"] video'),
  ).toBeVisible();
  const remoteId = await peer.page
    .getByTestId("remote-media")
    .getAttribute("data-participant-id");
  assert(remoteId, "Remote tile has no participant identity");
  const expectedPeer = peer.id === "A" ? "B" : "A";
  await expect
    .poll(
      async () => {
        // decodeRemoteFrame uses the pinned decoderBundle on pixels from the remote video.
        const frame = await decodeRemoteFrame(peer, remoteId);
        if (!frame.present || !frame.color) return "no-frame";
        const color = matchPeerColor(frame.color);
        return color.ok ? color.label : "unclassified";
      },
      {
        timeout: 45_000,
        message: `${peer.id} must decode peer ${expectedPeer}'s fixture color`,
      },
    )
    .toBe(expectedPeer);
  const first = await decodeRemoteFrame(peer, remoteId);
  assert(
    first.present && first.counter?.ok,
    "Remote fixture frame counter did not decode",
  );
  const firstCounter = first.counter;
  assert(firstCounter, "Remote fixture frame counter is missing");
  await expect
    .poll(
      async () => {
        const next = await decodeRemoteFrame(peer, remoteId);
        return (
          next.present &&
          next.counter?.ok &&
          next.counter.counter !== firstCounter.counter
        );
      },
      {
        timeout: 10_000,
        message: `${peer.id} remote fixture frame counter must advance`,
      },
    )
    .toBe(true);
  checks.push(
    `${peer.id} decoded peer ${expectedPeer} fixture color and advancing frame counter`,
  );
}

async function main() {
  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(shotsDir, { recursive: true });
    const revision = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(revision.status, 0, "Cannot read proof revision");
    gitSha = z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .parse(revision.stdout.trim());
    const missingFixture = ["A", "B"].some((id) =>
      ["y4m", "wav"].some(
        (ext) =>
          !fs.existsSync(
            path.join(REPO, `tools/call-eval/fixtures/peer-${id}.${ext}`),
          ),
      ),
    );
    if (missingFixture) {
      // The caller holds the heavy lease for the entire proof, including fixture generation.
      const generated = spawnSync(
        process.execPath,
        [path.join(REPO, "tools/call-eval/scripts/generate-fixtures.mjs")],
        {
          cwd: REPO,
          encoding: "utf8",
          timeout: 120_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      assert.equal(
        generated.status,
        0,
        "Pinned media fixture generation failed",
      );
    }
    const localContent = fs.readFileSync(path.join(REPO, ".env.local"), "utf8");
    const clean = checkedConvexEnvironment({
      env: process.env,
      envLocalContent: localContent,
    });
    const target = selectedLocalBackend({
      cwd: REPO,
      env: { ...parseEnv(localContent), ...clean, NODE_ENV: "development" },
    });
    const receipt = z
      .object({ convexUrl: z.string(), nextBaseUrl: z.string() })
      .parse(
        JSON.parse(
          fs.readFileSync(
            path.join(REPO, "tools/call-eval/out/state.json"),
            "utf8",
          ),
        ),
      );
    assert.equal(
      requireLoopbackUrl(receipt.convexUrl).origin,
      target.url,
      "Backend receipt selects another deployment",
    );
    assert.equal(
      requireLoopbackUrl(receipt.nextBaseUrl).port,
      String(port),
      "Backend receipt selects another Next port",
    );
    const instance = await fetch(`${target.url}/instance_name`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert(
      instance.ok &&
        (await instance.text()).trim().replace(/^"|"$/g, "") === target.name,
      "Local backend identity mismatch",
    );
    fixture("prepare");
    const a = await person("A");
    const b = await person("B");
    stage = "waiting";
    await openQueue(a);
    await state(a.page, "waiting");
    await capture(a.page, "waiting");
    stage = "matched";
    await openQueue(b);
    await Promise.all([state(a.page, "matched"), state(b.page, "matched")]);
    await expect(
      a.page.locator(SCOPE).getByRole("heading", { name: "Why you matched" }),
    ).toBeVisible();
    await expect(a.page.locator(`${SCOPE} [role=status]`)).toContainText(
      "Match found",
    );
    await capture(a.page, "matched");
    await keyboardAndHover(a.page);
    stage = "accepted";
    await a.page
      .locator(SCOPE)
      .getByRole("button", { name: "Join", exact: true })
      .click();
    await expect(
      a.page.getByRole("button", { name: "Waiting for partner", exact: true }),
    ).toBeDisabled();
    await capture(a.page, "accepted");
    stage = "declined";
    await a.page
      .locator(SCOPE)
      .getByRole("button", { name: "Decline", exact: true })
      .click();
    await Promise.all([state(a.page, "waiting"), state(b.page, "waiting")]);
    await expect(a.page.locator(SCOPE)).toContainText("Match declined.");
    await expect(b.page.locator(SCOPE)).toContainText("Your partner declined.");
    await capture(a.page, "declined");
    await capture(b.page, "partner_declined");
    checks.push(
      "Decline returns both participants to waiting with distinct notices",
    );
    stage = "match_expired";
    await freshPair(a, b);
    fixture("expire", { subject: "local-test-a", kind: "match" });
    await Promise.all([state(a.page, "waiting"), state(b.page, "waiting")]);
    await expect(a.page.locator(SCOPE)).toContainText(
      "The invitation timed out.",
    );
    await expect(b.page.locator(SCOPE)).toContainText(
      "The invitation timed out.",
    );
    await capture(a.page, "match_expired");
    stage = "expired";
    fixture("expire", { subject: "local-test-a", kind: "queue" });
    await state(a.page, "expired");
    await capture(a.page, "expired");
    stage = "offline-error";
    await a.page
      .locator(SCOPE)
      .getByRole("button", { name: "Rejoin queue" })
      .click();
    await state(a.page, "waiting");
    await a.cut.cut();
    await state(a.page, "error");
    await capture(a.page, "offline-error");
    await a.cut.restore();
    // A restored Convex socket clears the error automatically; Retry may already be gone.
    await state(a.page, "waiting");
    checks.push(
      "Invitation expiry, queue expiry, rejoin and automatic offline reconnect recovery",
    );
    stage = "queue-to-call";
    await freshPair(a, b);
    await a.page
      .locator(SCOPE)
      .getByRole("button", { name: "Join", exact: true })
      .click();
    await expect(
      a.page.getByRole("button", { name: "Waiting for partner", exact: true }),
    ).toBeDisabled();
    await b.page
      .locator(SCOPE)
      .getByRole("button", { name: "Join", exact: true })
      .click();
    for (const peer of [a, b]) {
      await peer.page.waitForURL(
        (url) => /^\/app\/call\/[^/]+$/.test(url.pathname),
        { timeout: 30_000 },
      );
      assert.equal(
        new URL(peer.page.url()).searchParams.get("as"),
        peer.id,
        "Queue navigation lost test identity",
      );
    }
    meetingId = new URL(a.page.url()).pathname.split("/").at(-1);
    assert(meetingId, "Queue created no meeting id");
    assert.equal(
      new URL(b.page.url()).pathname,
      `/app/call/${meetingId}`,
      "Peers entered different call lobbies",
    );
    const meeting = z
      .object({
        participants: z.array(
          z.object({ subject: z.string(), role: z.string() }),
        ),
      })
      .parse(fixture("meeting", { meetingId }));
    assert.deepEqual(
      meeting.participants.map((p) => p.subject).sort(),
      ["local-test-a", "local-test-b"],
      "Meeting participants must be exactly A and B",
    );
    checks.push(
      "Both queue Join buttons create one meeting with exactly local-test-a and local-test-b, preserving identities",
    );
    stage = "connected";
    await Promise.all(
      [a, b].map((peer) =>
        peer.page.getByTestId("join-call").click({ timeout: 60_000 }),
      ),
    );
    await Promise.all([connected(a), connected(b)]);
    await capture(a.page, "connected-A", false);
    await capture(b.page, "connected-B", false);
    checks.push(
      "Both call Join buttons connect; each peer renders exactly one remote video with decoded frames",
    );
    stage = "leave-and-reenter";
    for (const peer of [a, b]) {
      await peer.page.getByTestId("leave-call").click();
      await peer.page.getByTestId("leave-call-confirm").click();
      await expect(peer.page.locator("[data-call-phase]")).toHaveAttribute(
        "data-call-phase",
        "left",
        { timeout: 20_000 },
      );
    }
    await openQueue(a);
    await state(a.page, "waiting");
    await capture(a.page, "queue-reentry");
    checks.push("Both leave calls; A reenters a live waiting queue");
    stage = "accessibility-verdict";
    const violationCount = audits.reduce<number>(
      (count, audit) =>
        count +
        (z.object({ violations: z.array(z.unknown()).optional() }).parse(audit)
          .violations?.length ?? 0),
      0,
    );
    assert.equal(
      violationCount,
      0,
      "Queue axe audit has violations; inspect sanitized result",
    );
    assert.equal(
      errors.length,
      0,
      "Browser page errors occurred; inspect sanitized result",
    );
    pass = true;
  } catch (error) {
    failure =
      error instanceof Error
        ? `${error.name}: ${error.message}`
            .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted token]")
            .replace(
              /((?:authorization|token|secret|admin[_-]?key|api[_-]?key)\s*[:=]\s*)[^\s,}]+/gi,
              "$1[redacted]",
            )
            .slice(0, 2000)
        : "UnknownError";
    console.error(`FAIL match-queue-proof at ${stage} (${failure})`);
  } finally {
    await Promise.allSettled(
      browsers.map(async (browser) => {
        try {
          await Promise.allSettled(
            browser.contexts().map((context) => context.close()),
          );
        } finally {
          await browser.close();
        }
      }),
    );
    if (fs.existsSync(runDir)) {
      const result = {
        pass,
        gitSha,
        startedAt,
        completedAt: new Date().toISOString(),
        stage,
        failure,
        baseUrl,
        meetingId,
        checks,
        captures,
        audits,
        errors,
        recordings: path.relative(REPO, runDir),
        limitations: [
          "Axe incomplete rules require manual review; dark hover contrast measures opaque button text only.",
        ],
      };
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(
        path.join(runDir, "result.json"),
        JSON.stringify(result, null, 2) + "\n",
      );
      fs.writeFileSync(
        path.join(docsDir, "browser-proof.json"),
        JSON.stringify(result, null, 2) + "\n",
      );
    }
  }
  if (pass)
    console.log(
      `PASS match-queue-proof: ${checks.length} checks, ${captures.length} captures`,
    );
  process.exitCode = pass ? 0 : 1;
}
void main().catch((error: unknown) => {
  console.error(
    `FAIL match-queue-proof runner (${error instanceof Error ? error.name : "UnknownError"})`,
  );
  process.exitCode = 1;
});
