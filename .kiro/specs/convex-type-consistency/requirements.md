# Requirements Document

## Introduction

The LinkedUp Convex backend currently suffers from significant type inconsistencies and duplication acns. Each query, mutation, and action defines its own return types inline, leading to:

- **Type Duplication**: The same entity types (User, Meeting, etc.) are redefined multiple times with slight variations
- **Inconsistent Return Types**: Similar functions return different shaped objects for the same entities
- **Maintenance Overhead**: Changes to data models require updating types in multiple locations
- **Type Safety Gaps**: Lack of centralized type definitions makes it easy to introduce type mismatches
- **Developer Experience Issues**: No single source of truth for entity types across the backend

This feature aims to establish a comprehensive, centralized type system that ensures consistency across all Convex functions while maintaining full type safety and improving developer experience.

## Requirements

### Requirement 1 — Centralized Type Definitions

**User Story:** As a developer, I want centralized type definitions for all entities so that I have a single source of truth for data shapes.

#### Acceptance Criteria

1. WHEN defining entity types THEN the system SHALL create a centralized types module with complete type definitions for all database entities
2. WHEN creating return types THEN functions SHALL use shared type definitions instead of inline type definitions
3. WHEN entity schemas change THEN only the centralized type definitions SHALL need to be updated
4. WHEN adding new entities THEN their types SHALL be defined in the centralized location following established patterns
5. WHEN reviewing code THEN all entity types SHALL be imported from the centralized types module
6. WHEN defining public vs internal shapes THEN public API types SHALL be explicitly distinct (no accidental leakage of internal/private fields)
7. WHEN creating shared validators THEN validators SHALL live alongside centralized types and be imported, not duplicated

### Requirement 2 — Consistent Return Type Patterns

**User Story:** As a developer, I want consistent return types across similar functions so that client code can rely on predictable data shapes.

#### Acceptance Criteria

1. WHEN querying entities THEN similar functions SHALL return consistently shaped objects with the same field names and types
2. WHEN returning user data THEN all user-related functions SHALL use the same base User type with consistent optional/required fields
3. WHEN returning meeting data THEN all meeting-related functions SHALL use the same base Meeting type with consistent participant information
4. WHEN returning lists THEN all list functions SHALL use consistent pagination and metadata patterns
5. WHEN handling relationships THEN related entity data SHALL be consistently shaped across all functions that include it
6. WHEN implementing pagination THEN all paginated functions SHALL return a standardized PaginationResult shape with page, isDone, and continueCursor matching Convex guidelines
7. WHEN wrapping responses THEN a shared Result<T> envelope MAY be used for public APIs for consistency and error handling (without adding runtime overhead)

### Requirement 3 — Type-Safe Function Signatures

**User Story:** As a developer, I want all Convex functions to have properly typed arguments and return values so that I can catch type errors at compile time.

#### Acceptance Criteria

1. WHEN defining function arguments THEN all functions SHALL use proper Convex validators that match TypeScript types
2. WHEN defining return types THEN all functions SHALL use Convex validators that correspond to centralized TypeScript types
3. WHEN calling functions THEN TypeScript SHALL provide accurate type checking and autocomplete
4. WHEN refactoring types THEN TypeScript compiler SHALL catch all affected locations
5. WHEN generating client types THEN Convex SHALL produce accurate TypeScript definitions for all functions
6. WHEN defining functions THEN ALL functions SHALL include both args and returns validators per convex_rules.mdc
7. WHEN defining functions THEN the new function syntax SHALL be used (query/mutation/internal\*, httpAction)

### Requirement 4 — Elimination of Type Duplication

**User Story:** As a developer, I want to eliminate duplicate type definitions so that the codebase is maintainable and consistent.

#### Acceptance Criteria

1. WHEN auditing the codebase THEN no entity type SHALL be defined in multiple locations
2. WHEN creating new functions THEN developers SHALL reuse existing type definitions rather than creating new ones
3. WHEN updating entity types THEN changes SHALL automatically propagate to all functions using those types
4. WHEN reviewing pull requests THEN type definitions SHALL be centralized and not duplicated
5. WHEN building the project THEN TypeScript SHALL validate that all type usage is consistent
6. WHEN defining validators THEN the same validator instance SHALL be reused across functions (no inline redefinitions)

### Requirement 5 — Improved Developer Experience

**User Story:** As a developer, I want excellent TypeScript support and clear type definitions so that I can work efficiently and catch errors early.

#### Acceptance Criteria

1. WHEN writing code THEN IDE SHALL provide accurate autocomplete for all entity properties
2. WHEN making type errors THEN TypeScript SHALL provide clear, actionable error messages
3. WHEN exploring the codebase THEN developers SHALL easily find and understand entity type definitions
4. WHEN onboarding new developers THEN type definitions SHALL be self-documenting and easy to understand
5. WHEN debugging type issues THEN developers SHALL have clear visibility into type relationships and constraints
6. WHEN exploring types THEN barrel exports SHALL be provided for entities, validators, and API types to reduce import friction

### Requirement 6 — Backward Compatibility and Migration Safety

**User Story:** As a developer, I want to refactor types without breaking existing functionality so that the migration is safe and incremental.

#### Acceptance Criteria

1. WHEN refactoring types THEN existing function behavior SHALL remain unchanged
2. WHEN updating return types THEN client code SHALL continue to work without modifications
3. WHEN migrating functions THEN changes SHALL be made incrementally with validation at each step
4. WHEN testing migrations THEN comprehensive tests SHALL verify that all functions return expected data shapes
5. WHEN deploying changes THEN runtime behavior SHALL be identical to the previous implementation
6. WHEN introducing public shape changes THEN transitional adapter functions SHALL be provided if necessary to avoid breaking clients

### Requirement 7 — Performance and Bundle Size Optimization

**User Story:** As a developer, I want type definitions that don't negatively impact runtime performance or bundle size so that the application remains fast.

#### Acceptance Criteria

1. WHEN defining types THEN type definitions SHALL be compile-time only and not affect runtime performance
2. WHEN building the application THEN type definitions SHALL not increase bundle size
3. WHEN using shared types THEN there SHALL be no runtime overhead compared to inline type definitions
4. WHEN optimizing performance THEN type checking SHALL not slow down development builds
5. WHEN deploying THEN type definitions SHALL be stripped from production builds
6. WHEN storing large numeric arrays (e.g., embeddings) THEN binary storage via v.bytes() with Float32Array SHALL be preferred over number[] for price-performance

### Requirement 8 — Documentation and Maintainability

**User Story:** As a developer, I want well-documented type definitions so that I can understand and maintain the type system effectively.

#### Acceptance Criteria

1. WHEN defining types THEN all entity types SHALL include JSDoc comments explaining their purpose and usage
2. WHEN creating complex types THEN documentation SHALL explain relationships and constraints
3. WHEN updating types THEN documentation SHALL be updated to reflect changes
4. WHEN reviewing code THEN type definitions SHALL be self-explanatory and well-organized
5. WHEN troubleshooting THEN developers SHALL have clear guidance on type usage patterns

### Requirement 9 — Convex Guidelines Compliance (Essential)

**User Story:** As a developer, I want all Convex functions to follow established best practices so that the application is performant, maintainable, and follows framework conventions.

#### Acceptance Criteria

1. WHEN defining any Convex function THEN the new function syntax with args and returns validators SHALL be used
2. WHEN writing queries THEN index-first patterns SHALL be used (no q.filter scans); required indexes SHALL be declared in schema
3. WHEN structuring actions THEN actions SHALL NOT access ctx.db and SHALL call queries/mutations via ctx.run\*
4. WHEN calling functions THEN only api._ and internal._ SHALL be used with ctx.runQuery/mutation/action
5. WHEN handling pagination THEN paginationOptsValidator SHALL be used for args and standardized PaginationResult SHALL be returned
6. WHEN working with records/maps THEN v.record SHALL be used (v.map/v.set are unsupported)
