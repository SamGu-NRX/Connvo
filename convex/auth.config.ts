/**
 * Convex Authentication Configuration for WorkOS
 *
 * This configuration tells Convex how to validate WorkOS JWT tokens.
 * Required for all authenticated mutations and queries.
 *
 * DEPLOYMENT CHECKLIST:
 * 1. Set WORKOS_CLIENT_ID in Convex Dashboard → Settings → Environment Variables
 * 2. Value should match your WorkOS application's client ID (client_...)
 * 3. After setting, redeploy: `pnpm convex deploy --prod`
 * 4. Verify in logs that auth.config.ts loads without errors
 *
 * See CONVEX_DEPLOYMENT_SETUP.md for detailed instructions
 *
 * CALL-PLAN.md D2 (eval-only): with `CONNVO_LOCAL_TEST_JWKS` set, exactly one
 * extra `customJwt` provider is appended so the S0 harness's local backend can
 * accept tokens minted by the harness (issuer `https://connvo-local-test.invalid`).
 * With the env unset, `buildAuthConfig` returns byte-for-byte the provider list
 * main has always returned — proven by test/convex/auth.config.test.ts.
 * Local runs set `WORKOS_CLIENT_ID` to a dummy value.
 */

export interface AuthConfigEnv {
  WORKOS_CLIENT_ID?: string | undefined;
  CONNVO_LOCAL_TEST_JWKS?: string | undefined;
}

const LOCAL_TEST_ISSUER = "https://connvo-local-test.invalid";

interface CustomJwtProvider {
  type: "customJwt";
  issuer: string;
  algorithm: "RS256";
  jwks: string;
  applicationID: string;
}

/**
 * Pure builder so tests can pin the provider list without touching
 * process.env (D2). The WorkOS providers are character-for-character the
 * ones main shipped.
 */
export function buildAuthConfig(env: AuthConfigEnv): { providers: CustomJwtProvider[] } {
  const clientId = env.WORKOS_CLIENT_ID;

  if (!clientId) {
    const errorMessage = [
      "❌ WORKOS_CLIENT_ID environment variable is required but not set.",
      "",
      "🔧 TO FIX THIS ERROR:",
      "1. Go to https://dashboard.convex.dev",
      "2. Select your project and deployment",
      "3. Navigate to: Settings → Environment Variables",
      "4. Add: WORKOS_CLIENT_ID = client_your_client_id_here",
      "5. Save and redeploy: pnpm convex deploy --prod",
      "",
      "📖 For detailed instructions, see: CONVEX_DEPLOYMENT_SETUP.md",
      "",
      "⚠️  Without this variable, ALL authenticated requests will fail with 'Server Error'",
    ].join("\n");

    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  const providers: CustomJwtProvider[] = [
    {
      type: "customJwt",
      issuer: `https://api.workos.com/`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
  ];

  if (env.CONNVO_LOCAL_TEST_JWKS) {
    providers.push({
      type: "customJwt",
      issuer: LOCAL_TEST_ISSUER,
      algorithm: "RS256",
      jwks: env.CONNVO_LOCAL_TEST_JWKS,
      applicationID: clientId,
    });
  }

  return { providers };
}

// Read defensively so importing this module outside a Convex/Node runtime
// (e.g. an edge-runtime unit test that only wants buildAuthConfig) is safe.
const envForConfig = {
  WORKOS_CLIENT_ID:
    typeof process !== "undefined" ? process.env.WORKOS_CLIENT_ID : undefined,
  CONNVO_LOCAL_TEST_JWKS:
    typeof process !== "undefined" ? process.env.CONNVO_LOCAL_TEST_JWKS : undefined,
};

const authConfig = buildAuthConfig(envForConfig);

// Log successful configuration (helps verify deployment)
console.log(
  `[auth.config.ts] ✅ WorkOS authentication configured for client: ${envForConfig.WORKOS_CLIENT_ID?.substring(0, 20)}...`,
);

export default authConfig;
