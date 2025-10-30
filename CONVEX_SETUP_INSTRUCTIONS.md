# 🚨 CRITICAL: Convex Environment Variable Setup

## The Error You're Seeing

```
[CONVEX M(users/mutations:upsertUser)] Server Error
Uncaught ConvexError: {"code":"UNAUTHORIZED","message":"Authentication required","statusCode":401}
```

**Root Cause**: Convex cannot validate WorkOS JWT tokens because `WORKOS_CLIENT_ID` is not set in your Convex deployment.

---

## Step-by-Step Fix

### Step 1: Set Environment Variable in Convex Dashboard

1. **Open Convex Dashboard**
   ```
   https://dashboard.convex.dev
   ```

2. **Select Your Project**
   - Project name: **connvo**
   - Deployment: **dev:earnest-ermine-129**

3. **Navigate to Environment Variables**
   - Click **Settings** in the left sidebar
   - Click **Environment Variables** tab

4. **Add the Variable**
   - Click **"Add Environment Variable"** button
   - **Name**: `WORKOS_CLIENT_ID`
   - **Value**: `client_01K4TGBYAVCDQMC3G5SASM92KW`
   - Click **Save**

### Step 2: Restart Convex Dev Server

After saving the environment variable, you MUST restart your Convex dev server:

1. **Stop current Convex process** (if running)
   - Press `Ctrl+C` in the terminal running `npx convex dev`

2. **Start Convex dev server**
   ```bash
   npx convex dev
   ```

3. **Wait for confirmation**
   - You should see: **"✓ Convex functions ready!"**
   - This confirms the auth configuration is synced

### Step 3: Restart Next.js Dev Server

After Convex is ready, restart your Next.js app:

1. **Stop Next.js** (if running)
   - Press `Ctrl+C` in the terminal running `npm run dev`

2. **Start Next.js**
   ```bash
   npm run dev
   ```

3. **Clear browser cache** (important!)
   - Open DevTools (F12)
   - Right-click the refresh button
   - Select **"Empty Cache and Hard Reload"**

---

## Verification Steps

### 1. Check Convex Logs

After restarting, the Convex terminal should show:

```
✓ Convex functions ready!
  Authentication: Configured with 2 providers
  - customJwt (https://api.workos.com/)
  - customJwt (https://api.workos.com/user_management/...)
```

### 2. Test Authentication

1. **Open browser** to `http://localhost:3000`
2. **Click** any "Start Connecting" or login button
3. **Sign in** via WorkOS
4. **Check Console** (F12) - should see no UNAUTHORIZED errors

### 3. Verify User Creation

After successful login:

1. **Go to Convex Dashboard** → **Data** tab
2. **Select** `users` table
3. **Verify** your user record exists with:
   - ✅ `workosUserId`: Your WorkOS ID
   - ✅ `email`: Your email
   - ✅ `isActive`: true

---

## Still Getting Errors?

### Error: "Authentication required"

**Possible causes**:
1. ❌ `WORKOS_CLIENT_ID` not set in Convex dashboard
2. ❌ Convex dev server not restarted after setting variable
3. ❌ Browser cached old authentication state

**Solution**:
```bash
# 1. Verify environment variable is set in dashboard
# 2. Stop and restart Convex
npx convex dev

# 3. In a new terminal, restart Next.js
npm run dev

# 4. Clear browser cache and try again
```

### Error: "Invalid token"

**Possible causes**:
1. ❌ Wrong `WORKOS_CLIENT_ID` value
2. ❌ Mismatch between .env.local and Convex dashboard

**Solution**:
1. Verify `.env.local` has: `WORKOS_CLIENT_ID='client_01K4TGBYAVCDQMC3G5SASM92KW'`
2. Verify Convex dashboard has same value
3. Make sure there are no extra quotes or spaces

### Error: "Convex functions failed"

**Possible causes**:
1. ❌ Syntax error in `convex/auth.config.ts`
2. ❌ Missing Convex deployment

**Solution**:
```bash
# Check for syntax errors
npx convex dev

# If deployment missing, deploy manually
npx convex deploy
```

---

## Quick Troubleshooting Checklist

- [ ] `WORKOS_CLIENT_ID` is set in Convex dashboard
- [ ] Convex dashboard value matches `.env.local` value
- [ ] Ran `npx convex dev` after setting variable
- [ ] Saw "Convex functions ready!" message
- [ ] Restarted Next.js dev server
- [ ] Cleared browser cache
- [ ] Tested in incognito/private window

---

## Environment Variable Values Reference

**For Development** (`.env.local` and Convex dev deployment):

```env
WORKOS_CLIENT_ID='client_01K4TGBYAVCDQMC3G5SASM92KW'
WORKOS_API_KEY='sk_test_a2V5XzAxSzRUR0JYUkFBVFpSTTlGN01CWFhGME43LEZ2NXdwUjZuek0zcVoyUU5ud1E1V2ZKeU8'
```

**These values MUST match in**:
1. ✅ `.env.local` file
2. ✅ Convex Dashboard → Settings → Environment Variables

---

## What Happens When It's Fixed

When properly configured, this is the authentication flow:

1. ✅ User logs in via WorkOS
2. ✅ WorkOS returns JWT token
3. ✅ Token stored in browser cookie
4. ✅ ConvexClientProvider fetches token
5. ✅ Token sent to Convex with each request
6. ✅ Convex validates token using `WORKOS_CLIENT_ID`
7. ✅ Convex extracts user info from token
8. ✅ `upsertUser` mutation creates/updates user record
9. ✅ User is authenticated and can use the app

---

## Need More Help?

If you're still getting errors after following these steps:

1. **Check Convex Logs**
   - Look for authentication configuration messages
   - Check for any error messages

2. **Check Browser Console**
   - Open DevTools (F12)
   - Look for detailed error messages
   - Check Network tab for failed requests

3. **Verify WorkOS Dashboard**
   - Ensure redirect URI is configured: `http://localhost:3000/auth/callback`
   - Ensure CORS is configured for: `http://localhost:3000`

---

*Last Updated: 2025-01-30*
*Status: Critical Setup Required*