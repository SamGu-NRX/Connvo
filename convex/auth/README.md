# Authentication and Authorization System

This directory contains the authentication and authorization infrastructure for the LinkedUp Convex backend, implementing enterprise-grade security with WorkOS integration.

## Overview

The authentication system provides:

- **WorkOS Integration**: Enterprise-grade authentication with JWT validation
- **Role-Based Access Control (RBAC)**: Hierarchical permissions with org-level and resource-level controls
- **Meeting Isolation**: Per-meeting data streams with strict access controls
- **Audit Logging**: Comprehensive security event tracking
- **Type Safety**: Full TypeScript integration with Convex

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   WorkOS JWT    │───▶│  Convex Auth     │───▶│  Guard Functions│
│   Validation    │    │  Context         │    │  & ACL Checks   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Audit Logging   │
                       │  & Monitoring    │
                       └──────────────────┘
```

## Core Components

### 1. Authentication Guards (`guards.ts`)

#### `requireIdentity(ctx: AuthContext): AuthIdentity`

Extracts and validates user identity from Convex auth context.

```typescript
const identity = requireIdentity(ctx);
// Returns: { userId, workosUserId, orgId, orgRole, email, name }
```

#### `assertMeetingAccess(ctx, meetingId, requiredRole?)`

Validates user access to specific meetings with optional role requirements.

```typescript
// Check basic meeting access
await assertMeetingAccess(ctx, meetingId);

// Require host role
await assertMeetingAccess(ctx, meetingId, "host");
```

#### `assertOwnershipOrAdmin(ctx, resourceOwnerId)`

Validates resource ownership or admin access.

```typescript
// Allow access if user owns resource or is org admin
await assertOwnershipOrAdmin(ctx, userId);
```

#### `assertOrgAccess(ctx, requiredOrgRole)`

Validates organization-level permissions.

```typescript
// Require admin role in organization
await assertOrgAccess(ctx, "admin");
```

### 2. Error Management (`../lib/errors.ts`)

Standardized error codes and helper functions:

```typescript
// Predefined error types
ErrorCodes.UNAUTHORIZED;
ErrorCodes.FORBIDDEN;
ErrorCodes.MEETING_NOT_ACTIVE;
ErrorCodes.INSUFFICIENT_PERMISSIONS;

// Helper functions
createError.unauthorized("Custom message");
createError.forbidden("Access denied", { metadata });
createError.meetingNotActive(meetingId);
```

### 3. Type Definitions

#### `AuthIdentity`

```typescript
interface AuthIdentity {
  userId: string; // Primary user identifier
  workosUserId: string; // WorkOS user ID
  orgId: string | null; // Organization ID
  orgRole: string | null; // Organization role (admin, member)
  email: string | null; // User email
  name?: string | null; // Display name
}
```

## Usage Patterns

### Basic Query with Authentication

```typescript
export const getProtectedData = query({
  args: { resourceId: v.id("resources") },
  returns: v.any(),
  handler: async (ctx, { resourceId }) => {
    // Require authentication
    const identity = requireIdentity(ctx);

    // Your query logic here
    return await ctx.db.get(resourceId);
  },
});
```

### Meeting-Specific Access Control

```typescript
export const getMeetingNotes = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, { meetingId }) => {
    // Verify user is meeting participant
    await assertMeetingAccess(ctx, meetingId);

    // Return meeting-specific data
    return await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();
  },
});
```

### Host-Only Operations

```typescript
export const startMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    // Require host role
    await assertMeetingAccess(ctx, meetingId, "host");

    // Perform host-only operation
    await ctx.db.patch(meetingId, { state: "active" });
  },
});
```

### Admin Operations

```typescript
export const getOrgAnalytics = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    // Require org admin role
    const identity = await assertOrgAccess(ctx, "admin");

    // Return org-wide data
    return await getAnalyticsForOrg(identity.orgId);
  },
});
```

## Security Features

### 1. Per-Meeting Isolation

- All meeting data (notes, transcripts, prompts) is isolated by meeting participation
- Real-time subscriptions validate permissions on connection and updates
- Dynamic permission revocation when participants leave

### 2. Role Hierarchy

```
Organization Level:
- admin: Full org access + resource ownership override
- member: Basic org membership

Meeting Level:
- host: Full meeting control (start, end, invite, manage)
- participant: Meeting participation (view, contribute)
```

### 3. Audit Logging

All security events are logged with:

- Actor (user performing action)
- Resource (what was accessed)
- Action (what was attempted)
- Metadata (additional context)
- Timestamp

### 4. Rate Limiting

Built-in protection against abuse:

- Per-user action limits
- Sliding window implementation
- Configurable thresholds

## Error Handling

The system provides comprehensive error handling with:

### Standard Error Codes

- `UNAUTHORIZED`: Authentication required
- `FORBIDDEN`: Access denied
- `INSUFFICIENT_PERMISSIONS`: Role requirements not met
- `MEETING_NOT_ACTIVE`: Meeting state validation failed

### Error Metadata

Errors include contextual information for debugging:

```typescript
{
  code: "FORBIDDEN",
  message: "Access denied: Not a meeting participant",
  metadata: {
    meetingId: "meeting123",
    userId: "user456",
    requiredRole: "participant"
  }
}
```

## Performance Considerations

### 1. Efficient Queries

- Uses compound indexes for fast permission lookups
- Minimizes database queries through smart caching
- Batches permission checks where possible

### 2. Audit Log Optimization

- Asynchronous logging to avoid blocking operations
- Batched writes for high-frequency events
- Configurable retention policies

### 3. Caching Strategy

- Leverages Convex's built-in reactive caching
- Avoids redundant permission checks
- Invalidates cache on permission changes

## Testing

Comprehensive test suite covers:

- Authentication success/failure scenarios
- Authorization edge cases
- Role-based access control
- Audit logging verification
- Performance under load
- Concurrent access patterns

Run tests with:

```bash
npm run test convex/auth/guards.test.ts
```

## Migration from Clerk

The system replaces Clerk authentication with WorkOS:

### Key Changes

1. **JWT Structure**: WorkOS JWTs contain org context
2. **User IDs**: WorkOS user IDs replace Clerk IDs
3. **Organization Support**: Native org roles and permissions
4. **Enterprise Features**: Enhanced audit logging and compliance

### Migration Steps

1. Update auth configuration (`convex/auth.config.ts`)
2. Replace Clerk providers with WorkOS (`ConvexClientProvider`)
3. Update user creation/lookup logic
4. Migrate existing user records with WorkOS IDs

## Compliance

This implementation satisfies:

- **Requirements 2.3, 2.4, 2.6**: Authentication and authorization
- **steering/convex_rules.mdc**: Convex best practices
- **Enterprise Security**: Audit logging and access controls
- **GDPR/SOC2**: Data access tracking and retention policies

## Future Enhancements

Planned improvements:

- Multi-factor authentication support
- Advanced role definitions (custom roles)
- Integration with external identity providers
- Enhanced audit analytics and reporting
- Automated security monitoring and alerting
