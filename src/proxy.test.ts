// @vitest-environment node
//
// S0 call-harness gate for the eval-only bench carve-out
// (tools/call-eval/CONTRACT.md): /dev/call-bench skips the WorkOS AuthKit
// middleware only while NEXT_PUBLIC_CONNVO_CALL_BENCH=1, NODE_ENV is not
// "production" and VERCEL_ENV is not "production"; every other path keeps the
// middleware in all environments.
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
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("NODE_ENV", "development");
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

describe("production build", () => {
  it("keeps WorkOS on every /dev path, the bench included, even with the flag on", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CONNVO_CALL_BENCH", "1");
    const paths = ["/dev", "/dev/", "/dev/call-bench", "/dev/call-bench/reference?as=A", "/dev/call-bench/reference-no-audio", "/dev/auth-proof"];
    for (const vercelEnv of [undefined, "preview", "development"]) {
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      for (const path of paths) {
        expect(proxy(requestAt(path), event)).toBe(mocks.AUTH_SENTINEL);
      }
    }
    expect(mocks.handleAuth).toHaveBeenCalledTimes(paths.length * 3);
  });
});

describe("real call page in the local eval setup", () => {
  it("passes /app/call/<id> only with both flags on outside production", () => {
    const on = { benchFlag: "1", realCallFlag: "1", nodeEnv: "development" };
    expect(benchPathPassesThrough("/app/call/m1", on)).toBe(true);
    expect(benchPathPassesThrough("/app/call/m1", { ...on, realCallFlag: undefined })).toBe(false);
    expect(benchPathPassesThrough("/app/call/m1", { ...on, benchFlag: undefined })).toBe(false);
    expect(benchPathPassesThrough("/app/call/m1", { ...on, nodeEnv: "production" })).toBe(false);
    expect(benchPathPassesThrough("/app/call/m1", { ...on, vercelEnv: "production" })).toBe(false);
  });

  it("never passes other /app paths, even with both flags on", () => {
    const on = { benchFlag: "1", realCallFlag: "1", nodeEnv: "development" };
    for (const path of ["/app", "/app/call", "/app/call/", "/app/call/m1/x", "/app/dashboard", "/app/callx/m1"]) {
      expect(benchPathPassesThrough(path, on)).toBe(false);
    }
  });

  it("any Vercel deployment keeps WorkOS on the call page, preview included", () => {
    const on = { benchFlag: "1", realCallFlag: "1", nodeEnv: "development" };
    expect(benchPathPassesThrough("/app/call/m1", { ...on, vercel: "1" })).toBe(false);
    expect(benchPathPassesThrough("/app/call/m1", { ...on, vercel: "1", vercelEnv: "preview" })).toBe(false);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_CONNVO_REAL_CALL", "1");
    expect(proxy(requestAt("/app/call/m1?as=A"), event)).toBe(mocks.AUTH_SENTINEL);
  });

  it("a production build keeps WorkOS on the call page with both flags on", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CONNVO_REAL_CALL", "1");
    expect(proxy(requestAt("/app/call/m1?as=A"), event)).toBe(mocks.AUTH_SENTINEL);
  });
});

describe("no API carve-out", () => {
  it("the test-auth token route keeps the middleware with the bench flag on", () => {
    for (const path of ["/api/test-auth/token", "/api/test-auth/token?user=A", "/api/convex/token"]) {
      expect(benchPathPassesThrough(path.split("?")[0], { benchFlag: "1", nodeEnv: "development" })).toBe(false);
      expect(proxy(requestAt(path), event)).toBe(mocks.AUTH_SENTINEL);
    }
  });
});

describe("after-call pages in the local eval setup", () => {
  const local = { benchFlag: "1", realCallFlag: "1", afterCallFlag: "1", nodeEnv: "development" };
  it("pass only with all three flags, only /app/meetings and /app/meetings/<id>", () => {
    expect(benchPathPassesThrough("/app/meetings", local)).toBe(true);
    expect(benchPathPassesThrough("/app/meetings/m123", local)).toBe(true);
    expect(benchPathPassesThrough("/app/meetings/m123/edit", local)).toBe(false);
    expect(benchPathPassesThrough("/app/meetings", { ...local, afterCallFlag: "0" })).toBe(false);
    expect(benchPathPassesThrough("/app/meetings", { ...local, realCallFlag: undefined })).toBe(false);
    expect(benchPathPassesThrough("/app/meetings", { ...local, benchFlag: "0" })).toBe(false);
  });

  it("never in a production build or on any Vercel deployment", () => {
    expect(benchPathPassesThrough("/app/meetings", { ...local, nodeEnv: "production" })).toBe(false);
    expect(benchPathPassesThrough("/app/meetings", { ...local, vercelEnv: "production" })).toBe(false);
    expect(benchPathPassesThrough("/app/meetings", { ...local, vercel: "1" })).toBe(false);
  });
});

describe("public call processing files", () => {
  it("serves the bundled worker in production without exposing call routes", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_CONNVO_CALL_BENCH", "0");
    expect(proxy(requestAt("/call/blur-worker.js"), event)).toBeInstanceOf(NextResponse);
    expect(mocks.handleAuth).not.toHaveBeenCalled();
    expect(proxy(requestAt("/app/call/meeting"), event)).toBe(mocks.AUTH_SENTINEL);
    expect(proxy(requestAt("/call/mediapipe/private.js"), event)).toBe(mocks.AUTH_SENTINEL);
  });
});
