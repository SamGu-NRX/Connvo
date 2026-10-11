/**
 * Shared scenario helpers. Two hard-won behaviors live here:
 * 1. page.evaluate("() => …") in Playwright 1.64 evaluates the string as an
 *    EXPRESSION — it returns the function object instead of calling it. Every
 *    helper normalizes string sources by invoking them at eval time.
 * 2. joinPair waits for each peer's HONEST phase (the mock reports
 *    `connected` only after real ICE completes), so under shared-sandbox CPU
 *    load the join wait is 30 s — the scenarios' own timing assertions start
 *    after the join, and none of them re-define join latency.
 */
import { loadContracts } from "./contracts.mjs";
import { launchPeer } from "./peers.mjs";
import { decodeRemoteFrame } from "./page-helpers.mjs";

export class ScenarioError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "ScenarioError";
    this.details = details;
  }
}

/** Normalize a polling source: a string "(…) => x" is invoked at eval time. */
function normalizedEval(page, source, arg) {
  if (typeof source === "string") return page.evaluate(`(${source})()`, arg);
  return page.evaluate(source, arg);
}

export async function waitFor(peer, source, { timeoutMs = 10000, describe = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await normalizedEval(peer.page, source);
    if (last) return last;
    if (Date.now() > deadline) {
      throw new ScenarioError(`${peer.peerId}: ${describe} not reached within ${timeoutMs} ms`, { last });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

export async function waitForValue(peer, source, predicate, { timeoutMs = 10000, describe = "value" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await normalizedEval(peer.page, source);
    if (predicate(last)) return last;
    if (Date.now() > deadline) {
      throw new ScenarioError(`${peer.peerId}: ${describe} not satisfied within ${timeoutMs} ms (last=${JSON.stringify(last)})`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** `[data-call-phase]` on the call root. */
export const phaseIs = (phase) =>
  `() => document.querySelector('[data-call-phase]')?.getAttribute('data-call-phase') === '${phase}'`;

export async function waitAttr(peer, participantId, attr, value, timeoutMs) {
  const v = await waitFor(
    peer,
    `() => document.querySelector('[data-testid="remote-media"][data-participant-id="${participantId}"]')?.getAttribute('${attr}')`,
    { timeoutMs, describe: `${attr}=${value} on ${participantId}` },
  );
  if (v !== value) throw new ScenarioError(`${peer.peerId}: ${attr} was "${v}", expected "${value}"`);
  return v;
}

export async function click(peer, testId) {
  await peer.page.click(`[data-testid="${testId}"]`);
}

/**
 * Join A and B against ctx.url with optional query params and a relay-only
 * RTCConfiguration override (applied to BOTH peers — the H-07 debug proved
 * host/relay asymmetry stalls candidates).
 */
export async function joinPair(ctx, { a = "A", b = "B", paramsA = {}, paramsB = {}, rtcConfig = null, timeoutMs = 30000 } = {}) {
  const t0 = Date.now();
  const [peerA, peerB] = await Promise.all([
    ctx.launchPeer(a, paramsA, rtcConfig),
    ctx.launchPeer(b, paramsB, rtcConfig),
  ]);
  await Promise.all([
    waitFor(peerA, phaseIs("connected"), { timeoutMs, describe: "phase 'connected'" }),
    waitFor(peerB, phaseIs("connected"), { timeoutMs, describe: "phase 'connected'" }),
  ]);
  return { peerA, peerB, tJoinMs: Date.now() - t0 };
}

/**
 * H-01's time-to-first-remote-frame: ms from `since` until the first decoded
 * remote frame whose counter parses.
 */
export async function timeToFirstRemoteFrame(peer, participantId, since) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const frame = await decodeRemoteFrame(peer, participantId);
    if (frame.present && frame.counter?.ok) {
      return { ms: Date.now() - since, at: Date.now() };
    }
    if (Date.now() > deadline) {
      throw new ScenarioError(`${peer.peerId}: no decodable remote frame on ${participantId} within 20 s`, { frame });
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function assertProbePresent(peer) {
  const has = await peer.page.evaluate(() => !!window.__callProbe);
  if (!has) throw new ScenarioError(`${peer.peerId}: __callProbe missing — the init script did not run`, {});
}

export { launchPeer, loadContracts };
