# Profile Authentication Fix Summary

## Issues Identified

1. **JWT Token Not Being Passed**: The `fetchAccessToken` callback in `ConvexClientProvider` was using a cached ref value instead of returning the current access token from WorkOS.

2. **Query Error Handling**: The `getCurrentUserProfile` query was throwing UNAUTHORIZED errors instead of gracefully returning `null` when unauthenticated.

3. **Missing Default Profile**: When users logged in, the `upsertUser` mutation was only creating the user record but not creating a corresponding profile, causing the profile page to fail.

## Fixes Applied

### 1. Fixed Token Handling (`src/providers/ConvexClientProvider.tsx`)
- Updated `fetchAccessToken` to return the current `accessToken` directly from the hook
- Removed stale `useRef` caching mechanism
- Added `!tokenError` check to authentication validation

### 2. Fixed Profile Query (`convex/profiles/queries.ts`)
- Changed `getCurrentUserProfile` to return `null` when unauthenticated (defensive pattern)
- Matches the behavior of `getCurrentUser` query
- Prevents UNAUTHORIZED errors during authentication state transitions

### 3. Ensured Profile Creation (`convex/users/mutations.ts`)
- Updated `upsertUser` to automatically create a default profile for new users
- Added profile existence check for existing users and creates one if missing
- Default profile uses display name or email username

### 4. Added Debug Tools (`test/convex/profileDebug.ts`)
- Created `checkUserProfile` query to check specific user's profile status
- Created `listUsersWithProfiles` query to audit all users
- Useful for troubleshooting profile issues in Convex dashboard

## Testing Instructions

### Option 1: Existing User (Recommended)
1. Log out from your application
2. Log back in through WorkOS
3. Navigate to the profile page
4. Your profile should now be visible with default values

### Option 2: Debug Current State
1. Open Convex dashboard: https://dashboard.convex.dev/d/earnest-ermine-129
2. Go to the "Functions" tab
3. Run `test/profileDebug:listUsersWithProfiles` to see all users and their profile status
4. If your user exists but has no profile, log out and log back in to trigger profile creation

### Option 3: Fresh Start
1. Clear browser cookies/local storage
2. Log in again
3. Profile will be automatically created during authentication

## Expected Behavior

✅ **Authenticated Users**: 
- Can view their profile page
- Profile data loads without errors
- Can edit and save profile information

✅ **Unauthenticated Users**:
- See "Please log in" message
- No UNAUTHORIZED errors in console
- Smooth redirect to login when needed

## Technical Details

### Authentication Flow
```
User logs in → WorkOS callback → upsertUser mutation → 
  1. Create/update user record
  2. Create default profile (if missing)
  3. Return userId → Frontend receives auth token →
  4. Queries can now access user data and profile
```

### Profile Data Structure
```typescript
{
  userId: Id<"users">,
  displayName: string,
  bio?: string,
  languages: string[],
  // ... other fields
}
```

## Files Modified
1. `src/providers/ConvexClientProvider.tsx` - JWT token handling
2. `convex/profiles/queries.ts` - Defensive query pattern
3. `convex/users/mutations.ts` - Automatic profile creation
4. `test/convex/profileDebug.ts` - Debug utilities (new file)

## Verification
After logging in, check browser console for:
- ✅ No UNAUTHORIZED errors
- ✅ Profile data appears in React DevTools
- ✅ User can edit and save profile successfully
