# Connvo Convex Backend

This directory contains the Convex backend implementation for Connvo, providing real-time, reactive database functionality with TypeScript-first development.

## Module Structure

The Convex backend is organized by domain:

```
convex/
├── schema.ts                 # Database schema definition
├── auth.config.ts           # WorkOS authentication configuration
├── auth/                    # Authentication and authorization
│   └── guards.ts           # Auth helpers and ACL functions
├── users/                   # User management
│   ├── queries.ts          # User read operations
│   └── mutations.ts        # User write operations
├── profiles/               # User profile management
├── meetings/               # Meeting lifecycle and management
│   ├── lifecycle.ts        # Create, start, end meetings
│   └── queries.ts          # Meeting read operations
├── participants/           # Meeting participant management
├── notes/                  # Collaborative notes with OT
├── transcripts/            # Live transcription system
├── prompts/                # AI prompt generation
├── insights/               # Post-call insights
├── matching/               # Intelligent matching system
├── embeddings/             # Vector embeddings and similarity
├── messaging/              # Real-time chat messages
├── analytics/              # Analytics and metrics
├── lib/                    # Shared utilities
│   ├── errors.ts           # Error handling
│   ├── observability.ts    # Tracing and metrics
│   └── idempotency.ts      # Idempotency helpers
└── internal/               # Internal functions (not client-accessible)
```

## Key Design Principles

1. **Reactive-First**: All queries are reactive and update clients in real-time
2. **TypeScript Strict**: End-to-end type safety with strict validation
3. **Least Privilege**: Resource-based ACLs with per-meeting isolation
4. **Performance Optimized**: Time-sharded writes, compound indexes, denormalized data
5. **Observability Native**: Built-in tracing, metrics, and audit logging

## Authentication

Uses WorkOS Auth Kit for enterprise-grade authentication:

- JWT-based authentication with Convex integration
- Organization-level access control
- Role-based permissions (host, participant, observer)
- Dynamic permission updates for real-time streams

## Database Schema

### Core Collections

- **users**: WorkOS identity, profile basics, activity tracking
- **profiles**: Extended professional details, skills, preferences
- **meetings**: Meeting metadata, lifecycle, Stream integration
- **meetingParticipants**: Role-based membership with presence tracking
- **meetingState**: Real-time meeting status and statistics

### Real-Time Features

- **meetingNotes**: Materialized collaborative notes
- **noteOps**: Append-only operational transform log
- **transcripts**: Time-sharded transcription chunks (5-min buckets)
- **messages**: Real-time chat with threading support

### AI & Intelligence

- **prompts**: Pre-call and in-call conversation starters
- **insights**: Post-call summaries and recommendations
- **embeddings**: Vector representations for similarity matching
- **matchingQueue**: Real-time matching with constraints

### System Collections

- **auditLogs**: Security and access audit trail
- **rateLimits**: Durable rate limiting counters
- **featureFlags**: Reactive feature toggles
- **idempotencyKeys**: Exactly-once operation guarantees

## Performance Features

### Scalability Optimizations

- **Time-based Sharding**: Prevents hot partitions for high-frequency writes
- **Compound Indexes**: Optimized for common query patterns
- **Denormalized Counters**: Fast aggregations without N+1 queries
- **Bounded Queries**: All list operations paginated or time-windowed

### Real-Time Optimizations

- **Batching & Coalescing**: Configurable windows for high-frequency updates
- **Per-Meeting Isolation**: Strict access control with dynamic permissions
- **Cursor-based Pagination**: Resumable subscriptions after reconnect
- **Circuit Breakers**: Backpressure handling for overloaded clients

## Development

### Local Setup

```bash
# Install dependencies
npm install

# Start Convex development server
npm run convex:dev

# Generate TypeScript types
npm run convex:codegen

# Run type checking
npm run type-check
```

### Environment Variables

Required environment variables:

```env
# WorkOS Authentication
WORKOS_CLIENT_ID=client_your_client_id_here
WORKOS_API_KEY=sk_test_your_api_key_here
WORKOS_COOKIE_PASSWORD=your_secure_password_here_must_be_at_least_32_characters_long
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback

# Convex Configuration
CONVEX_DEPLOY_KEY=your_convex_deploy_key_here
NEXT_PUBLIC_CONVEX_URL=https://your-convex-url.convex.cloud

# Stream API (for video calls)
STREAM_API_KEY=your_stream_api_key
STREAM_SECRET=your_stream_secret

# AI Providers (optional, for advanced features)
OPENAI_API_KEY=your_openai_key
```

### Deployment

```bash
# Deploy to production
npm run convex:deploy

# Deploy with environment
npx convex deploy --cmd-url-env-var-name CONVEX_URL
```

## Function Patterns

### Query Example

```typescript
import { query } from "@convex/_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess } from "@convex/auth/guards";

export const getMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.union(v.object({...}), v.null()),
  handler: async (ctx, args) => {
    await assertMeetingAccess(ctx, args.meetingId);
    return await ctx.db.get(args.meetingId);
  },
});
```

### Mutation Example

```typescript
import { mutation } from "@convex/_generated/server";
import { v } from "convex/values";
import { requireIdentity } from "@convex/auth/guards";

export const createMeeting = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.id("meetings"),
  handler: async (ctx, args) => {
    const { userId } = requireIdentity(ctx);
    // Implementation...
  },
});
```

### Action Example (for external APIs)

```typescript
import { action } from "@convex/_generated/server";
import { v } from "convex/values";

export const generateInsights = action({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Call external AI service
    // Update database via mutations
  },
});
```

## Security

### Access Control

- All functions validate authentication via `requireIdentity()`
- Meeting-level isolation via `assertMeetingAccess()`
- Role-based permissions (host, participant, observer)
- Audit logging for all sensitive operations

### Data Protection

- PII classification and retention policies
- User-initiated data deletion support
- Webhook signature verification
- Rate limiting and input validation

## Testing

### Unit Tests

```bash
# Run function tests
npm test

# Test with different auth contexts
npm run test:auth
```

### Integration Tests

- Multi-user collaboration scenarios
- Real-time subscription testing
- Webhook handling validation
- Performance and load testing

## Monitoring

### Observability

- Function-level latency tracking
- WebSocket subscription metrics
- Error rate monitoring with context
- Audit log analysis and alerting

### Performance SLOs

- Query p95 < 120ms
- WebSocket delivery p95 < 150ms
- Support 1000+ concurrent meetings
- 10+ transcription updates/sec/meeting

## Migration

This backend replaces the previous Drizzle + Supabase setup with:

1. **Enhanced Real-time**: WebSocket-based reactive queries
2. **Better Performance**: Optimized indexes and denormalization
3. **Stronger Security**: WorkOS enterprise auth + fine-grained ACLs
4. **AI-Ready**: Built-in vector embeddings and external API integration
5. **Scalable Architecture**: Time-sharding and batching for high-frequency data

## Support

For questions or issues:

1. Check the [Convex documentation](https://docs.convex.dev)
2. Review the steering rules in `.kiro/steering/convex_rules.mdc`
3. Use the Context7 MCP tool for up-to-date guidance
