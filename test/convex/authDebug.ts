import { query } from "../../convex/_generated/server";

export const debugAuth = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    return {
      hasIdentity: !!identity,
      identity: identity ? {
        subject: identity.subject,
        issuer: identity.issuer,
        tokenIdentifier: identity.tokenIdentifier,
        email: identity.email,
        name: identity.name,
        // Log all claims for debugging
        allClaims: Object.keys(identity).filter(k => k !== 'aud' && k !== 'exp' && k !== 'iat'),
      } : null,
      envVarSet: !!process.env.WORKOS_CLIENT_ID,
      clientId: process.env.WORKOS_CLIENT_ID,
    };
  },
});