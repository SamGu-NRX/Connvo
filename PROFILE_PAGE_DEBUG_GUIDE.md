# Profile Page Debug Guide

## Problem
Profile page shows "Please log in to view your profile" even though:
- User is authenticated with WorkOS
- Migration successfully created profile record
- User can access other authenticated pages

## Debug Logging Added

### 1. useWorkOSAuth Hook (`src/hooks/useWorkOSAuth.ts`)
Logs every authentication state change:
- WorkOS user presence and details
- Access token availability
- Convex loading states
- Convex authentication status
- Convex user record status

**Look for**: `[useWorkOSAuth] Auth State:`

### 2. Profile Page (`src/app/[mvp]/profile/page.tsx`)
Logs profile page rendering state:
- WorkOS user data
- Authentication status
- Convex user record
- Profile record
- Whether queries are being skipped

**Look for**: `[ProfilePage] State:`

### 3. ConvexClientProvider (`src/providers/ConvexClientProvider.tsx`)
Logs user sync operations:
- When user sync is triggered
- User data being synced
- Success/failure of sync operations
- Retry attempts

**Look for**: `[UpsertUserOnAuth]`

## Testing Instructions

### Step 1: Clear Browser State
1. Open browser DevTools (F12)
2. Go to Application/Storage tab
3. Clear all site data (cookies, localStorage, sessionStorage)
4. Close and reopen the browser

### Step 2: Log In Fresh
1. Navigate to the login page
2. Open browser console (F12 → Console tab)
3. Log in with your credentials
4. **IMMEDIATELY** watch the console for these log sequences:

Expected sequence:
```
[UpsertUserOnAuth] Effect triggered: { ready: true, ... }
[UpsertUserOnAuth] Attempting to upsert user: { workosUserId: 'user_...', email: '...', ... }
[UpsertUserOnAuth] User upserted successfully
[useWorkOSAuth] Auth State: { hasUser: true, hasAccessToken: true, convexAuthenticated: true, ... }
```

### Step 3: Navigate to Profile Page
1. Go to `/[mvp]/profile` (e.g., `/v1/profile`)
2. Watch console for:
```
[ProfilePage] State: {
  hasUser: true,
  isAuthenticated: true,
  convexUser: { _id: '...', email: '...', ... },
  profile: { _id: '...', userId: '...', ... }
}
```

### Step 4: Analyze the Logs

#### Scenario A: convexAuthenticated is false
**Symptoms:**
```javascript
[useWorkOSAuth] Auth State: {
  hasUser: true,
  hasAccessToken: true,
  convexAuthenticated: false,  // ❌ THIS IS THE PROBLEM
  isAuthenticated: false
}
```

**Cause**: Convex auth context not initialized properly
**Fix Needed**: Auth token sync issue between WorkOS and Convex

#### Scenario B: convexUser is null
**Symptoms:**
```javascript
[useWorkOSAuth] Auth State: {
  convexAuthenticated: true,
  isAuthenticated: true,
  hasConvexUser: false,  // ❌ THIS IS THE PROBLEM
  convexUserId: null
}
```

**Cause**: User record not created in Convex database
**Fix Needed**: Check upsertUser mutation and WorkOS user ID format

#### Scenario C: profile is null
**Symptoms:**
```javascript
[ProfilePage] State: {
  isAuthenticated: true,
  convexUser: { _id: '...', ... },  // ✅ User exists
  profile: null  // ❌ THIS IS THE PROBLEM
}
```

**Cause**: Profile not linked to user record
**Fix Needed**: Check if profile's userId matches convexUser._id

## Common Issues & Solutions

### Issue 1: Race Condition in User Sync
**Problem**: UpsertUserOnAuth and useWorkOSAuth both try to sync user
**Solution**: Remove duplicate sync logic from useWorkOSAuth hook

### Issue 2: WorkOS User ID Mismatch
**Problem**: User created with wrong workosUserId format
**Check**: Migration output shows workosUserId starting with "user_"
**Verify**: Convex user record has matching workosUserId

### Issue 3: Profile userId Mismatch
**Problem**: Profile created with wrong userId
**Check**: Profile's userId field matches user's _id field
**Fix**: Run migration again or manually update profile

### Issue 4: Delayed Auth Context
**Problem**: convexAuthenticated stays false too long
**Solution**: Increase delay in ConvexClientProvider (currently 500ms)

## Next Steps Based on Logs

After reviewing the console logs, share:
1. The full `[useWorkOSAuth] Auth State:` output
2. The full `[ProfilePage] State:` output
3. Any error messages in the console
4. The URL you're trying to access

This will help pinpoint the exact failure point and determine the appropriate fix.

## Verification Queries

Use Convex dashboard to verify data:

### Check User Record
```javascript
// In Convex dashboard
db.query("users")
  .withIndex("by_email", q => q.eq("email", "andrewwang123118@gmail.com"))
  .unique()
```

### Check Profile Record
```javascript
// In Convex dashboard - get your userId first, then:
db.query("profiles")
  .withIndex("by_user", q => q.eq("userId", YOUR_USER_ID))
  .unique()
```

Look for:
- User record exists with correct workosUserId
- Profile record exists with correct userId
- userId in profile matches _id in user record