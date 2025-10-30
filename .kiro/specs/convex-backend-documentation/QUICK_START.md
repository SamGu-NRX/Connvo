# Quick Start Guide: Documentation Infrastructure

## Overview

This guide helps you quickly get started with the documentation audit and tooling infrastructure.

## Installation

No additional installation needed! The infrastructure uses existing dependencies:

- `tsx` - TypeScript execution
- `vitest` - Test framework
- `convex-test` - Convex testing utilities

## Quick Commands

### Check Documentation Coverage

```bash
# See overall coverage
pnpm audit:docs

# Check specific domain
pnpm tsx scripts/audit-docstrings.ts --domain=users

# Get JSON output for scripting
pnpm audit:docs:json > coverage.json
```

### Validate Docstrings

```bash
# Validate all files
pnpm validate:docs

# Validate specific file
pnpm validate:docs:file=convex/users/queries.ts
```

### Run Tests

```bash
# Run all tests
pnpm test:run

# Run specific test file
pnpm test:run convex/test/openapiExamples.test.ts

# Watch mode for development
pnpm test:watch
```

## Common Workflows

### Workflow 1: Adding Documentation to a Function

1. **Add docstring with examples**

   ````typescript
   /**
    * @summary Gets user by ID
    * @description Returns the full user document for the supplied userId.
    * This function is available to all authenticated users.
    *
    * @example request
    * ```json
    * { "args": { "userId": "user_123example" } }
    * ```
    *
    * @example response
    * ```json
    * {
    *   "status": "success",
    *   "value": {
    *     "_id": "user_123example",
    *     "displayName": "John Doe",
    *     "email": "john@example.com"
    *   }
    * }
    * ```
    */
   export const getUserById = query({ ... });
   ````

2. **Validate the docstring**

   ```bash
   pnpm validate:docs:file=convex/users/queries.ts
   ```

3. **Create a test** (optional but recommended)

   ```typescript
   test("getUserById example aligns", async () => {
     const t = createTestEnvironment();
     const ctx = createTestContext(t);

     const result = await ctx.validateQuery(
       "convex/users/queries.ts",
       "getUserById",
       api.users.queries.getUserById,
       { userId: testUserId },
     );

     expect(result.aligned).toBe(true);
   });
   ```

4. **Run the test**

   ```bash
   pnpm test:run convex/test/usersExamples.test.ts
   ```

5. **Check coverage improvement**
   ```bash
   pnpm audit:docs --domain=users
   ```

### Workflow 2: Finding Functions That Need Documentation

1. **Run audit to see gaps**

   ```bash
   pnpm audit:docs
   ```

2. **Focus on a specific domain**

   ```bash
   pnpm audit:docs --domain=meetings
   ```

3. **Look at "FUNCTIONS NEEDING ATTENTION" section**
   - Lists all functions missing docstrings, examples, or tests
   - Prioritize public functions first

4. **Document functions one by one**
   - Follow Workflow 1 for each function

### Workflow 3: Pre-Commit Validation

1. **Validate changed files**

   ```bash
   git diff --name-only | grep "convex/.*\.ts$" | while read file; do
     pnpm validate:docs:file=$file
   done
   ```

2. **Fix any validation errors**
   - Invalid JSON syntax
   - Missing required tags
   - Format issues

3. **Run tests**

   ```bash
   pnpm test:run
   ```

4. **Commit changes**
   ```bash
   git add .
   git commit -m "docs: add docstrings to user functions"
   ```

## Docstring Template

Use this template for new functions:

````typescript
/**
 * @summary [Verb phrase describing what the function does]
 * @description [Detailed explanation including:
 *   - What the function does
 *   - Parameters and their purpose
 *   - Return value structure
 *   - Authorization requirements
 *   - Side effects
 *   - Performance considerations]
 *
 * @example request
 * ```json
 * {
 *   "args": {
 *     "paramName": "exampleValue"
 *   }
 * }
 * ```
 *
 * @example response
 * ```json
 * {
 *   "status": "success",
 *   "value": {
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
 *     "code": "ERROR_CODE",
 *     "message": "Error description"
 *   }
 * }
 * ```
 */
export const functionName = query({
  args: { ... },
  returns: v.object({ ... }),
  handler: async (ctx, args) => {
    // Implementation
  },
});
````

## Test Template

Use this template for new tests:

```typescript
import { describe, expect, test } from "vitest";
import { api } from "@convex/_generated/api";
import { createTestEnvironment } from "./helpers";
import { createTestContext } from "./docstringHelpers";

describe("Domain Examples", () => {
  test("functionName example aligns with actual behavior", async () => {
    const t = createTestEnvironment();
    const ctx = createTestContext(t);

    // Set up test data
    const { testId } = await t.run(async (ctx) => {
      return await ctx.db.insert("table", {
        // Test data matching example
      });
    });

    // Validate example alignment
    const result = await ctx.validateQuery(
      "convex/domain/file.ts",
      "functionName",
      api.domain.file.functionName,
      { arg: testId },
      {
        normalizeOptions: {
          idFields: ["_id", "testId"],
          timestampFields: ["createdAt", "updatedAt"],
        },
      },
    );

    expect(result.aligned).toBe(true);
  });
});
```

## Troubleshooting

### "Docstring metadata not found"

**Problem:** Parser can't find the docstring.

**Solution:**

- Ensure JSDoc comment (`/** ... */`) is directly above the export
- Check function name matches exactly
- Verify no syntax errors in the comment

### "Invalid JSON in example"

**Problem:** JSON syntax error in example block.

**Solution:**

- Validate JSON with a linter
- Check for trailing commas
- Ensure proper escaping
- Verify fenced code block syntax (` ```json `)

### "Example does not match actual behavior"

**Problem:** Test fails because example doesn't match function output.

**Solution:**

- Update example to match actual behavior, OR
- Fix function to match documented behavior
- Ensure test data matches example scenario
- Normalize dynamic values (IDs, timestamps)

### "Coverage below threshold"

**Problem:** Too many functions lack documentation.

**Solution:**

- Run `pnpm audit:docs` to see gaps
- Focus on high-priority public functions first
- Document one domain at a time
- Use templates for consistency

## Best Practices

### 1. Start with Public Functions

Focus on public functions (query, mutation, action) before internal functions.

### 2. Use Realistic Examples

Examples should use realistic data that matches actual usage:

- Real-looking IDs: `user_123example`
- Realistic timestamps: `1704067200000`
- Meaningful data: `"John Doe"` not `"test"`

### 3. Test Your Examples

Always create tests to validate examples match behavior:

- Prevents documentation drift
- Catches breaking changes
- Ensures examples are accurate

### 4. Keep Examples Simple

Examples should be minimal but complete:

- Include only necessary fields
- Use clear, descriptive values
- Avoid complex nested structures unless needed

### 5. Document Error Cases

Include error examples for common failure scenarios:

- Not found errors
- Authorization failures
- Validation errors

## Next Steps

1. **Review current coverage**

   ```bash
   pnpm audit:docs
   ```

2. **Pick a domain to document**
   - Start with `users` (core functionality)
   - Then `meetings` (high usage)
   - Continue with other domains

3. **Follow the workflow**
   - Add docstrings
   - Validate format
   - Create tests
   - Check coverage

4. **Iterate**
   - Document one function at a time
   - Validate frequently
   - Run tests often
   - Track progress with audit script

## Resources

- [Test Infrastructure README](../../convex/test/README.md)
- [Scripts README](../../scripts/README.md)
- [Requirements](./requirements.md)
- [Design](./design.md)
- [Tasks](./tasks.md)
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review the detailed READMEs
3. Look at existing examples in the codebase
4. Run validation scripts for specific error messages

## Success Metrics

Track your progress:

- **Coverage:** Aim for 100% of public functions documented
- **Examples:** Aim for 80%+ of public functions with examples
- **Tests:** Aim for 50%+ of examples validated by tests
- **Quality:** Zero validation errors, minimal warnings
