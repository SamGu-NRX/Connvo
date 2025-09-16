# Implementation Plan

- [x] 1. Create centralized type system foundation
  - Create `convex/types/` directory structure with entities, validators, api, and domain subdirectories
  - Define base TypeScript interfaces for all core entities (User, Meeting, Transcript, etc.)
  - Set up type derivation utilities and helper functions for consistent type patterns
  - Add barrel exports: `convex/types/entities/index.ts`, `convex/types/validators/index.ts`, `convex/types/api/index.ts`
  - Add shared utility types: Result<T, E>, PaginationResult<T>, branded time types (EpochMs, DurationMs)
  - Ensure Convex compliance scaffolding: template function with args and returns validators
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Implement core entity type definitions
- [x] 2.1 Create User entity types and validators
  - Define User, UserProfile, AuthIdentity interfaces in `convex/types/entities/user.ts`
  - Create derived types (UserPublic, UserPublicWithEmail, UserSummary, UserWithProfile, etc.)
  - Implement validators in `convex/types/validators/user.ts` and export as `UserV`
  - Add type tests to enforce alignment between TS types and validators
  - _Requirements: 1.1, 2.1, 2.2, 4.1, 4.2_

- [x] 2.2 Create Meeting entity types and validators
  - Define Meeting, MeetingParticipant, MeetingRuntimeState interfaces and MeetingLifecycleState union in `convex/types/entities/meeting.ts`
  - Create extended types (MeetingWithUserRole, MeetingListItem, etc.)
  - Generate corresponding Convex validators in `convex/types/validators/meeting.ts`
  - Ensure state naming has no collisions and is intuitive (Lifecycle vs Runtime)
  - _Requirements: 1.1, 2.1, 2.2, 4.1, 4.2_

- [x] 2.3 Create Transcript entity types and validators
  - Define Transcript, TranscriptSegment, TranscriptionSession interfaces in `convex/types/entities/transcript.ts`
  - Create API response types (TranscriptChunk, TranscriptStats, etc.)
  - Generate corresponding Convex validators in `convex/types/validators/transcript.ts`
  - Define and enforce necessary indexes in schema for index-first queries (e.g., by_meeting_and_sequence, by_meeting_and_bucket)
  - _Requirements: 1.1, 2.1, 2.2, 4.1, 4.2_

- [x] 3. Implement domain-specific complex types
- [x] 3.1 Create Operational Transform types
  - Define Operation, OperationWithNoteOperation interfaces in `convex/types/domain/operational-transform.ts`
  - Create result types (NoteOperationResult) for OT operations
  - Generate validators for complex OT data structures
  - _Requirements: 1.1, 2.1, 2.2, 4.1, 4.2_

- [x] 3.2 Create WebRTC signaling types
  - Define WebRTCSession, WebRTCSignal, ConnectionMetrics interfaces in `convex/types/entities/webrtc.ts`
  - Create union types for session states and signal types
  - Generate validators for WebRTC data structures
  - Use discriminated unions in validators for signal data (SDP vs ICE)
  - _Requirements: 1.1, 2.1, 2.2, 4.1, 4.2_

- [x] 3.3 Create matching system types
  - Define MatchingQueueEntry, MatchingAnalytics, CompatibilityFeatures interfaces in `convex/types/entities/matching.ts`
  - Create result types (MatchResult, QueueStatus) for matching operations
  - Generate validators for matching algorithm data
  - _Requirements: 1.1, 2.1, 2.2, 4.1, 4.2_

- [x] 4. Create API response and pagination types
- [x] 4.1 Implement standardized API response patterns
  - Create common response wrapper types in `convex/types/api/responses.ts`
  - Define error response structures and success patterns
  - Implement pagination types and metadata structures
  - Provide standardized PaginationResult validators and Result<T, E> utilities
  - _Requirements: 2.3, 2.4, 2.5, 8.1, 8.2_

- [x] 4.2 Create vector embeddings and AI types
  - Define Embedding, VectorIndexMeta, SimilaritySearchResult interfaces in `convex/types/entities/embedding.ts`
  - Create AI prompt and insight types for ML features
  - Generate validators for vector search operations
  - Store embeddings as ArrayBuffer (v.bytes) + helpers to convert to/from Float32Array; avoid number[] for performance
  - _Requirements: 1.1, 2.1, 2.2, 4.1, 4.2_

- [x] 5. Refactor user-related functions to use centralized types
- [x] 5.1 Update user queries to use centralized types
  - Refactor `convex/users/queries.ts` to import and use UserValidators
  - Replace inline type definitions with centralized User types
  - Update return type annotations to use proper TypeScript types
  - Ensure functions include both args and returns validators
  - Ensure index-first query usage (withIndex) per convex_rules.mdc; add missing schema indexes if required
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [x] 5.2 Update user mutations to use centralized types
  - Refactor `convex/users/mutations.ts` to use centralized validators
  - Replace duplicate User type definitions with shared types
  - Ensure consistent return types across all user mutations
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [x] 6. Refactor meeting-related functions to use centralized types
- [x] 6.1 Update meeting queries to use centralized types
  - Refactor `convex/meetings/queries.ts` to import and use MeetingValidators
  - Replace inline Meeting type definitions with centralized types
  - Update participant-related functions to use consistent types
  - Add/verify indexes for common lookup patterns (by_organizer, by_state, by_meeting_and_user)
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [x] 6.2 Update meeting mutations to use centralized types
  - Refactor `convex/meetings/mutations.ts` to use centralized validators
  - Replace duplicate Meeting and Participant type definitions
  - Ensure consistent state management types across meeting lifecycle
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [x] 7. Refactor transcript and notes functions to use centralized types
- [x] 7.1 Update transcript ingestion functions
  - Refactor `convex/transcripts/ingestion.ts` to use TranscriptValidators
  - Replace inline transcript type definitions with centralized types
  - Update streaming and batch processing functions to use consistent types
  - Use index-first ingestion and retrieval (by_meeting_and_sequence) to prevent scans
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [x] 7.2 Update operational transform functions
  - Refactor `convex/notes/operations.ts` to use OT domain types
  - Replace inline Operation type definitions with centralized types
  - Update note collaboration functions to use consistent OT types
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [x] 8. Refactor WebRTC and real-time functions to use centralized types
- [x] 8.1 Update WebRTC signaling functions
  - Refactor WebRTC session management to use centralized WebRTC types
  - Replace inline signal type definitions with centralized validators
  - Update connection metrics functions to use consistent types
  - Ensure actions (for signaling via external services) do not access ctx.db
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [x] 8.2 Update real-time subscription functions
  - Refactor `convex/realtime/subscriptionManager.ts` to use centralized types
  - Replace inline subscription type definitions with shared types
  - Update presence and notification functions to use consistent types
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [x] 9. Refactor matching and analytics functions to use centralized types
- [x] 9.1 Update matching algorithm functions
  - Refactor `convex/matching/index.ts` to use MatchingValidators
  - Replace inline compatibility scoring types with centralized types
  - Update queue management functions to use consistent types
  - Ensure necessary indexes (e.g., by_status, by_user, by_available_window) exist for index-first queries
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [x] 9.2 Update analytics and insights functions
  - Refactor `convex/insights/generation.ts` to use centralized types
  - Replace inline analytics type definitions with shared types
  - Update ML feature extraction functions to use consistent types
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [ ] 10. Refactor AI and embeddings functions to use centralized types
- [ ] 10.1 Update vector search functions
  - Refactor embedding generation and search functions to use EmbeddingValidators
  - Replace inline vector type definitions with centralized types
  - Update similarity search functions to use consistent result types
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [ ] 10.2 Update AI prompt and insight functions
  - Refactor AI prompt management to use centralized prompt types
  - Replace inline insight type definitions with shared types
  - Update LLM integration functions to use consistent types
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2_

- [ ] 11. Create comprehensive type validation and testing
- [ ] 11.1 Implement type consistency validation utilities
  - Create utilities to validate validator-type alignment across all modules
  - Implement automated checks for type drift detection
  - Create type safety test helpers for function validation
  - Add tsd or vitest-based type tests to compare TS types vs validator Inferred types
  - Add CI job to run type tests, lint, and Convex codegen checks
  - _Requirements: 3.4, 3.5, 6.4, 6.5, 8.3, 8.4_

- [ ] 11.2 Create comprehensive test suite for type consistency
  - Write unit tests for all centralized type validators
  - Create integration tests for function type consistency across all modules
  - Implement property-based tests for complex domain types (OT, WebRTC, Vector Search)
  - _Requirements: 3.4, 3.5, 6.4, 6.5, 8.3, 8.4_

- [ ] 12. Performance validation and optimization
- [ ] 12.1 Validate performance impact across all functions
  - Measure compile-time impact of centralized types across 100+ functions
  - Validate runtime performance has no degradation
  - Ensure bundle size optimization with tree-shaking
  - Validate vector embeddings using v.bytes (ArrayBuffer) reduce payload size vs number[]
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 12.2 Create monitoring and maintenance tools
  - Implement CI/CD checks for type consistency across all modules
  - Create developer tools for type exploration and validation
  - Set up automated type drift detection and alerts
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.3, 8.4_

- [ ] 13. Documentation and developer experience improvements
- [ ] 13.1 Create comprehensive type documentation
  - Document all centralized entity types with JSDoc comments
  - Create usage guides for complex domain types (OT, WebRTC, Vector Search)
  - Write migration guide for developers updating existing functions
  - Document Convex compliance checklist and index-first query patterns
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 13.2 Finalize cleanup and validation
  - Remove all deprecated inline type definitions across codebase
  - Validate TypeScript compilation with strict mode across all modules
  - Perform final audit of type consistency across 100+ functions
  - _Requirements: 4.3, 4.4, 4.5, 6.3, 6.4, 6.5_
