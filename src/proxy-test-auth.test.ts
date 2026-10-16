/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";
import proxy, { testAuthProxyExempt } from "./proxy";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

const { authkitMiddlewareMock, handleAuthStub } = vi.hoisted(() => {
  const handleAuthStub = vi.fn(
    () =>
      new Response("authkit redirect", {
        status: 302,
        headers: { location: "https://auth.workos.com/sign-in" },
      }),
  );
  return { authkitMiddlewareMock: vi.fn(() => handleAuthStub), handleAuthStub };
});

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitMiddleware: authkitMiddlewareMock,
}));

const TEST_PATHS = [
  "/dev/auth-proof",
  "/api/test-auth/token",
  "/app/match-queue",
  "/app/dashboard",
  "/onboarding",
  "/app/settings",
  "/app/profile",
  "/app/smart-connection",
  "/app/professional/b2b",
  "/app/professional/collaboration",
  "/app/professional/mentorship",
  "/app/professional/investment",
] as const;

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

function event(): NextFetchEvent {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as NextFetchEvent;
}

// (Split from proxy.test.ts at the alpha merge: the two files mock WorkOS
// differently.)
// The proxy's declared return type is the framework union (Response |
// Promise<Response> | undefined); narrow it at runtime so assertions see a
// Response.
async function run(path: string): Promise<Response> {
  const res = await proxy(request(path), event());
  if (!(res instanceof Response)) {
    throw new Error(`proxy did not return a Response for ${path}`);
  }
  return res;
}

beforeEach(() => {
  handleAuthStub.mockClear();
  // This machine's env must not decide the outcome.
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NEXT_PUBLIC_CONNVO_CALL_BENCH", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy test-auth exemption (CALL-PLAN D3)", () => {
  it("exempts both test-auth paths in dev/test when NEXT_PUBLIC_CONNVO_TEST_AUTH=1", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONNVO_TEST_AUTH", "1");
    for (const path of TEST_PATHS) {
      const res = await run(path);
      expect(
        handleAuthStub,
        `authkit middleware must not run for ${path}`,
      ).not.toHaveBeenCalled();
      expect(
        res.headers.get("x-middleware-next"),
        `${path} must pass through to its own handler`,
      ).toBe("1");
    }
  });

  it("keeps both paths behind WorkOS in a production build (flag on)", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONNVO_TEST_AUTH", "1");
    vi.stubEnv("NODE_ENV", "production");
    for (const path of TEST_PATHS) {
      handleAuthStub.mockClear();
      const res = await run(path);
      expect(
        handleAuthStub,
        `authkit middleware must run for ${path} in a production build`,
      ).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("auth.workos.com");
    }
  });

  it("keeps both paths behind WorkOS under VERCEL_ENV=production", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONNVO_TEST_AUTH", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    for (const path of TEST_PATHS) {
      handleAuthStub.mockClear();
      await run(path);
      expect(handleAuthStub).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps both paths behind WorkOS on any Vercel deployment, previews included", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONNVO_TEST_AUTH", "1");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    for (const path of TEST_PATHS) {
      handleAuthStub.mockClear();
      await run(path);
      expect(handleAuthStub).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps WorkOS gating when the flag is off, even in dev/test", async () => {
    for (const path of TEST_PATHS) {
      handleAuthStub.mockClear();
      await run(path);
      expect(handleAuthStub).toHaveBeenCalledTimes(1);
    }
  });

  it("does not exempt near-miss paths while the flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONNVO_TEST_AUTH", "1");
    for (const path of [
      "/app/match-queue/extra",
      "/app/professional/unknown",
      "/app/professional",
      "/dev/auth-proof/extra",
      "/api/test-auth/tokens",
      "/api/test-auth",
      "/dev",
    ]) {
      handleAuthStub.mockClear();
      await run(path);
      expect(
        handleAuthStub,
        `${path} must stay behind WorkOS`,
      ).toHaveBeenCalledTimes(1);
    }
  });
});

describe("testAuthProxyExempt predicate", () => {
  const flagOn = { NEXT_PUBLIC_CONNVO_TEST_AUTH: "1" };

  it("exempts exact paths only, when the flag is on and the build is not production", () => {
    expect(testAuthProxyExempt("/dev/auth-proof", flagOn)).toBe(true);
    expect(testAuthProxyExempt("/api/test-auth/token", flagOn)).toBe(true);
    expect(testAuthProxyExempt("/api/test-auth/token/", flagOn)).toBe(false);
    expect(testAuthProxyExempt("/dev/auth-proof/x", flagOn)).toBe(false);
  });

  it("refuses without the flag and in production builds", () => {
    expect(testAuthProxyExempt("/dev/auth-proof", {})).toBe(false);
    expect(
      testAuthProxyExempt("/dev/auth-proof", {
        ...flagOn,
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
    expect(
      testAuthProxyExempt("/dev/auth-proof", {
        ...flagOn,
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });
});
