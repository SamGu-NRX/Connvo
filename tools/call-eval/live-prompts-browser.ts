/** Captures the real panel fixture and audits every state without paid requests. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

async function main() {
  const out = "docs/live-prompts/screenshots";
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const results = [];
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({
        viewport,
        recordVideo:
          viewport.width === 390
            ? { dir: "tools/call-eval/out/prompts-video", size: viewport }
            : undefined,
      });
      const page = await context.newPage();
      await page.goto("http://localhost:3104/dev/call-bench/prompts");
      const panel = page.getByTestId("conversation-prompts");
      await expect(
        panel.getByRole("heading", { name: "A little inspiration" }),
      ).toBeVisible();
      for (const state of [
        "loading",
        "lobby",
        "empty",
        "current",
        "pending",
        "used",
        "paused",
        "limited",
        "error",
        "ended",
        "exhausted",
      ]) {
        await page.getByLabel("Panel state").selectOption(state);
        await expect(panel).toBeVisible();
        const audit = await new AxeBuilder({ page })
          .include('[data-testid="conversation-prompts"]')
          .analyze();
        const violations = audit.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
        }));
        assert.deepEqual(
          violations,
          [],
          `${viewport.width} ${state} accessibility`,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          "Horizontal overflow",
        );
        await page.screenshot({
          path: `${out}/${state}-${viewport.width}x${viewport.height}.png`,
          animations: "disabled",
        });
        results.push({
          state,
          width: viewport.width,
          axeViolations: violations.length,
          horizontalOverflow: false,
        });
      }
      await page.getByLabel("Panel state").selectOption("current");
      const used = page.getByRole("button", { name: "We used this" });
      await used.focus();
      assert.equal(
        await used.evaluate((el) => getComputedStyle(el).outlineStyle),
        "solid",
      );
      await page.keyboard.press("Enter");
      await expect(
        page.getByText("Marked as used. Saved to your recap."),
      ).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Another one" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("current-prompt")).toHaveText(
        "What have you been curious about lately?",
      );
      assert.equal(
        await page
          .getByTestId("current-prompt")
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0s",
      );
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Pause automatic prompts" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        page.getByText("Automatic prompts are paused for both of you."),
      ).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(
        page.getByText(
          "A fresh idea after 90 seconds without shared-note edits.",
        ),
      ).toBeVisible();
      await page.screenshot({
        path: `${out}/keyboard-${viewport.width}x${viewport.height}.png`,
      });
      // Record a pointer-triggered change at normal speed, then verify reduced motion.
      await page.getByRole("button", { name: "Another one" }).click();
      await expect(page.getByTestId("current-prompt")).toHaveText(
        "What's been a small highlight of your week?",
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.getByRole("button", { name: "Another one" }).click();
      const reduced = await page
        .getByTestId("current-prompt")
        .evaluate((el) => ({
          duration: getComputedStyle(el).transitionDuration,
          transform: getComputedStyle(el).transform,
        }));
      assert.deepEqual(reduced, { duration: "0.15s", transform: "none" });
      await page.screenshot({
        path: `${out}/reduced-${viewport.width}x${viewport.height}.png`,
        animations: "disabled",
      });
      results.push({
        width: viewport.width,
        keyboard: "passed",
        reducedMotion: reduced,
      });
      const video = page.video();
      await context.close();
      if (video) console.log(`Video: ${await video.path()}`);
    }
    // Verify the mounted panel on the real call route with two seeded users.
    // The integration check left automatic prompts paused, so this spends at most one pick.
    const state = JSON.parse(
      readFileSync("tools/call-eval/out/state.json", "utf8"),
    );
    const peers = await Promise.all(
      ["A", "B"].map(async (who) => {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          permissions: ["camera", "microphone"],
        });
        const page = await context.newPage();
        await page.goto(
          `http://localhost:3104/app/call/${state.meetingId}?as=${who}`,
        );
        await expect(page.getByTestId("join-call")).toBeVisible({
          timeout: 30_000,
        });
        await page.getByTestId("join-call").click();
        await expect(page.getByTestId("current-prompt")).toBeVisible();
        return { context, page };
      }),
    );
    const [a, b] = peers.map((p) => p.page);
    const previous = await a.getByTestId("current-prompt").textContent();
    await expect(a.getByRole("button", { name: "Another one" })).toBeEnabled();
    await a.getByRole("button", { name: "Another one" }).click();
    await expect(a.getByTestId("current-prompt")).not.toHaveText(previous!);
    const next = await a.getByTestId("current-prompt").textContent();
    await expect(b.getByTestId("current-prompt")).toHaveText(next!);
    await b.getByRole("button", { name: "We used this" }).click();
    await expect(
      a.getByText("Marked as used. Saved to your recap."),
    ).toBeVisible();
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await a.setViewportSize(viewport);
      await a.getByTestId("conversation-prompts").scrollIntoViewIfNeeded();
      await a.screenshot({
        path: `${out}/mounted-call-${viewport.width}x${viewport.height}.png`,
        animations: "disabled",
      });
    }
    await Promise.all(peers.map((p) => p.context.close()));
    results.push({
      mountedCall: true,
      sharedBrowsers: 2,
      sharedManualPick: true,
      sharedUsedState: true,
      paidRequestsUpperBound: 1,
    });
    writeFileSync(
      "docs/live-prompts/browser-check.json",
      JSON.stringify({ fixture: true, results }, null, 2) + "\n",
    );
    console.log(`Panel checks passed: ${results.length} results`);
  } finally {
    await browser.close();
  }
  const lighthouse = spawnSync(
    "npx",
    [
      "--yes",
      "lighthouse",
      "http://localhost:3104/dev/call-bench/prompts",
      "--form-factor=mobile",
      "--only-categories=performance,accessibility",
      "--output=json",
      "--output-path=tools/call-eval/out/prompts-lighthouse.json",
      "--chrome-flags=--headless",
      "--quiet",
    ],
    {
      env: { ...process.env, CHROME_PATH: chromium.executablePath() },
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  if (lighthouse.status !== 0)
    throw new Error(`Lighthouse failed: ${lighthouse.stderr.slice(-1000)}`);
  const report = JSON.parse(
    readFileSync("tools/call-eval/out/prompts-lighthouse.json", "utf8"),
  );
  const scores = {
    developmentFixture: true,
    performance: report.categories.performance.score * 100,
    accessibility: report.categories.accessibility.score * 100,
  };
  writeFileSync(
    "docs/live-prompts/lighthouse.json",
    JSON.stringify(scores, null, 2) + "\n",
  );
  console.log(JSON.stringify(scores));
}
void main();
