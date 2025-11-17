# Testing Instructions After Authentication Fix

After configuring `WORKOS_CLIENT_ID` in your Convex deployment and deploying the code fixes, follow these steps to verify everything works correctly.

## Step 1: Deploy the Fixes

### Deploy to Convex Production

```bash
# From your project root
pnpm convex deploy --prod
```

**Expected Output:**

```
✓ Deployed functions to production
✓ Schema updated
✓ No errors
```

### Deploy Next.js Application

Commit and push your changes (if using Git-based deployment):

```bash
git add .
git commit -m "fix: Add Convex auth configuration and error handling"
git push origin main
```

Or deploy directly (if using Vercel CLI):

```bash
vercel --prod
```

## Step 2: Verify Convex Configuration

### Check Environment Variables

```bash
pnpm convex env list --prod
```

**Expected Output:**

```
WORKOS_CLIENT_ID: client_******************
```

### Check Convex Logs

1. Go to https://dashboard.convex.dev
2. Select your project
3. Click **Logs** in the sidebar
4. Look for recent logs from `auth.config.ts`

**Expected Log (Success):**

```
[auth.config.ts] ✅ WorkOS authentication configured for client: client_...
```

**Should NOT see:**

```
❌ WORKOS_CLIENT_ID environment variable is required
```

## Step 3: Test Sign-In Flow

### Access Your Production App

1. Open your production URL in a new incognito/private window
2. Navigate to `/app` or any authenticated route
3. You should be redirected to WorkOS sign-in

### Sign In

1. Complete the WorkOS authentication flow
2. You should be redirected back to your app
3. The page should load without errors

### Check Browser Console

Open DevTools (F12) → Console tab

**Expected Logs (Success):**

```
[ConvexAuth] Auth state changed: { hasUser: true, hasAccessToken: true, authLoading: false, ... }
[UpsertUserOnAuth] Attempting to upsert user: { workosUserId: "user_...", email: "...", ... }
[UpsertUserOnAuth] ✅ User upserted successfully
```

**Should NOT see:**

```
❌ Uncaught Error: [CONVEX Q(users/queries:getCurrentUser)] Server Error
❌ [CONVEX M(users/mutations:upsertUser)] Server Error
❌ CONVEX AUTHENTICATION CONFIGURATION ERROR
```

### Check Network Tab

Open DevTools → Network tab → Filter by "convex"

**Look for requests to:**

- `getCurrentUser` - Should return 200 with user data
- `upsertUser` - Should return 200 with user ID

**Should NOT see:**

- 401 Unauthorized errors
- 500 Server Error responses
- Continuous retry loops

## Step 4: Verify Database Records

### Check Convex Dashboard

1. Go to https://dashboard.convex.dev
2. Select your project
3. Click **Data** in the sidebar
4. Check the `users` table

**Expected:**

- Your user record exists
- `workosUserId` matches your WorkOS user ID
- `email` is populated
- `isActive` is `true`
- Timestamps are recent

### Check profiles table

**Expected:**

- Profile record exists with matching `userId`
- `displayName` is set
- `createdAt` and `updatedAt` are recent

## Step 5: Test Protected Routes

Visit these routes while authenticated:

### `/app` - Main App Route

- [ ] Page loads without errors
- [ ] No "Server Error" messages
- [ ] User data displays correctly

### `/app/professional` - Professional Queue

- [ ] Page loads
- [ ] User information available
- [ ] No authentication errors

### Other authenticated routes

- [ ] All protected routes accessible
- [ ] User context available
- [ ] No unexpected redirects

## Step 6: Test Error Scenarios (Optional)

### Test Unauthenticated Access

1. Sign out or open incognito window
2. Try to access `/app`
3. Should redirect to sign-in
4. Should NOT show errors in console

### Test with Invalid Token

1. In DevTools → Application → Cookies
2. Find WorkOS cookie and modify it
3. Refresh the page
4. Should redirect to sign-in or show appropriate error
5. Should NOT crash the application

## Step 7: Monitor Logs

### Monitor Convex Logs

```bash
# Watch logs in real-time
pnpm convex logs --prod --watch
```

**Look for:**

- Successful user upserts
- Successful queries
- No authentication errors
- No schema mismatches

### Monitor Application Logs

If you have application monitoring (Sentry, LogRocket, etc.):

- Check for auth-related errors
- Verify error rate is normal
- Look for any "Server Error" occurrences

## Troubleshooting Test Failures

### If you still see "Server Error"

**Check 1: Environment Variable**

```bash
pnpm convex env list --prod
```

- Verify `WORKOS_CLIENT_ID` is set
- Verify value matches your WorkOS dashboard

**Check 2: Deployment**

```bash
pnpm convex deploy --prod
```

- Ensure deployment completed successfully
- Check for any deployment errors

**Check 3: WorkOS Configuration**

- Go to WorkOS Dashboard
- Verify client ID matches
- Check redirect URIs include your production domain

### If user data doesn't load

**Check Convex Logs:**

```bash
pnpm convex logs --prod | grep -i error
```

**Common issues:**

- Schema not deployed: `pnpm convex deploy --prod`
- Index missing: Check schema.ts indexes
- Query failing: Check logs for specific error

### If authentication loops

**Check:**

- WorkOS redirect URI matches your callback route
- Cookies are being set properly
- No conflicting redirects in your code

## Success Criteria

✅ All tests pass when:

- [ ] No "Server Error" messages in browser console
- [ ] User successfully signs in via WorkOS
- [ ] User record created in Convex users table
- [ ] Profile record created in Convex profiles table
- [ ] `/app` route loads without errors
- [ ] User data displays correctly
- [ ] Convex logs show successful operations
- [ ] No authentication errors in Convex logs
- [ ] Protected routes are accessible when authenticated
- [ ] Unauthenticated users are properly redirected

## Performance Verification

After successful authentication:

### Page Load Time

- `/app` should load in < 2 seconds
- Subsequent navigations should be fast
- No noticeable delays from authentication

### Query Performance

Check Convex Dashboard → Analytics:

- `getCurrentUser` query should be < 100ms average
- `upsertUser` mutation should be < 200ms average
- No queries timing out

### User Experience

- Sign-in flow feels smooth
- No loading spinners that never end
- Error messages (if any) are clear and helpful

## Reporting Issues

If tests fail after following all steps:

### Gather Information

1. **Convex Logs:**

   ```bash
   pnpm convex logs --prod > convex-logs.txt
   ```

2. **Browser Console:**
   - Copy all error messages
   - Screenshot the Network tab

3. **Environment Variables:**

   ```bash
   pnpm convex env list --prod
   ```

   (Remove sensitive values before sharing)

4. **Configuration:**
   - Convex deployment URL
   - WorkOS client ID (first 10 characters)
   - Next.js version
   - Convex package version

### Check Documentation

1. Review [CONVEX_DEPLOYMENT_SETUP.md](./CONVEX_DEPLOYMENT_SETUP.md)
2. Review [PRE_DEPLOYMENT_CHECKLIST.md](./PRE_DEPLOYMENT_CHECKLIST.md)
3. Check Convex Discord/Support

## Next Steps After Successful Testing

Once all tests pass:

1. **Monitor Production**
   - Watch Convex logs for first 24 hours
   - Check error tracking tools
   - Monitor user sign-up success rate

2. **Document Custom Configuration**
   - Note any environment-specific settings
   - Document any custom modifications
   - Update team documentation

3. **Set Up Alerts** (Optional)
   - Alert on high error rates
   - Monitor authentication failures
   - Track database growth

4. **Clean Up**
   - Remove any debug logging (if added)
   - Remove test users (if needed)
   - Archive testing documentation

## Rollback Instructions

If critical issues occur:

### Quick Rollback

```bash
# Find previous working deployment
pnpm convex deployments --prod

# Rollback to specific deployment
pnpm convex deploy --prod --from <deployment-hash>

# For Next.js (Vercel example)
vercel rollback
```

### Re-deployment

After fixing issues:

```bash
pnpm convex deploy --prod
git push origin main  # Redeploy Next.js
```

---

## Quick Test Commands

```bash
# Deploy to Convex
pnpm convex deploy --prod

# Check environment variables
pnpm convex env list --prod

# Watch logs
pnpm convex logs --prod --watch

# Check recent errors
pnpm convex logs --prod | grep -i error | tail -20
```

## Support Resources

- **Convex Documentation:** https://docs.convex.dev/auth
- **WorkOS Documentation:** https://workos.com/docs/authkit
- **Project Documentation:**
  - [CONVEX_DEPLOYMENT_SETUP.md](./CONVEX_DEPLOYMENT_SETUP.md)
  - [PRE_DEPLOYMENT_CHECKLIST.md](./PRE_DEPLOYMENT_CHECKLIST.md)
