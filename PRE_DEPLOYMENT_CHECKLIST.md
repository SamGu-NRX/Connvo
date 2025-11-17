# Pre-Deployment Checklist for Convex + WorkOS Authentication

Use this checklist before deploying to production to ensure authentication will work correctly.

## Environment Variables Configuration

### ✅ Convex Production Environment

Go to [Convex Dashboard](https://dashboard.convex.dev) → Your Project → Settings → Environment Variables

- [ ] `WORKOS_CLIENT_ID` is set (value: `client_...`)
- [ ] Value matches exactly with Next.js environment variable
- [ ] No typos or extra spaces in the value
- [ ] Environment variable is set for the correct deployment (prod/staging)

### ✅ Next.js/Vercel Production Environment

Go to your hosting platform dashboard (Vercel, etc.)

- [ ] `NEXT_PUBLIC_CONVEX_URL` points to production Convex deployment
- [ ] `WORKOS_CLIENT_ID` matches Convex environment variable
- [ ] `WORKOS_API_KEY` is set (value: `sk_...`)
- [ ] `WORKOS_COOKIE_PASSWORD` is set (32+ characters)
- [ ] `NEXT_PUBLIC_WORKOS_REDIRECT_URI` includes production domain

### ✅ WorkOS Dashboard Configuration

Go to [WorkOS Dashboard](https://dashboard.workos.com)

- [ ] Redirect URIs include your production domain
  - Example: `https://yourapp.com/auth/callback`
  - Example: `https://yourapp.com/callback`
- [ ] Application is enabled and active
- [ ] Client ID matches environment variables
- [ ] API key is valid and not expired

## Code Deployment

### ✅ Convex Functions

```bash
# From project root
pnpm convex deploy --prod
```

- [ ] Deployment completed without errors
- [ ] No errors in Convex dashboard logs
- [ ] `auth.config.ts` initialized successfully (check logs)
- [ ] Schema deployed correctly

### ✅ Next.js Application

```bash
# Depending on your platform
git push origin main  # If using Git-based deployment
# OR
vercel --prod  # If using Vercel CLI
```

- [ ] Build completed successfully
- [ ] No TypeScript errors
- [ ] No build warnings about missing env vars
- [ ] Application deployed and accessible

## Verification Steps

### ✅ Convex Authentication

1. [ ] Open Convex Dashboard → Logs
2. [ ] Filter by "auth.config.ts"
3. [ ] Should see: `✅ WorkOS authentication configured for client: client_...`
4. [ ] No errors about missing WORKOS_CLIENT_ID

### ✅ Application Sign-In Flow

1. [ ] Visit your production URL
2. [ ] Click sign-in or navigate to authenticated route
3. [ ] WorkOS sign-in page loads correctly
4. [ ] Complete sign-in process
5. [ ] Redirected back to your application
6. [ ] No "Server Error" in browser console
7. [ ] User data loads successfully

### ✅ Console Logs (Browser DevTools)

Expected logs after sign-in:

```
[ConvexAuth] Auth state changed: { hasUser: true, hasAccessToken: true, ... }
[UpsertUserOnAuth] Attempting to upsert user: { ... }
[UpsertUserOnAuth] ✅ User upserted successfully
```

Should NOT see:

```
❌ [CONVEX Q(users/queries:getCurrentUser)] Server Error
❌ [CONVEX M(users/mutations:upsertUser)] Server Error
❌ WORKOS_CLIENT_ID environment variable is required
```

### ✅ Convex Logs (Dashboard)

After successful sign-in, check for:

```
[upsertUser] Starting user upsert { workosUserId: "...", ... }
[upsertUser] ✅ User updated successfully { userId: "..." }
```

## Common Issues & Quick Fixes

### Issue: "Server Error" on all authenticated requests

**Diagnosis:**

```bash
# Check if WORKOS_CLIENT_ID is set
pnpm convex env list --prod
```

**Fix:**

```bash
# Set the environment variable
pnpm convex env set WORKOS_CLIENT_ID client_your_id_here --prod

# Redeploy
pnpm convex deploy --prod
```

### Issue: WorkOS redirect URI mismatch

**Fix:**

1. Go to WorkOS Dashboard → Your App → Configuration
2. Add your production redirect URI: `https://yourapp.com/auth/callback`
3. Save and wait a few minutes for propagation

### Issue: User not being created in Convex

**Diagnosis:**

- Check browser console for upsert errors
- Check Convex logs for mutation failures

**Fix:**

- Verify schema is deployed: `pnpm convex deploy --prod`
- Check that users table exists in Convex dashboard
- Verify authentication token is being sent (Network tab)

## Testing Scenarios

### ✅ New User Sign-Up

- [ ] New user can sign up via WorkOS
- [ ] User record created in Convex users table
- [ ] Profile record created in Convex profiles table
- [ ] No errors in console or Convex logs

### ✅ Existing User Sign-In

- [ ] Existing user can sign in
- [ ] User data updates (lastSeenAt, etc.)
- [ ] Profile data loads correctly
- [ ] Authenticated pages work

### ✅ Onboarding Flow

- [ ] New users see onboarding screen
- [ ] Onboarding data saves correctly
- [ ] Interests are saved
- [ ] onboardingComplete flag is set
- [ ] Users redirect to appropriate page after onboarding

### ✅ Protected Routes

- [ ] Unauthenticated users cannot access `/app/*` routes
- [ ] Authenticated users can access protected routes
- [ ] User data loads on protected routes
- [ ] No authentication loops or redirects

## Performance Checks

### ✅ Query Performance

- [ ] `getCurrentUser` query resolves quickly (< 100ms)
- [ ] No excessive retries in console
- [ ] User data caches appropriately
- [ ] Page loads feel snappy

### ✅ Error Handling

- [ ] Graceful degradation if Convex is down
- [ ] Clear error messages for users
- [ ] Retry logic works for transient failures
- [ ] Configuration errors show helpful messages

## Security Verification

### ✅ Environment Variables

- [ ] No sensitive values in client-side code
- [ ] API keys not exposed in browser
- [ ] WORKOS_COOKIE_PASSWORD is strong and unique
- [ ] All secrets stored securely in platform dashboards

### ✅ Authentication Flow

- [ ] JWT tokens validated by Convex
- [ ] User cannot access other users' data
- [ ] Admin functions require proper permissions
- [ ] Session expires appropriately

## Monitoring Setup (Optional but Recommended)

### ✅ Error Tracking

- [ ] Set up error tracking (Sentry, LogRocket, etc.)
- [ ] Monitor for authentication failures
- [ ] Alert on high error rates
- [ ] Track user sign-up funnel

### ✅ Convex Monitoring

- [ ] Check Convex dashboard regularly
- [ ] Monitor query/mutation performance
- [ ] Watch for authentication errors
- [ ] Track database size and growth

## Rollback Plan

If issues occur after deployment:

### Quick Rollback

```bash
# Revert Next.js deployment (platform-specific)
# For Vercel:
vercel rollback

# Revert Convex deployment
pnpm convex deploy --prod --from <previous-deployment-hash>
```

### Emergency Contact

- [ ] Have Convex support contact ready
- [ ] Have WorkOS support contact ready
- [ ] Document working configuration for reference

## Sign-Off

Before marking complete, verify:

- [ ] All environment variables are set correctly
- [ ] Both Convex and Next.js are deployed
- [ ] Sign-in flow works end-to-end
- [ ] No errors in browser console
- [ ] No errors in Convex logs
- [ ] All checklist items above are completed

**Deployed by:** ******\_\_\_******  
**Date:** ******\_\_\_******  
**Deployment verified by:** ******\_\_\_******  
**Notes:** **********************\_\_\_**********************

---

## Quick Reference Commands

```bash
# View Convex environment variables
pnpm convex env list --prod

# Set Convex environment variable
pnpm convex env set KEY value --prod

# Deploy to Convex production
pnpm convex deploy --prod

# View Convex logs
pnpm convex logs --prod --watch

# Test locally before deploying
pnpm convex dev
pnpm dev
```

## Additional Resources

- [CONVEX_DEPLOYMENT_SETUP.md](./CONVEX_DEPLOYMENT_SETUP.md) - Detailed setup guide
- [Convex Authentication Docs](https://docs.convex.dev/auth)
- [WorkOS AuthKit Docs](https://workos.com/docs/authkit)
- [Environment Variables in Convex](https://docs.convex.dev/production/environment-variables)
