# Connvo Authentication Testing Guide

This guide will help you test the WorkOS authentication integration with Convex that we've built so far.

## Prerequisites

Before testing, ensure you have:

1. **WorkOS Account Setup**
   - WorkOS account with a configured application
   - Valid `WORKOS_CLIENT_ID` and `WORKOS_API_KEY`
   - AuthKit configured in your WorkOS dashboard

2. **Environment Variables**
   - All required environment variables in `.env`
   - Convex deployment configured

## Step-by-Step Testing Process

### Step 1: Start the Development Environment

```bash
# Terminal 1: Start Convex development server
npm run convex:dev

# Terminal 2: Start Next.js development server
npm run dev
```

**Expected Output:**

- Convex should generate types and connect to your deployment
- Next.js should start on http://localhost:3000
- No compilation errors

### Step 2: Verify Environment Configuration

Check that your `.env` file has all required variables:

```env
# WorkOS Configuration
WORKOS_CLIENT_ID=client_your_actual_id
WORKOS_API_KEY=sk_test_your_actual_key
WORKOS_COOKIE_PASSWORD=your_32_char_minimum_password
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback

# Convex Configuration (auto-generated)
CONVEX_DEPLOY_KEY=your_convex_deploy_key
NEXT_PUBLIC_CONVEX_URL=https://your-convex-url.convex.cloud
```

### Step 3: Test Authentication Flow

1. **Navigate to Test Page**

   ```
   http://localhost:3000/auth-test
   ```

2. **Initial State (Not Authenticated)**
   - Should see "Authentication Status: No"
   - Should see "Sign In" button
   - Convex User Data should show "Please sign in"

3. **Sign In Process**
   - Click "Sign In" button
   - Should redirect to WorkOS AuthKit
   - Complete authentication (create account or sign in)
   - Should redirect back to `/auth-test`

4. **Authenticated State**
   - Should see "Authentication Status: Yes"
   - Should see WorkOS user data populated
   - Should see "Sign Out" button

### Step 4: Test User Synchronization

1. **Automatic Sync**
   - After signing in, user should automatically sync to Convex
   - Check "Convex User Data" section
   - Should show database ID and synced information

2. **Manual Sync Test**
   - Click "Sync User" button
   - Should update user data in Convex
   - Check console for success/error messages

3. **Activity Update Test**
   - Click "Update Activity" button
   - Should update "Last Seen" timestamp
   - Verify timestamp changes

### Step 5: Test Access Control

1. **Role-based Access**
   - Check the "Role-based Access Control Test" section
   - Different messages should appear based on your role
   - Test with different WorkOS roles if available

2. **Organization Access**
   - If you have organization setup in WorkOS
   - Should see organization-specific content
   - Test with users in/out of organizations

### Step 6: Test Convex Functions Directly

You can test Convex functions directly using the dashboard or CLI:

```bash
# Test getting current user (requires authentication)
npx convex run users/queries:getCurrentUser

# Test syncing user (requires authentication)
npx convex run users/mutations:syncUserFromWorkOS

# Test updating activity (requires authentication)
npx convex run users/mutations:updateUserActivity
```

### Step 7: Test Error Scenarios

1. **Unauthenticated Access**
   - Open browser incognito/private mode
   - Navigate to `/auth-test`
   - Should see sign-in prompt
   - Protected content should not be visible

2. **Invalid Tokens**
   - Clear browser cookies/localStorage
   - Refresh page
   - Should prompt for re-authentication

3. **Database Sync Issues**
   - Check Convex dashboard for any errors
   - Verify user creation in database

## Expected Results

### ✅ Successful Authentication Flow

1. **Sign In**
   - Redirects to WorkOS AuthKit
   - Successful authentication
   - Redirects back to application

2. **User Data Display**
   - WorkOS user data shows correctly
   - Convex user data syncs automatically
   - All fields populated as expected

3. **Access Control**
   - Protected content only visible when authenticated
   - Role-based access works correctly
   - Organization access works if configured

4. **Real-time Updates**
   - User activity updates in real-time
   - Database changes reflect immediately
   - No console errors

### ❌ Common Issues and Solutions

#### Issue: "Authentication required" errors

**Solution:**

- Check WorkOS configuration in `convex/auth.config.ts`
- Verify environment variables
- Check WorkOS dashboard configuration

#### Issue: User not syncing to database

**Solution:**

- Check Convex dashboard for errors
- Verify schema is deployed
- Check network requests in browser dev tools

#### Issue: Redirect loops

**Solution:**

- Verify `NEXT_PUBLIC_WORKOS_REDIRECT_URI` matches WorkOS config
- Check for trailing slashes in URLs
- Verify WorkOS application settings

#### Issue: TypeScript errors

**Solution:**

- Run `npm run convex:codegen` to regenerate types
- Check for schema changes
- Restart TypeScript server in IDE

## Debugging Tools

### 1. Browser Developer Tools

- **Network Tab**: Check API requests and responses
- **Console**: Look for JavaScript errors
- **Application Tab**: Check cookies and localStorage

### 2. Convex Dashboard

- **URL**: https://dashboard.convex.dev
- **Functions**: View function execution logs
- **Database**: Browse user data
- **Logs**: Real-time function logs

### 3. WorkOS Dashboard

- **Users**: Check user creation and authentication
- **Events**: View authentication events
- **Logs**: Check for any errors

### 4. Console Commands

```bash
# Check Convex status
npx convex status

# View Convex logs
npx convex logs

# Test specific functions
npx convex run users/queries:getCurrentUser

# Generate fresh types
npm run convex:codegen
```

## Test Checklist

- [ ] Environment variables configured
- [ ] Convex development server running
- [ ] Next.js development server running
- [ ] Can access `/auth-test` page
- [ ] Sign in redirects to WorkOS
- [ ] Authentication completes successfully
- [ ] User data displays correctly
- [ ] User syncs to Convex database
- [ ] Activity updates work
- [ ] Access control works correctly
- [ ] Sign out works
- [ ] No console errors
- [ ] Convex functions work via CLI

## Next Steps After Successful Testing

Once authentication is working correctly, you can:

1. **Continue with Task 2.2**: Implement Authorization Guards and Helpers
2. **Test Meeting Creation**: Create and test meeting functionality
3. **Add More Users**: Test multi-user scenarios
4. **Test Organization Features**: If using WorkOS organizations

## Getting Help

If you encounter issues:

1. Check the console for error messages
2. Review the Convex dashboard logs
3. Verify WorkOS configuration
4. Check environment variables
5. Restart development servers
6. Regenerate Convex types

The authentication system is the foundation for all other features, so it's important to get this working correctly before proceeding to the next tasks.
