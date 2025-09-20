# Convex Type System API Reference

## Overview

This document provides a comprehensive reference for the centralized Convex type system, including all available types, validators, utilities, and monitoring tools.

## Core Entities

### User Types

#### Interfaces

```typescript
interface User {
  _id: Id<"users">;
  workosUserId: string;
  email: string;
  orgId?: string;
  orgRole?: string;
  displayName?: string;
  avatarUrl?: string;
  isActive: boolean;
  lastSeenAt?: number;
  onboardingComplete?: boolean;
  onboardingStartedAt?: number;
  onboardingCompletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface UserProfile {
  _id: Id<"profiles">;
  userId: Id<"users">;
  displayName: string;
  bio?: string;
  goals?: string;
  languages: string[];
  experience?: string;
  age?: number;
  gender?: "male" | "female" | "non-binary" | "prefer-not-to-say";
  field?: string;
  jobTitle?: string;
  company?: string;
  linkedinUrl?: string;
  createdAt: number;
  updatedAt: number;
}

interface AuthIdentity {
  userId: Id<"users">;
  workosUserId: string;
  orgId: string | null;
  orgRole: string | null;
  email: string | null;
  name?: string | null;
}
```

#### Derived Types

```typescript
// Public-safe: No email by default for privacy
type UserPublic = Pick<User, "_id" | "displayName" | "avatarUrl" | "isActive">;

// Public with email (opt-in for admin/internal UIs)
type UserPublicWithEmail = UserPublic & Pick<User, "email">;

// User with profile information
type UserWithProfile = User & { profile?: UserProfile };

// Summary for lists and references
type UserSummary = Pick<User, "_id" | "displayName" | "avatarUrl">;

// User with organization information
type UserWithOrgInfo = UserPublic & Pick<User, "orgId" | "orgRole">;
```

#### Validators

```typescript
import { UserV } from "@convex/types/validators/user";

// Available validators
UserV.full; // Complete User interface
UserV.public; // Public-safe user data
UserV.publicWithEmail; // Public data with email
UserV.summary; // Summary for lists
UserV.profile; // User profile data
```

### Meeting Types

#### Interfaces

```typescript
type MeetingLifecycleState = "scheduled" | "active" | "concluded" | "cancelled";
type ParticipantRole = "host" | "participant" | "observer";
type ParticipantPresence = "invited" | "joined" | "left";

interface Meeting {
  _id: Id<"meetings">;
  organizerId: Id<"users">;
  title: string;
  description?: string;
  scheduledAt?: number;
  duration?: number;
  webrtcEnabled?: boolean;
  streamRoomId?: string;
  state: MeetingLifecycleState;
  participantCount?: number;
  averageRating?: number;
  createdAt: number;
  updatedAt: number;
}

interface MeetingParticipant {
  _id: Id<"meetingParticipants">;
  meetingId: Id<"meetings">;
  userId: Id<"users">;
  role: ParticipantRole;
  joinedAt?: number;
  leftAt?: number;
  presence: ParticipantPresence;
  createdAt: number;
}

interface MeetingRuntimeState {
  _id: Id<"meetingState">;
  meetingId: Id<"meetings">;
  active: boolean;
  startedAt?: number;
  endedAt?: number;
  speakingStats?: {
    totalMs: number;
    byUserMs: Record<string, number>;
  };
  lullState?: {
    detected: boolean;
    lastActivity: number;
    duration: number;
  };
  topics: string[];
  recordingEnabled: boolean;
  updatedAt: number;
}
```

#### Extended Types

```typescript
interface MeetingWithUserRole extends Meeting {
  userRole: ParticipantRole;
  userPresence: ParticipantPresence;
  activeWebRTCSessions: number;
}

interface MeetingParticipantWithUser extends MeetingParticipant {
  user: UserSummary;
  webrtcConnected: boolean;
  webrtcSessionCount: number;
}

interface MeetingListItem
  extends Pick<
    Meeting,
    | "_id"
    | "organizerId"
    | "title"
    | "description"
    | "scheduledAt"
    | "duration"
    | "state"
    | "participantCount"
    | "createdAt"
    | "updatedAt"
  > {
  userRole: ParticipantRole;
  userPresence: ParticipantPresence;
}
```

#### Validators

```typescript
import { MeetingV } from "@convex/types/validators/meeting";

// Available validators
MeetingV.full; // Complete Meeting interface
MeetingV.participant; // Meeting participant data
MeetingV.runtimeState; // Meeting runtime state
MeetingV.withUserRole; // Meeting with user role info
MeetingV.listItem; // Meeting list item
MeetingV.lifecycleState; // Meeting state enum
MeetingV.participantRole; // Participant role enum
MeetingV.participantPresence; // Participant presence enum
```

### Transcript Types

#### Interfaces

```typescript
interface Transcript {
  _id: Id<"transcripts">;
  meetingId: Id<"meetings">;
  bucketMs: number; // Time-bucketed for sharding
  sequence: number;
  speakerId?: string;
  text: string;
  confidence: number;
  startMs: number;
  endMs: number;
  isInterim?: boolean;
  wordCount: number;
  language?: string;
  createdAt: number;
}

interface TranscriptSegment {
  _id: Id<"transcriptSegments">;
  meetingId: Id<"meetings">;
  startMs: number;
  endMs: number;
  speakers: string[];
  text: string;
  topics: string[];
  sentiment?: number;
  createdAt: number;
}

interface TranscriptionSession {
  _id: Id<"transcriptionSessions">;
  meetingId: Id<"meetings">;
  provider: "whisper" | "assemblyai" | "getstream";
  status: "initializing" | "active" | "paused" | "completed" | "failed";
  startedAt: number;
  endedAt?: number;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}
```

#### API Response Types

```typescript
type TranscriptChunk = Pick<
  Transcript,
  | "_id"
  | "sequence"
  | "speakerId"
  | "text"
  | "confidence"
  | "startMs"
  | "endMs"
  | "wordCount"
  | "language"
  | "createdAt"
>;

interface TranscriptStats {
  totalChunks: number;
  totalWords: number;
  averageConfidence: number;
  duration: number;
  speakers: string[];
  languages: string[];
}
```

#### Validators

```typescript
import { TranscriptV } from "@convex/types/validators/transcript";

// Available validators
TranscriptV.full; // Complete Transcript interface
TranscriptV.segment; // Transcript segment data
TranscriptV.session; // Transcription session data
TranscriptV.chunk; // Transcript chunk for API responses
TranscriptV.stats; // Transcript statistics
```

## Domain-Specific Types

### Operational Transform

#### Interfaces

```typescript
type OperationType = "insert" | "delete" | "retain";

interface Operation {
  type: OperationType;
  position: number;
  content?: string;
  length?: number;
}

interface OperationWithMetadata extends Operation {
  id: string;
  authorId: Id<"users">;
  timestamp: number;
  sequence: number;
  transformedFrom?: string[];
}

interface NoteOperation {
  _id: Id<"noteOps">;
  meetingId: Id<"meetings">;
  sequence: number;
  authorId: Id<"users">;
  operation: Operation;
  timestamp: number;
  applied: boolean;
}

interface MeetingNote {
  _id: Id<"meetingNotes">;
  meetingId: Id<"meetings">;
  content: string;
  version: number;
  lastRebasedAt: number;
  updatedAt: number;
}

interface NoteOperationResult {
  success: boolean;
  serverSequence: number;
  transformedOperation: Operation;
  newVersion: number;
  conflicts: string[];
}
```

#### Validators

```typescript
import { OperationalTransformV } from "@convex/types/validators/operationalTransform";

// Available validators
OperationalTransformV.operation; // Basic operation
OperationalTransformV.operationWithMetadata; // Operation with metadata
OperationalTransformV.noteOperation; // Note operation record
OperationalTransformV.meetingNote; // Meeting note record
OperationalTransformV.operationResult; // Operation result
```

### WebRTC Types

#### Interfaces

```typescript
type WebRTCSessionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";
type WebRTCSignalType = "sdp" | "ice";
type ConnectionQuality = "excellent" | "good" | "fair" | "poor";

interface WebRTCSession {
  _id: Id<"webrtcSessions">;
  meetingId: Id<"meetings">;
  sessionId: string;
  userId: Id<"users">;
  state: WebRTCSessionState;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

interface WebRTCSignal {
  _id: Id<"webrtcSignals">;
  meetingId: Id<"meetings">;
  sessionId: string;
  fromUserId: Id<"users">;
  toUserId?: Id<"users">; // null for broadcast
  type: WebRTCSignalType;
  data: SDPData | ICEData;
  timestamp: number;
  processed: boolean;
}

interface SDPData {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp: string;
}

interface ICEData {
  candidate: string;
  sdpMLineIndex?: number;
  sdpMid?: string;
  usernameFragment?: string;
}

interface ConnectionMetrics {
  _id: Id<"connectionMetrics">;
  meetingId: Id<"meetings">;
  sessionId: string;
  userId: Id<"users">;
  quality: ConnectionQuality;
  stats: {
    bitrate: number;
    packetLoss: number;
    latency: number;
    jitter: number;
  };
  timestamp: number;
  createdAt: number;
}
```

#### Validators

```typescript
import { WebRTCV } from "@convex/types/validators/webrtc";

// Available validators
WebRTCV.session; // WebRTC session
WebRTCV.signal; // WebRTC signal
WebRTCV.sdpData; // SDP signal data
WebRTCV.iceData; // ICE signal data
WebRTCV.connectionMetrics; // Connection quality metrics
WebRTCV.sessionState; // Session state enum
WebRTCV.signalType; // Signal type enum
WebRTCV.connectionQuality; // Connection quality enum
```

### Vector Embeddings

#### Interfaces

```typescript
type EmbeddingSourceType =
  | "user"
  | "profile"
  | "meeting"
  | "note"
  | "transcriptSegment";
type VectorIndexStatus = "active" | "inactive" | "migrating";

interface Embedding {
  _id: Id<"embeddings">;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  vector: ArrayBuffer; // Use ArrayBuffer for performance
  model: string;
  dimensions: number;
  version: string;
  metadata: Record<string, any>;
  createdAt: number;
}

interface VectorIndexMeta {
  _id: Id<"vectorIndexMeta">;
  provider: string;
  indexName: string;
  config: Record<string, any>;
  status: VectorIndexStatus;
  createdAt: number;
  updatedAt: number;
}

interface SimilaritySearchResult {
  embedding: Embedding;
  score: number;
  sourceData?: any;
}
```

#### Validators

```typescript
import { EmbeddingV } from "@convex/types/validators/embedding";

// Available validators
EmbeddingV.full; // Complete embedding
EmbeddingV.vectorIndexMeta; // Vector index metadata
EmbeddingV.similarityResult; // Similarity search result
EmbeddingV.sourceType; // Embedding source type enum
EmbeddingV.indexStatus; // Vector index status enum
```

#### Utility Functions

```typescript
import {
  arrayBufferToFloat32Array,
  float32ArrayToArrayBuffer,
  createNormalizedVector,
} from "@convex/types/utils";

// Convert between ArrayBuffer and Float32Array
const vector = new Float32Array([0.1, 0.2, 0.3]);
const buffer = float32ArrayToArrayBuffer(vector);
const restored = arrayBufferToFloat32Array(buffer);

// Create normalized vector
const normalized = createNormalizedVector([0.3, 0.4, 0.5]);
```

## API Response Types

### Pagination

#### Interfaces

```typescript
interface PaginationResult<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string | null;
}

interface PaginationOpts {
  numItems: number;
  cursor: string | null;
}
```

#### Validators

```typescript
import {
  PaginationResultV,
  paginationOptsValidator,
} from "@convex/types/api/pagination";

// Create paginated response validator
const userListValidator = PaginationResultV(UserV.summary);

// Use in function definition
export const listUsers = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: userListValidator,
  handler: async (ctx, { paginationOpts }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_isActive")
      .order("desc")
      .paginate(paginationOpts);
  },
});
```

### Result Envelopes

#### Interfaces

```typescript
interface Result<T, E = string> {
  success: boolean;
  data?: T;
  error?: E;
}

interface SuccessResult<T> {
  success: true;
  data: T;
}

interface ErrorResult<E = string> {
  success: false;
  error: E;
}
```

#### Validators

```typescript
import {
  ResultV,
  SuccessResultV,
  ErrorResultV,
} from "@convex/types/api/responses";

// Create result validator
const userResultValidator = ResultV(UserV.full);

// Use in function definition
export const createUserSafe = mutation({
  args: { userData: UserV.createInput },
  returns: userResultValidator,
  handler: async (ctx, { userData }) => {
    try {
      const user = await ctx.db.insert("users", userData);
      return { success: true, data: user };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
});
```

## Utility Types

### Branded Types

```typescript
// Time-based branded types
type EpochMs = number & { readonly __brand: "EpochMs" };
type DurationMs = number & { readonly __brand: "DurationMs" };

// Create branded values
const now: EpochMs = Date.now() as EpochMs;
const duration: DurationMs = 5000 as DurationMs;
```

### Common Validators

```typescript
import { CommonV } from "@convex/types/validators/common";

// Available common validators
CommonV.epochMs; // Branded timestamp
CommonV.durationMs; // Branded duration
CommonV.embeddingVector; // ArrayBuffer for vectors
CommonV.metadata; // Generic metadata record
CommonV.systemFields; // _id and _creationTime
```

## Monitoring and Validation

### Health Monitoring

```typescript
import {
  generateHealthReport,
  checkSystemHealth,
  detectTypeDrift,
  measureValidatorPerformance,
} from "@convex/types/monitoring";

// Generate comprehensive health report
const report = generateHealthReport({
  includePerformanceMetrics: true,
  includeDriftDetection: true,
  includeValidatorAnalysis: true,
});

// Check system health status
const health = checkSystemHealth();
console.log(`System healthy: ${health.healthy}`);

// Detect type drift
const drift = detectTypeDrift(UserV.full, expectedUserFields, "User");
if (drift.hasDrift) {
  console.log(`Missing fields: ${drift.missingFields}`);
  console.log(`Extra fields: ${drift.extraFields}`);
}

// Measure performance
const metrics = measureValidatorPerformance([
  { name: "UserV.full", validator: UserV.full },
  { name: "MeetingV.full", validator: MeetingV.full },
]);
```

### Type Exploration

```typescript
import { exploreValidatorStructure } from "@convex/types/monitoring";

// Explore validator structure
const exploration = exploreValidatorStructure(UserV.full, "UserV.full");
console.log(`Complexity: ${exploration.complexity}`);
console.log(`Dependencies: ${exploration.dependencies}`);
console.log(`Structure:`, exploration.structure);
```

### CI/CD Integration

```typescript
import { generateCIValidationReport } from "@convex/types/monitoring";

// Generate CI-friendly validation report
const ciReport = generateCIValidationReport({
  UserV,
  MeetingV,
  TranscriptV,
  // ... other validator collections
});

if (!ciReport.passed) {
  console.error(`Type validation failed: ${ciReport.errors.join(", ")}`);
  process.exit(1);
}
```

## Best Practices

### Function Definition

```typescript
// ✅ Recommended: Complete function with centralized types
import { query } from "@convex/_generated/server";
import { v } from "convex/values";
import { UserV } from "@convex/types/validators/user";
import type { User } from "@convex/types/entities/user";

export const getUserById = query({
  args: { userId: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { userId }): Promise<User | null> => {
    return await ctx.db.get(userId);
  },
});
```

### Index-First Queries

```typescript
// ✅ Recommended: Index-first with pagination
export const listActiveUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
    activeOnly: v.boolean(),
  },
  returns: PaginationResultV(UserV.summary),
  handler: async (ctx, { paginationOpts, activeOnly }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_isActive", (q) => q.eq("isActive", activeOnly))
      .order("desc")
      .paginate(paginationOpts);
  },
});
```

### Public vs Internal Types

```typescript
// ✅ Public function - no sensitive data
export const getPublicUserProfile = query({
  args: { userId: v.id("users") },
  returns: v.union(UserV.public, v.null()),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;

    return {
      _id: user._id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
    };
  },
});

// ✅ Internal function - can include sensitive data
export const getUserByIdInternal = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(UserV.full, v.null()),
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});
```

## Migration Guide

For migrating existing functions to use centralized types, see [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md).

For performance optimization strategies, see [PERFORMANCE_GUIDE.md](./PERFORMANCE_GUIDE.md).

For architectural details, see [ARCHITECTURE.md](./ARCHITECTURE.md).
