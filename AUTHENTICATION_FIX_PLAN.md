# Connvo Authentication Fix Plan

## Executive Summary

This document outlines the comprehensive plan to fix the WorkOS AuthKit + Convex authentication implementation in the Connvo application. The current setup has several critical issues that prevent proper authentication flow.

---

## Current Issues Identified

### 1. **CRITICAL: Duplicate AuthKitProvider Wrapping**
- **Location**: `src/app/providers.tsx` (line 11) AND `src/providers/ConvexClientProvider.tsx` (line 17)
- **Problem**: Double wrapping of AuthKitProvider causes auth state conflicts and broken context
- **Impact**: Authentication state becomes unreliable, tokens may not be passed correctly

### 2. **Environment Variables Contamination**
- **Location**: `.env.local`
- **Problem**: Contains obsolete Clerk and Supabase credentials mixed with WorkOS
- **Current problematic entries**:
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Impact**: Potential conflicts and confusion about which auth system is active

### 3. **Missing Sign-Up Route**
- **Location**: `src/app/auth/sign-up/route.ts` (doesn't exist)
- **Problem**: Only login route exists, but WorkOS AuthKit requires both sign-in and sign-up routes
- **Impact**: Users cannot register for new accounts

### 4. **Incorrect Middleware Route Matching**
- **Location**: `src/middleware.ts` (line 14)
- **Current**: `matcher: ['/', '/account/:page*']`
- **Problem**: Doesn't protect `/app/*` routes, only protects `/account/*`
- **Impact**: App routes are not properly protected by authentication

### 5. **Convex Environment Variable Not Set**
- **Location**: Convex Dashboard
- **Problem**: `WORKOS_CLIENT_ID` not configured in Convex environment
- **Impact**: Convex backend cannot validate WorkOS JWT tokens

### 6. **Inconsistent Environment Variable Naming**
- **Problem**: `.env` uses correct names, but `.env.local` is inconsistent
- **Missing in .env.local**:
  - `WORKOS_COOKIE_PASSWORD`
  - Proper `NEXT_PUBLIC_CONVEX_URL` (uses wrong deployment)

---

## Architecture Overview

```mermaid
graph TB
    A[User Browser] -->|1. Navigate to /app| B[Next.js Middleware]
    B -->|2. Check Auth| C{Authenticated?}
    C -->|No| D[Redirect to WorkOS Login]
    C -->|Yes| E[Allow Access]
    D -->|3. User Signs In| F[WorkOS AuthKit]
    F -->|4. Callback with Code| G[/auth/callback]
    G -->|5. Exchange Code for Token| H[WorkOS API]
    H -->|6. Return Access Token| I[AuthKit Sets Session]
    I -->|7. Token in Cookie| J[ConvexProviderWithAuth]
    J -->|8. Fetch Token & Send to Convex| K[Convex Backend]
    K -->|9. Validate JWT| L[WorkOS JWKS Endpoint]
    L -->|10. Return Public Key| K
    K -->|11. Auth Success| M[User Authenticated]
    M -->|12. Sync User Data| N[(Convex Database)]
```

---

## Detailed Fix Plan

### Phase 1: Environment Configuration (Critical)

#### Task 1.1: Clean Up .env.local
**Priority**: CRITICAL  
**File**: `.env.local`

**Actions**:
1. Remove all Clerk-related variables
2. Remove all Supabase-related variables  
3. Copy WorkOS variables from `.env`
4. Ensure correct Convex deployment URL

**New .env.local structure**:
```env
# WorkOS AuthKit Configuration
WORKOS_API_KEY='sk_test_a2V5XzAxSzRUR0JYUkFBVFpSTTlGN01CWFhGME43LEZ2NXdwUjZuek0zcVoyUU5ud1E1V2ZKeU8'
WORKOS_CLIENT_ID='client_01K4TGBYAVCDQMC3G5SASM92KW'
WORKOS_COOKIE_PASSWORD='this_is_a_secure_password_for_local_development_only_32_chars_minimum'
WORKOS_REDIRECT_URI='http://localhost:3000/auth/callback'
NEXT_PUBLIC_WORKOS_REDIRECT_URI='http://localhost:3000/auth/callback'

# Convex Configuration
CONVEX_DEPLOYMENT=dev:earnest-ermine-129
NEXT_PUBLIC_CONVEX_URL=https://earnest-ermine-129.convex.cloud

# Site Configuration
NEXT_PUBLIC_SITE_URL="http://localhost:3000"

# Stream API (if needed)
NEXT_PUBLIC_STREAM_API_KEY=qckzqddjtv5s
STREAM_SECRET_KEY=sba4jxp9ssqmq3vehfn5rs58zu697cf7f5agr8myvdur2n9q6awxfutxd4wpqpac
```

#### Task 1.2: Configure Convex Dashboard
**Priority**: CRITICAL  
**Location**: Convex Dashboard → Settings → Environment Variables

**Actions**:
1. Navigate to: https://dashboard.convex.dev
2. Select project: "connvo" (earnest-ermine-129)
3. Go to Settings → Environment Variables
4. Add: `WORKOS_CLIENT_ID` = `client_01K4TGBYAVCDQMC3G5SASM92KW`
5. Save changes
6. Re-deploy: Run `npx convex dev` to sync configuration

---

### Phase 2: Fix Provider Architecture

#### Task 2.1: Remove Duplicate AuthKitProvider
**Priority**: CRITICAL  
**File**: `src/app/providers.tsx`

**Current code** (lines 9-31):
```tsx
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthKitProvider>  {/* ❌ REMOVE THIS */}
    <ConvexClientProvider>
      <ThemeProvider ...>
        ...
      </ThemeProvider>
    </ConvexClientProvider>
    </AuthKitProvider>  {/* ❌ REMOVE THIS */}
  );
}
```

**Fixed code**:
```tsx
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexClientProvider>  {/* ✅ This already has AuthKitProvider inside */}
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
      >
        <div className="bg-background min-h-screen">
          <main>
            {children}
          </main>
        </div>
        <Toaster className="dark:hidden" />
        <Toaster theme="dark" className="hidden dark:block" />
      </ThemeProvider>
    </ConvexClientProvider>
  );
}
```

**Verification**: The provider chain should now be:
```
<ConvexClientProvider>
  └─ <AuthKitProvider>
      └─ <ConvexProviderWithAuth>
          └─ <UpsertUserOnAuth />
          └─ children
```

---

### Phase 3: Add Missing Routes

#### Task 3.1: Create Sign-Up Route
**Priority**: HIGH  
**File**: `src/app/auth/sign-up/route.ts` (NEW FILE)

**Code**:
```typescript
import { getSignUpUrl } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';

export const GET = async () => {
  const signUpUrl = await getSignUpUrl();
  return redirect(signUpUrl);
};
```

**Purpose**: Redirects users to WorkOS sign-up page

---

### Phase 4: Fix Middleware Configuration

#### Task 4.1: Update Middleware Matcher
**Priority**: HIGH  
**File**: `src/middleware.ts`

**Current code** (line 14):
```typescript
export const config = { matcher: ['/', '/account/:page*'] };
```

**Fixed code**:
```typescript
export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
```

**Purpose**: Ensures middleware runs on all routes except static files and Next.js internals

#### Task 4.2: Verify Unauthenticated Paths
**File**: `src/middleware.ts`

**Current configuration** (lines 5-9):
```typescript
export default authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ['/'],  // ✅ Correct - landing page is public
  },
});
```

**Verification**: This is already correct. The landing page `/` is public, all other routes require auth.

---

### Phase 5: Verify Convex Auth Configuration

#### Task 5.1: Review auth.config.ts
**Priority**: MEDIUM  
**File**: `convex/auth.config.ts`

**Current configuration**:
```typescript
const clientId = process.env.WORKOS_CLIENT_ID;

const authConfig = {
  providers: [
    {
      type: "customJwt",
      issuer: `https://api.workos.com/`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
  ],
};

export default authConfig;
```

**Verification**: ✅ Configuration is correct according to WorkOS documentation

---

### Phase 6: Verify User Sync Logic

#### Task 6.1: Review ConvexClientProvider User Sync
**File**: `src/providers/ConvexClientProvider.tsx`

**Current implementation** (lines 55-86):
```typescript
function UpsertUserOnAuth() {
  const { user, loading: authLoading } = useAuth();
  const { accessToken, loading: tokenLoading, error } = useAccessToken();
  const upsertUser = useMutation(api.users.mutations.upsertUser);
  const didRun = useRef(false);

  const ready = useMemo(() => {
    return !!user && !!accessToken && !authLoading && !tokenLoading && !error;
  }, [user, accessToken, authLoading, tokenLoading, error]);

  useEffect(() => {
    if (!ready || didRun.current) return;
    didRun.current = true;
    const displayName = [user?.firstName, user?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    upsertUser({
      workosUserId: String(user?.id),
      email: String(user?.email ?? ""),
      displayName: displayName || undefined,
      orgId: undefined,
      orgRole: undefined,
    }).catch(() => {
      // No-op: guards will surface if user not provisioned later.
    });
  }, [ready, upsertUser, user]);

  return null;
}
```

**Verification**: ✅ Logic is correct - creates/updates user in Convex on auth

---

## Testing Plan

### Test 1: Fresh Login Flow
**Steps**:
1. Clear browser cookies and local storage
2. Navigate to `http://localhost:3000`
3. Click "Start Connecting" or navigate to `/app`
4. Should redirect to `/auth/login`
5. Should redirect to WorkOS login page
6. Enter credentials and sign in
7. Should redirect to `/auth/callback`
8. Should redirect to `/app` (or original destination)
9. Should see authenticated content

**Expected Behavior**:
- User is authenticated
- Access token is stored in cookies
- Convex receives and validates token
- User record created in Convex database

### Test 2: Sign-Up Flow
**Steps**:
1. Navigate to `http://localhost:3000/auth/sign-up`
2. Should redirect to WorkOS sign-up page
3. Complete sign-up process
4. Should redirect to `/auth/callback`
5. Should redirect to `/app`
6. New user should be created in Convex

### Test 3: Protected Route Access
**Steps**:
1. In incognito mode, navigate to `http://localhost:3000/app`
2. Should redirect to login
3. After login, should return to `/app`

### Test 4: Public Route Access
**Steps**:
1. In incognito mode, navigate to `http://localhost:3000`
2. Should see landing page without redirect
3. Should not require authentication

### Test 5: Session Persistence
**Steps**:
1. Log in successfully
2. Close browser tab
3. Reopen and navigate to `/app`
4. Should still be authenticated (no re-login required)

### Test 6: Token Refresh
**Steps**:
1. Log in and stay on page for extended period
2. Token should refresh automatically
3. No interruption to user experience

---

## Implementation Checklist

### Pre-Implementation
- [x] Audit current authentication setup
- [x] Identify all issues and conflicts
- [x] Create comprehensive fix plan
- [ ] Backup current code (create git branch)

### Phase 1: Environment
- [ ] Clean up `.env.local` file
- [ ] Set `WORKOS_CLIENT_ID` in Convex dashboard
- [ ] Run `npx convex dev` to sync configuration
- [ ] Verify environment variables are loaded

### Phase 2: Provider Fix
- [ ] Remove duplicate `AuthKitProvider` from `src/app/providers.tsx`
- [ ] Verify provider chain structure
- [ ] Test that auth context is accessible

### Phase 3: Routes
- [ ] Create `src/app/auth/sign-up/route.ts`
- [ ] Verify login route still works
- [ ] Verify callback route still works

### Phase 4: Middleware
- [ ] Update middleware matcher configuration
- [ ] Verify unauthenticated paths list
- [ ] Test route protection

### Phase 5: Testing
- [ ] Run Test 1: Fresh Login Flow
- [ ] Run Test 2: Sign-Up Flow
- [ ] Run Test 3: Protected Route Access
- [ ] Run Test 4: Public Route Access
- [ ] Run Test 5: Session Persistence
- [ ] Run Test 6: Token Refresh

### Phase 6: Documentation
- [ ] Document final architecture
- [ ] Update README with auth setup instructions
- [ ] Create troubleshooting guide

---

## Rollback Plan

If issues occur during implementation:

1. **Git Revert**: Use git to revert to pre-fix state
2. **Environment Variables**: Restore original `.env.local` from backup
3. **Convex Config**: Remove `WORKOS_CLIENT_ID` from dashboard if causing issues
4. **File Restoration**: Restore modified files from git history

---

## Success Criteria

Authentication will be considered "fixed" when:

1. ✅ Users can sign up via `/auth/sign-up`
2. ✅ Users can log in via `/auth/login`
3. ✅ Landing page `/` is accessible without authentication
4. ✅ All `/app/*` routes require authentication
5. ✅ Tokens are properly passed from WorkOS to Convex
6. ✅ User records are automatically created/updated in Convex
7. ✅ Sessions persist across browser restarts
8. ✅ No console errors related to authentication
9. ✅ No duplicate provider warnings
10. ✅ Authentication state is consistent across the application

---

## Post-Implementation

### Monitoring
- Watch for authentication errors in Convex logs
- Monitor WorkOS dashboard for failed auth attempts
- Check browser console for warnings/errors

### Documentation
- Update project README with authentication setup
- Document WorkOS and Convex configuration steps
- Create troubleshooting guide for common issues

### Optimization
- Consider adding loading states for auth transitions
- Add error boundaries for auth failures
- Implement retry logic for failed token validation

---

## Reference Documentation

- [WorkOS AuthKit Docs](https://workos.com/docs/user-management/overview)
- [Convex Auth Docs](https://docs.convex.dev/auth)
- [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- [WorkOS + Convex Integration Guide](https://docs.convex.dev/auth/advanced/jwt-validation#workos-authkit)

---

## Contact Information

**WorkOS Support**: support@workos.com  
**Convex Support**: support@convex.dev  
**Project Maintainer**: [Your contact info]

---

*Last Updated: 2025-01-30*  
*Version: 1.0*  
*Status: Ready for Implementation*