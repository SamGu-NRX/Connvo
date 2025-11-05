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
 */

const clientId = process.env.WORKOS_CLIENT_ID;

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

// Log successful configuration (helps verify deployment)
console.log(`[auth.config.ts] ✅ WorkOS authentication configured for client: ${clientId.substring(0, 20)}...`);

const authConfig = {
  providers: [
    {
      type: "customJwt" as const,
      issuer: `https://api.workos.com/`,
      algorithm: "RS256" as const,
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
    {
      type: "customJwt" as const,
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256" as const,
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
  ],
};

export default authConfig;
