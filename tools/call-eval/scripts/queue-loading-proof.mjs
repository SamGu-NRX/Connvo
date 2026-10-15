/** Compare the Suspense fallback and query-loading QueueView in the real app shell. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const directory = path.resolve("src/app/dev/call-bench/lane3-queue-loading-proof");
const route = path.join(directory, "page.tsx");
const screenshots = path.resolve("docs/lane3/screenshots");
fs.mkdirSync(directory); // Refuse to overwrite another route.
fs.writeFileSync(route, `"use client";
import { Suspense, useEffect, useState } from "react";
import { notFound } from "next/navigation";
import AppLayout from "@/app/app/layout";
import { QueueLoading, QueueView } from "@/components/queue/QueueView";
const suspended = new Promise<never>(() => {});
function Waiting(): never { throw suspended; }
const noop = () => {};
export default function Page() {
  const [query, setQuery] = useState(false);
  useEffect(() => { document.documentElement.dataset.queueProofReady = "true"; }, []);
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_PUBLIC_CONNVO_TEST_AUTH !== "1") notFound();
  return <AppLayout><div data-proof-view={query ? "query" : "suspense"}><button data-testid="show-query-loading" onClick={() => setQuery(true)}>Show query loading</button>
    {query ? <QueueView title="Match queue" state={{kind:"loading"}} pending={false}
      onJoin={noop} onLeave={noop} onAccept={noop} onDecline={noop} onRetry={noop} />
      : <Suspense fallback={<QueueLoading />}><Waiting /></Suspense>}
    </div></AppLayout>;
}
`, { flag: "wx" });

/** @type {import('@playwright/test').Browser | undefined} */
let browser;
const comparisons = [];
try {
  const url = "http://localhost:3103/dev/call-bench/lane3-queue-loading-proof?as=A";
  // Next's route watcher may not see a newly created directory on the first request.
  let available = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await fetch(url);
    if (response.ok) { available = true; break; }
    assert.equal(response.status, 404, "Temporary fixture route failed before rendering");
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(available, "Next did not register the temporary local fixture route");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    // This fixture deliberately never completes its Suspense stream.
    await page.goto(url, { waitUntil: "commit" });
    await page.locator('html[data-queue-proof-ready="true"]').waitFor({ state: "attached" });
    await page.locator('[data-queue-state="loading"]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '[data-testid="show-query-loading"], nextjs-portal {display:none!important}' });
    const fallback = await page.locator('[data-queue-state="loading"]').boundingBox();
    await page.screenshot({ path: path.join(screenshots, `queue-suspense-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
    await page.getByTestId("show-query-loading").evaluate((button) => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await page.locator('[data-proof-view="query"]').waitFor();
    const query = await page.locator('[data-queue-state="loading"]').boundingBox();
    assert.deepEqual(query, fallback, "Suspense fallback must match query-loading geometry");
    const audit = await new AxeBuilder({ page }).include('[data-queue-state="loading"]').analyze();
    assert.equal(audit.violations.filter(v => v.impact === "serious" || v.impact === "critical").length, 0);
    comparisons.push({ viewport, fallback, query, seriousOrCriticalViolations: 0 });
  }
  fs.writeFileSync("docs/lane3/queue-loading-proof.json", JSON.stringify({ pass: true, fixture: "Suspended search consumer and query-loading view in local app shell", comparisons }, null, 2));
  const historyContext = await browser.newContext();
  const historyPages = new Set();
  await historyContext.routeWebSocket(/\/api\/[^/]+\/sync$/, socket => {
    const server = socket.connectToServer();
    const queryIds = new Map();
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      for (const modification of message.modifications ?? []) {
        if (modification.type === "Add" && modification.udfPath === "history/queries:listMyMeetings") {
          historyPages.add(modification.queryId);
          queryIds.set(modification.queryId, `proof-${historyPages.size}`);
        }
      }
      server.send(raw);
    });
    server.onMessage(raw => {
      const message = JSON.parse(String(raw));
      for (const modification of message.modifications ?? []) {
        const cursor = queryIds.get(modification.queryId);
        if (modification.type === "QueryUpdated" && cursor)
          modification.value = { page: [], isDone: false, continueCursor: cursor };
      }
      socket.send(JSON.stringify(message));
    });
    socket.onClose(() => void server.close().catch(() => {}));
    server.onClose(() => void socket.close().catch(() => {}));
  });
  const history = await historyContext.newPage();
  await history.goto("http://localhost:3103/app/meetings?as=A");
  await history.getByText("More meetings may be available", { exact: true }).waitFor();
  assert.equal(historyPages.size, 6, "Initial page plus five automatic requests");
  const historyAudits = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await history.setViewportSize(viewport);
    await history.addStyleTag({ content: "nextjs-portal {display:none!important}" });
    const audit = await new AxeBuilder({ page: history }).include('[data-testid="meeting-list-empty"]').analyze();
    const violations = audit.violations.filter(v => v.impact === "serious" || v.impact === "critical");
    assert.equal(violations.length, 0);
    historyAudits.push({ viewport, seriousOrCriticalViolations: 0 });
    await history.screenshot({ path: path.join(screenshots, `history-more-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
  }
  await history.getByRole("button", { name: "Load more" }).click();
  await history.getByText("More meetings may be available", { exact: true }).waitFor();
  assert.equal(historyPages.size, 7, "Manual continuation must issue exactly one more request");
  fs.writeFileSync("docs/lane3/history-pagination-proof.json", JSON.stringify({ pass: true, fixture: "Scoped empty history pages with more results remaining", automaticRequests: 5, manualRequests: 1, audits: historyAudits }, null, 2));
  console.log("PASS: two viewports, identical fallback/query loading rectangles, zero serious/critical accessibility violations");
} finally {
  await browser?.close();
  fs.unlinkSync(route);
  fs.rmdirSync(directory);
}
