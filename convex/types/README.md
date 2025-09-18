# Centralized Type System

This directory contains the centralized type system for the LinkedUp Convex backend, providing a single source of truth for all entity types, validators, and API patterns.

## Overview

The type system follows a **type-first approach** where TypeScript types are the primary source of truth, with corresponding Convex validators that ensure runtime validation while maintaining compile-time type safety.

## Directory Structure

```
convex/types/
├── entities/           # Core entity type definitions
│   ├── user.ts        # User, Profile, AuthIdentity types
│   ├── meeting.ts     # Meeting, Participant, State types
│   ├── transcript.ts  # Transcript, Segment, Session types
│   ├── note.ts        # Note, Operation, OT types
│   ├── prompt.ts      # AI prompts and insights
│   ├── matching.ts    # Queue, Analytics, Scoring types
│   ├── webrtc.ts      # Sessions, Signals, Metrics types
│   ├── embedding.ts   # Vector embeddings and search
│   └── index.ts       # Barrel exports
├── validators/         # Convex validators for runtime validation
│   ├── user.ts        # User validators (UserV)
│   ├── meeting.ts     # Meeting validators (MeetingV)
│   ├── transcript.ts  # Transcript validators (TranscriptV)
│   ├── note.ts        # Note validators (NoteV)
│   ├── prompt.ts      # Prompt validators (PromptV)
│   ├── matching.ts    # Matching validators (MatchingV)
│   ├── webrtc.ts      # WebRTC validators (WebRTCV)
│   ├── embedding.ts   # Embedding validators (EmbeddingV)
│   ├── common.ts      # Shared validator utilities
│   └── index.ts       # Barrel exports
├── api/               # API response patterns
│   ├── responses.ts   # Result<T>, error types
│   ├── pagination.ts  # PaginationResult<T>
│   └── index.ts       # Barrel exports
├── domain/            # Domain-specific complex types
│   ├── operationalTransform.ts
│   ├── vectorSearch.ts
│   ├── realTime.ts
│   └── index.ts
├── __tests__/         # Type alignment tests
│   └── type-alignment.test.ts
├── utils.ts           # Utility types and helpers
├── _template.ts       # Convex compliance examples
├── index.ts           # Main barrel export
└── README.md          # This file
```

## Key Principles

### 1. Type-First Approach

- TypeScript types are defined first as the source of truth
- Convex validators are derived from and aligned with TypeScript types
- Compile-time type tests ensure alignment between types and validators

### 2. Layered Type System

- **Base Types**: Core entity definitions (User, Meeting, etc.)
- **Derived Types**: Partial views, extended joins, public-safe variants
- **API Types**: Standardized response patterns and pagination
- **Domain Types**: Complex domain-specific types (OT, WebRTC, Vector Search)

### 3. Privacy and Security

- Public types exclude sensitive fields by default (e.g., no email in UserPublic)
- Explicit opt-in for sensitive data (UserPublicWithEmail)
- Clear separation between public and internal API types

### 4. Performance Optimization

- Use `ArrayBuffer` (v.bytes()) for vector embeddings instead of `number[]`
- Branded types for enhanced type safety without runtime overhead
- Efficient pagination patterns following Convex guidelines

## Usage Examples

### Basic Entity Usage

```typescript
import { User, UserPublic, UserV } from "convex/types";

// Define a query with proper types and validators
export const getUser = query({
  args: { userId: v.id("users") },
  returns: v.union(UserV.public, v.null()),
  handler: async (ctx, { userId }): Promise<UserPublic | null> => {
    const user = await ctx.db.get(userId);
    if (!user) return null;

    // Return only public-safe fields
    return {
      _id: user._id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
    };
  },
});
```

### Pagination Usage

```typescript
import { PaginationResultV, UserV } from "convex/types/validators";
import { paginationOptsValidator } from "convex/server";

export const listUsers = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: PaginationResultV(UserV.public),
  handler: async (ctx, { paginationOpts }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .paginate(paginationOpts);
  },
});
```

### Complex Domain Types

```typescript
import { Operation, NoteOperationResult, NoteV } from "convex/types";

export const applyNoteOperation = mutation({
  args: {
    meetingId: v.id("meetings"),
    operation: NoteV.operation,
  },
  returns: NoteV.operationResult,
  handler: async (
    ctx,
    { meetingId, operation },
  ): Promise<NoteOperationResult> => {
    // Operational transform logic here
    return {
      success: true,
      serverSequence: 123,
      transformedOperation: operation,
      newVersion: 2,
      conflicts: [],
    };
  },
});
```

### Vector Embeddings

```typescript
import { EmbeddingV } from "convex/types/validators";
import { float32ArrayToBuffer } from "convex/types/utils";

export const storeEmbedding = mutation({
  args: {
    sourceId: v.string(),
    vector: v.array(v.number()), // Input as number array
  },
  returns: v.id("embeddings"),
  handler: async (ctx, { sourceId, vector }) => {
    // Convert to ArrayBuffer for optimal storage
    const vectorArray = new Float32Array(vector);
    const vectorBuffer = float32ArrayToBuffer(vectorArray);

    return await ctx.db.insert("embeddings", {
      sourceType: "user",
      sourceId,
      vector: vectorBuffer, // Stored as ArrayBuffer
      model: "text-embedding-ada-002",
      dimensions: vector.length,
      version: "1.0",
      metadata: {},
      createdAt: Date.now(),
    });
  },
});
```

## Convex Compliance

All functions must follow the patterns demonstrated in `_template.ts`:

### ✅ Required Patterns

- Use new function syntax with `args` and `returns` validators
- Index-first queries with `withIndex()` (no `.filter()` scans)
- Actions must not access `ctx.db` directly
- Use `ctx.runQuery/Mutation/Action` with proper function references
- Include type annotations for circular function calls

### ✅ Validator Requirements

- All functions must have both `args` and `returns` validators
- Use `v.null()` for functions that don't return values
- Use `paginationOptsValidator` for paginated queries
- Return `PaginationResult<T>` shape for consistency

### ✅ Type Safety

- No `any` types allowed
- Use branded types for enhanced safety (EpochMs, DurationMs)
- Proper error handling with standardized error types
- Public vs internal function separation

## Testing

Run type alignment tests to ensure validators match TypeScript types:

```bash
npm test convex/types/__tests__/type-alignment.test.ts
```

The test suite validates:

- Compile-time type alignment between TS types and validator inferred types
- Runtime validator structure correctness
- Branded type helper functions
- Pagination and common validator patterns

## Migration Guide

When migrating existing functions to use centralized types:

1. **Import centralized types and validators**:

   ```typescript
   import { UserV, MeetingV } from "convex/types/validators";
   import type { User, Meeting } from "convex/types/entities";
   ```

2. **Replace inline validators with centralized ones**:

   ```typescript
   // Before
   returns: v.object({ _id: v.id("users"), name: v.string() });

   // After
   returns: UserV.public;
   ```

3. **Add proper type annotations**:

   ```typescript
   handler: async (ctx, args): Promise<UserPublic> => {
     // Implementation
   };
   ```

4. **Ensure index-first queries**:

   ```typescript
   // Before
   .filter(q => q.eq(q.field("isActive"), true))

   // After
   .withIndex("by_isActive", q => q.eq("isActive", true))
   ```

5. **Update return statements to match public types**:
   ```typescript
   // Return only public-safe fields
   return {
     _id: user._id,
     displayName: user.displayName,
     avatarUrl: user.avatarUrl,
     isActive: user.isActive,
   };
   ```

## Performance Considerations

- **Compile-time only**: All TypeScript types are stripped in production
- **Validator optimization**: Convex optimizes validators automatically
- **ArrayBuffer usage**: Use `v.bytes()` for large numeric arrays (embeddings)
- **Tree-shaking**: Unused type definitions are eliminated
- **No runtime overhead**: Type system adds no performance cost

## Future Enhancements

- Automatic validator generation from TypeScript types
- Enhanced branded types for domain-specific validation
- Integration with GraphQL schema generation
- Real-time type checking in development mode
- Advanced utility types for complex scenarios
