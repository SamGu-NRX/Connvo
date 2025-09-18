# Convex Compliance Checklist

This document provides a comprehensive checklist for ensuring all Convex functions follow best practices and framework conventions.

## 🎯 Overview

Convex compliance ensures:

- **Performance**: Index-first queries, no table scans
- **Type Safety**: Proper validators and type alignment
- **Bestces**: Following Convex framework conventions
- **Maintainability**: Consistent patterns across all functions

## ✅ Function Definition Compliance

### New Function Syntax (Required)

```typescript
// ✅ Correct - New function syntax
export const myQuery = query({
  args: { id: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

// ❌ Incorrect - Old function syntax
export const myQuery = query(async (ctx, { id }: { id: Id<"users"> }) => {
  return await ctx.db.get(id);
});
```

### Args and Returns Validators (Required)

```typescript
// ✅ Correct - Both args and returns validators
export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

// ❌ Incorrect - Missing returns validator
export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

// ❌ Incorrect - Missing args validator
export const getAllUsers = query({
  returns: v.array(UserV.public),
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});
```

### Null Returns (Required)

```typescript
// ✅ Correct - Explicit null return
export const doSomething = mutation({
  args: { data: v.string() },
  returns: v.null(),
  handler: async (ctx, { data }) => {
    // Do something...
    return null;
  },
});

// ❌ Incorrect - Implicit undefined return
export const doSomething = mutation({
  args: { data: v.string() },
  returns: v.null(),
  handler: async (ctx, { data }) => {
    // Do something...
    // Missing return statement
  },
});
```

## 🔍 Query Compliance

### Index-First Queries (Critical)

```typescript
// ✅ Correct - Index-first query
export const getUsersByStatus = query({
  args: { isActive: v.boolean() },
  returns: v.array(UserV.public),
  handler: async (ctx, { isActive }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_isActive", (q) => q.eq("isActive", isActive))
      .order("desc")
      .collect();
  },
});

// ❌ Incorrect - Table scan with filter
export const getUsersByStatus = query({
  args: { isActive: v.boolean() },
  returns: v.array(UserV.public),
  handler: async (ctx, { isActive }) => {
    return await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("isActive"), isActive)) // Table scan!
      .collect();
  },
});
```

### Required Schema Indexes

```typescript
// Schema must define indexes for all query patterns
export default defineSchema({
  users: defineTable({
    workosUserId: v.string(),
    email: v.string(),
    isActive: v.boolean(),
    orgId: v.optional(v.string()),
    createdAt: v.number(),
  })
    // ✅ Required indexes for common queries
    .index("by_isActive", ["isActive"])
    .index("by_workosUserId", ["workosUserId"])
    .index("by_org_and_active", ["orgId", "isActive"])
    .index("by_createdAt", ["createdAt"]),
});
```

### Pagination Patterns

```typescript
// ✅ Correct - Standard Convex pagination
import { paginationOptsValidator } from "convex/server";

export const listUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
    activeOnly: v.optional(v.boolean()),
  },
  returns: PaginationResultV(UserV.public),
  handler: async (ctx, { paginationOpts, activeOnly = true }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_isActive", (q) => q.eq("isActive", activeOnly))
      .order("desc")
      .paginate(paginationOpts);
  },
});

// ❌ Incorrect - Custom pagination
export const listUsers = query({
  args: {
    offset: v.number(),
    limit: v.number(),
  },
  returns: v.array(UserV.public),
  handler: async (ctx, { offset, limit }) => {
    // Custom pagination is not recommended
    const users = await ctx.db.query("users").collect();
    return users.slice(offset, offset + limit);
  },
});
```

### Query Ordering

```typescript
// ✅ Correct - Explicit ordering
export const getRecentMeetings = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(MeetingV.listItem),
  handler: async (ctx, { limit = 10 }) => {
    return await ctx.db
      .query("meetings")
      .withIndex("by_createdAt")
      .order("desc") // Explicit ordering
      .take(limit);
  },
});

// ⚠️ Acceptable - Default ascending order
export const getOldestMeetings = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(MeetingV.listItem),
  handler: async (ctx, { limit = 10 }) => {
    return await ctx.db
      .query("meetings")
      .withIndex("by_createdAt")
      // Default ascending order
      .take(limit);
  },
});
```

## 🔄 Mutation Compliance

### No Delete Method

```typescript
// ✅ Correct - Collect then delete
export const deleteUserMeetings = mutation({
  args: { userId: v.id("users") },
  returns: v.number(),
  handler: async (ctx, { userId }) => {
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_organizer", (q) => q.eq("organizerId", userId))
      .collect();

    for (const meeting of meetings) {
      await ctx.db.delete(meeting._id);
    }

    return meetings.length;
  },
});

// ❌ Incorrect - Query doesn't support .delete()
export const deleteUserMeetings = mutation({
  args: { userId: v.id("users") },
  returns: v.number(),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("meetings")
      .withIndex("by_organizer", (q) => q.eq("organizerId", userId))
      .delete(); // This doesn't exist!
  },
});
```

### Proper Update Patterns

```typescript
// ✅ Correct - Using patch for partial updates
export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    updates: v.object({
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { userId, updates }) => {
    await ctx.db.patch(userId, {
      ...updates,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ✅ Correct - Using replace for full updates
export const replaceUser = mutation({
  args: {
    userId: v.id("users"),
    userData: UserV.full,
  },
  returns: v.null(),
  handler: async (ctx, { userId, userData }) => {
    await ctx.db.replace(userId, userData);
    return null;
  },
});
```

## ⚡ Action Compliance

### No Direct Database Access

```typescript
// ✅ Correct - Actions use ctx.run* methods
export const processWebhook = action({
  args: {
    userId: v.id("users"),
    webhookData: v.object({
      type: v.string(),
      payload: v.any(),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { userId, webhookData }) => {
    // ✅ Use ctx.runQuery
    const user = await ctx.runQuery(api.users.getUserById, { userId });

    if (user) {
      // ✅ Use ctx.runMutation
      await ctx.runMutation(api.users.updateLastSeen, { userId });
    }

    return null;
  },
});

// ❌ Incorrect - Actions cannot access ctx.db
export const processWebhook = action({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    // ❌ Actions don't have ctx.db
    const user = await ctx.db.get(userId);
    return null;
  },
});
```

### Node.js Usage in Actions

```typescript
// ✅ Correct - "use node" directive for Node.js APIs
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

export const sendEmail = action({
  args: {
    to: v.string(),
    subject: v.string(),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { to, subject, body }) => {
    // Node.js APIs available here
    const nodemailer = require("nodemailer");
    // ... email sending logic
    return null;
  },
});
```

### Function References

```typescript
// ✅ Correct - Using function references
import { api, internal } from "./_generated/api";

export const orchestrateWorkflow = action({
  args: { workflowId: v.string() },
  returns: v.null(),
  handler: async (ctx, { workflowId }) => {
    // ✅ Use api.* for public functions
    const data = await ctx.runQuery(api.workflows.getWorkflow, { workflowId });

    // ✅ Use internal.* for internal functions
    await ctx.runMutation(internal.workflows.updateStatus, {
      workflowId,
      status: "processing",
    });

    return null;
  },
});

// ❌ Incorrect - Passing functions directly
export const orchestrateWorkflow = action({
  args: { workflowId: v.string() },
  returns: v.null(),
  handler: async (ctx, { workflowId }) => {
    // ❌ Cannot pass function directly
    const data = await ctx.runQuery(getWorkflow, { workflowId });
    return null;
  },
});
```

## 📊 Validator Compliance

### Supported Validator Types

```typescript
// ✅ Supported Convex validators
const supportedValidators = {
  // Primitives
  id: v.id("tableName"),
  null: v.null(),
  number: v.number(),
  float64: v.number(), // Same as v.number()
  int64: v.int64(),
  boolean: v.boolean(),
  string: v.string(),
  bytes: v.bytes(),

  // Complex types
  array: v.array(v.string()),
  object: v.object({ field: v.string() }),
  record: v.record(v.string(), v.number()),
  union: v.union(v.string(), v.number()),
  literal: v.literal("specific-value"),
  optional: v.optional(v.string()),
};

// ❌ Unsupported validators
const unsupportedValidators = {
  map: v.map(v.string(), v.number()), // Not supported
  set: v.set(v.string()), // Not supported
};
```

### Record vs Map

```typescript
// ✅ Correct - Use v.record for dynamic keys
export const updateMetadata = mutation({
  args: {
    entityId: v.id("entities"),
    metadata: v.record(
      v.string(),
      v.union(v.string(), v.number(), v.boolean()),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { entityId, metadata }) => {
    await ctx.db.patch(entityId, { metadata });
    return null;
  },
});

// ❌ Incorrect - v.map is not supported
export const updateMetadata = mutation({
  args: {
    entityId: v.id("entities"),
    metadata: v.map(v.string(), v.any()), // Not supported!
  },
  returns: v.null(),
  handler: async (ctx, { entityId, metadata }) => {
    return null;
  },
});
```

### Literal Types for Enums

```typescript
// ✅ Correct - Use v.literal with v.union for enums
export const updateMeetingState = mutation({
  args: {
    meetingId: v.id("meetings"),
    state: v.union(
      v.literal("scheduled"),
      v.literal("active"),
      v.literal("concluded"),
      v.literal("cancelled"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { meetingId, state }) => {
    await ctx.db.patch(meetingId, { state });
    return null;
  },
});
```

## 🗄️ Schema Compliance

### System Fields

```typescript
// ✅ Correct - System fields are automatic
export default defineSchema({
  users: defineTable({
    workosUserId: v.string(),
    email: v.string(),
    // ✅ _id and _creationTime are added automatically
  }),
});

// ❌ Incorrect - Don't define system fields
export default defineSchema({
  users: defineTable({
    _id: v.id("users"), // ❌ System field, don't define
    _creationTime: v.number(), // ❌ System field, don't define
    workosUserId: v.string(),
    email: v.string(),
  }),
});
```

### Index Naming Convention

```typescript
// ✅ Correct - Include all index fields in name
export default defineSchema({
  meetings: defineTable({
    organizerId: v.id("users"),
    state: v.string(),
    createdAt: v.number(),
  })
    .index("by_organizer", ["organizerId"])
    .index("by_organizer_and_state", ["organizerId", "state"])
    .index("by_state_and_createdAt", ["state", "createdAt"]),
});

// ❌ Incorrect - Index name doesn't match fields
export default defineSchema({
  meetings: defineTable({
    organizerId: v.id("users"),
    state: v.string(),
  }).index("meetings_index", ["organizerId", "state"]), // Unclear name
});
```

### Field Naming Rules

```typescript
// ✅ Correct - Valid field names
export default defineSchema({
  entities: defineTable({
    name: v.string(),
    isActive: v.boolean(),
    userId: v.id("users"),
    metadata: v.record(v.string(), v.any()),
  }),
});

// ❌ Incorrect - Invalid field names
export default defineSchema({
  entities: defineTable({
    "": v.string(), // ❌ Empty field name
    $reserved: v.string(), // ❌ Starts with $
    _private: v.string(), // ❌ Starts with _
  }),
});
```

## 📁 File Storage Compliance

### File Metadata Access

```typescript
// ✅ Correct - Query _storage system table
export const getFileMetadata = query({
  args: { fileId: v.id("_storage") },
  returns: v.union(
    v.object({
      _id: v.id("_storage"),
      _creationTime: v.number(),
      contentType: v.optional(v.string()),
      sha256: v.string(),
      size: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { fileId }) => {
    return await ctx.db.system.get(fileId);
  },
});

// ❌ Incorrect - Using deprecated getMetadata
export const getFileMetadata = query({
  args: { fileId: v.id("_storage") },
  returns: v.any(),
  handler: async (ctx, { fileId }) => {
    // ❌ Deprecated method
    return await ctx.storage.getMetadata(fileId);
  },
});
```

### File URL Generation

```typescript
// ✅ Correct - Using getUrl for signed URLs
export const getFileUrl = query({
  args: { fileId: v.id("_storage") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { fileId }) => {
    return await ctx.storage.getUrl(fileId);
  },
});
```

## 🕐 Cron Job Compliance

### Cron Definition

```typescript
// ✅ Correct - Using cronJobs with function references
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ✅ Use crons.interval or crons.cron
crons.interval(
  "cleanup-old-data",
  { hours: 24 },
  internal.maintenance.cleanup,
  {},
);

crons.cron("daily-report", "0 9 * * *", internal.reports.generateDaily, {});

export default crons;

// ❌ Incorrect - Using deprecated helpers
const crons = cronJobs();
crons.daily("daily-task", internal.tasks.daily, {}); // ❌ Deprecated
```

## 🧪 Testing Compliance

### Type Alignment Tests

```typescript
// ✅ Required - Type alignment validation
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

## 📋 Compliance Checklist

### Function Definition ✅

- [ ] Uses new function syntax (`query({})`, not `query(async () => {})`)
- [ ] Has both `args` and `returns` validators
- [ ] Returns `null` explicitly when no return value
- [ ] Uses proper TypeScript return type annotations

### Query Functions ✅

- [ ] Uses index-first queries (`.withIndex()`)
- [ ] No table scans (no `.filter()` without index)
- [ ] Required indexes defined in schema
- [ ] Uses standard Convex pagination patterns
- [ ] Explicit ordering when needed

### Mutation Functions ✅

- [ ] Uses `.collect()` then individual `.delete()` calls
- [ ] Uses `.patch()` for partial updates
- [ ] Uses `.replace()` for full updates
- [ ] Proper error handling

### Action Functions ✅

- [ ] No direct `ctx.db` access
- [ ] Uses `ctx.runQuery/runMutation/runAction`
- [ ] Uses function references (`api.*`, `internal.*`)
- [ ] Includes `"use node"` when using Node.js APIs

### Validators ✅

- [ ] Uses only supported Convex validator types
- [ ] Uses `v.record()` instead of `v.map()`
- [ ] Uses `v.literal()` with `v.union()` for enums
- [ ] Proper optional field handling

### Schema ✅

- [ ] No manual system field definitions
- [ ] Index names include all field names
- [ ] Valid field names (no empty, $, or \_ prefixes)
- [ ] Proper index definitions for all query patterns

### File Storage ✅

- [ ] Uses `ctx.db.system.get()` for metadata
- [ ] Uses `ctx.storage.getUrl()` for file URLs
- [ ] No deprecated `getMetadata()` calls

### Cron Jobs ✅

- [ ] Uses `cronJobs()` with function references
- [ ] Uses `crons.interval()` or `crons.cron()`
- [ ] No deprecated helper methods

### Testing ✅

- [ ] Type alignment tests for all entities
- [ ] Function compliance validation
- [ ] Performance regression tests
- [ ] Integration tests with real data

## 🔧 Validation Tools

Use these tools to validate compliance:

```bash
# Run comprehensive type validation
npm run validate-types

# Check TypeScript compilation
npm run type-check

# Run Convex codegen
npm run convex:codegen

# Run compliance tests
npm run test:compliance
```

## 📚 Resources

- [Convex Documentation](https://docs.convex.dev/)
- [Convex Best Practices](https://docs.convex.dev/production/best-practices)
- [Type System Documentation](./README.md)
- [Migration Guide](./MIGRATION_GUIDE.md)
