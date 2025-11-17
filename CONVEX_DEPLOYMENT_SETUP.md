# Convex Deployment Setup Guide

## Issue Resolution: Authentication "Server Error"

The "Server Error" you're experiencing on `/app` is caused by missing environment variables in your Convex production deployment. Convex cannot validate WorkOS JWT tokens without the proper configuration.

## Root Cause

The errors indicate:

```
[CONVEX Q(users/queries:getCurrentUser)] [Request ID: ...] Server Error
[CONVEX M(users/mutations:upsertUser)] [Request ID: ...] Server Error
```

This happens when:

1. Your Convex deployment doesn't have `WORKOS_CLIENT_ID` environment variable set
2. The `auth.config.ts` file cannot properly configure JWT validation
3. All authenticated queries/mutations fail because Convex cannot validate the JWT tokens

## Step-by-Step Fix

### 1. Get Your WorkOS Client ID

From your local `.env` file or WorkOS dashboard:

```bash
# Your WorkOS Client ID looks like this:
WORKOS_CLIENT_ID=client_01HQXXXXXXXXXXXXXXXXXX
```

### 2. Configure Convex Production Deployment

1. Go to https://dashboard.convex.dev
2. Select your project
3. Click **Settings** in the left sidebar
4. Click **Environment Variables**
5. Add the following variable:
   - **Key**: `WORKOS_CLIENT_ID`
   - **Value**: Your WorkOS client ID (from step 1)
6. Click **Save**

### 3. Redeploy Your Convex Functions

After adding the environment variable, you need to trigger a redeployment:

**Option A: Via CLI (Recommended)**

```bash
# Make sure you're in your project directory
pnpm convex deploy --prod
```

**Option B: Via Dashboard**

1. Make a small change to any Convex file (e.g., add a comment to `convex/auth.config.ts`)
2. Commit and push to trigger your CI/CD pipeline
3. Or manually run your deployment workflow

### 4. Verify the Configuration

After deployment, check the Convex logs:

1. Go to **Logs** in the Convex dashboard
2. Look for logs from `auth.config.ts` during initialization
3. You should **NOT** see any errors about missing `WORKOS_CLIENT_ID`

### 5. Test Your Application

1. Visit your production URL (e.g., `https://yourapp.vercel.app`)
2. Navigate to `/app` or any authenticated route
3. Sign in with WorkOS
4. Verify that:
   - No "Server Error" messages appear in the browser console
   - User data loads successfully
   - The `/app` page renders without errors

## Additional Environment Variables

For a complete production setup, ensure these are also configured in Convex:

### Required for Production:

- `WORKOS_CLIENT_ID` - WorkOS application client ID (for JWT validation)

### Optional (depending on features used):

- `OPENAI_API_KEY` - For AI-powered features
- `ANTHROPIC_API_KEY` - Alternative AI provider
- `PINECONE_API_KEY` - For vector search features
- `PINECONE_ENVIRONMENT` - Pinecone environment name

## Troubleshooting

### Error: "WORKOS_CLIENT_ID environment variable is required"

**Cause**: Environment variable not set in Convex dashboard

**Solution**: Follow steps 1-3 above

### Error: "Invalid authentication token"

**Causes**:

1. WorkOS client ID mismatch between Next.js and Convex
2. Token expired or malformed

**Solutions**:

1. Verify both `WORKOS_CLIENT_ID` in Next.js `.env` and Convex dashboard match exactly
2. Clear browser cookies and sign in again
3. Check WorkOS dashboard for any API key issues

### Error: "User not provisioned"

**Cause**: User exists in WorkOS but not in Convex database

**Solution**:

- This should auto-resolve on next sign-in due to the `upsertUser` mutation
- If it persists, check Convex logs for mutation failures
- Verify database schema is deployed correctly: `pnpm convex deploy`

### Server Errors Persist After Configuration

1. **Verify environment variable is actually set**:

   ```bash
   # Check via Convex CLI
   pnpm convex env list --prod
   ```

2. **Force a clean redeployment**:

   ```bash
   pnpm convex deploy --prod --clear-cache
   ```

3. **Check for multiple deployments**:
   - Ensure you're configuring the correct deployment (dev/staging/prod)
   - Verify your Next.js `NEXT_PUBLIC_CONVEX_URL` points to the right deployment

4. **Review Convex Dashboard Logs**:
   - Filter by "error" or "auth"
   - Look for JWT validation failures
   - Check for schema initialization errors

## Pre-Deployment Checklist

Before deploying to production, verify:

- [ ] `WORKOS_CLIENT_ID` is set in Convex production environment
- [ ] `WORKOS_CLIENT_ID` matches between Next.js and Convex
- [ ] `NEXT_PUBLIC_CONVEX_URL` points to your production Convex deployment
- [ ] `WORKOS_API_KEY` is set in Next.js environment (Vercel/hosting platform)
- [ ] WorkOS callback URLs include your production domain
- [ ] Convex schema is deployed and up to date
- [ ] You can access Convex dashboard and see your deployment

## Deployment Architecture

```
User Browser
    ↓ (1) Signs in
WorkOS AuthKit
    ↓ (2) Returns JWT token
Next.js Frontend
    ↓ (3) Sends JWT to Convex
Convex Backend
    ↓ (4) Validates JWT using WORKOS_CLIENT_ID
    ↓ (5) Executes queries/mutations
Database Operations
```

**Key Point**: Step 4 fails without `WORKOS_CLIENT_ID` in Convex, causing "Server Error"

## Quick Commands Reference

```bash
# Deploy to production
pnpm convex deploy --prod

# Check environment variables
pnpm convex env list --prod

# Set environment variable via CLI
pnpm convex env set WORKOS_CLIENT_ID client_your_id_here --prod

# View production logs
pnpm convex logs --prod --watch

# Test local development
pnpm convex dev
pnpm dev
```

## Next Steps

After resolving the authentication errors:

1. Monitor Convex dashboard for any new errors
2. Test all authenticated routes thoroughly
3. Verify user creation and profile updates work correctly
4. Check that the onboarding flow completes successfully
5. Consider setting up monitoring/alerting for production errors

## Need Help?

If you continue experiencing issues after following this guide:

1. Check Convex logs for specific error messages
2. Verify WorkOS dashboard shows successful authentications
3. Review browser network tab for failed API calls
4. Check that JWT tokens are being sent in requests
5. Reach out to Convex support with deployment URL and error details

## Related Documentation

- [Convex Authentication Docs](https://docs.convex.dev/auth)
- [WorkOS AuthKit Docs](https://workos.com/docs/authkit)
- [Environment Variables in Convex](https://docs.convex.dev/production/environment-variables)
