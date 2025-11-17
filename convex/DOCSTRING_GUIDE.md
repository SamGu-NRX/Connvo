# Convex Docstring Developer Guide

This guide provides comprehensive instructions for writing, validating, and maintaining docstrings for Convex functions.

## Table of Contents

- [Quick Start](#quick-start)
- [Docstring Format](#docstring-format)
- [Templates by Function Type](#templates-by-function-type)
- [Example Best Practices](#example-best-practices)
- [Validation](#validation)
- [Common Errors and Fixes](#common-errors-and-fixes)
- [Test Validation](#test-validation)
- [IDE Integration](#ide-integration)

## Quick Start

### 1. Add Docstring to Your Function

````typescript
/**
 * @summary Gets user by ID
 * @description Retrieves user data by user ID with proper authorization.
 * Requires authentication. Returns null if user not found.
 *
 * @example request
 * ```json
 * { "args": { "userId": "user_abc123" } }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "_id": "user_abc123",
 *     "name": "John Doe",
 *     "email": "john@example.com"
 *   }
 * }
 * ```
 */
export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, args) => {
    // Implementation
  },
});
````

### 2. Validate Your Docstring

```bash
# Validate specific file
pnpm run validate:docs:file convex/users/queries.ts

# Validate all files
pnpm run validate:docs
```

### 3. Run Documentation Pipeline

```bash
# Generate OpenAPI spec with your docstrings
pnpm run update:api-docs:dev
```

## Docstring Format

### Required Structure

````typescript
/**
 * @summary [Brief verb phrase]
 * @description [Detailed explanation]
 *
 * @example request
 * ```json
 * { "args": { ... } }
 * ```
 *
 * @example response
 * ```json
 * { "status": "success", "value": { ... } }
 * ```
 *
 * @example response-error (optional)
 * ```json
 * { "status": "error", "errorData": { ... } }
 * ```
 */
````

### Tag Requirements

#### @summary

- **Length**: < 100 characters
- **Format**: Start with a verb (Gets, Creates, Updates, Deletes, etc.)
- **Style**: Brief, action-oriented phrase
- **Examples**:
  - ✅ "Gets user profile by user ID"
  - ✅ "Creates new meeting with participants"
  - ✅ "Updates user interests and preferences"
  - ❌ "User profile retrieval" (no verb)
  - ❌ "This function gets the user profile by looking up the user ID in the database" (too long)

#### @description

- **Length**: > 50 characters
- **Content**: Must include:
  - What the function does
  - Authorization requirements
  - Side effects and state changes
  - Performance considerations
  - Error conditions
- **Examples**:

  ```
  ✅ "Retrieves user profile data by user ID with proper authorization checks.
      Requires authentication and validates meeting access. Returns null if the
      user is not found or the caller lacks permission. Uses indexed query on
      by_user_id for optimal performance."

  ❌ "Gets user profile" (too brief, missing details)
  ```

#### @example request

- **Format**: Valid JSON wrapped in fenced code block
- **Content**: Realistic input arguments matching the function's validator
- **Structure**:
  ```json
  {
    "args": {
      "param1": "value1",
      "param2": "value2"
    }
  }
  ```

#### @example response

- **Format**: Valid JSON wrapped in fenced code block
- **Content**: Realistic output matching the function's return type
- **Structure**:
  ```json
  {
    "status": "success",
    "value": {
      "_id": "resource_abc123",
      "_creationTime": 1699564800000,
      "field1": "value1"
    }
  }
  ```

#### @example response-error (optional but recommended)

- **Format**: Valid JSON wrapped in fenced code block
- **Content**: Common error scenarios
- **Structure**:
  ```json
  {
    "status": "error",
    "errorData": {
      "code": "ERROR_CODE",
      "message": "Human-readable error message"
    }
  }
  ```

## Templates by Function Type

### Query Template

Use for read-only operations that retrieve data.

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
 *     "resourceId": "resource_a123"
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

### Mutation Template

Use for operations that modify database state.

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

### Action Template

Use for operations that call external APIs or perform non-deterministic operations.

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

## Example Best Practices

### 1. Use Realistic Data

Examples should mirror actual system behavior:

```typescript
// ✅ Good: Realistic IDs and values
{
  "args": {
    "userId": "user_abc123",
    "meetingId": "meeting_xyz789"
  }
}

// ❌ Bad: Generic placeholders
{
  "args": {
    "userId": "123",
    "meetingId": "456"
  }
}
```

### 2. Use Deterministic Values

Use stable values for test reproducibility:

```typescript
// ✅ Good: Deterministic timestamp
{
  "_creationTime": 1699564800000,
  "timestamp": "2023-11-10T00:00:00.000Z"
}

// ❌ Bad: Dynamic values
{
  "_creationTime": Date.now(),
  "timestamp": new Date().toISOString()
}
```

### 3. Show Complete Objects

Don't abbreviate or truncate:

```typescript
// ✅ Good: Complete object structure
{
  "value": {
    "_id": "user_abc123",
    "_creationTime": 1699564800000,
    "name": "John Doe",
    "email": "john@example.com",
    "role": "participant",
    "status": "active"
  }
}

// ❌ Bad: Abbreviated
{
  "value": {
    "_id": "user_abc123",
    "name": "John Doe",
    "...": "other fields"
  }
}
```

### 4. Include Common Error Cases

Document expected error scenarios:

```typescript
// Authorization error
{
  "status": "error",
  "errorData": {
    "code": "UNAUTHORIZED",
    "message": "User does not have access to this meeting"
  }
}

// Not found error
{
  "status": "error",
  "errorData": {
    "code": "NOT_FOUND",
    "message": "Meeting not found"
  }
}

// Validation error
{
  "status": "error",
  "errorData": {
    "code": "VALIDATION_ERROR",
    "message": "Title must be at least 3 characters"
  }
}
```

### 5. Show Cache Behavior for Actions

For actions with caching, show both scenarios:

````typescript
// Fresh result
/**
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "data": { ... },
 *     "fromCache": false,
 *     "processingTime": 342
 *   }
 * }
 * ```
 *
 * @example response-cache
 * ```json
 * {
 *   "status": "success",
 *   "value": {
 *     "data": { ... },
 *     "fromCache": true,
 *     "processingTime": 12
 *   }
 * }
 * ```
 */
````

## Validation

### Command Line Validation

```bash
# Validate all Convex functions
pnpm run validate:docs

# Validate specific file
pnpm run validate:docs:file convex/users/queries.ts

# Generate coverage report
pnpm run audit:docs

# Generate JSON report for CI
pnpm run audit:docs:json
```

### Pre-commit Hook

Docstrings are automatically validated on commit. The hook will:

1. Detect staged Convex TypeScript files
2. Validate docstring format and JSON syntax
3. Block commit if validation fails
4. Show specific errors with file locations

To bypass (not recommended):

```bash
git commit --no-verify
```

### CI Validation

The CI pipeline validates docstrings on every push:

1. Runs `pnpm run validate:docs`
2. Generates OpenAPI spec
3. Validates spec with Redocly
4. Fails build if errors found

## Common Errors and Fixes

### Error: Invalid JSON in Example

```
❌ Example "request" contains invalid JSON
```

**Cause**: JSON syntax error in example block

**Fix**: Validate JSON syntax

```bash
# Use a JSON validator
echo '{ "args": { ... } }' | jq .
```

### Error: Missing @summary Tag

```
⚠️  Public function missing @summary tag
```

**Cause**: No `@summary` tag in docstring

**Fix**: Add summary tag

```typescript
/**
 * @summary Gets user by ID
 * ...
 */
```

### Error: Summary Too Long

```
⚠️  Summary is too long (127 chars). Keep it under 100 characters.
```

**Cause**: Summary exceeds 100 characters

**Fix**: Shorten to focus on core action

```typescript
// ❌ Too long
@summary Retrieves the complete user profile including all personal information, preferences, and activity history

// ✅ Concise
@summary Gets user profile with preferences and activity
```

### Error: Summary Doesn't Start with Verb

```
⚠️  Summary should start with a verb (e.g., "Gets", "Creates", "Updates")
```

**Cause**: Summary doesn't start with action verb

**Fix**: Start with verb

```typescript
// ❌ No verb
@summary User profile retrieval

// ✅ Starts with verb
@summary Gets user profile
```

### Error: Description Too Brief

```
⚠️  Description is too brief (32 chars). Provide more detail.
```

**Cause**: Description < 50 characters

**Fix**: Expand with details

```typescript
// ❌ Too brief
@description Gets user data

// ✅ Detailed
@description Retrieves user profile data by user ID with proper authorization checks.
Requires authentication and validates meeting access. Returns null if the user is
not found or the caller lacks permission.
```

### Error: Duplicate Summary

```
⚠️  Duplicate summary: "gets user by id" (also used in convex/profiles/queries.ts:getUserById)
```

**Cause**: Multiple functions with identical summaries

**Fix**: Make summaries more specific

```typescript
// ❌ Duplicate
@summary Gets user by ID  // in users/queries.ts
@summary Gets user by ID  // in profiles/queries.ts

// ✅ Specific
@summary Gets user account by ID  // in users/queries.ts
@summary Gets user profile by ID  // in profiles/queries.ts
```

### Error: Missing Request Example

```
⚠️  Function has examples but missing "@example request" block
```

**Cause**: Has response example but no request example

**Fix**: Add request example

````typescript
/**
 * @example request
 * ```json
 * { "args": { "userId": "user_abc123" } }
 * ```
 */
````

### Error: Missing Response Example

```
⚠️  Function has examples but missing "@example response" block
```

**Cause**: Has request example but no response example

**Fix**: Add response example

````typescript
/**
 * @example response
 * ```json
 * { "status": "success", "value": { ... } }
 * ```
 */
````

## Test Validation

### Writing Test Validation

All docstring examples should be validated by tests to ensure accuracy:

```typescript
// convex/test/usersExamples.test.ts
import { test, expect } from "vitest";
import { convexTest } from "convex-test";
import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import {
  getDocstringInfoForOperation,
  getExampleValue,
} from "./docstringHelpers";

test("getUserById example aligns with actual behavior", async () => {
  const t = convexTest(schema);

  // 1. Load docstring examples
  const docInfo = getDocstringInfoForOperation(
    "convex/users/queries.ts",
    "getUserById",
  );
  const requestExample = getExampleValue(docInfo, "request");
  const responseExample = getExampleValue(docInfo, "response");

  // 2. Set up test data matching examples
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      _id: requestExample.args.userId,
      name: "John Doe",
      email: "john@example.com",
      workosUserId: "workos_123",
    });
  });

  // 3. Execute function with example input
  const result = await t.query(api.users.getUserById, requestExample.args);

  // 4. Normalize dynamic values (IDs, timestamps)
  const normalized = {
    ...result,
    _id: responseExample.value._id,
    _creationTime: responseExample.value._creationTime,
  };

  // 5. Assert match
  expect(normalized).toMatchObject(responseExample.value);
});
```

### Test Helper Functions

Use helper functions from `convex/test/docstringHelpers.ts`:

```typescript
// Get docstring info for a function
const docInfo = getDocstringInfoForOperation(
  "convex/users/queries.ts",
  "getUserById",
);

// Extract specific example
const requestExample = getExampleValue(docInfo, "request");
const responseExample = getExampleValue(docInfo, "response");
const errorExample = getExampleValue(docInfo, "response-error");

// Normalize dynamic values
const normalized = normalizeDynamicValues(result, responseExample.value);
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test convex/test/usersExamples.test.ts

# Run in watch mode
pnpm test:watch
```

## IDE Integration

### VSCode

Docstrings automatically appear in:

- **Hover tooltips**: Hover over function name to see documentation
- **Autocomplete**: See function signature and examples while typing
- **Go to definition**: Jump to source with full docstring context

### TypeScript Language Server

The TypeScript language server reads JSDoc comments and provides:

- IntelliSense with parameter descriptions
- Type information with examples
- Quick info on hover

### Convex Dashboard

Docstrings are displayed in the Convex dashboard:

- Function list shows summaries
- Function details show full documentation
- Examples are syntax-highlighted

## Reference Examples

See these files for well-documented functions:

### Actions with External APIs

- `convex/embeddings/actions.ts` - OpenAI integration with caching
- `convex/prompts/actions.ts` - AI prompt generation with error handling

### Queries with Authorization

- `convex/meetings/queries.ts` - Meeting access with role checks
- `convex/users/queries.ts` - User data with privacy controls

### Mutations with Validation

- `convex/embeddings/mutations.ts` - Vector operations with validation
- `convex/notes/mutations.ts` - Operational transform with conflict resolution

### Complex Domain Logic

- `convex/matching/engine.ts` - Matching algorithm with scoring
- `convex/transcripts/ingestion.ts` - High-frequency writes with batching

## Additional Resources

- [Convex Documentation](https://docs.convex.dev)
- [JSDoc Reference](https://jsdoc.app/)
- [OpenAPI Specification](https://swagger.io/specification/)
- [Mintlify Documentation](https://mintlify.com/docs)

## Support

For questions or issues:

1. Review this guide and reference examples
2. Check validation output for specific errors
3. Review steering rules in `.kiro/steering/convex_rules.mdc`
4. Use the Context7 MCP tool for up-to-date Convex guidance
