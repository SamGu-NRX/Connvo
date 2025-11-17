# WorkOS AuthKit Configuration Guide

## Overview

This document explains the correct configuration for WorkOS AuthKit in the Connvo application, specifically focusing on avoiding the "Provider parameter not allowed for hosted AuthKit" error.

## Table of Contents

- [Understanding Hosted AuthKit](#understanding-hosted-authkit)
- [Common Error: Provider Parameter](#common-error-provider-parameter)
- [Correct Implementation](#correct-implementation)
- [Environment Configuration](#environment-configuration)
- [Testing Your Setup](#testing-your-setup)
- [Troubleshooting](#troubleshooting)
- [Advanced Configuration](#advanced-configuration)

## Understanding Hosted AuthKit

WorkOS AuthKit provides two authentication approaches:

### 1. Hosted AuthKit (Recommended) ✅

The hosted approach displays a WorkOS-managed sign-in page where users can:
- Choose their authentication method (email, Google, Microsoft, etc.)
- See all available authentication options
- Benefit from WorkOS security updates automatically
- Experience consistent branding across authentication flows

**URL Pattern:** 
```
https://auth.workos.com/authorize?client_id=...&response_type=code&...
```

**Key Characteristic:** NO `provider` or `connection` parameter in URL

### 2. Direct Provider Auth (Not Recommended for Most Cases) ❌

Direct provider auth skips the hosted page and goes straight to a specific provider:

**URL Pattern:**
```
https://auth.workos.com/authorize?client_id=...&provider=GoogleOAuth&...
```

**When to Use:** Only for very specific use cases where you want to bypass the hosted page

## Common Error: Provider Parameter

### Error Message
```
Provider parameter not allowed for hosted AuthKit
```

### Root Cause
This error occurs when your authentication URL includes a `provider` or `connection` parameter while trying to use the hosted AuthKit page.

### How It Happens
1. Passing options to `getSignInUrl()` or `getSignUpUrl()` that include provider information
2. Environment variables inadvertently adding provider parameters
3. Misconfigured WorkOS settings in the dashboard

## Correct Implementation

### Sign-In Route

**File:** `src/app/auth/sign-in/route.ts`

```typescript
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

export const GET = async () => {
  // ✅ CORRECT: Call without provider parameter
  const signInUrl = await getSignInUrl();
  return redirect(signInUrl);
};
```

**What NOT to do:**

```typescript
// ❌ WRONG: Including provider parameter
const signInUrl = await getSignInUrl({
  provider: "GoogleOAuth"  // This causes the error!
});

// ❌ WRONG: Including connection parameter
const signInUrl = await getSignInUrl({
  connection: "conn_123"  // This also causes the error!
});
```

### Sign-Up Route

**File:** `src/app/auth/sign-up/route.ts`

```typescript
import { getSignUpUrl } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';

export const GET = async () => {
  // ✅ CORRECT: Call without provider parameter
  const signUpUrl = await getSignUpUrl();
  return redirect(signUpUrl);
};
```

### Callback Handler

**File:** `src/app/auth/callback/route.ts`

```typescript
import { handleAuth } from '@workos-inc/authkit-nextjs';

// ✅ CORRECT: Default configuration works for hosted AuthKit
export const GET = handleAuth();

// ✅ ALSO CORRECT: Custom redirect after authentication
export const GET = handleAuth({
  returnPathname: '/dashboard'  // Redirect to dashboard after login
});
```

## Environment Configuration

### Required Environment Variables

**File:** `.env` or `.env.local`

```bash
# ✅ REQUIRED: WorkOS credentials
WORKOS_API_KEY=sk_test_your_api_key_here
WORKOS_CLIENT_ID=client_your_client_id_here
WORKOS_COOKIE_PASSWORD=your_32_character_password_here

# ✅ OPTIONAL: Custom redirect URI
WORKOS_REDIRECT_URI=https://yourdomain.com/auth/callback
```

### Variables to AVOID

```bash
# ❌ DO NOT SET these for hosted AuthKit
WORKOS_CONNECTION_ID=conn_123          # Causes provider parameter error
WORKOS_DEFAULT_PROVIDER=GoogleOAuth    # Causes provider parameter error
```

### Environment Checklist

- [ ] `WORKOS_API_KEY` is set (starts with `sk_test_` or `sk_live_`)
- [ ] `WORKOS_CLIENT_ID` is set (starts with `client_`)
- [ ] `WORKOS_COOKIE_PASSWORD` is at least 32 characters
- [ ] No `WORKOS_CONNECTION_ID` variable exists
- [ ] No `WORKOS_DEFAULT_PROVIDER` variable exists

## Testing Your Setup

### Manual Testing Checklist

1. **Sign-In Flow**
   ```bash
   # Start your development server
   npm run dev
   ```
   
   - [ ] Navigate to your app
   - [ ] Click "Sign In" button
   - [ ] Verify you're redirected to WorkOS hosted page (not Google/Microsoft directly)
   - [ ] Check URL in browser: should NOT contain `provider=` or `connection=`
   - [ ] Sign in with any available method
   - [ ] Verify successful redirect back to app

2. **Sign-Up Flow**
   - [ ] Click "Sign Up" button
   - [ ] Verify you're redirected to WorkOS hosted page
   - [ ] Check URL: should NOT contain `provider=` or `connection=`
   - [ ] Complete sign-up process
   - [ ] Verify successful account creation and redirect

3. **Browser DevTools Check**
   - [ ] Open Network tab in browser DevTools
   - [ ] Click sign in/sign up
   - [ ] Find the redirect request
   - [ ] Verify the authorize URL does NOT include `provider` parameter

### Automated Testing

Create a test file: `test/auth/sign-in.test.ts`

```typescript
import { getSignInUrl, getSignUpUrl } from "@workos-inc/authkit-nextjs";

describe("AuthKit Configuration", () => {
  it("should not include provider parameter in sign-in URL", async () => {
    const signInUrl = await getSignInUrl();
    const url = new URL(signInUrl);
    
    expect(url.searchParams.has("provider")).toBe(false);
    expect(url.searchParams.has("connection")).toBe(false);
  });

  it("should not include provider parameter in sign-up URL", async () => {
    const signUpUrl = await getSignUpUrl();
    const url = new URL(signUpUrl);
    
    expect(url.searchParams.has("provider")).toBe(false);
    expect(url.searchParams.has("connection")).toBe(false);
  });

  it("should include required OAuth parameters", async () => {
    const signInUrl = await getSignInUrl();
    const url = new URL(signInUrl);
    
    expect(url.searchParams.has("client_id")).toBe(true);
    expect(url.searchParams.has("response_type")).toBe(true);
    expect(url.searchParams.has("redirect_uri")).toBe(true);
  });
});
```

## Troubleshooting

### Problem: Still getting provider parameter error

**Solutions:**

1. **Check Environment Variables**
   ```bash
   # Run this in your terminal
   printenv | grep WORKOS
   ```
   Ensure no `CONNECTION_ID` or `DEFAULT_PROVIDER` variables exist

2. **Clear Next.js Cache**
   ```bash
   rm -rf .next
   npm run dev
   ```

3. **Check WorkOS Dashboard**
   - Log into WorkOS Dashboard
   - Go to Authentication settings
   - Ensure "Hosted AuthKit" is enabled
   - Check that no default provider is configured

4. **Verify Package Version**
   ```bash
   npm list @workos-inc/authkit-nextjs
   ```
   Should be `^2.10.0` or higher

### Problem: Users not redirected after authentication

**Solutions:**

1. **Check Callback Configuration**
   Verify `handleAuth()` is properly configured in `/auth/callback/route.ts`

2. **Verify Redirect URI**
   In WorkOS Dashboard → Redirect URIs, ensure:
   ```
   https://yourdomain.com/auth/callback
   http://localhost:3000/auth/callback  (for development)
   ```

3. **Check Cookie Configuration**
   Ensure `WORKOS_COOKIE_PASSWORD` is set and at least 32 characters

### Problem: TypeScript errors in auth routes

**Solutions:**

1. **Import Type Definitions**
   ```typescript
   import type { WorkOSAuthUrlOptions } from "@/types/auth";
   ```

2. **Use Correct Types**
   ```typescript
   // ✅ CORRECT
   const signInUrl = await getSignInUrl();
   
   // ✅ ALSO CORRECT with options
   const signInUrl = await getSignInUrl({
     loginHint: "user@example.com"
   });
   ```

## Advanced Configuration

### Custom Redirect After Authentication

```typescript
// src/app/auth/callback/route.ts
import { handleAuth } from '@workos-inc/authkit-nextjs';

export const GET = handleAuth({
  returnPathname: '/onboarding'  // Custom redirect
});
```

### Conditional Redirects

```typescript
// Advanced: Redirect based on user state
import { handleAuth } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';

export const GET = async (request: Request) => {
  const response = await handleAuth()(request);
  
  // Add custom logic here if needed
  // Note: This is an advanced pattern, use with caution
  
  return response;
};
```

### Pre-fill Email Address

```typescript
// src/app/auth/sign-in/route.ts
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

export const GET = async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  
  const signInUrl = await getSignInUrl({
    loginHint: email || undefined  // Pre-fill email if provided
  });
  
  return redirect(signInUrl);
};
```

### Organization-Specific Sign-In

```typescript
// For multi-tenant applications
const signInUrl = await getSignInUrl({
  organizationId: "org_123456"  // Users must sign in to this org
});
```

## Best Practices

1. **Always Use Hosted AuthKit** unless you have a specific reason not to
2. **Never hardcode provider** in your authentication URLs
3. **Document any custom configuration** in your codebase
4. **Test authentication flows** after any WorkOS package updates
5. **Monitor authentication errors** in production
6. **Keep WorkOS packages updated** for security and features

## Security Considerations

1. **Cookie Security**
   - Use a strong `WORKOS_COOKIE_PASSWORD` (32+ characters)
   - Never commit `.env` files to version control
   - Rotate credentials periodically

2. **HTTPS in Production**
   - Always use HTTPS in production
   - Configure proper redirect URIs
   - Enable secure cookies

3. **Error Handling**
   - Don't expose sensitive error details to users
   - Log authentication errors securely
   - Monitor for unusual authentication patterns

## References

- [WorkOS Authentication Docs](https://workos.com/docs/user-management/authenticate-users)
- [WorkOS Next.js Quickstart](https://workos.com/docs/user-management/nextjs)
- [AuthKit Configuration](https://workos.com/docs/user-management/authkit)
- [WorkOS Dashboard](https://dashboard.workos.com)

## Support

If you encounter issues not covered in this guide:

1. Check [WorkOS Documentation](https://workos.com/docs)
2. Review [WorkOS Examples](https://github.com/workos/authkit-nextjs)
3. Contact [WorkOS Support](https://workos.com/support)
4. Check our internal `#engineering` Slack channel

---

**Last Updated:** 2025-11-05  
**Maintained By:** Engineering Team  
**Related Files:**
- [`src/app/auth/sign-in/route.ts`](../src/app/auth/sign-in/route.ts)
- [`src/app/auth/sign-up/route.ts`](../src/app/auth/sign-up/route.ts)
- [`src/app/auth/callback/route.ts`](../src/app/auth/callback/route.ts)
- [`src/types/auth.ts`](../src/types/auth.ts)