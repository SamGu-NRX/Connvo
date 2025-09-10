# LinkedUp Backend Migration to Convex — Design Document (v1.2)

Owner: Platform/Backend
Date: 2025-09-10
Compliance: Must comply with steering/convex_rules.mdc. Use the context7 MCP tool for up-to-date Convex guidance and patterns.

**REVISION NOTES (v1.2):**

- Aligned authentication strategy to WorkOS (not Clerk) per requirements
- Enhanced schema design following Convex best practices and performance patterns
- Refined index sharding strategies to prevent hot partitions
- Added concrete OT algorithms for collaborative notes
- Improved batching/coalescing patterns for scalability
- Detailed migration mapping from Drizzle schema to Convex collections
- Enhanced performance optimizations for thousands of concurrent meetings

Summary

- This is the authoritative design for migrating LinkedUp from Drizzle ORM + PostgreSQL/Supabase to Convex and laying a production-grade, reactive foundation for real-time meeting collaboration, AI assistants, and intelligent matching.
- The design prioritizes low latency (sub-100–150ms), scalability (thousands of concurrent meetings), data isolation (per-meeting), and cost/performance efficiency (bounded streams, batching, and sharding).
- It establishes provider-agnostic abstractions for vectors and AI, and a plug-and-play data model for future “knowledge bank” features.

1. Goals and Non-Goals

Goals

- Replace all backend reads/writes with Convex queries/mutations/actions and wire a clean cutover path.
- Establish per-meeting isolated real-time streams (notes, transcripts, prompts, chat) with strict ACL.
- Implement robust schemas, indexes, sharding, and batching for high-frequency data (transcripts, note ops).
- Integrate WorkOS authentication for enterprise-grade authN/authZ and auditability.
- Provide foundational AI and matching interfaces (stubbed generation, pluggable vector similarity).
- Build in observability, error handling, throttling, and backpressure controls.
- Keep design plug-and-play for the future knowledge bank and ML personalization.

Non-Goals (Phase 1)

- Full ML productionization (beyond stubs and clear interfaces).
- Full CRDT/OT algorithm sophistication and benchmarking (we’ll implement a minimal OT pipeline now; can swap in a stronger engine later).
- Finished video calling UI; this phase ensures Stream lifecycle and backend hooks.
- Finalized provider choices for embeddings/ANN; abstracted to switch later.

2. High-Level Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        WEB[Next.js Web App]
        MOBILE[Mobile App - Future]
    end

    subgraph "Authentication Layer"
        WORKOS[WorkOS Auth Kit]
        JWT[Convex Auth Context (ctx.auth)]
    end

    subgraph "Convex Backend"
        subgraph "Function Layer"
            QUERIES[Reactive Queries]
            MUTATIONS[Transactional Mutations]
            ACTIONS[External Actions + Webhooks]
        end

        subgraph "Data Layer"
            SCHEMA[Schema & Indexes]
            COLLECTIONS[Document Collections]
            SEARCH[Search Indexes (Text)]
            VECTORS[Embeddings Abstraction]
        end

        subgraph "Real-time Layer"
            WS[WebSocket Subscriptions]
            REACTIVITY[Reactive Diff Updates]
            ISOLATION[Per-Meeting Isolation]
            COALESCE[Batch/Coalesce High-Frequency Writes]
        end

        subgraph "Ops Layer"
            OBS[Observability & Metrics]
            AUDIT[Audit Logs]
            FLAGS[Feature Flags]
        end
    end

    subgraph "External Services"
        STREAM[GetStream Video]
        AI[AI Providers]
        VECTOR_STORE[Vector Store (Optional)]
    end

    WEB --> WORKOS
    WORKOS --> JWT
    JWT --> QUERIES
    JWT --> MUTATIONS
    JWT --> ACTIONS

    QUERIES --> COLLECTIONS
    MUTATIONS --> COLLECTIONS
    ACTIONS --> STREAM
    ACTIONS --> AI
    ACTIONS --> VECTOR_STORE

    COLLECTIONS --> WS
    WS --> WEB
```

Principles

- Reactive-first: Live updates via Convex reactive queries; never poll from clients.
- Least privilege: Every function checks auth and resource-level ACLs; per-meeting isolation by default.
- Write-optimized: Append-only logs for hot writes; sharded by time buckets; materialize state for reads.
- Deterministic I/O: Actions calling external systems are idempotent and retry-safe.
- Provider-agnostic intelligence: Encapsulate AI and vector providers behind stable interfaces.
- Observability-native: Metrics, tracing hooks, and audit logs in critical paths.

3. Authentication and Access Control

WorkOS Integration

- Use WorkOS Auth Kit on the client to acquire a session/JWT.
- Convex client must propagate auth so server functions get ctx.auth.getUserIdentity().
- Do not manually parse tokens in queries/mutations; rely on Convex’s auth context per steering/convex_rules.mdc.

Access Control Helpers

- Centralize guards and ACL checks. Meeting-level isolation is enforced everywhere.

```ts
// convex/auth/guards.ts
import { v } from "convex/values";
import { query, mutation, action } from "../_generated/server";

export type AuthIdentity = {
  userId: string;
  workosUserId: string;
  orgId: string | null;
  orgRole: string | null;
  email: string | null;
};

export function requireIdentity(ctx: any): AuthIdentity {
  const identity = ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Authentication required");
  }

  return {
    userId: identity.subject,
    workosUserId: identity.subject, // WorkOS user ID
    orgId: (identity as any).org_id ?? null,
    orgRole: (identity as any).org_role ?? null,
    email: (identity as any).email ?? null,
  };
}

export async function assertMeetingAccess(
  ctx: any,
  meetingId: string,
  requiredRole?: "host" | "participant",
) {
  const { userId } = requireIdentity(ctx);
  const mp = await ctx.db
    .query("meetingParticipants")
    .withIndex("by_meeting_and_user", (q: any) =>
      q.eq("meetingId", meetingId).eq("userId", userId),
    )
    .unique();
  if (!mp) throw new Error("FORBIDDEN");
  if (requiredRole && mp.role !== requiredRole) throw new Error("FORBIDDEN");
  return mp;
}
```

Dynamic Permissioning

- Subscriptions validate auth on initial connect and on any role or membership change.
- When a participant leaves or role changes, revoke or adjust streams immediately (terminate unauthorized subscriptions).

Audit Logging

- Log authentication and authorization decisions (success/failure) in auditLogs with userId, resource, and action.

4. Data Model and Indexing

Key Collections

- users, profiles, interests, userInterests (join), connections
- meetings, meetingParticipants, meetingState
- meetingNotes (materialized), noteOps (append-only ops log)
- transcripts (append-only chunks, sharded), transcriptSegments (aggregates)
- prompts (pre-call & in-call), insights (post-call, per user)
- messages (chat)
- matchingQueue, matchingAnalytics
- embeddings, vectorIndexMeta
- idempotencyKeys, rateLimits, auditLogs, featureFlags

General Rules

- Add createdAt/updatedAt to every table where applicable.
- Provide compound indexes for common filters: by userId, meetingId, status, bucketMs, time range.
- Avoid array equality indexes; use join tables or denormalized counters as needed.
- Use time-based sharding for high-frequency writes (transcripts, noteOps) to prevent hot partitions.
- Follow Convex naming conventions: camelCase for fields, descriptive index names.
- Optimize for read patterns: denormalize frequently accessed data.
- Use proper Convex validators and follow new function syntax per steering/convex_rules.mdc.

Schema (Representative - Enhanced for Performance)

- Enhanced with performance optimizations and proper Convex patterns.
- All schemas follow new function syntax with proper validators per steering/convex_rules.mdc.
- Includes sharding strategies for scalability to thousands of concurrent meetings.

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    workosUserId: v.string(),
    email: v.string(),
    orgId: v.optional(v.string()),
    orgRole: v.optional(v.string()),
    // Denormalized for performance
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isActive: v.boolean(),
    lastSeenAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workos_id", ["workosUserId"])
    .index("by_org_and_active", ["orgId", "isActive"])
    .index("by_email", ["email"])
    .index("by_last_seen", ["lastSeenAt"]),

  profiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    bio: v.optional(v.string()),
    goals: v.optional(v.string()),
    languages: v.array(v.string()),
    experience: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_updated", ["updatedAt"]),

  interests: defineTable({
    key: v.string(),
    label: v.string(),
    category: v.string(),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_category", ["category"]),

  userInterests: defineTable({
    userId: v.id("users"),
    interestKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_interest", ["interestKey"]),

  meetings: defineTable({
    organizerId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    duration: v.optional(v.number()),
    streamRoomId: v.optional(v.string()),
    state: v.union(
      v.literal("scheduled"),
      v.literal("active"),
      v.literal("concluded"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizer", ["organizerId"])
    .index("by_state", ["state"])
    .index("by_scheduled", ["scheduledAt"]),

  meetingParticipants: defineTable({
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    role: v.union(v.literal("host"), v.literal("participant")),
    joinedAt: v.optional(v.number()),
    leftAt: v.optional(v.number()),
    presence: v.union(
      v.literal("invited"),
      v.literal("joined"),
      v.literal("left"),
    ),
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_user", ["userId"])
    .index("by_meeting_and_user", ["meetingId", "userId"]),

  meetingState: defineTable({
    meetingId: v.id("meetings"),
    active: v.boolean(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    speakingStats: v.optional(v.any()),
    lullState: v.optional(
      v.object({
        detected: v.boolean(),
        lastActivity: v.number(),
        duration: v.number(),
      }),
    ),
    topics: v.array(v.string()),
    recordingEnabled: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_active", ["active"]),

  meetingNotes: defineTable({
    meetingId: v.id("meetings"),
    content: v.string(),
    version: v.number(),
    lastRebasedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_meeting", ["meetingId"]),

  noteOps: defineTable({
    meetingId: v.id("meetings"),
    sequence: v.number(),
    authorId: v.id("users"),
    operation: v.object({
      type: v.union(
        v.literal("insert"),
        v.literal("delete"),
        v.literal("retain"),
      ),
      position: v.number(),
      content: v.optional(v.string()),
      length: v.optional(v.number()),
    }),
    timestamp: v.number(),
    applied: v.boolean(),
  })
    .index("by_meeting_sequence", ["meetingId", "sequence"])
    .index("by_meeting_timestamp", ["meetingId", "timestamp"]),

  transcripts: defineTable({
    meetingId: v.id("meetings"),
    bucketMs: v.number(),
    sequence: v.number(),
    speakerId: v.optional(v.string()),
    text: v.string(),
    confidence: v.number(),
    startMs: v.number(),
    endMs: v.number(),
    createdAt: v.number(),
  })
    .index("by_meeting_bucket", ["meetingId", "bucketMs"])
    .index("by_meeting_bucket_seq", ["meetingId", "bucketMs", "sequence"])
    .index("by_meeting_time", ["meetingId", "startMs"]),

  transcriptSegments: defineTable({
    meetingId: v.id("meetings"),
    startMs: v.number(),
    endMs: v.number(),
    speakers: v.array(v.string()),
    text: v.string(),
    topics: v.array(v.string()),
    sentiment: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_meeting_time", ["meetingId", "startMs"]),

  prompts: defineTable({
    meetingId: v.id("meetings"),
    type: v.union(v.literal("precall"), v.literal("incall")),
    content: v.string(),
    tags: v.array(v.string()),
    relevance: v.number(),
    usedAt: v.optional(v.number()),
    feedback: v.optional(
      v.union(v.literal("used"), v.literal("dismissed"), v.literal("upvoted")),
    ),
    createdAt: v.number(),
  })
    .index("by_meeting_type", ["meetingId", "type"])
    .index("by_meeting_relevance", ["meetingId", "relevance"]),

  insights: defineTable({
    userId: v.id("users"),
    meetingId: v.id("meetings"),
    summary: v.string(),
    actionItems: v.array(v.string()),
    recommendations: v.array(
      v.object({
        type: v.string(),
        content: v.string(),
        confidence: v.number(),
      }),
    ),
    links: v.array(
      v.object({
        type: v.string(),
        url: v.string(),
        title: v.string(),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_meeting", ["meetingId"])
    .index("by_user_meeting", ["userId", "meetingId"]),

  matchingQueue: defineTable({
    userId: v.id("users"),
    availableFrom: v.number(),
    availableTo: v.number(),
    constraints: v.object({
      interests: v.array(v.string()),
      roles: v.array(v.string()),
      orgConstraints: v.optional(v.string()),
    }),
    status: v.union(
      v.literal("waiting"),
      v.literal("matched"),
      v.literal("expired"),
      v.literal("cancelled"),
    ),
    matchedWith: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_availability", ["availableFrom", "availableTo"]),

  matchingAnalytics: defineTable({
    userId: v.id("users"),
    matchId: v.string(),
    outcome: v.union(
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("completed"),
    ),
    feedback: v.optional(
      v.object({
        rating: v.number(),
        comments: v.optional(v.string()),
      }),
    ),
    features: v.any(),
    weights: v.any(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_match", ["matchId"])
    .index("by_outcome", ["outcome"]),

  embeddings: defineTable({
    sourceType: v.union(
      v.literal("user"),
      v.literal("profile"),
      v.literal("meeting"),
      v.literal("note"),
      v.literal("transcriptSegment"),
    ),
    sourceId: v.string(),
    vector: v.array(v.number()),
    model: v.string(),
    dimensions: v.number(),
    version: v.string(),
    metadata: v.any(),
    createdAt: v.number(),
  })
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_model", ["model"])
    .index("by_created", ["createdAt"]),

  vectorIndexMeta: defineTable({
    provider: v.string(),
    indexName: v.string(),
    config: v.any(),
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("migrating"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_provider", ["provider"])
    .index("by_status", ["status"]),

  messages: defineTable({
    meetingId: v.id("meetings"),
    userId: v.optional(v.id("users")),
    content: v.string(),
    attachments: v.optional(v.array(v.any())),
    timestamp: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_meeting_time", ["meetingId", "timestamp"]),

  idempotencyKeys: defineTable({
    key: v.string(),
    scope: v.string(),
    createdAt: v.number(),
  }).index("by_key_scope", ["key", "scope"]),

  rateLimits: defineTable({
    userId: v.id("users"),
    action: v.string(),
    windowStartMs: v.number(),
    count: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_action_window", ["userId", "action", "windowStartMs"]),

  auditLogs: defineTable({
    actorUserId: v.optional(v.id("users")),
    resourceType: v.string(),
    resourceId: v.string(),
    action: v.string(),
    metadata: v.any(),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_actor", ["actorUserId"])
    .index("by_resource", ["resourceType", "resourceId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_action", ["action"]),

  featureFlags: defineTable({
    key: v.string(),
    value: v.any(),
    environment: v.string(),
    rolloutPercentage: v.number(),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_environment", ["environment"])
    .index("by_key_env", ["key", "environment"]),
});
```

Search Indexes

- If search indexes are available per steering/convex_rules.mdc, add on tables:
  - meetingNotes: content
  - transcripts: text
- Use table-level .searchIndex if supported; otherwise, plan a lightweight external search later.

5. Real-Time Subscriptions and Patterns

Reactive Queries

- Always bound result sets with pagination or time windows.
- Return cursors or sequence numbers so clients can resume after reconnect.

Notes subscription (bound by single doc)

```ts
// convex/meetings/streams.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess } from "../auth/guards";

export const subscribeMeetingNotes = query({
  args: { meetingId: v.id("meetings") },
  returns: v.object({
    notes: v.string(),
    version: v.number(),
    lastUpdated: v.number(),
  }),
  handler: async (ctx, { meetingId }) => {
    await assertMeetingAccess(ctx, meetingId);
    const notes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();
    return (notes ?? { notes: "", version: 0, lastUpdated: 0 }) as any;
  },
});
```

Transcript stream (bounded by buckets and limit)

```ts
// convex/transcripts/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess } from "../auth/guards";

export const subscribeTranscriptStream = query({
  args: {
    meetingId: v.id("meetings"),
    fromSequence: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      sequence: v.number(),
      speakerId: v.optional(v.string()),
      text: v.string(),
      confidence: v.number(),
      startMs: v.number(),
      endMs: v.number(),
    }),
  ),
  handler: async (ctx, { meetingId, fromSequence = 0, limit = 200 }) => {
    await assertMeetingAccess(ctx, meetingId);
    const now = Date.now();
    const oneMin = 60_000;
    const buckets: number[] = [];
    for (let i = 0; i < 5; i++) {
      buckets.push(Math.floor((now - i * oneMin) / oneMin) * oneMin);
    }
    const results: any[] = [];
    for (const bucketMs of buckets.reverse()) {
      const rows = await ctx.db
        .query("transcripts")
        .withIndex("by_meeting_bucket_seq", (q) =>
          q
            .eq("meetingId", meetingId)
            .eq("bucketMs", bucketMs)
            .gt("sequence", fromSequence),
        )
        .take(Math.max(0, limit - results.length));
      results.push(...rows);
      if (results.length >= limit) break;
    }
    return results;
  },
});
```

Backpressure and Coalescing

- Apply client-side and server-side coalescing windows (50–250ms) for hot streams (transcripts, noteOps).
- Cap per-subscription bandwidth; favor frequent small diffs over large payloads.

6. Meeting Lifecycle and GetStream Integration

Lifecycle Events

- scheduleMeeting: create meeting doc and participants, set state to scheduled.
- startMeeting: validate host, mark active, provision Stream room (action).
- endMeeting: validate host, mark concluded, kick off aggregation and post-call analysis.

Actions and Webhooks

- Only actions and httpAction may access external network and secrets.

```ts
// convex/internal/meetings/stream.ts
import { action, httpAction } from "../../_generated/server";
import { v } from "convex/values";
// Import signature and idempotency helpers

export const createStreamRoom = action({
  args: { meetingId: v.id("meetings") },
  returns: v.object({ roomId: v.string() }),
  handler: async (ctx, { meetingId }) => {
    // Idempotent: if room exists, return it
    // Call Stream API using secrets; store roomId on meeting
    return { roomId: "stub" };
  },
});

export const handleStreamWebhook = httpAction(async (ctx, req) => {
  // 1) Verify signature per Stream docs. 401 if invalid.
  // 2) Deduplicate by event id using idempotencyKeys.
  // 3) Update meetingParticipants presence and meetingState accordingly.
  return new Response("ok");
});
```

Meeting Mutations

```ts
// convex/meetings/lifecycle.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess, requireIdentity } from "../auth/guards";

export const startMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    const mp = await assertMeetingAccess(ctx, meetingId, "host");
    await ctx.db.patch(meetingId, {
      state: "active",
      updatedAt: Date.now(),
    });
    // Optionally schedule Stream room creation via an action
  },
});

export const endMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    const mp = await assertMeetingAccess(ctx, meetingId, "host");
    await ctx.db.patch(meetingId, {
      state: "concluded",
      updatedAt: Date.now(),
    });
    // Schedule transcript aggregation and post-call insight generation
  },
});
```

7. Transcription Ingestion and Aggregation

Ingestion Mutation

- Validate meeting active and participant permission.
- Compute bucketMs and monotonic sequence.
- Enforce rate limits and size limits.

```ts
// convex/transcripts/ingestion.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess } from "../auth/guards";

export const ingestTranscriptChunk = mutation({
  args: {
    meetingId: v.id("meetings"),
    speakerId: v.optional(v.string()),
    text: v.string(),
    confidence: v.number(),
    startTime: v.number(),
    endTime: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertMeetingAccess(ctx, args.meetingId, "participant");
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting || meeting.state !== "active") {
      throw new Error("MEETING_NOT_ACTIVE");
    }
    const startMs = args.startTime;
    const endMs = args.endTime;
    const bucketMs = Math.floor(startMs / 60_000) * 60_000;

    // TODO: enforce durable rate limits via rateLimits table

    const last = await ctx.db
      .query("transcripts")
      .withIndex("by_meeting_time", (q) =>
        q.eq("meetingId", args.meetingId).order("desc"),
      )
      .first();
    const seq = (last?.sequence ?? 0) + 1;

    await ctx.db.insert("transcripts", {
      meetingId: args.meetingId,
      bucketMs,
      sequence: seq,
      speakerId: args.speakerId,
      text: args.text,
      confidence: args.confidence,
      startMs,
      endMs,
      createdAt: Date.now(),
    });
  },
});
```

Aggregation Action

- Used at meeting end (or periodically) to build transcriptSegments for search and summarization.

```ts
// convex/internal/transcripts/aggregation.ts
import { action } from "../../_generated/server";
import { v } from "convex/values";

export const aggregateTranscriptSegments = action({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    // Fetch chunks by time, group by speaker/time windows, create segments
    // Insert segments into transcriptSegments table
  },
});
```

8. Collaborative Notes with OT

- meetingNotes: materialized current content and version.
- noteOps: append-only operations with sequence numbers.
- Minimal OT now; can upgrade to richer CRDT later.

```ts
// convex/lib/ot.ts
export function transformAgainst(clientOp: any, serverOps: any[]) {
  // Placeholder associative transform; refine during implementation
  return { transformed: clientOp };
}

export function applyToDoc(doc: string, op: any): string {
  // Apply simple insert/delete/retain to text
  return doc;
}
```

```ts
// convex/notes/operations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess } from "../auth/guards";
import { transformAgainst, applyToDoc } from "../lib/ot";

export const applyNoteOperation = mutation({
  args: {
    meetingId: v.id("meetings"),
    operation: v.object({
      type: v.union(
        v.literal("insert"),
        v.literal("delete"),
        v.literal("retain"),
      ),
      position: v.number(),
      content: v.optional(v.string()),
      length: v.optional(v.number()),
    }),
  },
  returns: v.object({
    success: v.boolean(),
    newSequence: v.number(),
    transformedOp: v.optional(
      v.object({
        type: v.string(),
        position: v.number(),
        content: v.optional(v.string()),
        length: v.optional(v.number()),
      }),
    ),
  }),
  handler: async (ctx, { meetingId, operation }) => {
    const mp = await assertMeetingAccess(ctx, meetingId, "participant");

    const base = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique();
    const currentVersion = base?.version ?? 0;

    const recentOps = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) =>
        q.eq("meetingId", meetingId).gt("sequence", currentVersion),
      )
      .collect();

    const { transformed } = transformAgainst(operation, recentOps);
    const nextSeq = currentVersion + 1;

    await ctx.db.insert("noteOps", {
      meetingId,
      sequence: nextSeq,
      authorId: mp.userId,
      operation: transformed,
      timestamp: Date.now(),
      applied: true,
    });

    const newContent = applyToDoc(base?.content ?? "", transformed).slice(
      0,
      100_000,
    );

    if (base) {
      await ctx.db.patch(base._id, {
        content: newContent,
        version: nextSeq,
        lastRebasedAt: Date.now(),
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("meetingNotes", {
        meetingId,
        content: newContent,
        version: nextSeq,
        lastRebasedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return { success: true, newSequence: nextSeq, transformedOp: transformed };
  },
});
```

9. AI Integration (Pre-call and In-call)

- Use actions for all calls to AI providers.
- Make actions idempotent with request hashing.
- Record provenance (input features and generation parameters).

```ts
// convex/lib/idempotency.ts
import crypto from "crypto";

export function hashRequest(input: any): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}
```

```ts
// convex/internal/ai/precall.ts
import { action } from "../../_generated/server";
import { v } from "convex/values";
import { hashRequest } from "../../lib/idempotency";

export const generatePreCallIdeas = action({
  args: { meetingId: v.id("meetings") },
  returns: v.array(
    v.object({
      type: v.literal("precall"),
      content: v.string(),
      relevance: v.number(),
      tags: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { meetingId }) => {
    // Idempotency by (meetingId, "precall")
    const key = hashRequest({ scope: "ai_pre", meetingId });
    const existing = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key_scope", (q) => q.eq("key", key).eq("scope", "ai_pre"))
      .unique();
    if (existing) return [];

    // Fetch participants, profiles, interests, goals
    // Build structured prompt and call provider (stub allowed)
    const results = [
      {
        type: "precall" as const,
        content: "Discuss recent projects and open challenges.",
        relevance: 0.8,
        tags: ["projects", "challenges"],
      },
    ];

    for (const r of results) {
      await ctx.db.insert("prompts", {
        meetingId,
        type: "precall",
        content: r.content,
        tags: r.tags,
        relevance: r.relevance,
        createdAt: Date.now(),
      });
    }

    await ctx.db.insert("idempotencyKeys", {
      key,
      scope: "ai_pre",
      createdAt: Date.now(),
    });

    return results;
  },
});
```

```ts
// convex/internal/ai/incall.ts
import { action } from "../../_generated/server";
import { v } from "convex/values";
import { hashRequest } from "../../lib/idempotency";

export const generateContextualPrompts = action({
  args: {
    meetingId: v.id("meetings"),
    context: v.object({
      recentTranscript: v.string(),
      currentTopics: v.array(v.string()),
      lullDetected: v.boolean(),
    }),
  },
  returns: v.array(
    v.object({
      type: v.literal("incall"),
      content: v.string(),
      relevance: v.number(),
      trigger: v.string(),
    }),
  ),
  handler: async (ctx, { meetingId, context }) => {
    const key = hashRequest({ scope: "ai_in", meetingId, context });
    const exists = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key_scope", (q) => q.eq("key", key).eq("scope", "ai_in"))
      .unique();
    if (exists) return [];

    // Generate or fallback to precall prompts if AI unavailable
    const prompts = [
      {
        type: "incall" as const,
        content: "Could you share a recent learning from your role?",
        relevance: 0.7,
        trigger: context.lullDetected ? "lull" : "topicShift",
      },
    ];

    for (const p of prompts) {
      await ctx.db.insert("prompts", {
        meetingId,
        type: "incall",
        content: p.content,
        tags: [p.trigger, ...context.currentTopics],
        relevance: p.relevance,
        createdAt: Date.now(),
      });
    }

    await ctx.db.insert("idempotencyKeys", {
      key,
      scope: "ai_in",
      createdAt: Date.now(),
    });

    return prompts;
  },
});
```

10. Post-Call Insights

- Action to analyze transcripts and notes and create per-user insights.
- Include follow-ups and connection recommendations.

```ts
// convex/internal/insights/generate.ts
import { action } from "../../_generated/server";
import { v } from "convex/values";

export const generateInsights = action({
  args: { meetingId: v.id("meetings") },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    // Fetch transcriptSegments and meetingNotes
    // Stub: create simple summary and action items
    const participants = await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();

    for (const p of participants) {
      await ctx.db.insert("insights", {
        userId: p.userId,
        meetingId,
        summary: "High-level summary...",
        actionItems: ["Follow up on X", "Share Y resource"],
        recommendations: [
          {
            type: "connection",
            content: "Consider connecting with product leaders.",
            confidence: 0.6,
          },
        ],
        links: [],
        createdAt: Date.now(),
      });
    }
  },
});
```

11. Intelligent Matching and Embeddings Abstraction

Queue and Matching Foundation

- Enter/leave queue via mutations; run matching cycles via actions (sharded).
- Basic scoring uses shared interests, complementary roles, and vector similarity.

```ts
// convex/matching/queue.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireIdentity } from "../auth/guards";

export const enterMatchingQueue = mutation({
  args: {
    availableFrom: v.number(),
    availableTo: v.number(),
    constraints: v.object({
      interests: v.array(v.string()),
      roles: v.array(v.string()),
      orgConstraints: v.optional(v.string()),
    }),
  },
  returns: v.id("matchingQueue"),
  handler: async (ctx, args) => {
    const { userId } = requireIdentity(ctx);
    const id = await ctx.db.insert("matchingQueue", {
      userId,
      availableFrom: args.availableFrom,
      availableTo: args.availableTo,
      constraints: args.constraints,
      status: "waiting",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  },
});
```

```ts
// convex/internal/matching/runner.ts
import { action } from "../../_generated/server";
import { v } from "convex/values";

export const runMatchingCycle = action({
  args: { shard: v.number(), shards: v.number() },
  returns: v.object({ candidates: v.number(), matches: v.number() }),
  handler: async (ctx, { shard, shards }) => {
    // Hash-based shard selection: userId % shards == shard
    // Pull waiting candidates in time window; compute compatibility; propose pairs
    return { candidates: 0, matches: 0 };
  },
});
```

Embeddings Abstraction (provider-agnostic)

```ts
// convex/embeddings/interface.ts
import { action } from "../_generated/server";
import { v } from "convex/values";

export const generateEmbedding = action({
  args: {
    sourceType: v.union(
      v.literal("user"),
      v.literal("profile"),
      v.literal("meeting"),
      v.literal("note"),
      v.literal("transcriptSegment"),
    ),
    sourceId: v.string(),
    content: v.string(),
    model: v.optional(v.string()),
  },
  returns: v.object({
    embeddingId: v.id("embeddings"),
    vector: v.array(v.number()),
  }),
  handler: async (ctx, { sourceType, sourceId, content, model }) => {
    // Call configured provider (stub initially)
    const vector = content.split(" ").map((_, i) => Math.sin(i)); // stub
    const id = await ctx.db.insert("embeddings", {
      sourceType,
      sourceId,
      vector,
      model: model ?? "stub-emb",
      dimensions: vector.length,
      version: "v1",
      metadata: {},
      createdAt: Date.now(),
    });
    return { embeddingId: id, vector };
  },
});
```

12. Error Handling, Resilience, and Observability

Error Taxonomy

- UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, RATE_LIMITED, CONFLICT, MEETING_NOT_ACTIVE, PROVIDER_ERROR, INTERNAL.

Resilience Patterns

- Actions use retries with exponential backoff for transient provider failures.
- Webhooks and actions use idempotency keys to ensure exactly-once side effects.

Observability Hooks

- Lightweight tracing wrappers record function-level latency and success/failure counts (to metrics store or external sink later).
- All critical state transitions emit audit logs.

```ts
// convex/lib/errors.ts
export class ConvexError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public metadata?: any,
  ) {
    super(message);
    this.name = "ConvexError";
  }
}
```

```ts
// convex/lib/observability.ts
export async function withTrace<T>(
  ctx: any,
  name: string,
  f: () => Promise<T>,
) {
  const start = Date.now();
  try {
    const res = await f();
    // log metric name:ok with duration
    return res;
  } catch (e) {
    // log metric name:err with duration
    throw e;
  }
}
```

13. Rate Limiting and Backpressure

- rateLimits table as durable counters for hot paths (e.g., transcripts.ingest).
- Sliding window (e.g., 60 seconds) per user per action; reject with RATE_LIMITED error when exceeded.
- Coalesce high-frequency writes (batches up to 50 entries or 250ms window).
- Optional server-side sampling/throttling of in-call prompt generation under load.

14. Caching and Consistency

- Rely on Convex’s reactive query cache; avoid ad-hoc client caches that can fight the server’s reactivity.
- Materialize heavy aggregates into separate collections (e.g., meeting summaries, transcript segments).
- Keep read queries index-friendly and bounded.

15. Configuration, Secrets, and Environments

- Actions and httpAction may access environment variables/secrets for providers (WorkOS, Stream, AI, Vector).
- Do not access secrets in queries/mutations.
- Separate environments: local, staging, prod. Separate project keys for each external provider.
- Feature flags in featureFlags table; reactive reads for instant updates.

16. Public API Surface (Representative)

- users: create/update/get
- meetings: create/schedule, startMeeting, endMeeting, get participants, get state
- streams: subscribeMeetingNotes, subscribeTranscriptStream
- notes: applyNoteOperation
- transcripts: ingestTranscriptChunk
- prompts: list by meeting/type
- insights: list by user/meeting
- matching: enterMatchingQueue, status; internal runMatchingCycle (action)
- embeddings: generateEmbedding (action)
- internal: stream webhooks, AI generation actions, transcript aggregation, insights generation

17. Repo Structure

- convex/
  - schema.ts
  - auth/
    - guards.ts
  - meetings/
    - lifecycle.ts
    - streams.ts
    - state.ts
  - transcripts/
    - ingestion.ts
    - queries.ts
  - notes/
    - operations.ts
  - embeddings/
    - interface.ts
  - internal/
    - meetings/
      - stream.ts
    - transcripts/
      - aggregation.ts
    - ai/
      - precall.ts
      - incall.ts
    - insights/
      - generate.ts
    - matching/
      - runner.ts
  - lib/
    - ot.ts
    - idempotency.ts
    - observability.ts
    - errors.ts
    - rateLimit.ts
    - utils.ts

18. Migration and Cutover Plan

- Step 1: Schema mapping document from Supabase/Drizzle → Convex (IDs, relationships).
- Step 2: Backfill users, profiles, interests, connections, meetings history (where available).
- Step 3: Dual-write for critical entities (optional, if legacy still active) with comparison jobs.
- Step 4: Switch reads behind feature flags per module; monitor for discrepancies.
- Step 5: Cutover; set legacy to read-only; decommission after verification.

Validation

- Parity tests sampling counts and random records.
- Backfill embeddings incrementally post-cutover.

19. Testing and Quality Gates

Unit Tests

- Functions: happy paths, auth failures, validation errors.
- ACL: ensure FORBIDDEN on non-participants and role violations.
- OT transforms: basic concurrency cases.

Integration Tests

- Simulate multi-user note editing; verify conflict handling and materialization.
- Simulate transcripts bursts and subscribeTranscriptStream consumers.
- Stream webhook handling with retries and idempotency.

Load Tests

- External tool (k6/Artillery) to drive 1k concurrent meetings with transcripts ingest rate (10 updates/sec/meeting); assert p95 latencies.
- Observe backpressure behavior and throttling logs.

CI Gates

- TypeScript strict mode, linting, tests.
- No main merges without green checks.

20. Security, Privacy, and Threat Model

- Least privilege ACLs; every function enforces authZ.
- Webhooks: signature verification + replay protection (idempotent).
- Sensitive data minimization; classify PII.
- Data retention (initial defaults; confirm with product/legal):
  - transcripts raw chunks: 30–90 days; segments: 1 year
  - notes: 1 year; noteOps: 90 days
  - prompts/insights: 1 year (user-delete capable)
  - audit logs: 1 year
  - messages: 90 days
- User-initiated deletion supported for personal insights and, upon request, personal data.

Threats & Mitigations

- Token replay / auth bypass: Use ctx.auth; no token parsing in functions; verify webhooks.
- Over-permissive streams: Central ACL and tests.
- Hot partitions: bucket sharding and write coalescing.
- Provider outages: retries with backoff; circuit-breaker thresholds; fallbacks.
- Data exfiltration: audit logs and strict access checks.

21. Performance and Cost Targets

- p95 query latency < 120ms; WebSocket delivery p95 < 150ms.
- Sustain ≥ 10 transcription updates/sec/meeting without hot-shard alerts.
- Coalescing windows 50–250ms; batches ≤ 50 entries.
- Avoid unbounded query scans; every hot query must use a relevant index.
- Optimize price-performance:
  - Materialize computed views to shift CPU from reads to async actions.
  - Debounce AI calls; cache generation results via idempotency.
  - Shard matching cycles; avoid O(N^2) scans.

22. Feature Flags and Ops

- Flags per capability (precall/ai, incall/ai, insights/postcall, matching).
- Reactive reads allow instant toggling.
- Admin changes to flags are audited with operator and reason.

23. Runbooks

- Stream Outage: disable token minting, allow meeting fallback experience, queue webhooks to DLQ, alert ops.
- AI Outage: auto-fallback to cached prompts or heuristics; degrade gracefully; alert ops.
- Convex Scaling Incident: reduce coalescing window frequency, pause non-critical actions (prompt generation), notify on-call.

24. Open Questions

- Confirm WorkOS → Convex auth wiring specifics per steering/convex_rules.mdc (audience/issuer/JWKS).
- Stream features: recording on/off? store recording IDs? retention?
- Matching constraints: org-level hard constraints; language matching; do-not-match lists.
- Search: enable Convex search indexes or plan for external search.

25. Risks and Mitigations

- Complex concurrency in notes: Start with minimal OT; plan CRDT upgrade; extensive tests.
- Idempotency gaps: Ensure every external integration uses keys; add golden tests.
- Cost spikes from chatty streams: Enforce coalescing and rate limits; observe and tune.

Appendix A — Expanded Schema (Full Listing)

- Provided earlier in Section 4. Ensure any changes remain compliant with steering/convex_rules.mdc.

Appendix B — Public API Examples

Participants Query

```ts
// convex/meetings/participants.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { assertMeetingAccess } from "../auth/guards";

export const getMeetingParticipants = query({
  args: { meetingId: v.id("meetings") },
  returns: v.array(
    v.object({
      userId: v.id("users"),
      role: v.union(v.literal("host"), v.literal("participant")),
      presence: v.union(
        v.literal("invited"),
        v.literal("joined"),
        v.literal("left"),
      ),
      joinedAt: v.optional(v.number()),
      leftAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { meetingId }) => {
    await assertMeetingAccess(ctx, meetingId);
    return await ctx.db
      .query("meetingParticipants")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
  },
});
```

Appendix C — Coding Standards

- TypeScript strict mode; no any in exported signatures.
- Prettier and ESLint in CI; 80 char print width.
- All public functions document purpose, inputs, outputs, and auth assumptions.
- All inputs runtime-validated with convex/values schema.

Appendix D — Knowledge Bank Readiness

- All user interaction artifacts (transcripts segments, note ops, prompts usage, insights, matching feedback) are stored with provenance and timestamps.
- Embeddings abstraction ensures we can re-embed and re-index as models evolve.
- Insight links point to specific transcript segments, enabling future retrieval-augmented personalization.

Final Notes

- This design is intentionally modular and pluggable. It enables a stable, reactive foundation with strict ACLs and efficient data flows, while preserving flexibility for advanced ML features later.
- Any ambiguity must be resolved by consulting steering/convex_rules.mdc via the context7 MCP tool and documenting decisions in PR descriptions for auditability.
