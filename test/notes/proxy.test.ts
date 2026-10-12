/**
 * Middleware regression tests (r2 W4).
 *
 * #31 added a /dev/notes-preview sign-in exemption to src/proxy.ts. That
 * relaxation is reverted: WorkOS middleware must cover EVERY /dev path in
 * EVERY environment - notes needs no no-sign-in preview, and an
 * authorization boundary is not ours to relax. These tests pin the restored
 * alpha shape: the matcher keeps middleware enabled on all /dev routes, the
 * file contains no exemption path, and a /dev request reaches the WorkOS
 * auth handler (never an early pass-through).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

const AUTH_RESULT = Symbol("auth-result");

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitMiddleware: vi.fn(() =>
    vi.fn(() => AUTH_RESULT),
  ),
}));

const PROXY_PATH = path.join(__dirname, "..", "..", "src", "proxy.ts");
const proxySource = readFileSync(PROXY_PATH, "utf8");

describe("proxy middleware coverage (r2 W4)", () => {
  test("the matcher keeps middleware enabled on every /dev path", async () => {
    const { config } = await import("@/proxy");
    expect(config.matcher).toHaveLength(1);
    // Next evaluates a custom matcher with path-to-regexp: the pattern's
    // leading "/" consumes the pathname's leading slash BEFORE the negative
    // lookahead runs, so test against the pattern verbatim.
    const pattern = config.matcher[0] as string;
    const regex = new RegExp(`^${pattern}$`);
    expect(regex.test("/dev")).toBe(true);
    expect(regex.test("/dev/notes-preview")).toBe(true);
    expect(regex.test("/dev/notes-preview/deep")).toBe(true);
    // Sanity: static assets are still (intentionally) skipped.
    expect(regex.test("/_next/static/chunk.js")).toBe(false);
  });

  test("no exemption path exists in the built proxy config", () => {
    // The reverted file must not mention the demo route, must not import
    // NextResponse (the early pass-through primitive), and must not carry
    // any environment-conditional bypass.
    expect(proxySource).not.toContain("notes-preview");
    expect(proxySource).not.toContain("NextResponse");
    expect(proxySource).not.toContain("VERCEL_ENV");
    expect(proxySource).not.toContain("CONNVO_CALL_BENCH");
  });

  test("a /dev request reaches the WorkOS auth handler with no bypass", async () => {
    const { default: proxy } = await import("@/proxy");
    const request = {
      nextUrl: new URL("https://connvo.example/dev/notes-preview"),
      url: "https://connvo.example/dev/notes-preview",
    } as never;
    const event = {} as never;
    expect(proxy(request, event)).toBe(AUTH_RESULT);
  });
});
