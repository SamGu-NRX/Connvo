## ADDED Requirements

### Requirement: Friendly Operation Summaries
Convex OpenAPI documentation MUST expose human-readable Mintlify summaries for `/api/run/*` operations without relying on manual override maps.

#### Scenario: Summary derived from docstring
- **GIVEN** an operation whose exported function has a JSDoc block
- **WHEN** the enhancement script runs
- **THEN** the summary MUST use the first sentence of the docstring (or `@summary` tag if present)
- **AND** the summary MUST NOT contain raw module suffixes such as `.js:createMeeting`

#### Scenario: Summary fallback without docstring
- **GIVEN** an operation whose exported function has no JSDoc block
- **WHEN** the enhancement script runs
- **THEN** the summary MUST be generated from the function name in Title Case (e.g. `createMeeting` → `Create Meeting`)
- **AND** no manual lookup tables SHALL be required

### Requirement: Docstring-driven Descriptions
OpenAPI operations MUST include descriptions sourced from the JSDoc comment that precedes the exported Convex function.

#### Scenario: JSDoc present
- **GIVEN** an exported Convex function with a JSDoc block immediately above it
- **WHEN** the enhancement script runs
- **THEN** the OpenAPI summary MUST use the first sentence of the JSDoc block
- **AND** the description MUST include the full JSDoc text (minus comment syntax)
- **AND** the docstring's line breaks MUST be preserved so multi-paragraph documentation renders correctly

#### Scenario: JSDoc missing
- **GIVEN** no JSDoc block exists for an exported function
- **WHEN** the enhancement script runs
- **THEN** the description MUST fall back to the generated summary
- **AND** the output MUST still omit raw module path references

### Requirement: Test-aligned Examples
Request and response examples in the enhanced OpenAPI spec MUST originate from structured data embedded in source docstrings so that code comments remain the single source of truth.

#### Scenario: Docstring example parsed
- **GIVEN** a docstring includes an `@example request` or `@example response` tag containing JSON
- **WHEN** the enhancement script runs
- **THEN** the corresponding OpenAPI operation MUST embed that JSON as the example payload
- **AND** the JSON MUST be parsed programmatically from the docstring (no hard-coded maps)

#### Scenario: Shared docstring update
- **GIVEN** a developer edits the docstring examples for a function
- **WHEN** the enhancement script runs
- **THEN** the OpenAPI examples MUST reflect the updated docstring content
- **AND** the Vitest suite MUST be able to parse the same docstring example without modification
