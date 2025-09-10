# Requirements Document

## Introduction

LinkedUp’s backend must migrate from Drizzle ORM + PostgreSQL/Supabase to Convex to enable enterprise-grade, real-time experiences: pre-call idea generation, in-call prompts, collaborative notes, live transcription, and post-call insights. Current matching and video call features are incomplete and not wired to robust data flows. This spec defines a rigorous, TypeScript-first, reactive foundation in Convex, with secure, isolated, per-meeting data streams; scalable schemas and indexes; WorkOS-authenticated access; and clear performance/observability standards. Some advanced features will be stubbed/mocked initially with plug-and-play architecture for future expansion (e.g., “knowledge bank”).

This feature involves migrating LinkedUp's current database architecture from Drizzle ORM with PostgreSQL/Supabase to Convex, a modern reactive backend-as-a-service platform. LinkedUp is a professional networking application that currently features basic matching and video calling, but requires significant enhancement with advanced real-time capabilities:

**Current Features:**

- Basic user profiles and interests management
- Simulated smart matching (currently mock implementation)
- Video meetings with Stream integration (INCOMPLETE, NEED TO FIX)
- Basic chat and meeting controls

**New Advanced Features to Implement:**

- **Pre-call Idea Generation**: AI-powered conversation starters and meeting preparation based on participant profiles
- **Real-time In-call Features**: Live conversation prompts, shared meeting notes, and collaborative tools
- **Post-call Insights**: Transcription analysis, meeting summaries, and connection recommendations
- **Live Transcription**: Real-time speech-to-text with participant-specific accuracy
- **Collaborative Notes**: Shared, real-time note-taking visible only to meeting participants

The migration aims to achieve enterprise-grade robustness, consistency, scalability, and performance while implementing these advanced real-time features using Convex's reactive architecture, WebSocket-based live updates, and TypeScript-first development practices.

Essential Compliance (!!!): Always comply with `steering/convex_rules.mdc` and use the `context7 MCP` tool for up-to-date Convex documentation and best practices.

## Goals

- Deliver a production-ready Convex foundation: schemas, indexes, access control, and reactive patterns for real-time features.
- Replace Supabase/Drizzle reads/writes with Convex queries/mutations/actions; provide a clean migration path and cutover.
- Establish per-meeting isolated data streams (transcripts, notes, prompts) with strong, dynamic access controls.
- Provide foundations for AI-driven features (pre-call, in-call, post-call) with clear external API integration points.
- Enable intelligent matching foundations (queueing, scoring, vector-ready, feedback loops) and real-time notifications.
- Ensure enterprise-grade performance, scalability, observability, and testability.
- Make the system future-proof for a knowledge bank and additional ML-driven personalization features.

## Non-Goals

- Building full ML models or productionizing AI pipelines beyond stubs/interfaces/actions.
- Implementing full production live transcription (we’ll define schema and hooks; provider integration comes later).
- Completing all video call UI; this phase sets backend lifecycle and Stream integration foundations.
- Implementing full CRDT/OT engines; we’ll define structures and minimal conflict-resolution patterns sufficient to validate approach.
- Finalizing the knowledge bank; we’ll ensure the data model is plug-and-play for later.

## 4. Background and Pain Points

- Current DB is Drizzle + Supabase; features are decoupled and not reactive; live features need per-meeting isolation and robust, low-latency subscriptions.
- Video calling (Stream) integration is incomplete; tokens/room lifecycle and webhooks are not wired.
- “Smart matching” is mocked and not validated for performance or correctness; no vector similarity foundation.
- Lack of strong permissioning, streaming scalability, and observability impedes enterprise readiness.

## 5. Principles

- Reactive-first: Convex reactive queries propagate minimal diffs over WebSockets, avoiding client polling.
- Types everywhere: End-to-end TypeScript types across schemas, functions, and client.
- Principle of least privilege: Resource-based ACLs; authZ validated in every query/mutation/action; per-meeting isolation.
- Write-optimized for real-time: Append-only logs for high-frequency data; batched writes; sharded/time-bucketed partitions to avoid hot spots.
- Deterministic interfaces: Idempotent, retry-safe actions for all external integrations.
- Pluggable intelligence: Abstract interfaces for embeddings, vector similarity, and AI generation to allow provider swaps.
- Observability and testability by design: Metrics, tracing, audit logs, fixtures, and load tests defined from day one.

## 6. Compliance and Tooling Constraints

- Must comply with `steering/convex_rules.mdc`. Any ambiguity must be resolved using `context7 MCP` tool to fetch the latest Convex guidance.
- Secrets must be managed per environment using Convex’s secrets and deployment configuration.
- All code must follow Prettier formatting and linting standards; CI must enforce type checks and linting.

## 7. Definitions

- **Convex Query**: Read-only, reactive, cached. Runs on every invalidation; must validate permissions.
- **Convex Mutation**: Write operation; strict ACID; must validate permissions.
- **Convex Action**: Non-transactional operation for external calls or heavy compute; can call HTTP, schedule jobs; must be idempotent where possible.
- **Meeting**: A scheduled or ad-hoc session with participants; includes metadata, state, notes, transcripts, prompts, and analytics.
- **Participant**: Authenticated user linked to a meeting with a role (host, speaker, attendee).
- **Stream**: GetStream Video backend for calls (room, tokens, events).
- **Vector Store**: Abstraction for embedding storage and similarity (initially in-Convex tables with optional offload to external providers).

## 8. Environments and Deployment

- Environments: local (dev), staging, production. Separate Convex deployments, secrets, Stream projects, and WorkOS projects per environment.
- CI/CD: On PR, type-check, lint, unit tests. On main merge, deploy to staging; manual promotion to prod.
- Feature flags: Server-side flags stored in Convex; enabled per environment.

## 9. Performance Targets (initial SLOs)

- Query p95 < 120ms, p99 < 250ms under 1k concurrent meetings; WebSocket update delivery p95 < 150ms.
- High-frequency streams (e.g., transcription chunks): sustain ≥ 10 updates/sec/meeting without hot shard alerts.
- Auth and permission checks must add ≤ 5ms median overhead per request.

## 10. Data Security and Privacy

- All per-meeting data (notes, transcripts, prompts) must be accessible only to current participants (and post-call to participants and authorized admins where specified).
- Audit logs: who accessed what, when; include auth context (WorkOS user ID, org ID) and resource.
- PII and sensitive fields classified and minimized; retention policies per collection documented (see requirements below).

## 11. Entity Overview (collections to define in Convex)

- `users`: Identity, profile basics, WorkOS linking
- `profiles`: Extended professional details (bio, interests, roles)
- `interests`: Canonical interest taxonomy; user-interest join or embedded list
- `connections`: User-user relationships and requests
- `meetings`: Meeting metadata and lifecycle
- `meetingParticipants`: Membership/role per meeting; presence state
- `meetingState`: Derived ephemeral state (active, startedAt, recording flags)
- `meetingNotes`: Current shared note document per meeting (with versioning/OT ops logs in separate collection)
- `noteOps`: Append-only operations for collaborative editing
- `transcripts`: Append-only transcription chunks per meeting (time-bucketed)
- `transcriptSegments`: Aggregated segments for search/review
- `prompts`: Pre-call and in-call conversation prompts tied to meeting
- `insights`: Post-call summaries, action items, recommendations per user
- `messages`: Chat messages in meeting
- `matchingQueue`: Real-time user queue entries, availability windows
- `matchingAnalytics`: Feedback, outcomes, scoring features/weights
- `embeddings`: Stored embeddings and metadata (user/profile/meeting text)
- `vectorIndexMeta`: Optional config for vector similarity backend/provider
- `auditLogs`: Auth events, access logs, admin actions
- `featureFlags`: Server-side toggles

## 12. Cross-Cutting Acceptance Criteria (apply to all requirements)

- All queries, mutations, and actions must validate authZ based on WorkOS identity and resource ACLs.
- All real-time subscriptions must isolate data by meeting or user where applicable.
- All operations must log audit events for material accesses and changes.
- All functions must include input validation and schema-safe parsing.

## Requirements

### Requirement 1 — Project Initialization and Repo Structure

User Story: As a developer, I want a clean Convex project with a scalable, typed structure so we can implement real-time features confidently.

Acceptance Criteria:

1. WHEN initializing the project THEN a new Convex app SHALL be created with TypeScript, linting, Prettier, and strict `tsconfig`.
2. WHEN organizing server code THEN the system SHALL structure Convex modules by domain: `auth`, `users`, `profiles`, `meetings`, `participants`, `notes`, `transcripts`, `prompts`, `insights`, `matching`, `embeddings`, `messaging`, `analytics`, `admin`.
3. WHEN configuring environments THEN separate config/secrets SHALL exist for local, staging, prod; documented variables include WorkOS keys, Stream keys, AI providers (stub allowed), vector provider (optional).
4. WHEN dependency management is configured THEN dev scripts SHALL include local dev server, codegen, test, type-check, lint, format, seed.
5. WHEN documentation is generated THEN a README SHALL describe module layout, how to run locally, how to deploy, and how to run tests.
6. WHEN initializing tooling THEN the project SHALL integrate CI (type-check, lint, tests) and protected branches for main.

### Requirement 2 — WorkOS Authentication and Authorization Integration

User Story: As a developer, I want secure, enterprise-grade authentication with role- and resource-based authorization.

Acceptance Criteria:

1. WHEN users authenticate THEN the system SHALL integrate WorkOS Auth Kit to issue JWTs that Convex validates for identity and org context.
2. WHEN user sessions are created THEN user documents SHALL be upserted in Convex with WorkOS IDs, email, orgId, orgRole, and minimal profile fields.
3. WHEN authorization is required THEN the system SHALL implement RBAC + resource ACLs. Meeting access is derived from `meetingParticipants`. Admin and org-scoped roles must be respected.
4. WHEN real-time subscriptions are established THEN the system SHALL validate permissions per connection and per query stream using WorkOS JWT context.
5. WHEN user roles/entitlements change in WorkOS THEN the system SHALL update permissions dynamically across active sessions/streams (kicking or demoting as needed).
6. WHEN security is audited THEN the system SHALL log authentication events, ACL decisions, and data access (who/what/when) to `auditLogs`.

### Requirement 3 — Core Convex Schemas, Indexing, and Relationships

User Story: As a developer, I want robust schemas and indexes that scale for real-time workloads and matching.

Acceptance Criteria:

1. WHEN defining schemas THEN collections SHALL be created for all entities in Section 11, with strict validation (Convex schema types), `createdAt`/`updatedAt`, and composite indexes.
2. WHEN handling relationships THEN data SHALL be denormalized where it reduces hot reads/writes (e.g., store `meetingId` on child docs, embed participant list counts on meeting).
3. WHEN indexing THEN the system SHALL create indexes for high-volume filters: by `userId`, `meetingId`, time bucket, `orgId`, and status. Range queries must exist for time-based fetches.
4. WHEN designing transcript storage THEN `transcripts` SHALL be append-only, sharded by `meetingId` + time bucket to avoid write hot spots; segments aggregated asynchronously.
5. WHEN designing notes THEN `noteOps` SHALL be append-only with sequence numbers and conflict-resolution metadata; `meetingNotes` SHALL be the current materialized state.
6. WHEN designing embeddings THEN `embeddings` SHALL reference `sourceType` (user|profile|meeting|note|transcriptSegment), `sourceId`, `vector` (provider-agnostic), metadata, and version.

### Requirement 4 — Access Control and Row-Level Isolation (Per-Meeting Streams)

User Story: As a developer, I want isolated per-meeting data streams to ensure privacy and least privilege.

Acceptance Criteria:

1. WHEN a client subscribes to notes/transcripts/prompts/messages THEN the system SHALL enforce access based on `meetingParticipants` membership and role.
2. WHEN participants join or leave THEN access SHALL be granted/revoked immediately, including active WebSocket streams (e.g., terminate or downgrade unauthorized streams).
3. WHEN meeting ownership changes THEN ACLs SHALL update atomically with consistent visibility across existing subscriptions.
4. WHEN data is written THEN mutations SHALL validate both write permission and role requirements (e.g., only host can end meeting, etc.).
5. WHEN auditing access THEN each successful subscription/init of a data stream SHALL log an audit entry with `userId`, `meetingId`, stream type, and timestamp.

### Requirement 5 — Reactive Queries and Real-Time Patterns

User Story: As a developer, I want Convex reactive queries that power sub-100ms live UX.

Acceptance Criteria:

1. WHEN implementing real-time features THEN the system SHALL use reactive queries for meeting state, participants, notes, transcripts (live cursor), prompts, and chat messages.
2. WHEN subscriptions emit updates THEN only minimal diffs SHALL be published to clients; queries must avoid unbounded result sets (pagination or time windows).
3. WHEN scaling to many streams THEN high-frequency data (transcripts, `noteOps`) SHALL be batched and coalesced (e.g., debounce to 100–250ms windows) to balance latency and throughput.
4. WHEN designing queries THEN stable indexes SHALL exist to keep p95 under target; any full-table scans are forbidden in prod paths.
5. WHEN clients reconnect THEN the system SHALL support resuming with last-seen cursor/sequence to catch up without replaying the entire history.

### Requirement 6 — Meeting Lifecycle and Stream (GetStream) Integration Foundations

User Story: As a developer, I want a reliable backend lifecycle for meetings integrated with Stream.

Acceptance Criteria:

1. WHEN scheduling a meeting THEN a meeting doc SHALL be created with participants list, organizer, planned start/end, and Stream room pre-provisioning status.
2. WHEN a meeting starts THEN the system SHALL create or join a Stream room via an action, mint participant tokens server-side, and store `roomId` and ephemeral tokens (never persist raw tokens beyond lifetime).
3. WHEN Stream webhooks fire (`call.created`, `participant.joined/left`, `call.ended`) THEN the system SHALL verify signatures, update `meetingState` and `meetingParticipants` presence, and log audit entries.
4. WHEN a meeting ends THEN the system SHALL mark `concludedAt`, trigger aggregation jobs (transcript segment assembly, insight stubs), and close any residual subscriptions.
5. WHEN errors occur with Stream THEN actions SHALL be idempotent and retry-safe; backoff policies and alerting must be in place.

### Requirement 7 — Live Transcription Foundations

User Story: As a developer, I want scalable, secure storage and streaming for live transcripts.

Acceptance Criteria:

1. WHEN transcription starts THEN the system SHALL create an isolated transcription stream per meeting, accessible only to current participants via subscriptions.
2. WHEN speech is processed THEN transcription chunks SHALL store `speakerId` (or provisional label), timestamps, confidence scores, and raw text; chunks are append-only with increasing sequence.
3. WHEN write rates are high THEN chunks SHALL be partitioned by `meetingId` + time bucket to reduce write contention; batch writes permitted with transactional guarantees.
4. WHEN participants join/leave THEN access permissions SHALL be updated in real time.
5. WHEN meetings end THEN transcripts SHALL be aggregated into `transcriptSegments` for searchability; apply retention policies and indexes for query by time range and speaker.

### Requirement 8 — Collaborative Notes Foundations

User Story: As a developer, I want real-time shared notes with conflict resolution and optimistic UI.

Acceptance Criteria:

1. WHEN editing notes THEN the system SHALL support optimistic UI updates with rollback on failure.
2. WHEN conflicts occur THEN the system SHALL resolve using OT/CRDT-inspired operation ordering: sequence numbers, per-author clocks, and associative transforms; final state materialized in `meetingNotes`.
3. WHEN offline scenarios happen THEN client operations SHALL queue and sync on reconnect with conflict-safe merging.
4. WHEN auditing edits THEN `noteOps` SHALL include `authorId`, timestamp, and operation type; `meetingNotes` SHALL include `lastRebasedAt` and version.
5. WHEN permissions change THEN only authorized participants can apply `noteOps`; unauthorized ops must be rejected with audit logs.

### Requirement 9 — Pre-Call Idea Generation Foundations

User Story: As a developer, I want to generate pre-call insights from participant profiles and interests.

Acceptance Criteria:

1. WHEN a meeting is scheduled THEN queries SHALL analyze participant profiles (interests, skills, bio, goals) and compute shared/complementary features.
2. WHEN generating ideas THEN actions SHALL call AI providers (stub allowed initially) with deterministic, idempotent requests (include request hash) to produce prompts, agendas, and questions.
3. WHEN ideas are generated THEN results SHALL be stored in `prompts` collection with `type=precall`, `meetingId`, and surfaced via reactive queries.
4. WHEN new insights are added THEN participants SHALL see updates in real time.
5. WHEN meetings begin THEN precall items SHALL be promote-able to in-call prompts with provenance preserved.

### Requirement 10 — In-Call Conversation Prompts Foundations

User Story: As a developer, I want contextual prompts to appear during lulls or based on topics.

Acceptance Criteria:

1. WHEN meetings are active THEN the system SHALL track engagement metrics (speaking time ratios, lull detectors from transcript cadence) and current topics (keyword extraction stub) in `meetingState`.
2. WHEN a lull is detected OR topic shifts THEN actions SHALL generate contextual prompts using meeting context and participant expertise; fallback to precall prompts if AI unavailable.
3. WHEN prompts are published THEN they SHALL stream via reactive queries, visible to all participants with timestamps and relevance tags.
4. WHEN participants interact with prompts (used, upvoted, dismissed) THEN analytics SHALL be recorded and used to improve relevance over time.
5. WHEN prompts are used THEN they SHALL be linked into `transcriptSegments` and notes for post-call reference.

### Requirement 11 — Post-Call Insights Foundations

User Story: As a developer, I want post-call summaries and recommendations per participant.

Acceptance Criteria:

1. WHEN meetings end THEN actions SHALL analyze full transcripts and notes (stub pipeline) to extract topics, decisions, and action items.
2. WHEN insights are generated THEN `insights` docs SHALL be created per user with privacy controls; deliver via reactive queries/notifications.
3. WHEN generating recommendations THEN include connection recommendations and follow-ups; store rationale and confidence.
4. WHEN users view insights THEN provide links to transcript segments and profiles; queries must be performant and access-controlled.
5. WHEN insights influence matching THEN `matchingAnalytics` and profile preferences SHALL be updated to close the feedback loop.

### Requirement 12 — Intelligent Matching Foundations

User Story: As a developer, I want a scalable matching system with real-time queues, vector similarity, and feedback loops.

Acceptance Criteria:

1. WHEN users enter a queue THEN a `matchingQueue` doc SHALL be created with availability window, constraints (roles, interests), and status; updates stream in real time.
2. WHEN computing compatibility THEN scoring SHALL combine shared interests, complementary skills, org constraints, historical success signals, and vector similarity from `embeddings` (pluggable).
3. WHEN matches are found THEN both users SHALL be notified via reactive queries with compatibility score and key factors.
4. WHEN users accept/decline THEN feedback SHALL be recorded to adjust weights; avoid re-suggesting poor matches within a decay window.
5. WHEN matching at scale THEN operations SHALL use optimistic concurrency and indexing to avoid hot contention; batch and shard queue scans.

### Requirement 13 — Embeddings and Vector Similarity Abstraction

User Story: As a developer, I want a provider-agnostic vector layer to support qualitative matching.

Acceptance Criteria:

1. WHEN generating embeddings THEN actions SHALL produce `embeddings` for bios, interests, notes, and transcript segments with versioned metadata; backfills supported.
2. WHEN performing similarity search THEN an abstraction SHALL route to either an in-Convex approximate method (if available) or external providers (e.g., Pinecone/Weaviate) via actions.
3. WHEN providers change THEN no calling code SHALL change; only `vectorIndexMeta`/config updates are required.
4. WHEN indexing THEN store source provenance and `lastComputedAt`; jobs SHALL handle drift and re-embedding.
5. WHEN querying THEN results SHALL include similarity scores and be filterable by org, language, and data type.

### Requirement 14 — Observability, Metrics, and Auditability

User Story: As a developer, I want deep visibility into performance and security.

Acceptance Criteria:

1. WHEN queries/mutations/actions execute THEN trace IDs and timing SHALL be recorded; aggregate p50/p95/p99 per function.
2. WHEN WebSocket streams operate THEN track subscriber counts, update fan-out latency, and dropped update rates.
3. WHEN errors occur THEN structured logs SHALL capture context (`userId`, `meetingId`, function name, error code) without leaking secrets.
4. WHEN security is audited THEN `auditLogs` SHALL support filters by `userId`, `meetingId`, action type, and time range; export endpoints provided for admin.
5. WHEN SLOs breach THEN alerts SHALL trigger (staging/prod) with actionable traces.

### Requirement 15 — Performance and Scalability Practices

User Story: As a developer, I want confidence the system sustains thousands of concurrent meetings.

Acceptance Criteria:

1. WHEN designing high-frequency writes THEN batching and coalescing SHALL be implemented (e.g., transcripts 50–250ms batch windows); ensure ACID within batches.
2. WHEN indexing THEN hot partitions SHALL be avoided via shard keys (`meetingId` + timeBucket) and bounded result windows.
3. WHEN global users connect THEN Convex edge distribution SHALL be configured to minimize latency; document region strategy.
4. WHEN backpressure is needed THEN server SHALL shed load gracefully (e.g., temporarily reduce prompt generation frequency) with clear metrics.
5. WHEN load testing THEN synthetic tests SHALL demonstrate targets in Section 9; publish reports.

### Requirement 16 — Data Migration Plan (Supabase/Drizzle → Convex)

User Story: As a developer, I want a safe and verifiable migration.

Acceptance Criteria:

1. WHEN mapping schemas THEN a migration document SHALL define old→new mapping for each table/field, including IDs, timestamps, and relationships.
2. WHEN migrating users THEN WorkOS identities SHALL be reconciled; orphaned records flagged.
3. WHEN migrating meetings and connections THEN referential integrity SHALL be preserved; meeting history imported where available.
4. WHEN validating THEN spot checks and automated parity tests SHALL confirm counts and sample data equivalence; discrepancies logged and resolved.
5. WHEN cutting over THEN a plan SHALL define read/write dual-run, freeze window, rollback steps, and success criteria.

### Requirement 17 — Cutover, Dual-Write/Read Strategy, and Backfill

User Story: As a developer, I want minimal downtime and safe rollback.

Acceptance Criteria:

1. WHEN preparing cutover THEN a dual-write phase SHALL be implemented where updates write to both stores; comparisons run in background.
2. WHEN confidence is sufficient THEN reads SHALL switch to Convex behind a feature flag per-endpoint/module.
3. WHEN backfilling embeddings THEN a background job SHALL populate embeddings for legacy items incrementally with progress metrics.
4. WHEN rollback is required THEN a clear procedure SHALL revert read paths and reconcile any drift.
5. WHEN cutover completes THEN the old store SHALL be set read-only; decommission plan documented.

### Requirement 18 — Testing Strategy and Quality Gates

User Story: As a developer, I want high confidence via tests.

Acceptance Criteria:

1. WHEN implementing functions THEN unit tests SHALL cover happy paths, auth failures, and edge cases.
2. WHEN designing real-time flows THEN integration tests SHALL simulate multiple participants editing notes and streaming transcripts with conflict checks.
3. WHEN handling actions THEN idempotency and retry behavior SHALL be tested with simulated timeouts and transient errors.
4. WHEN performance testing THEN load scenarios SHALL simulate 1k concurrent meetings with transcription and notes; assert SLOs.
5. WHEN merging to main THEN CI SHALL block without passing tests, type-checks, linting.

### Requirement 19 — Security, Secrets, and Threat Model

User Story: As a developer, I want hardened security from day one.

Acceptance Criteria:

1. WHEN storing secrets THEN only Convex secrets/env SHALL be used; tokens never logged; Stream tokens ephemeral.
2. WHEN receiving webhooks THEN HMAC signature verification SHALL be enforced; replay protection implemented.
3. WHEN validating inputs THEN all payloads SHALL be schema-validated; rate limits per user/IP apply to sensitive mutations.
4. WHEN enumerating threats THEN a threat model document SHALL cover auth bypass, elevation, data exfiltration, replay, and injection; mitigations mapped to controls.
5. WHEN compliance is required THEN data retention and deletion endpoints SHALL be defined for PII.

### Requirement 20 — Caching and Data Access Patterns

User Story: As a developer, I want efficient, debuggable, type-safe caching.

Acceptance Criteria:

1. WHEN serving reads THEN rely on Convex reactive cache; avoid duplicative client caches that fight server reactivity.
2. WHEN expensive queries exist THEN materialized views or aggregates SHALL be maintained asynchronously (e.g., meeting summaries).
3. WHEN per-user dashboards load THEN queries SHALL be paginated and indexed; no N+1 patterns.
4. WHEN invalidating caches THEN updates MUST be granular to avoid invalidating large unrelated query sets.

### Requirement 21 — Feature Flags and Configuration

User Story: As a developer, I want controlled rollouts.

Acceptance Criteria:

1. WHEN introducing new capabilities THEN flags SHALL gate precall, in-call prompts, and insights separately.
2. WHEN flags change THEN the system SHALL update behavior without redeploy; flags are readable via reactive queries for immediate effect.
3. WHEN auditing flag changes THEN admin actions SHALL be logged with reason and operator.

### Requirement 22 — Documentation and Runbooks

User Story: As a developer, I want clear docs and operational runbooks.

Acceptance Criteria:

1. WHEN onboarding THEN a Developer Guide SHALL explain auth, data model, reactive patterns, and how to add a new collection with indexes and ACL.
2. WHEN integrating AI providers THEN a Runbook SHALL define secrets, configs, rate limits, and fallback behavior.
3. WHEN incidents occur THEN an Incident Runbook SHALL outline steps for Stream outages, WorkOS issues, and Convex scaling incidents.

### Requirement 23 — Compliance with `steering/convex_rules.mdc` and `context7 MCP` tool

User Story: As a developer, I want to ensure our implementation follows current best practices.

Acceptance Criteria:

1. WHEN implementing Convex functions THEN developers SHALL consult `steering/convex_rules.mdc` and verify compliance via code review checklists.
2. WHEN ambiguities arise THEN developers SHALL use `context7 MCP` tool to fetch latest Convex docs and paste links/references into PRs.
3. WHEN audits occur THEN references to rules and doc versions SHALL be present in PR descriptions for traceability.

## 14. Data Retention and Privacy (by Collection)

- **transcripts**: Raw chunks retained 30–90 days; segments retained 1 year (configurable); deletion on user request executed within 30 days.
- **meetingNotes** and **noteOps**: Notes retained 1 year; ops retained 90 days (for debugging); ops can be compacted after materialization.
- **prompts** and **insights**: Retained 1 year; user can delete personal insights.
- **embeddings**: Retained as long as source exists; re-embedded on model version change; delete with source.
- **auditLogs**: Retained 1 year; exports available for compliance.
- **messages**: Retained 90 days by default; configurable by org.

## 15. Risk Register (Top)

- **Hot partitions for large meetings with dense transcription writes** — Mitigation: time-bucket sharding and batching.
- **Over-permissive access via missed checks** — Mitigation: centralized ACL helper and mandatory checks in all functions with tests.
- **Stream webhook delivery failures** — Mitigation: idempotent processing with retry queues and dead-letter logging.
- **Vector provider shifts causing regressions** — Mitigation: stable abstraction and golden test fixtures.
- **Cost blow-ups from chatty streams** — Mitigation: coalescing windows and rate limiting.

## 16. Deliverables for This Stage (Requirements)

- This specification approved and baselined.
- Migration mapping document from Supabase/Drizzle to Convex.
- SLO definitions and load test plan (scenarios and metrics).
- Threat model document with mapped mitigations.
- Schema and index inventory (names, fields, and primary access patterns).
- Cutover plan outline (dual-write/read, rollback).

## 17. Out of Scope (Deferred to Design/Implementation Stages)

- Concrete provider selection for embeddings and AI (beyond abstraction and stubs).
- Full CRDT/OT algorithm implementation details and benchmarking (will be defined in design).
- Full vector ANN index tuning and recall/latency trade-offs.
- Comprehensive UI changes and UX instrumentation.

## Appendix A — Minimal Entity Field Expectations (Non-binding, for clarity)

- `users`: id, `workosUserId`, email, `orgId`, `orgRole`, `createdAt`, `updatedAt`
- `profiles`: `userId`, `displayName`, bio, `interests[]`, goals, languages, experience, `embeddingId`?
- `interests`: key, label, category
- `connections`: `requesterId`, `addresseeId`, status, `createdAt`
- `meetings`: `organizerId`, title, description, `scheduledAt`, duration, `streamRoomId`, state, `createdAt`
- `meetingParticipants`: `meetingId`, `userId`, role, `joinedAt`, `leftAt`, presence
- `meetingState`: `meetingId`, active, `startedAt`, `endedAt`, `speakingStats`, `lullState`, `topics[]`
- `meetingNotes`: `meetingId`, doc, version, `lastRebasedAt`
- `noteOps`: `meetingId`, seq, `authorId`, op, ts
- `transcripts`: `meetingId`, `timeBucket`, seq, `speakerId`, text, confidence, `startMs`, `endMs`
- `transcriptSegments`: `meetingId`, `startMs`, `endMs`, `speakers[]`, text, `topics[]`, sentiment?
- `prompts`: `meetingId`, type (precall|incall), text, `tags[]`, relevance, `createdAt`, `usedAt`?
- `insights`: `userId`, `meetingId`, summary, `actionItems[]`, `recommendations[]`, `links[]`, `createdAt`
- `messages`: `meetingId`, `userId`, text, `attachments`?, ts
- `matchingQueue`: `userId`, `availableFrom`, `availableTo`, constraints, status
- `matchingAnalytics`: `userId`, `matchId`, outcome, feedback, features, weights
- `embeddings`: `sourceType`, `sourceId`, vector, model, dim, version, `createdAt`
- `vectorIndexMeta`: provider, `indexName`, config, status
- `auditLogs`: `actorUserId`, `resourceType`, `resourceId`, action, ts, metadata
- `featureFlags`: key, value, env, rollout, `updatedBy`

## Appendix B — Mocking and Stubs for Advanced Features

- AI Generators: Provide deterministic stubs seeded by `meetingId` to ensure reproducible outputs.
- Topic Extraction and Lull Detection: Lightweight heuristics using rolling word rate and silence windows; replaceable by provider-backed analysis later.
- Vector Similarity: Fallback to cosine similarity in a Convex action for small candidate sets; swap to external ANN when scaling.

## Appendix C — Quality and Code Standards

- TypeScript strict mode; no `any`. Shared types package for client-server.
- Prettier and ESLint enforced in CI. Function docs include purpose, inputs, outputs, and auth assumptions.
- All public-facing Convex functions require input runtime validation (zod or equivalent).

## Notes for Design and Task Agents

- The Design agent should convert these requirements into concrete schema definitions, indexes, function signatures, ACL helpers, streaming/batching strategies, and provider abstractions, referencing `steering/convex_rules.mdc`.
- The Task agent should create fine-grained tasks covering repo setup, environment configs, initial schema/migrations, auth wiring, reactive queries, Stream webhooks, mock AI actions, matching queue foundation, tests, and load-testing scaffolding.

## End of Requirements Specification
