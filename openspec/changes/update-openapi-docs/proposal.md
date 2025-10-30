# Proposal: Update Convex OpenAPI Documentation Metadata

## Why
- Generated API docs currently expose raw Convex module paths (e.g. `meetings/lifecycle.js:createMeeting`), which are hard to scan in Mintlify.
- Engineers add rich JSDoc comments in Convex functions, but the enhancement script drops that context.
- Example payloads in the spec drift from the fixtures we verify in Vitest, reducing trust in the documentation.

## What Will Change
- Generate human-friendly summaries for `/api/run/*` operations with optional overrides.
- Surface the first sentence of JSDoc comments as the summary and the remaining body as the description.
- Load request/response examples from shared fixtures that tests and the enhancement script both consume.
- Extend the enhancement script to merge overrides, docstrings, and examples into the final `docs/api-reference/convex-openapi.yaml`.

## Impact
- Mintlify renders approachable operation names with domain context pulled from code comments.
- Documentation stays in sync with the test suite because both read from the same fixture source.
- No breaking change to existing API behaviour; only documentation metadata is updated.
