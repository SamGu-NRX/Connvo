# Documentation Scripts

This directory contains scripts for managing, validating, and generating API documentation from Convex backend functions.

## Overview

The documentation pipeline consists of:

1. **Audit** - Scan functions and generate coverage reports
2. **Validate** - Check docstring format and JSON syntax
3. **Parse** - Extract docstrings and examples from source files
4. **Enhance** - Inject docstring metadata into OpenAPI spec
5. **Generate** - Create final API documentation

## Scripts

### `audit-docstrings.ts`

Scans all Convex functions and generates coverage reports showing documentation completeness.

**Usage:**

```bash
# Audit all domains
pnpm audit:docs

# Audit specific domain
pnpm tsx scripts/audit-docstrings.ts --domain=users

# Generate JSON report
pnpm audit:docs:json > coverage.json
```

**Output:**

```
================================================================================
CONVEX BACKEND DOCUMENTATION COVERAGE REPORT
================================================================================

OVERALL SUMMARY
--------------------------------------------------------------------------------
Total Functions:        150
Public Functions:       120
Documented:             95 (79.2%)
With Examples:          45 (37.5%)
With Tests:             30 (25.0%)

DOMAIN BREAKDOWN
--------------------------------------------------------------------------------
Domain                 Public     Docs   Examples    Tests   Coverage
--------------------------------------------------------------------------------
users                      11       11          2        0     100.0% ██████████
meetings                   15       12          5        2      80.0% ████████░░
...

FUNCTIONS NEEDING ATTENTION
--------------------------------------------------------------------------------
USERS
  - users/mutations.ts:upsertUser (no examples, no tests)
  - users/queries.ts:getCurrentUser (no description, no examples)
...
```

**Features:**

- Scans all TypeScript files in `convex/` directory
- Identifies public vs internal functions
- Tracks docstring presence, examples, and test coverage
- Generates domain-by-domain breakdown
- Lists functions needing attention
- Exits with error code if coverage below threshold (80%)

### `validate-docstrings.ts`

Validates docstring format, JSON syntax, and completeness.

**Usage:**

```bash
# Validate all files
pnpm validate:docs

# Validate specific file
pnpm validate:docs:file=convex/users/queries.ts
```

**Output:**

```
❌ ERRORS (2)
================================================================================

convex/users/queries.ts:getUserById
  Example "request" contains invalid JSON

⚠️  WARNINGS (5)
================================================================================

convex/users/queries.ts:getCurrentUser
  Public function missing @example blocks

convex/users/queries.ts:getUserProfile
  Summary should start with a verb
```

**Validation Rules:**

1. **JSON Syntax**
   - All examples must be valid JSON
   - Examples must be wrapped in fenced code blocks

2. **Completeness**
   - Public functions should have `@summary`
   - Public functions should have `@description`
   - Public functions should have at least one `@example`
   - Functions with examples should have both `request` and `response`

3. **Format**
   - Summary should be concise (< 100 chars)
   - Summary should start with a verb
   - Description should be substantial (> 50 chars)

4. **Uniqueness**
   - No duplicate summaries across functions

### `docstringParser.ts`

Parses JSDoc-style docstrings and extracts structured metadata.

**Usage:**

```typescript
import { loadDocstringInfo } from "./docstringParser";

const docInfo = loadDocstringInfo("convex/users/queries.ts", "getUserById");

console.log(docInfo.summary);
console.log(docInfo.description);
console.log(docInfo.examples["request"].value);
```

**Parsed Structure:**

```typescript
interface ParsedDocstring {
  summary?: string;
  description?: string;
  examples: Record<
    string,
    {
      label: string;
      raw: string;
      value?: unknown; // Parsed JSON
    }
  >;
}
```

**Features:**

- Caches file reads for performance
- Extracts `@summary`, `@description`, `@example` tags
- Parses JSON in fenced code blocks
- Handles multi-line descriptions
- Supports multiple examples per function

### `enhance-openapi.ts`

Injects docstring metadata into the OpenAPI specification.

**Usage:**

```bash
# Run as part of documentation pipeline
pnpm update:api-docs:dev
```

**Process:**

1. Loads base OpenAPI spec from Convex
2. Scans all Convex functions for docstrings
3. Extracts summaries, descriptions, and examples
4. Injects metadata into OpenAPI paths
5. Writes enhanced spec to `docs/api-reference/convex-openapi.yaml`

**Features:**

- Preserves existing OpenAPI structure
- Adds `x-examples` extension for request/response examples
- Updates operation summaries and descriptions
- Validates enhanced spec with Redocly

### `update-api-docs.sh`

Orchestrates the complete documentation generation pipeline.

**Usage:**

```bash
# Generate for development
pnpm update:api-docs:dev

# Generate for staging
pnpm update:api-docs:staging

# Generate for production
pnpm update:api-docs:prod
```

**Pipeline Steps:**

1. Generate base OpenAPI spec from Convex
2. Enhance spec with docstring metadata
3. Validate spec with Redocly
4. Copy to documentation directory

## Docstring Format

### Basic Structure

````typescript
/**
 * @summary Brief verb phrase (< 100 chars)
 * @description Detailed explanation of behavior, parameters, side effects
 *
 * @example request
 * ```json
 * { "args": { "userId": "user_123" } }
 * ```
 *
 * @example response
 * ```json
 * { "status": "success", "value": { ... } }
 * ```
 *
 * @example response-error
 * ```json
 * { "status": "error", "errorData": { "code": "NOT_FOUND" } }
 * ```
 */
export const functionName = query({ ... });
````

### Example Labels

- **`request`** - Function input arguments
- **`response`** - Successful response
- **`response-error`** - Error response
- **`response-cache`** - Cached response (for actions)
- **`datamodel`** - Database entity structure

### Best Practices

1. **Summary**
   - Start with a verb (Gets, Creates, Updates, etc.)
   - Keep under 100 characters
   - Be specific and descriptive

2. **Description**
   - Explain what the function does
   - Document parameters and return values
   - Note side effects and authorization requirements
   - Include performance considerations

3. **Examples**
   - Use realistic data values
   - Match actual function behavior
   - Include error scenarios
   - Use deterministic IDs and timestamps

4. **JSON Format**
   - Always wrap in fenced code blocks
   - Ensure valid JSON syntax
   - Use consistent formatting (2-space indent)

## CI Integration

### GitHub Actions Workflow

The documentation pipeline runs automatically on push:

```yaml
name: Update API Documentation

on:
  push:
    branches: [main, develop]
    paths:
      - "convex/**/*.ts"

jobs:
  update-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
      - name: Install dependencies
        run: pnpm install
      - name: Validate docstrings
        run: pnpm validate:docs
      - name: Generate documentation
        run: pnpm update:api-docs:dev
      - name: Commit changes
        run: |
          git config user.name "github-actions[bot]"
          git add docs/api-reference/convex-openapi.yaml
          git commit -m "docs: update API documentation" || exit 0
          git push
```

### Pre-commit Hook

Add to `.husky/pre-commit`:

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Validate docstrings before commit
pnpm validate:docs --file=$(git diff --cached --name-only | grep "convex/.*\.ts$")
```

## Troubleshooting

### "Docstring metadata not found"

**Cause:** Function doesn't have a docstring or parser can't find it.

**Solution:**

1. Ensure function has a JSDoc comment block (`/** ... */`)
2. Check that comment is directly above the export statement
3. Verify function name matches exactly

### "Invalid JSON in example"

**Cause:** JSON syntax error in example block.

**Solution:**

1. Validate JSON with a linter
2. Ensure proper escaping of special characters
3. Check for trailing commas
4. Verify fenced code block syntax

### "Coverage below threshold"

**Cause:** Too many functions lack documentation.

**Solution:**

1. Run `pnpm audit:docs` to see which functions need docs
2. Add docstrings to public functions
3. Focus on high-priority domains first

### "Duplicate summary detected"

**Cause:** Multiple functions have the same summary.

**Solution:**

1. Make summaries more specific
2. Include context (e.g., "Gets user by ID" vs "Gets user by WorkOS ID")

## Development Workflow

### Adding Documentation to a Function

1. **Write docstring with examples**

   ````typescript
   /**
    * @summary Gets user by ID
    * @description Returns the full user document...
    *
    * @example request
    * ```json
    * { "args": { "userId": "user_123" } }
    * ```
    *
    * @example response
    * ```json
    * { "status": "success", "value": { ... } }
    * ```
    */
   export const getUserById = query({ ... });
   ````

2. **Validate docstring**

   ```bash
   pnpm validate:docs:file=convex/users/queries.ts
   ```

3. **Create test**

   ```typescript
   test("getUserById example aligns", async () => {
     // Test implementation
   });
   ```

4. **Run test**

   ```bash
   pnpm test:run convex/test/usersExamples.test.ts
   ```

5. **Generate documentation**

   ```bash
   pnpm update:api-docs:dev
   ```

6. **Check coverage**
   ```bash
   pnpm audit:docs --domain=users
   ```

## Related Documentation

- [Test Infrastructure](../convex/test/README.md) - Test helpers and patterns
- [Requirements](../.kiro/specs/convex-backend-documentation/requirements.md) - Documentation requirements
- [Design](../.kiro/specs/convex-backend-documentation/design.md) - Documentation design
- [Tasks](../.kiro/specs/convex-backend-documentation/tasks.md) - Implementation plan
