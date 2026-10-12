// @vitest-environment node
/**
 * The eval token route must never mint on a Vercel deployment: the
 * local-build marker is for production-mode builds on a developer machine,
 * and a deployment could carry it by mistake.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const request = () =>
  new Request("http://localhost/api/test-auth/token?user=A");

afterEach(() => vi.unstubAllEnvs());

describe("test-auth token route", () => {
  it("refuses on any Vercel deployment, even with the local-build marker", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONNVO_TEST_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CONNVO_LOCAL_BUILD", "1");
    vi.stubEnv("NODE_ENV", "production");
    for (const vercelEnv of ["production", "preview", "development"]) {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      const res = await GET(request());
      expect(res.status).toBe(403);
      expect(await res.text()).toMatch(/Vercel/);
    }
  });

  it("refuses a production build without the local-build marker", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONNVO_TEST_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CONNVO_LOCAL_BUILD", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await GET(request())).status).toBe(403);
  });

  it("is not found when test auth is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONNVO_TEST_AUTH", "");
    expect((await GET(request())).status).toBe(404);
  });
});
