/**
 * A Playwright route on one browser context's Convex WebSocket that can hold
 * back or fail the answers for chosen functions, to put a page into its
 * loading or error state on purpose. The page, its code and the server are
 * untouched; only what reaches the page over the socket changes.
 *
 * Functions are matched by a substring of their path ("history/queries:").
 */

const SYNC_SOCKET = /\/api\/[^/]+\/sync$/;

/**
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function tapConvex(context) {
  const mode = {
    /** @type {string[]} query results for these are not delivered */
    holdQueries: [],
    /** @type {string[]} query results for these arrive as server errors */
    failQueries: [],
  };
  const matches = (/** @type {string[]} */ list, /** @type {string} */ udfPath) => list.some((part) => udfPath.includes(part));
  await context.routeWebSocket(SYNC_SOCKET, (ws) => {
    const server = ws.connectToServer();
    /** @type {Map<number, string>} query id -> function path */
    const queries = new Map();
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "ModifyQuerySet") {
        for (const mod of msg.modifications ?? []) {
          if (mod.type === "Add") queries.set(mod.queryId, String(mod.udfPath));
        }
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type !== "Transition" || (mode.holdQueries.length === 0 && mode.failQueries.length === 0)) {
        ws.send(raw);
        return;
      }
      msg.modifications = (msg.modifications ?? []).flatMap((/** @type {any} */ mod) => {
        const path = queries.get(mod.queryId) ?? "";
        if (mod.type !== "QueryUpdated") return [mod];
        if (matches(mode.failQueries, path)) {
          return [{ type: "QueryFailed", queryId: mod.queryId, errorMessage: "Server Error", logLines: [], journal: mod.journal ?? null }];
        }
        if (matches(mode.holdQueries, path)) return [];
        return [mod];
      });
      ws.send(JSON.stringify(msg));
    });
    ws.onClose(() => void server.close().catch(() => {}));
    server.onClose(() => void ws.close().catch(() => {}));
  });
  return mode;
}
