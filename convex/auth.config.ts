/**
 * Convex Authentication Configuration for WorkOS
 * 
 * This configuration tells Convex how to validate WorkOS JWT tokens.
 * Required for all authenticated mutations and queries.
 */

const clientId = process.env.WORKOS_CLIENT_ID;

if (!clientId) {
  throw new Error(
    "WORKOS_CLIENT_ID environment variable is required. " +
    "Set it in your Convex Dashboard: Settings → Environment Variables"
  );
}

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
