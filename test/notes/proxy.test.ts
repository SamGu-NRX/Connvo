/**
 * Middleware regression tests.
 *
 * #31 added a /dev/notes-preview sign-in exemption to src/proxy.ts. It is
 * gone: notes needs no preview without sign-in, and the notes branch does
 * not relax an authorization boundary. The only carve-outs left are alpha's
 * own (the call bench and the test-auth paths, tested in
 * src/proxy-*.test.ts); none of them covers a notes path. These tests pin
 * that: the matcher covers every /dev path, the file names no notes route,
 * and a notes /dev request reaches the WorkOS handler even with every eval
 * flag on.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const AUTH_RESULT = Symbol("auth-result");

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitMiddleware: vi.fn(() => vi.fn(() => AUTH_RESULT)),
}));

const PROXY_PATH = path.join(__dirname, "..", "..", "src", "proxy.ts");
const proxySource = readFileSync(PROXY_PATH, "utf8");

afterEach(() => vi.unstubAllEnvs());

describe("proxy middleware coverage", () => {
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

  test("the proxy names no notes route", () => {
    expect(proxySource).not.toContain("notes-preview");
    expect(proxySource).not.toMatch(/notes/i);
  });

  test("a notes /dev request reaches the WorkOS handler, even with every eval flag on", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONNVO_CALL_BENCH", "1");
    vi.stubEnv("NEXT_PUBLIC_CONNVO_REAL_CALL", "1");
    vi.stubEnv("NEXT_PUBLIC_CONNVO_TEST_AUTH", "1");
    vi.stubEnv("NODE_ENV", "development");
    const { default: proxy } = await import("@/proxy");
    for (const p of ["/dev/notes-preview", "/dev/notes-preview/deep"]) {
      const request = {
        nextUrl: new URL(`https://connvo.example${p}`),
        url: `https://connvo.example${p}`,
      } as never;
      expect(proxy(request, {} as never)).toBe(AUTH_RESULT);
    }
  });
});
