# Implementation Plan

## Overview

This plan systematically adds comprehensive docstrings with test-validated examples to all public Convex functions across 15 backend domains. The existing infrastructure (docstring parser, OpenAPI enhancer, CI workflow) is already functional—we focus on achieving complete coverage.

## Task Breakdown

- [x] 1. Create documentation audit and tooling infrastructure
  - Create audit script to scan all Convex functions and generate coverage reports
  - Create docstring validation utilities to check JSON syntax and format
  - Create test helper utilities for example validation patterns
  - _Requirements: 1.1, 1.2, 7.1_

- [x] 2. Document core user management domain (convex/users/)
  - [x] 2.1 Add docstrings to convex/users/queries.ts functions
    - Document `getUserById`, `getCurrentUser`, `getUserProfile`, `getOnboardingState`, `listActiveUsersInOrg`, `getUsersByOnboardingStatus`
    - Add request/response examples for each function
    - Include error examples for authorization failures
    - _Requirements: 1.3, 2.1, 2.2_

  - [x] 2.2 Add docstrings to convex/users/mutations.ts functions
    - Document `upsertUser`, `updateUserProfile`, `updateUserInterests`, `deactivateUser`, `updateLastSeen`, `saveOnboarding`
    - Add request/response examples showing successful operations
    - Include error examples for validation failures
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ]\* 2.3 Create test file convex/test/usersExamples.test.ts
    - Validate examples for key user functions (getUserById, upsertUser, saveOnboarding)
    - Use deterministic test data matching docstring examples
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 3. Document meeting lifecycle domain (convex/meetings/)
  - [x] 3.1 Add docstrings to convex/meetings/queries.ts functions
    - Document `getMeeting` (already has examples, verify completeness), `listUserMeetings`, `listMeetingParticipants`, `getMeetingState`, `getActiveMeetings`
    - Add request/response examples with WebRTC session data
    - Include datamodel examples showing meeting structure
    - _Requirements: 1.3, 2.1, 2.2_

  - [x] 3.2 Add docstrings to convex/meetings/lifecycle.ts functions
    - Document `createMeeting`, `addParticipant`, `addMultipleParticipants`, `removeParticipant`, `updateParticipantRole`, `startMeeting`, `endMeeting`, `getMeetingConnectionInfo`, `joinMeeting`, `leaveMeeting`, `cancelMeeting`
    - Add request/response examples for each lifecycle state transition
    - Include error examples for invalid state transitions
    - _Requirements: 1.3, 2.1, 2.2_

  - [x] 3.3 Add docstrings to convex/meetings/stream/ functions
    - Document `createStreamRoom`, `generateParticipantToken`, `generateParticipantTokenPublic`, `startRecording`, `stopRecording`, `deleteStreamRoom`, `cleanupMeetingResources`
    - Add request/response examples showing GetStream integration
    - Include error examples for external service failures
    - _Requirements: 1.3, 2.1, 2.2, 6.1_

  - [ ]\* 3.4 Extend convex/test/openapiExamples.test.ts with meeting lifecycle tests
    - Validate examples for createMeeting, startMeeting, endMeeting
    - Test state transitions and participant management
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. Document transcription domain (convex/transcripts/)
  - [x] 4.1 Add docstrings to convex/transcripts/ingestion.ts functions
    - Document `ingestTranscriptChunk`, `batchIngestTranscriptChunks`, `coalescedIngestTranscriptChunks`, `getTranscriptChunks`, `getTranscriptStats`, `cleanupOldTranscripts`
    - Add request/response examples showing chunk ingestion with rate limiting
    - Include performance metrics in examples (throughput, latency)
    - _Requirements: 1.3, 2.1, 2.2_

  - [x] 4.2 Add docstrings to convex/transcripts/streaming.ts functions
    - Document `processTranscriptStream`, `updateStreamingMetrics`, `manageStreamingBackpressure`, `cleanupStreamingMetrics`, `getStreamingStats`
    - Add request/response examples showing batching and coalescing
    - Include backpressure management examples
    - _Requirements: 1.3, 2.1, 2.2_

  - [x] 4.3 Add docstrings to convex/transcripts/queries.ts and aggregation.ts functions
    - Document `getTranscriptSegments`, `listTranscriptsAfterSequence`, `aggregateTranscriptSegments`, `clearTranscriptSegmentsForMeeting`, `writeTranscriptSegmentsBatch`, `cleanupOldTranscriptSegments`
    - Add request/response examples showing segment aggregation
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ]\* 4.4 Create test file convex/test/transcriptsExamples.test.ts
    - Validate examples for ingestTranscriptChunk, processTranscriptStream
    - Test batching and coalescing behavior
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Document collaborative notes domain (convex/notes/)
  - [x] 5.1 Add docstrings to convex/notes/mutations.ts functions
    - Document `applyNoteOperation`, `batchApplyNoteOperations`, `composeConsecutiveOperations`, `rebaseNotesDocument`, `rollbackToSequence`, `cleanupOldNoteOperations`
    - Add request/response examples showing operational transform conflict resolution
    - Include examples of transformed operations and conflict detection
    - _Requirements: 1.3, 2.1, 2.2_

  - [x] 5.2 Add docstrings to convex/notes/queries.ts functions
    - Document `getMeetingNotes`
    - Add request/response examples showing note structure
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ]\* 5.3 Create test file convex/test/notesExamples.test.ts
    - Validate examples for applyNoteOperation, batchApplyNoteOperations
    - Test operational transform scenarios
    - _Requirements: 3.1, 3.2, 3.3_

- [-] 6. Document AI prompts domain (convex/prompts/)
  - [-] 6.1 Add docstrings to convex/prompts/actions.ts functions
    - Document `generatePreCallIdeas` (already has examples, verify completeness), `generateContextualPrompts`, `detectLullAndGeneratePrompts`
    - Add request/response examples showing AI-generated prompts
    - Include cache hit examples and error scenarios
    - _Requirements: 1.3, 2.1, 2.2, 6.1_

  - [ ] 6.2 Add docstrings to convex/prompts/queries.ts functions
    - Document `getPreCallPrompts`, `getInCallPrompts`, `subscribeToInCallPrompts`, `getPromptById`, `getPromptsByMeetingAndType`
    - Add request/response examples showing prompt retrieval
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ] 6.3 Add docstrings to convex/prompts/mutations.ts functions
    - Document `createPrompt`, `updatePromptFeedback`, `markPromptAsUsed`, `batchCreatePrompts`, `cleanupOldPrompts`
    - Add request/response examples showing prompt lifecycle
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ]\* 6.4 Verify convex/test/openapiExamples.test.ts prompt tests
    - Ensure generatePreCallIdeas test is comprehensive
    - Add tests for contextual prompts if needed
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 7. Document insights domain (convex/insights/)
  - [ ] 7.1 Add docstrings to convex/insights/generation.ts functions
    - Document `generateInsights`, `generateParticipantInsights`
    - Add request/response examples showing AI-generated insights
    - Include examples of action items and recommendations
    - _Requirements: 1.3, 2.1, 2.2, 6.1_

  - [ ] 7.2 Add docstrings to convex/insights/queries.ts functions
    - Document `getMeetingInsights`, `getUserInsights`, `getInsightById`, `getConnectionRecommendations`, `getInsightsByUserAndMeeting`
    - Add request/response examples showing privacy-controlled access
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ] 7.3 Add docstrings to convex/insights/mutations.ts functions
    - Document `createInsights`, `batchCreateInsights`, `updateInsightsFeedback`, `deleteInsights`, `cleanupOldInsights`
    - Add request/response examples showing insight management
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ]\* 7.4 Create test file convex/test/insightsExamples.test.ts
    - Validate examples for generateInsights, getMeetingInsights
    - Test privacy controls and per-user isolation
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 8. Document matching domain (convex/matching/)
  - [ ] 8.1 Add docstrings to convex/matching/queue.ts functions
    - Document `enterMatchingQueue`, `cancelQueueEntry`, `getQueueStatus`, `getActiveQueueEntries`, `updateQueueStatus`, `cleanupExpiredEntries`
    - Add request/response examples showing queue management
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ] 8.2 Add docstrings to convex/matching/engine.ts functions
    - Document `runMatchingCycle`, `processMatchingShard`, `getShardQueueEntries`, `createMatch`, `logMatchingMetrics`, `updateMatchOutcome`
    - Add request/response examples showing shard-based processing
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ] 8.3 Add docstrings to convex/matching/scoring.ts functions
    - Document `calculateCompatibilityScore`, `calculateCompatibilityScoreInternal`, `getUserScoringData`
    - Add request/response examples showing compatibility calculations
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ] 8.4 Add docstrings to convex/matching/analytics.ts functions
    - Document `submitMatchFeedback`, `getMatchHistory`, `getMatchingStats`, `getGlobalMatchingAnalytics`, `optimizeMatchingWeights`, `getMatchesForOptimization`
    - Add request/response examples showing analytics data
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ]\* 8.5 Create test file convex/test/matchingExamples.test.ts
    - Validate examples for enterMatchingQueue, calculateCompatibilityScore
    - Test matching algorithm behavior
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 9. Document embeddings domain (convex/embeddings/)
  - [ ] 9.1 Add docstrings to convex/embeddings/actions.ts functions
    - Document `generateEmbedding`, `generateEmbeddingsBatch`, `generateUserProfileEmbedding`, `generateMeetingEmbedding`, `advancedVectorSearch`
    - Add request/response examples showing OpenAI integration
    - Include error examples for API failures
    - _Requirements: 1.3, 2.1, 2.2, 6.1_

  - [ ] 9.2 Add docstrings to convex/embeddings/queries.ts functions
    - Document `getEmbedding`, `getEmbeddingsBySource`, `getEmbeddingsByModel`, `vectorSimilaritySearch`, `getEmbeddingAnalytics`, `getVectorIndexMeta`, `findSimilarEmbeddingsBySource`, `getEmbeddingWithSource`, `embeddingExistsForSource`
    - Add request/response examples showing vector search results
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ] 9.3 Add docstrings to convex/embeddings/mutations.ts functions
    - Document `createEmbedding`, `updateEmbedding`, `deleteEmbedding`, `deleteEmbeddingsBySource`, `batchUpsertEmbeddings`, `upsertVectorIndexMeta`, `updateVectorIndexStatus`
    - Add request/response examples showing embedding lifecycle
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ]\* 9.4 Create test file convex/test/embeddingsExamples.test.ts
    - Validate examples for generateEmbedding, vectorSimilaritySearch
    - Test vector operations with deterministic data
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 10. Document real-time subscriptions domain (convex/realtime/)
  - [ ] 10.1 Add docstrings to convex/realtime/subscriptions.ts functions
    - Document `subscribeMeetingNotes`, `subscribeTranscriptStream`, `subscribeMeetingParticipants`, `validateSubscription`, `terminateSubscription`
    - Add request/response examples showing subscription lifecycle
    - Include bandwidth management examples
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ]\* 10.2 Create test file convex/test/realtimeExamples.test.ts
    - Validate examples for subscribeMeetingNotes, subscribeTranscriptStream
    - Test subscription validation
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 11. Document supporting domains (profiles, interests, monitoring, system)
  - [ ] 11.1 Add docstrings to convex/profiles/queries.ts functions
    - Document `getProfileByUserId`, `getCurrentUserProfile`, `getProfileByUserIdPublic`
    - Add request/response examples showing profile data
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ] 11.2 Add docstrings to convex/interests/queries.ts functions
    - Document `listCatalog`, `getUserInterests`, `seedDefault`
    - Add request/response examples showing interest catalog
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ] 11.3 Add docstrings to convex/monitoring/ functions
    - Document `checkBandwidthLimit`, `getBandwidthStats`, `executeWithCircuitBreaker`, `getCircuitBreakerStatus`, `resetCircuitBreaker`, `shouldShedLoad` in bandwidthManager.ts
    - Document `createAlert` in alerts.ts
    - Add request/response examples showing monitoring data
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ] 11.4 Add docstrings to convex/system/ functions
    - Document `getKey`, `createKey`, `patchKey`, `deleteKey`, `resolveResult`, `enforceRateLimit` in idempotency.ts
    - Document `enforce` in rateLimit.ts
    - Document `cleanupQueryOptimizers` in maintenance.ts
    - Add request/response examples showing system operations
    - _Requirements: 1.3, 2.1, 2.2_

  - [ ] 11.5 Add docstrings to convex/audit/logging.ts functions
    - Document `logDataAccessEvent`, `logAuthorizationEvent`, `createAuditLog`, `getAuditLogs`
    - Add request/response examples showing audit trail
    - _Requirements: 1.3, 2.1, 2.2_

- [ ] 12. Run comprehensive documentation validation
  - Run audit script to verify 100% coverage of public functions
  - Run all example validation tests to ensure accuracy
  - Execute `pnpm run update:api-docs:dev` to generate OpenAPI spec
  - Verify Redocly validation passes without errors
  - Check for duplicate summaries or descriptions
  - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2_

- [ ] 13. Update documentation generation pipeline
  - Verify CI workflow runs successfully with all new docstrings
  - Ensure auto-commit of updated OpenAPI spec works
  - Test documentation generation for staging and prod environments
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 14. Create developer documentation
  - Document docstring format and requirements in convex/README.md
  - Create examples of good docstrings for each function type (query, mutation, action)
  - Document test validation patterns for future contributors
  - Add pre-commit hook to validate docstring format
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 15. Establish quality metrics and monitoring
  - Create coverage dashboard showing documentation completeness
  - Set up alerts for documentation drift (examples not matching behavior)
  - Document coverage thresholds for CI quality gates
  - Create monthly documentation review process
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

## Notes

- Tasks marked with `*` are optional testing tasks that can be skipped for faster MVP delivery
- Each domain should be completed sequentially to maintain consistency
- Use existing docstrings (getMeeting, generatePreCallIdeas) as reference patterns
- All examples must use deterministic IDs and timestamps for test reproducibility
- Focus on public functions first; internal functions can have minimal docstrings
