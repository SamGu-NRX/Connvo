import { describe, expect, it } from "vitest";

// The module under test throws at import time without a client id (by
// design — it is the D2 guard). Give it a dummy for the import, then
// exercise the pure builder directly below.
process.env.WORKOS_CLIENT_ID ??= "client_test_module_import";

const { buildAuthConfig } = await import("@convex/auth.config");

const CLIENT = "client_test_dummy";
const JWKS = "data:application/json;base64,eyJrZXlzIjpbXX0=";

// Byte-for-byte main provider list (CALL-PLAN.md D2): with
// CONNVO_LOCAL_TEST_JWKS unset, exactly the two WorkOS customJwt providers
// main shipped, serialized identically.
const MAIN_PROVIDERS_JSON = JSON.stringify([
  {
    type: "customJwt",
    issuer: "https://api.workos.com/",
    algorithm: "RS256",
    jwks: `https://api.workos.com/sso/jwks/${CLIENT}`,
    applicationID: CLIENT,
  },
  {
    type: "customJwt",
    issuer: `https://api.workos.com/user_management/${CLIENT}`,
    algorithm: "RS256",
    jwks: `https://api.workos.com/sso/jwks/${CLIENT}`,
    applicationID: CLIENT,
  },
]);

describe("auth.config (D2 env-gated local test provider)", () => {
  it("throws without WORKOS_CLIENT_ID", () => {
    expect(() => buildAuthConfig({})).toThrow(/WORKOS_CLIENT_ID/);
  });

  it("with CONNVO_LOCAL_TEST_JWKS unset, the provider list is byte-for-byte main's", () => {
    const config = buildAuthConfig({ WORKOS_CLIENT_ID: CLIENT });
    expect(config.providers).toHaveLength(2);
    // Byte-for-byte: identical serialization to main's literal list.
    expect(JSON.stringify(config.providers)).toBe(MAIN_PROVIDERS_JSON);
    expect(config).toEqual({ providers: JSON.parse(MAIN_PROVIDERS_JSON) });
  });

  it("with CONNVO_LOCAL_TEST_JWKS set, exactly one extra local-test provider is appended", () => {
    const config = buildAuthConfig({
      WORKOS_CLIENT_ID: CLIENT,
      CONNVO_LOCAL_TEST_JWKS: JWKS,
    });
    expect(config.providers).toHaveLength(3);
    expect(config.providers[2]).toEqual({
      type: "customJwt",
      issuer: "https://connvo-local-test.invalid",
      algorithm: "RS256",
      jwks: JWKS,
      applicationID: CLIENT,
    });
    // The first two remain byte-for-byte main's.
    expect(JSON.stringify(config.providers.slice(0, 2))).toBe(
      MAIN_PROVIDERS_JSON,
    );
  });
});
