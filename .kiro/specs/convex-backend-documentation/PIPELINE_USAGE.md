# Documentation Pipeline Usage Guide

Quick reference for using the Convex backend documentation generation pipeline.

## Quick Start

### Generate Documentation Locally

```bash
# Development environment (default)
pnpm run update:api-docs:dev

# Staging environment
pnpm run update:api-docs:staging

# Production environment
pnpm run update:api-docs:prod
```

### Test CI Workflow

```bash
# Simulate the GitHub Actions workflow locally
pnpm run test:ci-workflow
```

### Validate Documentation

```bash
# Audit docstring coverage
pnpm run audit:docs

# Validate docstring format
pnpm run validate:docs

# Validate specific file
pnpm run validate:docs:file convex/users/queries.ts
```

## Pipeline Components

### 1. Documentation Generation

**Script:** `scripts/update-api-docs.sh`

**What it does:**

1. Applies compatibility patches
2. Generates base OpenAPI spec with convex-helpers
3. Enhances spec with docstring metadata
4. Validates enhanced spec with Redocly
5. Outputs to `docs/api-reference/convex-openapi.yaml`

**Environment variables:**

- `CONVEX_URL_DEV` - Development deployment URL
- `CONVEX_URL_STAGING` - Staging deployment URL
- `CONVEX_URL_PROD` - Production deployment URL

### 2. Docstring Enhancement

**Script:** `scripts/enhance-openapi.ts`

**What it does:**

- Parses docstrings from Convex functions
- Injects summaries and descriptions into OpenAPI spec
- Adds request/response examples
- Configures security schemes
- Assigns domain-based tags
- Removes internal operations

### 3. Validation

**Script:** `scripts/validate-openapi.ts`

**What it does:**

- Validates YAML syntax
- Checks OpenAPI 3.x schema compliance
- Verifies server URLs
- Validates security schemes
- Checks operation descriptions

### 4. CI Workflow

**File:** `.github/workflows/api-docs.yml`

**Triggers:**

- Push to `main` branch
- Changes to `convex/**`, `scripts/**`, `docs/**`, etc.
- Manual workflow dispatch

**What it does:**

1. Checks out repository
2. Installs dependencies
3. Regenerates OpenAPI spec
4. Detects changes
5. Auto-commits updated documentation

## Docstring Format

### Basic Structure

````typescript
/**
 * @summary Brief description (verb phrase)
 * @description Detailed explanation of behavior, parameters, side effects
 *
 * @example request
 * ```json
 * { "args": { "userId": "user_123" } }
 * ```
 *
 * @example response
 * ```json
 * { "status": "success", "value": { "name": "Alice" } }
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

- `request` - Input arguments
- `response` - Successful response
- `response-error` - Error response
- `response-cache` - Cached response (for actions)
- `datamodel` - Data structure examples

## Common Tasks

### Adding Documentation to a New Function

1. Add JSDoc comment above function export
2. Include `@summary` and `@description`
3. Add at least one `@example request` and `@example response`
4. Run `pnpm run validate:docs:file <file-path>` to check format
5. Run `pnpm run update:api-docs:dev` to regenerate spec
6. Commit changes (CI will auto-update OpenAPI spec)

### Fixing Validation Warnings

1. Run `pnpm run update:api-docs:dev` to see warnings
2. Check warning details in output
3. Update docstring examples to match schema
4. Re-run validation to confirm fix

### Testing Before Push

```bash
# 1. Validate docstrings
pnpm run validate:docs

# 2. Generate documentation
pnpm run update:api-docs:dev

# 3. Test CI workflow
pnpm run test:ci-workflow

# 4. Check for changes
git status docs/api-reference/convex-openapi.yaml
```

## Troubleshooting

### "Example value must conform to the schema"

**Cause:** Example JSON doesn't match the function's validator schema

**Fix:** Update example to include all required fields and correct types

### "No docstring found for function"

**Cause:** Missing JSDoc comment or incorrect placement

**Fix:** Add JSDoc comment directly above `export const functionName`

### "Invalid JSON in example"

**Cause:** Malformed JSON in example block

**Fix:** Validate JSON syntax, ensure proper escaping

### "Placeholder server URL detected"

**Cause:** Environment variables not set

**Fix:** Set `CONVEX_URL_DEV`, `CONVEX_URL_STAGING`, `CONVEX_URL_PROD`

## Best Practices

### Writing Good Docstrings

✅ **Do:**

- Use clear, concise summaries (verb phrases)
- Include detailed descriptions for complex behavior
- Provide realistic example data
- Document error scenarios
- Use consistent terminology

❌ **Don't:**

- Copy-paste generic descriptions
- Use placeholder data (e.g., "string", "number")
- Omit error examples for critical operations
- Include implementation details in descriptions

### Example Data

✅ **Good:**

```json
{
  "args": {
    "userId": "user_alice123",
    "email": "alice@example.com"
  }
}
```

❌ **Bad:**

```json
{
  "args": {
    "userId": "string",
    "email": "string"
  }
}
```

### Maintaining Documentation

1. **Update docstrings when changing function behavior**
2. **Run validation before committing**
3. **Review CI workflow output for warnings**
4. **Address schema mismatches promptly**
5. **Keep examples synchronized with tests**

## CI Workflow Details

### When It Runs

- Every push to `main` branch
- When files in these paths change:
  - `convex/**`
  - `scripts/**`
  - `docs/**`
  - `mint.json`
  - `package.json`
  - `pnpm-lock.yaml`
  - `redocly.yaml`

### What Gets Committed

- Only `docs/api-reference/convex-openapi.yaml`
- Commit message: "chore: update API documentation"
- Co-authored by actor and github-actions bot

### Monitoring

Check workflow status:

1. Go to GitHub Actions tab
2. Find "Update API Docs" workflow
3. Review run details and logs

## Resources

- **OpenAPI Spec:** `docs/api-reference/convex-openapi.yaml`
- **Validation Report:** `.kiro/specs/convex-backend-documentation/PIPELINE_VALIDATION.md`
- **Requirements:** `.kiro/specs/convex-backend-documentation/requirements.md`
- **Design:** `.kiro/specs/convex-backend-documentation/design.md`
- **Tasks:** `.kiro/specs/convex-backend-documentation/tasks.md`

## Support

For issues or questions:

1. Check validation output for specific errors
2. Review this guide for common solutions
3. Consult the design document for architecture details
4. Check CI workflow logs for deployment issues
