# Dynamic Permission Management System

This document describes the real-time permission management system that handles WebSocket subscription validation, dynamic permission updates, and comprehensive audit logging.

## Overview

The dynamic permission management system provides:

- **Real-time Permission Validation**: Validates permissions on WebSocket subscription initialization
- **Dynamic Permission Updates**: Updates permissions when roles change or participants are removed
- **Subscription Management**: Tracks and manages active real-time subscriptions
- **Comprehensive Audit Logging**: Logs all permission events for security and compliance
- **Automatic Cleanup**: Terminates unauthorized streams when permissions are revoked

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client        │───▶│  Subscription    │───▶│  Permission     │
│   Subscription  │    │  Validation      │    │  Validation     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │  Audit Logging   │    │  Dynamic        │
                       │  System          │    │  Updates        │
                       └──────────────────┘    └─────────────────┘
```

## Core Components

### 1. Permission Validation (`auth/permissions.ts`)

#### `validateSubscriptionPermissions`

Validates permissions for WebSocket subscription initialization.

```typescript
const validation = await ctx.runQuery(
  api.auth.permissions.validateSubscriptionPermissions,
  {
    resourceType: "meetingNotes",
    resourceId: meetingId,
    requiredPermissions: ["read", "write"],
  },
);
```

#### `refreshSubscriptionPermissions`

Validates multiple subscriptions for continued access.

#### `revokeSubscriptionPermissions`

Revokes permissions and terminates unauthorized streams.

### 2. Real-Time Subscriptions (`realtime/subscriptions.ts`)

#### Meeting-Specific Subscriptions

- `subscribeMeetingNotes`: Real-time collaborative notes
- `subscribeTranscriptStream`: Live transcription with time bounds
- `subscribeMeetingParticipants`: Participant presence and roles

#### Subscription Validation

- `validateSubscription`: Real-time permission checking
- `terminateSubscription`: Cleanup for revoked access

### 3. Audit Logging (`audit/logging.ts`)

#### Comprehensive Event Tracking

- Authentication events (login, logout, token refresh)
- Authorization events (access granted/denied, role changes)
- Data access events (read, write, delete operations)
- Security events (suspicious activity, rate limits)

#### Audit Query and Export

- `getAuditLogs`: Filtered audit log retrieval
- `getAuditLogStats`: Statistical analysis
- `exportAuditLogs`: Compliance reporting

## Permission Model

### Resource Types

- `meeting`: Meeting metadata and lifecycle
- `meetingNotes`: Collaborative notes content
- `transcripts`: Live transcription data
- `prompts`: AI-generated conversation prompts
- `messages`: Meeting chat messages
- `participants`: Participant list and presence

### Role-Based Permissions

#### Host Permissions

```typescript
const hostPermissions = [
  "read",
  "write",
  "manage",
  "start_meeting",
  "end_meeting",
  "invite_participants",
  "manage_recording",
  "access_transcripts",
  "access_notes",
  "access_prompts",
  "access_messages",
  "access_participants",
];
```

#### Participant Permissions

```typescript
const participantPermissions = [
  "read",
  "write",
  "access_transcripts",
  "access_notes",
  "access_prompts",
  "access_messages",
  "access_participants",
];
```

## Dynamic Updates

### Permission Revocation Triggers

1. **Participant Removal**: All permissions revoked immediately
2. **Role Demotion**: Elevated permissions removed
3. **Meeting End**: Time-sensitive permissions (transcripts) revoked
4. **Participant Leave**: Active subscriptions terminated

### Real-Time Updates

```typescript
// When participant is removed
await ctx.runMutation(internal.auth.permissions.handleParticipantRemoval, {
  meetingId,
  userId,
  removedBy: currentUserId,
});

// When role changes
await ctx.runMutation(internal.auth.permissions.updateParticipantPermissions, {
  meetingId,
  userId,
  oldRole: "participant",
  newRole: "host",
});
```

## Audit Logging

### Event Categories

- `AUTHENTICATION`: Login/logout events
- `AUTHORIZATION`: Permission grants/denials
- `DATA_ACCESS`: Resource access events
- `DATA_MODIFICATION`: Create/update/delete operations
- `MEETING_LIFECYCLE`: Meeting state changes
- `SECURITY_EVENT`: Security alerts and violations

### Severity Levels

- `LOW`: Normal operations
- `MEDIUM`: Notable events requiring attention
- `HIGH`: Security-relevant events
- `CRITICAL`: Immediate investigation required

### Audit Log Structure

```typescript
interface AuditLogEntry {
  actorUserId?: Id<"users">;
  resourceType: string;
  resourceId: string;
  action: string;
  category: string;
  severity: string;
  metadata: {
    permissions?: string[];
    oldRole?: string;
    newRole?: string;
    subscriptionId?: string;
    // ... additional context
  };
  timestamp: number;
  success: boolean;
}
```

## Usage Examples

### Establishing Secure Subscriptions

```typescript
// Client establishes subscription
const subscription = await convex.query(
  api.realtime.subscriptions.subscribeMeetingNotes,
  {
    meetingId: "meeting123",
    subscriptionId: "notes_sub_1",
  },
);

if (subscription?.subscriptionValid) {
  // Subscription established successfully
  console.log("Permissions:", subscription.permissions);
} else {
  // Handle permission denial
}
```

### Periodic Permission Validation

```typescript
// Client validates subscriptions periodically
const validations = await convex.query(
  api.realtime.subscriptions.refreshSubscriptionPermissions,
  {
    subscriptions: [
      {
        resourceType: "meetingNotes",
        resourceId: meetingId,
        permissions: ["read", "write"],
        lastValidated: lastCheckTime,
      },
    ],
  },
);

validations.forEach((validation) => {
  if (!validation.valid) {
    // Terminate subscription
    console.log("Subscription invalid:", validation.reason);
  }
});
```

### Administrative Audit Review

```typescript
// Admin reviews security events
const auditLogs = await convex.query(api.audit.logging.getAuditLogs, {
  category: "SECURITY_EVENT",
  severity: "HIGH",
  startTime: Date.now() - 24 * 60 * 60 * 1000, // Last 24 hours
  limit: 100,
});

auditLogs.logs.forEach((log) => {
  console.log(`Security event: ${log.action} by ${log.actorUserId}`);
});
```

## Performance Considerations

### Efficient Permission Checking

- Uses compound database indexes for fast lookups
- Caches permission results where appropriate
- Batches multiple permission checks

### Scalable Audit Logging

- Asynchronous logging to avoid blocking operations
- Time-based partitioning for large audit datasets
- Configurable retention policies

### Real-Time Optimization

- Minimal permission validation overhead (< 5ms target)
- Efficient WebSocket subscription management
- Graceful degradation under high load

## Security Features

### Comprehensive Coverage

- All subscription attempts logged
- Failed permission checks audited
- Role changes tracked with full context
- Suspicious activity detection

### Compliance Support

- Audit log export for compliance reporting
- Retention policy enforcement
- Data access tracking for GDPR/SOC2

### Threat Detection

- Rate limiting integration
- Anomaly detection hooks
- Real-time security alerting

## Testing

The system includes comprehensive tests covering:

- Permission validation scenarios
- Dynamic permission updates
- Audit logging verification
- Performance under load
- Edge cases and error handling

Run tests with:

```bash
npm run test convex/auth/permissions.test.ts
```

## Future Enhancements

Planned improvements:

- Machine learning-based anomaly detection
- Advanced permission caching strategies
- Real-time security dashboards
- Integration with external SIEM systems
- Automated incident response workflows
