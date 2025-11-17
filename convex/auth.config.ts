/**
 * Convex Authentication Configuration for WorkOS
 * 
 * This configuration tells Convex how to validate WorkOS JWT tokens.
 * Required for all authenticated mutations and queries.
 */

import type { AuthConfig } from "convex/server";

const clientId = process.env.WORKOS_CLIENT_ID;

if (!clientId) {
  throw new Error(
    "WORKOS_CLIENT_ID environment variable is required. " +
      "Set it in your Convex Dashboard (Settings → Environment Variables) before running Convex.",
  );
}

const workosProvider = (issuer: string): AuthConfig["providers"][number] => ({
  type: "customJwt",
  issuer,
  algorithm: "RS256",
  jwks: `https://api.workos.com/sso/jwks/${clientId}`,
  applicationID: clientId,
});

const authConfig: AuthConfig = {
  providers: [
    workosProvider("https://api.workos.com/"),
    workosProvider(`https://api.workos.com/user_management/${clientId}`),
  ],
};

export default authConfig;
