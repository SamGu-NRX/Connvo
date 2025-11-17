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

## Documentation Standards

### Docstring Format

All public Convex functions (queries, mutations, actions) must include comprehensive JSDoc-style docstrings with the following structure:

````typescript
/**
 * @summary [Brief verb phrase describing the operation]
 * @description [Detailed explanation of behavior, parameters, side effects, and authorization]
 *
 * @example request
 * ```json
 * { "args": { [realistic input matching validator] } }
 * ```
 *
 * @example response
 * ```json
 * { "status": "success", "value": { [realistic output matching return type] } }
 * ```
 *
 * @example response-error
 * ```json
 * { "status": "error", "errorData": { "code": "[ERROR_CODE]", "message": "..." } }
 * ```
 */
````

### Required Tags

- **@summary**: Brief verb phrase (< 100 chars) starting with a verb (Gets, Creates, Updates, etc.)
- **@description**: Detailed explanation (> 50 chars) covering:
  - What the function does
  - Authorization requirements
  - Side effects and state changes
  - Performance considerations
  - Error conditions
- **@example request**: Valid JSON showing realistic input arguments
- **@example response**: Valid JSON showing successful return value
- **@example response-error** (optional): Valid JSON showing error scenarios

### Docstring Templates

#### Query Template

````typescript
/**
 * @summary Gets [resource] by [criteria]
 * @description Retrieves [resource] data with [filtering/authorization details].
 * Requires authentication and validates [access control]. Returns null if [not found condition].
 * Uses indexed query on [index name] for optimal performance.
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "resourceId": "resource_abc123"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "_id": "resource_abc123",
 *     "_creationTime": 1699564800000,
 *     "field1": "value1",
 *     "field2": "value2"
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "UNAUTHORIZED",
 *     "message": "User does not have access to this resource"
 *   }
 * }
 * ```
 */
export const getResource = query({
  args: { resourceId: v.id("resources") },
  returns: v.union(ResourceV.full, v.null()),
  handler: async (ctx, args) => {
    // Implementation
  },
});
````

#### Mutation Template

````typescript
/**
 * @summary Creates/Updates/Deletes [resource]
 * @description [Action description] with [validation details]. Validates [input constraints]
 * and enforces [authorization rules]. [Side effects description]. Idempotent if [condition].
 * Throws ConvexError if [error conditions].
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "field1": "value1",
 *     "field2": "value2"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "resourceId": "resource_xyz789",
 *     "success": true,
 *     "created": true
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Field1 must be at least 3 characters"
 *   }
 * }
 * ```
 */
export const createResource = mutation({
  args: { field1: v.string(), field2: v.string() },
  returns: v.object({ resourceId: v.id("resources"), success: v.boolean() }),
  handler: async (ctx, args) => {
    // Implementation
  },
});
````

#### Action Template

````typescript
/**
 * @summary Generates/Processes [external operation]
 * @description Calls [external service] to [operation description]. Handles [retry/caching behavior].
 * Requires [API keys/configuration]. Returns [result description] with [processing metrics].
 * Caches results for [duration] to reduce API costs. Throws ConvexError if [external service errors].
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "inputData": "content to process",
 *     "options": {
 *       "model": "model-name",
 *       "temperature": 0.7
 *     }
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "resultId": "result_xyz789",
 *     "data": { "processed": "output" },
 *     "processingTime": 342,
 *     "fromCache": false,
 *     "success": true
 *   }
 * }
 * ```
 *
 * @example response-cache
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "resultId": "result_xyz789",
 *     "data": { "processed": "output" },
 *     "processingTime": 12,
 *     "fromCache": true,
 *     "success": true
 *   }
 * }
 * ```
 *
 * @example response-error
 * ```json
 * {
 *   "status": "error",
 *   "errorData": {
 *     "code": "EXTERNAL_SERVICE_ERROR",
 *     "message": "API key not configured",
 *     "value": {
 *       "resultId": "",
 *       "data": {},
 *       "processingTime": 8,
 *       "fromCache": false,
 *       "success": false,
 *       "error": "API key not configured"
 *     }
 *   }
 * }
 * ```
 */
export const processWithExternalService = action({
  args: { inputData: v.string(), options: v.optional(v.object({ ... })) },
  returns: v.object({ resultId: v.string(), data: v.any(), success: v.boolean() }),
  handler: async (ctx, args) => {
    // Implementation
  },
});
````

### Example Best Practices

1. **Use Realistic Data**: Examples should use realistic IDs, timestamps, and values that match actual system behavior
2. **Deterministic Values**: Use stable IDs and timestamps for test reproducibility (e.g., `user_abc123`, `1699564800000`)
3. **Complete Objects**: Show full object structures, not abbreviated versions
4. **Valid JSON**: All examples must be valid JSON wrapped in fenced code blocks
5. **Error Scenarios**: Include common error cases (unauthorized, not found, validation failures)
6. **Cache Indicators**: For actions, show both fresh and cached responses when applicable

### Validation

Validate your docstrings before committing:

```bash
# Validate all docstrings
pnpm tsx scripts/validate-docstrings.ts

# Validate specific file
pnpm tsx scripts/validate-docstrings.ts --file=convex/users/queries.ts

# Run in CI
pnpm run validate:docstrings
```

### Common Validation Errors

**Invalid JSON in Examples**

```
❌ Example "request" contains invalid JSON
```

Fix: Ensure examples are wrapped in fenced code blocks with valid JSON syntax

**Missing Required Tags**

```
⚠️  Public function missing @summary tag
```

Fix: Add `@summary` tag with a brief verb phrase

**Summary Too Long**

```
⚠️  Summary is too long (127 chars). Keep it under 100 characters.
```

Fix: Shorten summary to focus on the core action

**Summary Doesn't Start with Verb**

```
⚠️  Summary should start with a verb (e.g., "Gets", "Creates", "Updates")
```

Fix: Start summary with an action verb

**Description Too Brief**

```
⚠️  Description is too brief (32 chars). Provide more detail.
```

Fix: Expand description to cover behavior, authorization, and side effects

**Duplicate Summaries**

```
⚠️  Duplicate summary: "gets user by id" (also used in convex/profiles/queries.ts:getUserById)
```

Fix: Make summaries more specific to differentiate similar functions

### Test Validation Pattern

All docstring examples should be validated by tests:

```typescript
// convex/test/[domain]Examples.test.ts
import { test, expect } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "@convex/_generated/api";
import {
  getDocstringInfoForOperation,
  getExampleValue,
} from "./docstringHelpers";

test("functionName example aligns with actual behavior", async () => {
  const t = convexTest(schema);

  // 1. Load docstring examples
  const docInfo = getDocstringInfoForOperation(
    "convex/domain/file.ts",
    "functionName",
  );
  const requestExample = getExampleValue(docInfo, "request");
  const responseExample = getExampleValue(docInfo, "response");

  // 2. Set up test data matching examples
  await t.run(async (ctx) => {
    await ctx.db.insert("resources", {
      _id: requestExample.args.resourceId,
      field1: "value1",
      field2: "value2",
    });
  });

  // 3. Execute function with example input
  const result = await t.query(api.domain.functionName, requestExample.args);

  // 4. Normalize dynamic values (IDs, timestamps)
  const normalized = {
    ...result,
    _creationTime: responseExample.value._creationTime,
  };

  // 5. Assert match
  expect(normalized).toMatchObject(responseExample.value);
});
```

### Pre-commit Hook

Add docstring validation to your pre-commit workflow:

```bash
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Validate docstrings
pnpm tsx scripts/validate-docstrings.ts || {
  echo "❌ Docstring validation failed. Fix errors before committing."
  exit 1
}
```

### Documentation Pipeline

The documentation pipeline automatically:

1. **Parses** docstrings from all Convex functions
2. **Validates** JSON syntax and completeness
3. **Generates** OpenAPI specification with examples
4. **Commits** updated spec to repository
5. **Deploys** to Mintlify documentation site

Run the pipeline manually:

```bash
# Development environment
pnpm run update:api-docs:dev

# Staging environment
pnpm run update:api-docs:staging

# Production environment
pnpm run update:api-docs:prod
```

### IDE Integration

Docstrings are automatically displayed in:

- **Hover tooltips**: See function documentation on hover
- **Autocomplete**: View examples while typing
- **Go to definition**: Jump to source with full context

### Reference Examples

See these files for well-documented functions:

- `convex/embeddings/actions.ts` - Action with external API calls
- `convex/embeddings/queries.ts` - Query with vector search
- `convex/embeddings/mutations.ts` - Mutation with validation
- `convex/meetings/queries.ts` - Query with authorization
- `convex/prompts/actions.ts` - Action with caching

## Support

For questions or issues:

1. Check the [Convex documentation](https://docs.convex.dev)
2. Review the steering rules in `.kiro/steering/convex_rules.mdc`
3. Use the Context7 MCP tool for up-to-date guidance
4. Review docstring examples in `convex/embeddings/` and `convex/meetings/`
