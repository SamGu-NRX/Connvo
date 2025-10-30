# Design Document

## Overview

Enhance documentation coverage across the entire Convex backend by systematically adding comprehensive docstrings with test-validated examples to all public functions. The existing infrastructure (`docstringParser.ts`, `enhance-openapi.ts`, CI workflow) is already functional—this spec focuses on achieving complete coverage and establishing quality standards.

## Current State Analysis

**Existing Infrastructure:**

- ✅ `scripts/docstringParser.ts` - Parses JSDoc with `@summary`, `@description`, `@example` tags
- ✅ `scripts/enhance-openapi.ts` - Injects docstring metadata into OpenAPI spec
- ✅ `scripts/update-api-docs.sh` - Orchestrates generation pipeline
- ✅ `.github/workflows/api-docs.yml` - Auto-commits updated specs
- ✅ `convex/test/openapiExamples.test.ts` - Example validation pattern established

**Current Coverage:**

- ✅ `convex/meetings/queries.ts:getMeeting` - Complete with examples
- ✅ `convex/prompts/actions.ts:generatePreCallIdeas` - Complete with examples
- ⚠️ `convex/users/queries.ts:getUserById` - Has examples but minimal
- ⚠️ Most other functions - Missing examples or incomplete docstrings
- ❌ Many functions - No docstrings at all

## Architecture

### Documentation Structure

````typescript
/**
 * @summary Brief verb phrase (e.g., "Gets meeting by ID")
 * @description Multi-sentence explanation of behavior, parameters, side effects
 *
 * @example request
 * ```json
 * { "args": { "meetingId": "meeting_123" } }
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

### Coverage Strategy

**Phase 1: Audit & Prioritize**

1. Scan all `convex/**/*.ts` files for `export const ... = query|mutation|action`
2. Categorize by domain: users, meetings, transcripts, notes, prompts, insights, matching, embeddings
3. Identify high-priority public APIs (used by frontend, external integrations)

**Phase 2: Domain-by-Domain Enhancement**

1. Start with core domains (users, meetings)
2. Add docstrings following established patterns
3. Create/extend tests to validate examples
4. Run documentation pipeline to verify

**Phase 3: Quality Assurance**

1. Validate all examples are valid JSON
2. Ensure examples match actual function behavior via tests
3. Verify OpenAPI spec generation succeeds
4. Check for duplicate/inconsistent descriptions

## Components and Interfaces

### Docstring Templates

**Query Template:**

````typescript
/**
 * @summary [Verb phrase describing what data is retrieved]
 * @description [Detailed explanation including authorization, filtering, performance notes]
 *
 * @example request
 * ```json
 * { "args": { [realistic input matching validator] } }
 * ```
 *
 * @example response
 * ```json
 * { "status": "success", "value": [realistic output matching return type] }
 * ```
 */
````

**Mutation Template:**

````typescript
/**
 * @summary [Verb phrase describing what is modified]
 * @description [Detailed explanation including side effects, validation, idempotency]
 *
 * @example request
 * ```json
 * { "args": { [realistic input] } }
 * ```
 *
 * @example response
 * ```json
 * { "status": "success", "value": { "success": true, [result data] } }
 * ```
 *
 * @example response-error
 * ```json
 * { "status": "error", "errorData": { "code": "[ERROR_CODE]", "message": "..." } }
 * ```
 */
````

**Action Template:**

````typescript
/**
 * @summary [Verb phrase describing external operation]
 * @description [Detailed explanation including external dependencies, retry behavior, caching]
 *
 * @example request
 * ```json
 * { "args": { [realistic input] } }
 * ```
 *
 * @example response
 * ```json
 * { "status": "success", "value": { [result with external data] } }
 * ```
 *
 * @example response-cache
 * ```json
 * { "status": "success", "value": { "fromCache": true, ... } }
 * ```
 *
 * @example response-error
 * ```json
 * { "status": "error", "errorData": { "code": "EXTERNAL_SERVICE_ERROR", ... } }
 * ```
 */
````

### Test Validation Pattern

```typescript
// convex/test/[domain]Examples.test.ts
test("[functionName] example aligns with actual behavior", async () => {
  const t = createTestEnvironment();

  // 1. Load docstring examples
  const docInfo = getDocstringInfoForOperation("convex/[path].ts", "[functionName]");
  const requestExample = getExampleValue(docInfo, "request");
  const responseExample = getExampleValue(docInfo, "response");

  // 2. Set up test data matching examples
  const { testId } = await t.run(async (ctx) => {
    // Create deterministic test data
  });

  // 3. Execute function with example input
  const result = await t.query(api.[domain].[functionName], requestExample.args);

  // 4. Normalize dynamic values (IDs, timestamps)
  const normalized = { ...result, _id: responseExample.value._id };

  // 5. Assert match
  expect(normalized).toMatchObject(responseExample.value);
});
```

## Data Models

### Coverage Tracking

Track documentation coverage per domain:

```typescript
interface CoverageReport {
  domain: string;
  totalFunctions: number;
  documented: number;
  withExamples: number;
  withTests: number;
  coverage: number; // percentage
}
```

### Example Metadata

```typescript
interface ExampleMetadata {
  functionPath: string;
  functionName: string;
  exampleLabels: string[]; // ["request", "response", "response-error"]
  validated: boolean; // has corresponding test
  lastUpdated: number;
}
```

## Implementation Plan

### 1. Create Audit Script

```bash
# scripts/audit-docstrings.ts
# - Scans convex/**/*.ts for public functions
# - Checks for docstring presence
# - Validates example JSON
# - Generates coverage report
```

### 2. Domain-Specific Enhancement

**Priority Order:**

1. `convex/users/` - Core identity functions
2. `convex/meetings/` - Meeting lifecycle
3. `convex/transcripts/` - Transcription APIs
4. `convex/notes/` - Collaborative editing
5. `convex/prompts/` - AI prompt generation
6. `convex/insights/` - Post-call analytics
7. `convex/matching/` - User matching
8. `convex/embeddings/` - Vector search

**Per Domain:**

1. List all public functions
2. Add docstrings following templates
3. Create/extend test file with example validation
4. Run `pnpm run update:api-docs:dev`
5. Verify OpenAPI spec updates

### 3. Quality Gates

**Pre-commit:**

- Validate docstring JSON syntax
- Check for duplicate summaries
- Ensure examples match validators

**CI Pipeline:**

- Run example validation tests
- Generate coverage report
- Fail if coverage drops below threshold

## Error Handling

**Invalid JSON in Examples:**

- Parser reports file, line, and JSON error
- CI fails with actionable message

**Example/Behavior Mismatch:**

- Test fails with diff showing expected vs actual
- Developer updates either docstring or test

**Missing Required Tags:**

- Audit script warns about functions without `@summary`
- Optional: Fail CI if public functions lack docstrings

## Testing Strategy

**Unit Tests:**

- Test docstring parser with various formats
- Test example extraction and validation

**Integration Tests:**

- Validate examples against actual function execution
- Use deterministic test data for reproducibility
- Normalize dynamic values (IDs, timestamps) before comparison

**End-to-End Tests:**

- Run full documentation pipeline
- Verify OpenAPI spec generation
- Check Redocly validation passes

## Performance Considerations

**Audit Script:**

- Cache file reads to avoid repeated I/O
- Parallel processing for large codebases

**Test Execution:**

- Group tests by domain for parallel execution
- Use shared test fixtures to reduce setup time

**Documentation Generation:**

- Incremental updates (only changed files)
- Cache parsed docstrings between runs
