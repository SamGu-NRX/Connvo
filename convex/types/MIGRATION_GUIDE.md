# Migration Guide: Centralized Type System

This guide helps developers migrate from inline type definitions to the centralized type system.

## 🎯 Migration Overview

The centralized type system eliminates type duplication across 100+ functions by providing:

- Single source of truth for all entity types
- Consistent validator patterns
- Full TypeScript type safety
- Excellent developer experience

## 📋 Pre-Migration Checklist

Before starting migration:

- [ ] Understand the [centralized type system](./README.md)
- [ ] Review [Convex best practices](../../.kiro/steering/convex_rules.mdc)
- [ ] Set up type validation tools
- [ ] Plan migration in phases (by module)

## 🔄 Step-by-Step Migration

### Step 1: Identify Functions to Migrate

Find functions with inline type definitions:

```bash
# Search for inline v.object() patterns
grep -r "v\.object({" convex/ --include="*.ts"

# Search for functions without returns validators
grep -r "export.*query\|export.*mutation" convex/ --include="*.ts" | grep -v "returns:"
```

### Step 2: Replace Inline Types

#### Before: Inline Type Definitions

```typescript
// ❌ Old pattern - inline types
export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      workosUserId: v.string(),
      email: v.string(),
      orgId: v.optional(v.string()),
      orgRole: v.optional(v.string()),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
      isActive: v.boolean(),
      lastSeenAt: v.optional(v.number()),
      onboardingComplete: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});
```

#### After: Centralized Types

```typescript
// ✅ New pattern - centralized types
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

### Step 3: Update Function Patterns

#### Query Functions

```typescript
// Before
export const listUsers = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 10 }) => {
    return await ctx.db.query("users").take(limit);
  },
});

// After - with proper pagination and types
import { paginationOptsValidator } from "convex/server";
import { PaginationResultV } from "@convex/types/validators/pagination";
import { UserV } from "@convex/types/validators/user";
import type { UserPublic, PaginationResult } from "@convex/types";

export const listUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
    activeOnly: v.optional(v.boolean()),
  },
  returns: PaginationResultV(UserV.public),
  handler: async (
    ctx,
    { paginationOpts, activeOnly = true },
  ): Promise<PaginationResult<UserPublic>> => {
    return await ctx.db
      .query("users")
      .withIndex("by_isActive", (q) => q.eq("isActive", activeOnly))
      .order("desc")
      .paginate(paginationOpts);
  },
});
```

#### Mutation Functions

```typescript
// Before
export const createUser = mutation({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("users", {
      ...args,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

// After - with proper types and validation
import { UserV } from "@convex/types/validators/user";
import type { User } from "@convex/types/entities/user";

export const createUser = mutation({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
    orgId: v.optional(v.string()),
    orgRole: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args): Promise<Id<"users">> => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      ...args,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

#### Action Functions

```typescript
// Before
export const processWebhook = action({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    // ❌ Actions shouldn't access ctx.db directly
    const user = await ctx.db.get(data.userId);
    // Process webhook...
  },
});

// After - proper action pattern
import { UserV } from "@convex/types/validators/user";
import type { User } from "@convex/types/entities/user";

export const processWebhook = action({
  args: {
    userId: v.id("users"),
    webhookData: v.object({
      type: v.string(),
      payload: v.record(v.string(), v.any()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { userId, webhookData }): Promise<null> => {
    // ✅ Actions use ctx.runQuery/ctx.runMutation
    const user = await ctx.runQuery(api.users.getUserById, { userId });

    if (user) {
      await ctx.runMutation(api.users.updateUser, {
        userId,
        updates: { lastSeenAt: Date.now() },
      });
    }

    return null;
  },
});
```

### Step 4: Update Query Patterns

#### Replace Filter Scans with Index-First Queries

```typescript
// Before - table scan (slow!)
export const getMeetingsByOrganizer = query({
  args: { organizerId: v.id("users") },
  handler: async (ctx, { organizerId }) => {
    return await ctx.db
      .query("meetings")
      .filter((q) => q.eq(q.field("organizerId"), organizerId))
      .collect();
  },
});

// After - index-first query (fast!)
// Note: Requires schema index: .index("by_organizer", ["organizerId"])
export const getMeetingsByOrganizer = query({
  args: { organizerId: v.id("users") },
  returns: v.array(MeetingV.listItem),
  handler: async (ctx, { organizerId }): Promise<MeetingListItem[]> => {
    return await ctx.db
      .query("meetings")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .order("desc")
      .collect();
  },
});
```

### Step 5: Add Required Schema Indexes

Update your schema to support index-first queries:

```typescript
// convex/schema.ts
export default defineSchema({
  users: defineTable({
    workosUserId: v.string(),
    email: v.string(),
    isActive: v.boolean(),
    // ... other fields
  })
    .index("by_isActive", ["isActive"])
    .index("by_workosUserId", ["workosUserId"]),

  meetings: defineTable({
    organizerId: v.id("users"),
    state: v.union(
      v.literal("scheduled"),
      v.literal("active"),
      v.literal("concluded"),
      v.literal("cancelled"),
    ),
    // ... other fields
  })
    .index("by_organizer", ["organizerId"])
    .index("by_organizer_and_state", ["organizerId", "state"])
    .index("by_state", ["state"]),

  // ... other tables
});
```

## 🧪 Testing Migration

### Add Type Alignment Tests

```typescript
// convex/types/__tests__/migration-validation.test.ts
import { describe, test, expect } from "vitest";
import { validateValidatorStructure } from "./type-validation-utils";
import { UserV, MeetingV } from "../validators";

describe("Migration Validation", () => {
  test("All User validators are valid", () => {
    for (const [name, validator] of Object.entries(UserV)) {
      const result = validateValidatorStructure(validator, `UserV.${name}`);
      expect(result.isValid).toBe(true);
    }
  });

  test("All Meeting validators are valid", () => {
    for (const [name, validator] of Object.entries(MeetingV)) {
      const result = validateValidatorStructure(validator, `MeetingV.${name}`);
      expect(result.isValid).toBe(true);
    }
  });
});
```

### Validate Function Compliance

```typescript
// Test that functions follow new patterns
test("Functions use centralized validators", () => {
  // This would be a more comprehensive test in practice
  const mockFunction = {
    args: { userId: v.id("users") },
    returns: UserV.full,
    handler: async () => {},
  };

  expect(mockFunction.args).toBeDefined();
  expect(mockFunction.returns).toBeDefined();
});
```

## 📊 Module-by-Module Migration Plan

### Phase 1: Core Entities (Week 1)

- [ ] `convex/users/` - User management functions
- [ ] `convex/auth/` - Authentication functions
- [ ] Add User type alignment tests

### Phase 2: Meeting System (Week 2)

- [ ] `convex/meetings/` - Meeting lifecycle functions
- [ ] `convex/participants/` - Participant management
- [ ] Add Meeting type alignment tests

### Phase 3: Content & Communication (Week 3)

- [ ] `convex/transcripts/` - Transcript processing
- [ ] `convex/notes/` - Note operations
- [ ] `convex/messaging/` - Messaging functions
- [ ] Add content type alignment tests

### Phase 4: Advanced Features (Week 4)

- [ ] `convex/matching/` - Matching algorithm
- [ ] `convex/embeddings/` - Vector search
- [ ] `convex/insights/` - AI insights
- [ ] Add advanced type alignment tests

### Phase 5: Real-time & Infrastructure (Week 5)

- [ ] `convex/realtime/` - Real-time subscriptions
- [ ] `convex/webrtc/` - WebRTC signaling
- [ ] `convex/system/` - System functions
- [ ] Add infrastructure type alignment tests

## 🔍 Validation & Quality Assurance

### Automated Validation

```bash
# Run type validation
npm run validate-types

# Run type consistency tests
npm run test:types

# Check TypeScript compilation
npm run type-check

# Generate type system health report
npm run type-report
```

### Manual Review Checklist

For each migrated function:

- [ ] Uses centralized validators (no inline `v.object()`)
- [ ] Has both `args` and `returns` validators
- [ ] Uses TypeScript return type annotation
- [ ] Follows index-first query patterns
- [ ] Uses new Convex function syntax
- [ ] Actions don't access `ctx.db` directly
- [ ] Proper error handling and validation

### Performance Validation

```typescript
// Measure performance impact
import { measureValidatorPerformance } from "@convex/types/__tests__/type-validation-utils";

const validators = [UserV.full, MeetingV.full, TranscriptV.full];
const metrics = measureValidatorPerformance(
  validators.map((v, i) => ({ name: `validator_${i}`, validator: v })),
);

console.log(
  `Average validation time: ${metrics.averageValidationTime.toFixed(2)}ms`,
);
expect(metrics.averageValidationTime).toBeLessThan(5); // Should be fast
```

## 🚨 Common Migration Issues

### Issue 1: Type Mismatches

**Problem**: TypeScript errors after migration

```typescript
// Error: Type 'User | null' is not assignable to type 'UserPublic | null'
const user: UserPublic | null = await ctx.runQuery(api.users.getUserById, {
  userId,
});
```

**Solution**: Use the correct type variant

```typescript
// Use the appropriate type for your use case
const user: User | null = await ctx.runQuery(api.users.getUserById, { userId });
// OR use a public-safe query
const user: UserPublic | null = await ctx.runQuery(
  api.users.getPublicUserById,
  { userId },
);
```

### Issue 2: Missing Indexes

**Problem**: Query performance degradation

```typescript
// This will be slow without proper index
const meetings = await ctx.db
  .query("meetings")
  .withIndex("by_organizer", (q) => q.eq("organizerId", userId))
  .collect();
```

**Solution**: Add required indexes to schema

```typescript
// convex/schema.ts
meetings: defineTable({
  organizerId: v.id("users"),
  // ... other fields
}).index("by_organizer", ["organizerId"]),
```

### Issue 3: Validator Complexity

**Problem**: Complex nested validators are hard to maintain

```typescript
// Hard to maintain
const complexValidator = v.object({
  user: v.object({
    profile: v.object({
      // ... deeply nested
    }),
  }),
});
```

**Solution**: Use composition with centralized types

```typescript
// Easier to maintain
const complexValidator = v.object({
  user: UserV.withProfile,
  meeting: MeetingV.withParticipants,
});
```

### Issue 4: Performance Regression

**Problem**: Validation becomes slow

**Solution**: Use performance monitoring

```typescript
// Monitor performance in tests
test("Validation performance", () => {
  const startTime = performance.now();
  validateValidatorStructure(UserV.full, "UserV.full");
  const endTime = performance.now();

  expect(endTime - startTime).toBeLessThan(1); // 1ms threshold
});
```

## 📈 Post-Migration Benefits

After completing migration, you'll have:

### ✅ Consistency

- Single source of truth for all types
- Standardized patterns across 100+ functions
- Consistent error handling and validation

### ✅ Type Safety

- Full TypeScript checking
- Compile-time error detection
- Excellent IDE support with autocomplete

### ✅ Performance

- Index-first queries (no table scans)
- Optimized ArrayBuffer usage for embeddings
- Minimal runtime overhead

### ✅ Maintainability

- Easy to update entity types
- Centralized validator patterns
- Comprehensive test coverage

### ✅ Developer Experience

- Clear documentation and examples
- Automated validation tools
- Health monitoring and alerts

## 🎯 Success Metrics

Track migration success with these metrics:

- **Type Coverage**: % of functions using centralized types
- **Performance**: Average query response time
- **Errors**: Reduction in type-related bugs
- **Developer Velocity**: Time to implement new features
- **Code Quality**: Reduction in code duplication

## 🤝 Getting Help

If you encounter issues during migration:

1. **Check Documentation**: Review [README.md](./README.md) and examples
2. **Run Validation Tools**: Use automated type checking
3. **Review Tests**: Look at existing test patterns
4. **Check Monitoring**: Use health monitoring tools
5. **Ask for Help**: Reach out to the team

## 📚 Additional Resources

- [Convex Type System README](./README.md)
- [Convex Best Practices](../../.kiro/steering/convex_rules.mdc)
- [Type Validation Tools](./type-validation-utils.ts)
- [Monitoring Tools](./monitoring-tools.ts)
- [Convex Documentation](https://docs.convex.dev/)

---

**Next Steps**: Start with Phase 1 (Core Entities) and work through each module systematically. Use the validation tools to ensure quality at each step.
