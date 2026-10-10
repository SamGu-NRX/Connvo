// Keyboard-walk evidence for results/recap.html (owned by the post-call
// evidence study thread). Serves the results dir over localhost, drives a
// real Chromium through Playwright, presses the documented keys, asserts
// the DOM state after each, and writes walk.json plus screenshots here
// (results/walk/). Offline: no network beyond localhost.
//
// Run: node experiments/postcall-evidence/walk.mjs
// Requires: playwright (resolved from /home/user/work/connvo-testdeps) and
// its Chromium in ~/.cache/ms-playwright.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "file:///home/user/work/connvo-testdeps/node_modules/playwright/index.mjs";

const resultsDir = path.dirname(fileURLToPath(import.meta.url)) + "/results";
const walkDir = resultsDir + "/walk";
const port = 8412;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, "http://x").pathname === "/" ? "/recap.html" : new URL(req.url, "http://x").pathname;
    const body = await readFile(resultsDir + name);
    res.writeHead(200, { "content-type": MIME[path.extname(name)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(port, "127.0.0.1", r));

const steps = [];
const record = (name, ok, observed) => {
  steps.push({ name, ok, observed });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${JSON.stringify(observed)}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
try {
  await page.goto(`http://127.0.0.1:${port}/recap.html`);
  await page.waitForSelector("#groups .card", { timeout: 10000 });
  const meta = await page.textContent("#meta");
  record("page loads data over http", /generated \d{4}-\d{2}-\d{2}T/.test(meta.trim()) && !/failed/.test(meta), { meta: meta.trim().slice(0, 80) });

  const countAll = async () => ({
    groups: await page.locator("#groups .card").count(),
    visible: await page.locator("#groups .card:visible").count(),
    claims: await page.locator("#groups .claim").count(),
    refused: await page.locator('#groups .claim[data-verdict="refused"]').count(),
  });
  const initial = await countAll();
  record("all 7 groups render with 15 claims, 9 refused", initial.groups === 7 && initial.claims === 15 && initial.refused === 9, initial);
  await page.screenshot({ path: walkDir + "/00-initial.png", fullPage: true });

  // r → refused-only view
  await page.keyboard.press("r");
  const refusedOnly = await countAll();
  record("r shows only groups containing refused claims", refusedOnly.visible < refusedOnly.groups && refusedOnly.visible > 0, refusedOnly);
  const helpAfterR = await page.textContent("#filter-help");
  record("help line names the refused-only mode", /refused claims only/.test(helpAfterR), { help: helpAfterR.trim() });
  await page.screenshot({ path: walkDir + "/01-refused-only.png", fullPage: true });

  // j/k navigation INSIDE the refused-only filter — state.cursor indexes
  // the visible card list. j→1, j→2, k→1 ⇒ the cursor highlight must sit
  // on the 2nd visible card. This step fails on the old DOM-index bug,
  // which scrolled/highlighted card #state.cursor in DOM order instead.
  const visibleIdx = await page.evaluate(() =>
    [...document.querySelectorAll("#groups .card")]
      .map((c, i) => [c, i])
      .filter(([c]) => !c.classList.contains("hidden"))
      .map(([, i]) => i)
  );
  const scrollFilteredBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  await page.waitForTimeout(200);
  const cursorState = await page.evaluate(() => {
    const all = [...document.querySelectorAll("#groups .card")];
    const marked = all.map((c, i) => [c, i]).filter(([c]) => c.classList.contains("cursor"));
    const visible = all.filter((c) => !c.classList.contains("hidden"));
    const markedVisible = marked.filter(([c]) => !c.classList.contains("hidden"));
    return {
      markedCount: marked.length,
      markedVisibleCount: markedVisible.length,
      markedDomIndex: marked.length === 1 ? marked[0][1] : null,
      visibleCount: visible.length,
      expectedDomIndex: visible[1] ? all.indexOf(visible[1]) : null,
    };
  });
  const scrollFilteredAfter = await page.evaluate(() => window.scrollY);
  record(
    "filtered j/j/k lands cursor on 2nd VISIBLE card (not DOM index)",
    cursorState.markedCount === 1 &&
      cursorState.markedVisibleCount === 1 &&
      cursorState.markedDomIndex === cursorState.expectedDomIndex &&
      visibleIdx.length === 4 &&
      scrollFilteredAfter !== scrollFilteredBefore,
    { ...cursorState, visibleDomIndices: visibleIdx, scrollFilteredBefore, scrollFilteredAfter }
  );
  await page.screenshot({ path: walkDir + "/04-filtered-navigation.png", fullPage: false });

  // a → back to all
  await page.keyboard.press("a");
  const afterA = await countAll();
  const cursorAfterA = await page.evaluate(() => {
    const marked = [...document.querySelectorAll("#groups .card")].map((c, i) => [c, i]).filter(([c]) => c.classList.contains("cursor"));
    return { markedCount: marked.length, markedDomIndex: marked.length === 1 ? marked[0][1] : null };
  });
  record("a restores all groups and resets cursor to first card", afterA.visible === afterA.groups && cursorAfterA.markedCount === 1 && cursorAfterA.markedDomIndex === 0, { ...afterA, cursorAfterA });

  // j/k navigation scrolls
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("j");
  await page.waitForTimeout(150);
  const scrollJ1 = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("j");
  await page.waitForTimeout(150);
  const scrollJ2 = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("k");
  await page.waitForTimeout(150);
  const scrollK = await page.evaluate(() => window.scrollY);
  record("j scrolls forward, k back", scrollJ1 > scrollBefore && scrollJ2 >= scrollJ1 && scrollK < scrollJ2, { scrollBefore, scrollJ1, scrollJ2, scrollK });
  await page.screenshot({ path: walkDir + "/02-navigation.png", fullPage: false });

  // ? toggles the keyboard help
  await page.keyboard.press("?");
  const helpHidden = await page.locator("#filter-help.hidden").count();
  await page.keyboard.press("?");
  const helpBack = await page.locator("#filter-help.hidden").count();
  record("? toggles the help line", helpHidden === 1 && helpBack === 0, { helpHidden, helpBack });
  await page.screenshot({ path: walkDir + "/03-help-toggled.png", fullPage: true });

  // every rendered claim card carries provenance
  const quoteless = await page.locator("#groups .claim:not(:has(.quote))").count();
  record("every rendered claim cites a provenance quote", quoteless === 0, { quoteless });

  const passed = steps.filter((s) => s.ok).length;
  const summary = {
    url: `http://127.0.0.1:${port}/recap.html`,
    browser: "chromium (playwright bundled, ms-playwright cache)",
    viewport: "1000x800",
    stepsPassed: passed,
    stepsTotal: steps.length,
    agreement: passed === steps.length,
    steps,
  };
  await writeFile(walkDir + "/walk.json", JSON.stringify(summary, null, 2) + "\n");
  console.log(`\n${passed}/${steps.length} steps passed — walk.json + 5 screenshots written to results/walk/`);
  process.exitCode = passed === steps.length ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
