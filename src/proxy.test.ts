// @vitest-environment node
//
// S0 call-harness gate for the eval-only bench carve-out
// (tools/call-eval/CONTRACT.md): /dev/call-bench skips the WorkOS AuthKit
// middleware only while NEXT_PUBLIC_CONNVO_CALL_BENCH=1 and VERCEL_ENV is not
// "production"; every other /dev path keeps the middleware in all
// environments.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => {
  const AUTH_SENTINEL = Symbol("authkit-response");
  const handleAuth = vi.fn(() => AUTH_SENTINEL);
  return { AUTH_SENTINEL, handleAuth, authkitMiddleware: vi.fn(() => handleAuth) };
});

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitMiddleware: mocks.authkitMiddleware,
}));

import proxy, { benchPathPassesThrough } from "./proxy";

function requestAt(path: string): NextRequest {
  return {
    nextUrl: new URL(`http://localhost:3000${path}`),
  } as unknown as NextRequest;
}

const event = {} as NextFetchEvent;

beforeEach(() => {
  mocks.handleAuth.mockClear();
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_CONNVO_CALL_BENCH", "1");
});

describe("benchPathPassesThrough", () => {
  it("passes the bench route only when the flag is exactly '1'", () => {
    expect(
      benchPathPassesThrough("/dev/call-bench/reference", {
        benchFlag: "1",
        vercelEnv: undefined,
      }),
    ).toBe(true);
    expect(
      benchPathPassesThrough("/dev/call-bench/reference", {
        benchFlag: "0",
        vercelEnv: undefined,
      }),
    ).toBe(false);
    expect(
      benchPathPassesThrough("/dev/call-bench/reference", {
        benchFlag: "",
        vercelEnv: undefined,
      }),
    ).toBe(false);
  });

  it("never passes the bench route in production", () => {
    expect(
      benchPathPassesThrough("/dev/call-bench/reference", {
        benchFlag: "1",
        vercelEnv: "production",
      }),
    ).toBe(false);
  });

  it("passes under preview and development environments", () => {
    for (const vercelEnv of ["preview", "development"]) {
      expect(
        benchPathPassesThrough("/dev/call-bench/reference", {
          benchFlag: "1",
          vercelEnv,
        }),
      ).toBe(true);
    }
  });

  it("matches the bare bench path and its subpaths, and nothing else under /dev", () => {
    for (const path of ["/dev/call-bench", "/dev/call-bench/reference", "/dev/call-bench/reference/x"]) {
      expect(benchPathPassesThrough(path, { benchFlag: "1" })).toBe(true);
    }
    for (const path of ["/dev", "/dev/", "/dev/auth-proof", "/dev/call-benchnope", "/dev/call-bench-not/here"]) {
      expect(benchPathPassesThrough(path, { benchFlag: "1" })).toBe(false);
    }
  });
});

describe("proxy middleware gate", () => {
  it("flag on, VERCEL_ENV absent: the bench path passes through without the middleware", () => {
    const result = proxy(requestAt("/dev/call-bench/reference?as=A&meeting=m1"), event);
    expect(mocks.handleAuth).not.toHaveBeenCalled();
    expect(result).not.toBe(mocks.AUTH_SENTINEL);
    expect(result).toBeInstanceOf(NextResponse);
  });

  it("flag on, VERCEL_ENV=preview: the bench path passes through", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const result = proxy(requestAt("/dev/call-bench"), event);
    expect(mocks.handleAuth).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(NextResponse);
  });

  it("VERCEL_ENV=production: the middleware stays on the bench path", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const result = proxy(requestAt("/dev/call-bench/reference"), event);
    expect(mocks.handleAuth).toHaveBeenCalledWith(
      expect.objectContaining({ nextUrl: expect.objectContaining({ pathname: "/dev/call-bench/reference" }) }),
      event,
    );
    expect(result).toBe(mocks.AUTH_SENTINEL);
  });

  it("flag off: the middleware stays on the bench path", () => {
    vi.stubEnv("NEXT_PUBLIC_CONNVO_CALL_BENCH", "");
    expect(proxy(requestAt("/dev/call-bench/reference"), event)).toBe(mocks.AUTH_SENTINEL);
    vi.stubEnv("NEXT_PUBLIC_CONNVO_CALL_BENCH", "0");
    expect(proxy(requestAt("/dev/call-bench/reference"), event)).toBe(mocks.AUTH_SENTINEL);
    expect(mocks.handleAuth).toHaveBeenCalledTimes(2);
  });

  it("every other /dev path keeps the middleware in all environments", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const devPaths = ["/dev", "/dev/", "/dev/auth-proof", "/dev/call-benchnope"];
    for (const path of devPaths) {
      expect(proxy(requestAt(path), event)).toBe(mocks.AUTH_SENTINEL);
    }
    vi.stubEnv("VERCEL_ENV", "preview");
    for (const path of devPaths) {
      expect(proxy(requestAt(path), event)).toBe(mocks.AUTH_SENTINEL);
    }
    vi.unstubAllEnvs();
    for (const path of devPaths) {
      expect(proxy(requestAt(path), event)).toBe(mocks.AUTH_SENTINEL);
    }
    expect(mocks.handleAuth).toHaveBeenCalledTimes(devPaths.length * 3);
  });
});
