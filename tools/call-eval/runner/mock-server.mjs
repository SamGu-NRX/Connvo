/**
 * Static file server for the mock bench pages with the signaling relay
 * attached (one port, one server). Prints exactly one JSON readiness line.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { attachRelay } from "./relay.mjs";

/** @type {Record<string, string>} */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/** @param {{ root: string, port?: number, relay?: Parameters<typeof attachRelay>[1] }} opts */
export async function startMockServer({ root, port = 0, relay }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let file = path.join(root, path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""));
    if (url.pathname === "/" || !path.extname(file)) file = path.join(file, "index.html");
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(data);
    });
  });

  const relayHandle = attachRelay(server, relay ?? {});
  const listenPort = await new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("mock server has no TCP address"));
      resolve(address.port);
    });
    server.on("error", reject);
  });

  return {
    port: listenPort,
    url: `http://127.0.0.1:${listenPort}`,
    relay: relayHandle,
    close() {
      relayHandle.close();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** CLI form for manual debugging: `node mock-server.mjs [root] [port]`. */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const root = process.argv[2] ?? new URL("./mock", import.meta.url).pathname;
  const port = Number(process.argv[3] ?? 0);
  const handle = await startMockServer({ root, port });
  console.log(JSON.stringify({ ok: true, port: handle.port }));
}
