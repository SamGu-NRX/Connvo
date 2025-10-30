# Convex Type System Documentation

This directory contains the centralized type system for the Connvo Convex backend, providing a single source of truth for all entity types, validators, and API responses.

## 🎯 Overview

The centralized type system eliminates type duplication, ensures consistency across 100+ functions, and provides excellent developer experience with full TypeScript support.

### Key Benefits

- **Single Source of Truth**: All entity types defined in one location
- **Type Safety**: Full TypeScript checking with Convex validator alignment
- **Performance**: Compile-time only types with minimal runtime overhead
- **Consistency**: Standardized patterns across all functions
- **Developer Experience**: Excellent autocomplete and error messages

## 📁 Directory Structure

```
convex/types/
├── entities/           # TypeScript entity type definitions
│   ├── user.ts        # User, Profile, AuthIdentity types
│   ├── meeting.ts     # Meeting, Participant, State types
│   ├── transcript.ts  # Transcript, Segment, Session types
│   ├── note.ts        # Note, Operation, OT types
│   ├── webrtc.ts      # WebRTC sessions, signals, metrics
│   ├── embedding.ts   # Vector embeddings and search
│   └── index.ts       # Main entity exports
├── validators/         # Convex validators (runtime validation)
│   ├── user.ts        # UserV validators
│   ├── meeting.ts     # MeetingV validators
│   ├── common.ts      # CommonV shared validators
│   ├── pagination.ts  # PaginationV utilities
│   └── index.ts       # Main validator exports
├── api/               # API response types
│   ├── responses.ts   # Result<T>, Error types
│   ├── pagination.ts  # PaginationResult<T>
│   └── index.ts       # API type exports
├── domain/            # Domain-specific complex types
│   ├── operational-transform.ts  # OT operations
│   ├── vector-search.ts         # Vector similarity
│   └── real-time.ts            # Real-time subscriptions
├── utils.ts           # Utility types and helpers
├── __tests__/         # Comprehensive test suite
└── README.md          # This documentation
```

## 🚀 Quick Start

### Basic Usage

```typescript
import { query } from "./_generated/server";
import { v } from "convex/values";
import { UserV } from "@convex/types/validators/user";
import type { User } from "@convex/types/entities/user";

export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { userId }): Promise<User | null> => {
    return await ctx.db.get(userId);
  },
});
```

### Pagination Example

```typescript
import { query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { PaginationResultV } from "@convex/types/validators/pagination";
import { UserV } from "@convex/types/validators/user";
import type { UserPublic, PaginationResult } from "@convex/types";

export const listUsers = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: PaginationResultV(UserV.public),
  handler: async (
    ctx,
    { paginationOpts },
  ): Promise<PaginationResult<UserPublic>> => {
    return await ctx.db
      .query("users")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .order("desc")
      .paginate(paginationOpts);
  },
});
```

## 📋 Entity Types

### Core Entities

#### User Types

- `User` - Complete user entity with all fields
- `UserPublic` - Public-safe user (no email by default)
- `UserSummary` - Minimal user info for references
- `UserProfile` - Extended profile information
- `AuthIdentity` - Authentication-related user data

#### Meeting Types

- `Meeting` - Core meeting entity
- `MeetingParticipant` - Participant information
- `MeetingRuntimeState` - Real-time meeting state
- `MeetingWithUserRole` - Meeting with user's role/presence

#### Transcript Types

- `Transcript` - Individual transcript chunks
- `TranscriptSegment` - Processed transcript segments
- `TranscriptionSession` - Transcription session metadata

### Domain-Specific Types

#### WebRTC Types

- `WebRTCSession` - WebRTC connection sessions
- `WebRTCSignal` - Signaling data (SDP/ICE)
- `ConnectionMetrics` - Connection quality metrics

#### Embedding Types

- `Embedding` - Vector embeddings (uses ArrayBuffer for performance)
- `SimilaritySearchResult` - Vector search results
- `VectorIndexMeta` - Vector index metadata

## 🔧 Validators

### Validator Patterns

All validators follow consistent patterns:

```typescript
export const EntityV = {
  // Full entity with all fields
  full: v.object({
    _id: v.id("tableName"),
    _creationTime: v.number(), // Convex system field
    // ... other fields
  }),

  // Public-safe version (no sensitive data)
  public: v.object({
    _id: v.id("tableName"),
    // ... public fields only
  }),

  // Summary version (minimal fields)
  summary: v.object({
    _id: v.id("tableName"),
    name: v.string(),
    // ... essential fields only
  }),
} as const;
```

### Common Validators

```typescript
import { CommonV } from "@convex/types/validators/common";

// Time-related
CommonV.epochMs; // Timestamp in milliseconds
CommonV.durationMs; // Duration in milliseconds

// String validation
CommonV.nonEmptyString; // Non-empty string
CommonV.email; // Email address
CommonV.url; // URL string

// Arrays
CommonV.stringArray; // Array of strings
CommonV.numberArray; // Array of numbers

// Performance-optimized embeddings
CommonV.embeddingVector; // { data: ArrayBuffer, dimensions: number, model: string }
```

## 📊 API Response Types

### Standard Response Patterns

```typescript
import { PaginationResultV } from "@convex/types/validators/pagination";
import type { PaginationResult, Result } from "@convex/types";

// Paginated responses
const paginatedUsers: PaginationResult<UserPublic> = {
  page: [...],           // Array of items
  isDone: boolean,       // No more pages
  continueCursor: string | null, // Next page cursor
};

// Result envelope (optional for public APIs)
const apiResponse: Result<User, string> = {
  success: true,
  data: user,
  // OR
  success: false,
  error: "Error message",
};
```

## 🎨 Best Practices

### 1. Type-First Development

Always define TypeScript types first, then create corresponding validators:

```typescript
// 1. Define TypeScript type
export interface MyEntity {
  _id: Id<"myEntities">;
  name: string;
  isActive: boolean;
}

// 2. Create validator
export const MyEntityV = {
  full: v.object({
    _id: v.id("myEntities"),
    name: v.string(),
    isActive: v.boolean(),
  }),
} as const;

// 3. Add type test to ensure alignment
type _TypeCheck = ValidatorTypeAlignment<MyEntity, typeof MyEntityV.full>;
```

### 2. Convex Compliance

Follow Convex best practices:

```typescript
// ✅ Use new function syntax with args and returns validators
export const myQuery = query({
  args: { id: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { id }) => {
    // Implementation
  },
});

// ✅ Use index-first queries (no .filter() scans)
const results = await ctx.db
  .query("users")
  .withIndex("by_isActive", (q) => q.eq("isActive", true))
  .order("desc")
  .take(10);

// ✅ Actions don't access ctx.db directly
export const myAction = action({
  args: { data: v.object({}) },
  returns: v.null(),
  handler: async (ctx, { data }) => {
    // Use ctx.runQuery/ctx.runMutation instead of ctx.db
    const result = await ctx.runQuery(api.users.getUserById, { userId: "..." });
  },
});
```

### 3. Performance Optimization

#### ArrayBuffer for Embeddings

```typescript
// ✅ Use ArrayBuffer for vector data (performance + cost optimization)
const embedding: Embedding = {
  vector: arrayBuffer, // ArrayBuffer, not number[]
  dimensions: 1536,
  model: "text-embedding-ada-002",
};

// Helper functions for conversion
import {
  float32ArrayToBuffer,
  bufferToFloat32Array,
} from "@convex/types/utils";

const vector = new Float32Array([1, 2, 3, 4]);
const buffer = float32ArrayToBuffer(vector);
const converted = bufferToFloat32Array(buffer);
```

#### Efficient Queries

```typescript
// ✅ Index-first with proper schema indexes
// Schema: .index("by_organizer_and_state", ["organizerId", "state"])
const meetings = await ctx.db
  .query("meetings")
  .withIndex("by_organizer_and_state", (q) =>
    q.eq("organizerId", userId).eq("state", "active"),
  )
  .order("desc")
  .take(10);

// ❌ Avoid table scans
const meetings = await ctx.db
  .query("meetings")
  .filter((q) => q.eq(q.field("organizerId"), userId)) // Table scan!
  .collect();
```

### 4. Type Safety Patterns

#### Branded Types

```typescript
import {
  EpochMs,
  DurationMs,
  toEpochMs,
  toDurationMs,
} from "@convex/types/utils";

// Branded types prevent mixing different numeric types
const timestamp: EpochMs = toEpochMs(Date.now());
const duration: DurationMs = toDurationMs(5000);

// TypeScript will catch this error:
// const invalid: EpochMs = duration; // ❌ Type error
```

#### Optional vs Required Fields

```typescript
// Use v.optional() for optional fields
export const UserV = {
  full: v.object({
    _id: v.id("users"),
    email: v.string(), // Required
    displayName: v.optional(v.string()), // Optional
    avatarUrl: v.optional(v.string()), // Optional
  }),
};
```

## 🧪 Testing

### Type Alignment Tests

```typescript
import { describe, test, expect } from "vitest";
import type { ValidatorTypeAlignment } from "@convex/types/__tests__/type-validation-utils";

test("User types align with validators", () => {
  // This will fail compilation if types don't match
  type _UserAlignment = ValidatorTypeAlignment<User, typeof UserV.full>;

  // Runtime validation
  const result = validateValidatorStructure(UserV.full, "UserV.full");
  expect(result.isValid).toBe(true);
});
```

### Property-Based Testing

```typescript
// Test complex domain invariants
test("Operational Transform properties", () => {
  const testCase: PropertyTestCase<Operation[]> = {
    name: "Operation sequence ordering",
    generator: generateOperationSequence,
    validator: (ops) => {
      // Sequences should be monotonically increasing
      for (let i = 1; i < ops.length; i++) {
        if (ops[i].sequence <= ops[i - 1].sequence) return false;
      }
      return true;
    },
    invariant: "Sequences are monotonic",
  };

  runPropertyTest(testCase);
});
```

## 🔍 Monitoring

### Health Monitoring

```typescript
import { TypeSystemMonitor } from "@convex/types/__tests__/monitoring-tools";

const monitor = new TypeSystemMonitor();

// Check system health
const health = await monitor.checkHealth();
console.log(`Type System: ${health.healthy ? "✅ HEALTHY" : "❌ ISSUES"}`);

// Generate detailed report
const report = await monitor.generateHealthReport();
const markdown = monitor.exportReportToMarkdown(report);
```

### CI/CD Integration

```bash
# Add to your CI pipeline
npm run validate-types  # Runs comprehensive type validation
npm run test:types      # Runs type consistency tests
```

## 🚨 Common Issues & Solutions

### Issue: Type Drift

**Problem**: Entity types and validators get out of sync

**Solution**: Use type alignment tests and monitoring

```typescript
// Add to your test suite
test("No type drift", () => {
  const driftCheck = detectTypeDrift(UserV.full, expectedUserFields, "User");
  expect(driftCheck.hasDrift).toBe(false);
});
```

### Issue: Performance Degradation

**Problem**: Type validation becomes slow

**Solution**: Use performance monitoring and optimization

```typescript
// Monitor performance
const metrics = measureValidatorPerformance(validators);
expect(metrics.averageValidationTime).toBeLessThan(5); // 5ms threshold
```

### Issue: Bundle Size Growth

**Problem**: Validators increase bundle size

**Solution**: Validators are minimal, types are compile-time only

```typescript
// Types have zero runtime footprint
import type { User } from "@convex/types"; // ✅ No bundle impact

// Validators are lightweight runtime objects
import { UserV } from "@convex/types/validators"; // Minimal impact
```

## 🔄 Migration Guide

### From Inline Types to Centralized Types

```typescript
// Before: Inline type definitions
export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      email: v.string(),
      displayName: v.optional(v.string()),
      // ... 15 more fields
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

// After: Centralized types
import { UserV } from "@convex/types/validators/user";
import type { User } from "@convex/types/entities/user";

export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { userId }): Promise<User | null> => {
    return await ctx.db.get(userId);
  },
});
```

### Migration Checklist

- [ ] Replace inline `v.object()` with centralized validators
- [ ] Add TypeScript return type annotations
- [ ] Ensure functions have both `args` and `returns` validators
- [ ] Use index-first query patterns
- [ ] Add type alignment tests
- [ ] Update to new Convex function syntax

## 📚 Advanced Topics

### Custom Validator Creation

```typescript
// Create domain-specific validators
export const CustomEntityV = {
  full: v.object({
    _id: v.id("customEntities"),
    // Use existing patterns
    ...CommonV.baseEntity,
    // Add custom fields
    customField: v.string(),
  }),

  // Create specialized views
  withRelations: v.object({
    // Base entity
    ...CustomEntityV.full.fields,
    // Add relations
    relatedUsers: v.array(UserV.summary),
    relatedMeetings: v.array(MeetingV.listItem),
  }),
} as const;
```

### Complex Domain Types

```typescript
// Operational Transform types
export interface OperationWithMetadata extends Operation {
  id: string;
  authorId: Id<"users">;
  timestamp: EpochMs;
  sequence: number;
  transformedFrom?: string[];
}

// WebRTC signaling with discriminated unions
export type WebRTCSignalData = SDPData | ICEData;

export interface SDPData {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp: string;
}

export interface ICEData {
  candidate: string;
  sdpMLineIndex?: number;
  sdpMid?: string;
}
```

## 🤝 Contributing

### Adding New Entity Types

1. **Define TypeScript types** in `entities/`
2. **Create validators** in `validators/`
3. **Add type alignment tests** in `__tests__/`
4. **Update documentation** in this README
5. **Add to monitoring** configuration

### Code Review Checklist

- [ ] Types defined before validators
- [ ] Validators use centralized patterns
- [ ] Type alignment tests added
- [ ] Performance impact measured
- [ ] Documentation updated
- [ ] Convex compliance verified

## 📞 Support

For questions or issues with the type system:

1. Check this documentation
2. Review existing tests for examples
3. Run type validation tools
4. Check monitoring reports

## 🔗 Related Documentation

- [Convex Documentation](https://docs.convex.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Convex Best Practices](https://docs.convex.dev/production/best-practices)
- [Project Architecture](../README.md)
