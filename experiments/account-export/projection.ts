/**
 * Source-indexed projection policy for the caller-only account export study.
 *
 * QUESTION UNDER TEST
 * -------------------
 * A caller-only export must never contain somebody else's private meeting
 * data. This module encodes which schema tables and fields may enter a
 * caller's export, and every decision cites the authorization contract that
 * justifies it (file:line, verified at base commit d86620c of
 * obv/products-connvo-hardening-20261009-r1).
 *
 * This is an interpretive instrument for the experiment, NOT a production
 * proposal: the production export endpoint does not exist yet. The policy is
 * deliberately source-indexed so a reviewer can check every rule against the
 * actual contract instead of trusting a summary.
 *
 * Classes are EXPORT-OUTCOME classes:
 *
 *  - "owner"     — the row is the caller's own record; exported in full
 *                  minus sensitive fields (provider internals).
 *  - "shared"    — meeting-scoped content the caller has a documented export
 *                  grant for (host of the meeting), or a mutual record
 *                  (connections). Exported minus sensitive fields.
 *  - "excluded"  — the row never enters the caller's export. This covers
 *                  (a) other users' rows, (b) rows in meetings the caller
 *                  has no participation in, (c) rows the caller could read
 *                  but has no EXPORT authority for (refusals — the caller's
 *                  participant role lacks the "export" permission), and
 *                  (d) system/infrastructure rows outside the export
 *                  contract entirely.
 *
 * Refusal rule (load-bearing): missing authority for a record is a REFUSAL
 * recorded in the archive, never a guessed permission. The runtime export
 * function derives every inclusion from the same production guards the app
 * uses (requireIdentity, assertMeetingAccess semantics) and the production
 * permission matrix (permissionsForResource); it never invents a grant.
 */

// ---------------------------------------------------------------------------
// Authority contract — the ONLY sources this policy leans on
// ---------------------------------------------------------------------------

export const AUTHORITY_SOURCES = {
  requireIdentity:
    "convex/auth/guards.ts:42 requireIdentity — a valid WorkOS session must resolve an active, provisioned Convex user; deactivated accounts are refused outright (isActive === false check)",
  assertMeetingAccess:
    "convex/auth/guards.ts:128 assertMeetingAccess — access to meeting-scoped data requires a meetingParticipants row for the caller; non-participants are refused",
  assertOrgAccess:
    "convex/auth/guards.ts:176 assertOrgAccess — org-role hierarchy (admin > member)",
  assertOwnershipOrAdmin:
    "convex/auth/guards.ts:210 assertOwnershipOrAdmin — resource owner or org admin",
  permissionsForResource:
    "convex/lib/permissions.ts:26 permissionsForResource — per-resource role→permission matrix; the 'export' permission exists ONLY for meetingNotes (host) and transcripts (host); participants get read/write or read but never export; meetingParticipants is never exportable for any role; messages, events, recordings and all other resources have no entry at all",
  exportResponse:
    "convex/types/api/responses.ts:244 ExportResponse — the envelope the export must satisfy (exportId, status, format, metadata.{requestedAt, completedAt, recordCount, ...})",
  exportResponseValidator:
    "convex/types/validators/responses.ts:307 ExportResponseV.full — runtime validator for the same envelope",
  settingsScope:
    "convex/settings/queries.ts:19 getCurrentUserSettings — settings reads are scoped by the requireIdentity caller; settings are the caller's own data",
} as const;

// ---------------------------------------------------------------------------
// Policy tables
// ---------------------------------------------------------------------------

export const POLICY_VERSION = "account-export/projection-v1";

export type AccessClass = "owner" | "shared" | "excluded";

export interface TablePolicy {
  table: string;
  /** Static class for unconditional tables; conditional tables note it here. */
  class: AccessClass | "conditional";
  /** Human-readable authority decision, citing AUTHORITY_SOURCES keys. */
  authority: string;
  /** Source index: contract symbols this decision rests on. */
  sources: string[];
  /** All schema fields (convex/schema/*.ts at base commit d86620c). */
  fields: string[];
  /**
   * Sensitive fields stripped from every exported row of this table.
   * Criteria: third-party provider internals and identity-provider IDs —
   * data the caller cannot own and whose presence in a portable archive
   * enables correlation, not portability.
   */
  sensitiveFields: string[];
  note?: string;
}

export const TABLE_POLICIES: TablePolicy[] = [
  {
    table: "users",
    class: "conditional",
    authority: "Caller's own user row only (requireIdentity resolves the caller; ownership is self). Other users' rows are excluded.",
    sources: ["requireIdentity"],
    fields: ["workosUserId", "email", "orgId", "orgRole", "displayName", "avatarUrl", "isActive", "lastSeenAt", "onboardingComplete", "onboardingStartedAt", "onboardingCompletedAt", "createdAt", "updatedAt"],
    sensitiveFields: ["workosUserId"],
    note: "workosUserId is the WorkOS identity-provider subject — not portable data, and pairing it with email in a portable file invites correlation. Redacted even from the caller's own row.",
  },
  {
    table: "profiles",
    class: "conditional",
    authority: "Caller's own profile only. Other users' profiles are excluded even for meetings they share (caller-only export).",
    sources: ["requireIdentity", "assertOwnershipOrAdmin"],
    fields: ["userId", "displayName", "bio", "goals", "languages", "experience", "age", "gender", "field", "jobTitle", "company", "linkedinUrl", "createdAt", "updatedAt"],
    sensitiveFields: [],
    note: "profileVisibility (userSettings) governs visibility to OTHERS; it cannot reduce what the caller may export about themselves.",
  },
  {
    table: "userSettings",
    class: "conditional",
    authority: "Caller's own settings row (settings queries scope by requireIdentity caller). Missing row → empty section, not an error.",
    sources: ["settingsScope"],
    fields: ["userId", "emailNotifications", "pushNotifications", "smsNotifications", "profileVisibility", "dataSharing", "activityTracking", "createdAt", "updatedAt"],
    sensitiveFields: [],
  },
  {
    table: "userInterests",
    class: "conditional",
    authority: "Caller's own interest selections.",
    sources: ["requireIdentity"],
    fields: ["userId", "interestKey", "createdAt"],
    sensitiveFields: [],
  },
  {
    table: "interests",
    class: "excluded",
    authority: "Global taxonomy catalog, not personal data. Outside the export contract.",
    sources: [],
    fields: ["key", "label", "category", "iconName", "usageCount", "createdAt"],
    sensitiveFields: [],
  },
  {
    table: "connections",
    class: "conditional",
    authority: "Mutual relationship: rows where the caller is requester or addressee (assertOwnershipOrAdmin spirit: either party of a connection is a legitimate party to it).",
    sources: ["assertOwnershipOrAdmin"],
    fields: ["requesterId", "addresseeId", "status", "createdAt", "updatedAt"],
    sensitiveFields: [],
    note: "Foreign-key references (the counterpart user id) are preserved as stored; the referenced CONTENT is not exported.",
  },
  {
    table: "meetings",
    class: "conditional",
    authority: "Organizer → owner. Participant (assertMeetingAccess grants read of meeting metadata) → shared. No participation → excluded.",
    sources: ["assertMeetingAccess", "requireIdentity"],
    fields: ["organizerId", "title", "description", "scheduledAt", "duration", "webrtcEnabled", "streamRoomId", "state", "participantCount", "averageRating", "createdAt", "updatedAt"],
    sensitiveFields: ["streamRoomId"],
    note: "streamRoomId is a third-party provider (GetStream) room identifier — provider infrastructure, not user data.",
  },
  {
    table: "meetingParticipants",
    class: "conditional",
    authority: "Caller's own participation rows only. Other members' presence rows: permissionsForResource('meetingParticipants', role) grants read/invite/remove/manage but NEVER export for any role — missing authority is a refusal, not a guess.",
    sources: ["assertMeetingAccess", "permissionsForResource"],
    fields: ["meetingId", "userId", "role", "joinedAt", "leftAt", "presence", "createdAt"],
    sensitiveFields: [],
  },
  {
    table: "meetingState",
    class: "excluded",
    authority: "Ephemeral live-session state (speaking stats, lull detection). No export grant exists in the permission matrix.",
    sources: ["permissionsForResource"],
    fields: ["meetingId", "active", "startedAt", "endedAt", "speakingStats", "lullState", "topics", "recordingEnabled", "updatedAt"],
    sensitiveFields: [],
  },
  {
    table: "meetingNotes",
    class: "conditional",
    authority: "Export grant is host-only: permissionsForResource('meetingNotes','host') includes 'export'; participant gets read/write but NOT export. Caller-hosted meetings → shared; participant-only → refused.",
    sources: ["assertMeetingAccess", "permissionsForResource"],
    fields: ["meetingId", "content", "version", "lastRebasedAt", "updatedAt"],
    sensitiveFields: [],
  },
  {
    table: "noteOps",
    class: "excluded",
    authority: "Per-author operation log (editor telemetry, includes other authors' keystroke ops). No export grant in the permission matrix; the meetingNotes export covers note content.",
    sources: ["permissionsForResource"],
    fields: ["meetingId", "sequence", "authorId", "operation", "timestamp", "applied"],
    sensitiveFields: [],
  },
  {
    table: "meetingCounters",
    class: "excluded",
    authority: "Sequence allocation bookkeeping. Not user data.",
    sources: [],
    fields: ["meetingId", "lastSequence", "updatedAt"],
    sensitiveFields: [],
  },
  {
    table: "meetingEvents",
    class: "excluded",
    authority: "Lifecycle telemetry. No export grant in the permission matrix.",
    sources: ["permissionsForResource"],
    fields: ["meetingId", "event", "userId", "duration", "success", "error", "metadata", "timestamp", "createdAt"],
    sensitiveFields: [],
  },
  {
    table: "meetingRecordings",
    class: "excluded",
    authority: "Provider infrastructure (GetStream/URLs). No export grant in the permission matrix.",
    sources: ["permissionsForResource"],
    fields: ["meetingId", "recordingId", "recordingUrl", "provider", "status", "error", "lastAttempt", "attempts", "createdAt", "updatedAt"],
    sensitiveFields: [],
  },
  {
    table: "videoRoomConfigs",
    class: "excluded",
    authority: "Provider room configuration incl. ICE credentials. Never user data; no export grant.",
    sources: ["permissionsForResource"],
    fields: ["meetingId", "roomId", "provider", "iceServers", "features", "createdAt", "updatedAt"],
    sensitiveFields: [],
  },
  {
    table: "transcripts",
    class: "conditional",
    authority: "Export grant is host-only: permissionsForResource('transcripts','host') includes 'export'; participant gets read only. Caller-hosted meetings → shared (meeting content, including other speakers' contributions — the host's export grant is what authorizes this); participant-only → refused.",
    sources: ["assertMeetingAccess", "permissionsForResource"],
    fields: ["meetingId", "bucketMs", "sequence", "speakerId", "text", "confidence", "startMs", "endMs", "isInterim", "wordCount", "language", "createdAt"],
    sensitiveFields: [],
    note: "speakerId is an opaque per-meeting speaker label (v.string()), not a user id — correlation-resistant by construction.",
  },
  {
    table: "transcriptionSessions",
    class: "excluded",
    authority: "Provider session metadata (whisper/assemblyai/getstream). Infrastructure, no export grant.",
    sources: ["permissionsForResource"],
    fields: ["meetingId", "provider", "status", "startedAt", "endedAt", "metadata", "createdAt", "updatedAt"],
    sensitiveFields: [],
  },
  {
    table: "transcriptSegments",
    class: "conditional",
    authority: "Derived view of transcript content; inherits the transcripts authority (host-only export). Judgment call, recorded here: the permission matrix has no separate entry, and segments are transformations of transcript text.",
    sources: ["assertMeetingAccess", "permissionsForResource"],
    fields: ["meetingId", "startMs", "endMs", "speakers", "text", "topics", "sentiment", "createdAt"],
    sensitiveFields: [],
  },
  {
    table: "messages",
    class: "excluded",
    authority: "NO resource entry in permissionsForResource — no export authority exists for chat. Missing authority is a refusal, never a guessed permission.",
    sources: ["permissionsForResource"],
    fields: ["meetingId", "userId", "content", "attachments", "timestamp"],
    sensitiveFields: [],
    note: "Even the caller's own messages are refused: the contract defines no export grant for chat, and extending the matrix is a production decision outside this experiment.",
  },
  {
    table: "prompts",
    class: "excluded",
    authority: "AI prompt content for a meeting. No export grant in the permission matrix.",
    sources: ["permissionsForResource"],
    fields: ["meetingId", "type", "content", "tags", "relevance", "usedAt", "feedback", "createdAt"],
    sensitiveFields: [],
  },
  {
    table: "insights",
    class: "conditional",
    authority: "Caller's own generated insights (userId-keyed, produced FOR the caller).",
    sources: ["requireIdentity"],
    fields: ["userId", "meetingId", "summary", "actionItems", "recommendations", "links", "createdAt"],
    sensitiveFields: [],
    note: "Rows may reference meetings not included in the export; references are preserved as stored (the caller owns the row), while referenced content stays behind its own authority check.",
  },
  {
    table: "embeddings",
    class: "excluded",
    authority: "Opaque vectors over mixed sources (users, profiles, meetings — mostly other people's content). Outside the export contract.",
    sources: [],
    fields: ["sourceType", "sourceId", "vector", "model", "dimensions", "version", "metadata", "createdAt"],
    sensitiveFields: [],
  },
  {
    table: "vectorIndexMeta",
    class: "excluded",
    authority: "Vector index configuration. System data.",
    sources: [],
    fields: ["provider", "indexName", "config", "status", "createdAt", "updatedAt"],
    sensitiveFields: [],
  },
  {
    table: "matchingQueue",
    class: "conditional",
    authority: "Caller's own matching-queue entry (userId-keyed).",
    sources: ["requireIdentity"],
    fields: ["userId", "availableFrom", "availableTo", "constraints", "status", "matchedWith", "createdAt", "updatedAt"],
    sensitiveFields: [],
  },
  {
    table: "matchingAnalytics",
    class: "conditional",
    authority: "Caller's own matching analytics (userId-keyed).",
    sources: ["requireIdentity"],
    fields: ["userId", "matchId", "outcome", "feedback", "features", "weights", "createdAt"],
    sensitiveFields: [],
  },
  {
    table: "offlineOperationQueue",
    class: "excluded",
    authority: "Offline sync machinery (per-client op queue). Infrastructure, not a user-facing record.",
    sources: [],
    fields: ["meetingId", "clientId", "queueId", "operation", "operationId", "authorId", "clientSequence", "timestamp", "queuedAt", "attempts", "lastAttempt", "error", "status"],
    sensitiveFields: [],
  },
  {
    table: "offlineCheckpoints",
    class: "excluded",
    authority: "Offline sync machinery (durable checkpoints). Infrastructure.",
    sources: [],
    fields: ["checkpointId", "meetingId", "clientId", "sequence", "version", "contentHash", "timestamp", "createdAt"],
    sensitiveFields: [],
  },
  {
    table: "idempotencyKeys",
    class: "excluded",
    authority: "System idempotency bookkeeping.",
    sources: [],
    fields: ["key", "scope", "metadata", "createdAt"],
    sensitiveFields: [],
  },
  {
    table: "alerts",
    class: "excluded",
    authority: "Operational alerting. System data.",
    sources: [],
    fields: ["alertId", "severity", "category", "title", "message", "metadata", "actionable", "status", "escalationTime", "createdAt", "updatedAt"],
    sensitiveFields: [],
  },
  {
    table: "performanceMetrics",
    class: "excluded",
    authority: "Operational telemetry. System data.",
    sources: [],
    fields: ["name", "value", "unit", "labels", "meetingId", "threshold", "timestamp", "createdAt"],
    sensitiveFields: [],
  },
  {
    table: "rateLimits",
    class: "excluded",
    authority: "Rate-limit accounting. System data.",
    sources: [],
    fields: ["userId", "action", "windowStartMs", "count", "createdAt", "updatedAt"],
    sensitiveFields: [],
  },
  {
    table: "auditLogs",
    class: "excluded",
    authority: "Audit reads are internal-only (pinned by convex/auth/tenancy.test.ts); ipAddress/userAgent are sensitive. Outside the export contract.",
    sources: [],
    fields: ["actorUserId", "resourceType", "resourceId", "action", "metadata", "ipAddress", "userAgent", "timestamp"],
    sensitiveFields: [],
  },
  {
    table: "featureFlags",
    class: "excluded",
    authority: "Platform configuration. System data.",
    sources: [],
    fields: ["key", "value", "environment", "rolloutPercentage", "updatedBy", "createdAt", "updatedAt"],
    sensitiveFields: [],
  },
];

// ---------------------------------------------------------------------------
// Derived sets used by BOTH the runtime export and the fixture classifier
// ---------------------------------------------------------------------------

/** Tables whose rows are keyed by userId (caller's own rows → owner). */
export const USER_KEYED_TABLES = [
  "users",
  "profiles",
  "userSettings",
  "userInterests",
  "insights",
  "matchingQueue",
  "matchingAnalytics",
] as const;

/** Meeting-scoped tables with an export grant in the permission matrix. */
export const MEETING_SCOPED_EXPORTABLE: Record<string, { resource: string; grantRole: "host" }> = {
  transcripts: { resource: "transcripts", grantRole: "host" },
  transcriptSegments: { resource: "transcripts", grantRole: "host" },
  meetingNotes: { resource: "meetingNotes", grantRole: "host" },
};

/** Meeting-scoped tables with NO export authority at all (refusals). */
export const MEETING_SCOPED_NO_GRANT = [
  "messages",
  "noteOps",
  "meetingEvents",
  "meetingRecordings",
  "videoRoomConfigs",
  "meetingState",
  "transcriptionSessions",
  "prompts",
  "meetingCounters",
] as const;

/** Tables outside the export contract entirely (system/infra/global). */
export const EXCLUDED_SYSTEM_TABLES = [
  "interests",
  "embeddings",
  "vectorIndexMeta",
  "offlineOperationQueue",
  "offlineCheckpoints",
  "idempotencyKeys",
  "alerts",
  "performanceMetrics",
  "rateLimits",
  "auditLogs",
  "featureFlags",
] as const;

/** Bounded-pagination ceilings enforced by the runtime export. */
export const MAX_PAGE_SIZE = 100;
export const MAX_ROWS_PER_TABLE = 1000;

// ---------------------------------------------------------------------------
// Policy integrity
// ---------------------------------------------------------------------------

/** Deterministic FNV-1a (32-bit, hex) — an integrity mark, not a security hash. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ("00000000" + hash.toString(16)).slice(-8);
}

function canonicalPolicyJson(): string {
  return JSON.stringify(
    TABLE_POLICIES.map((p) => ({
      table: p.table,
      class: p.class,
      sensitiveFields: [...p.sensitiveFields].sort(),
      fields: [...p.fields].sort(),
    })),
  );
}

/** Checksum over the policy content; embedded in archives and re-checked by the reader. */
export const POLICY_CHECKSUM = fnv1a(`${POLICY_VERSION}\n${canonicalPolicyJson()}`);

// ---------------------------------------------------------------------------
// Row classification (single rule source for the fixture classifier)
// ---------------------------------------------------------------------------

export interface RowClassContext {
  callerRef: string;
  /** owner user for user-keyed tables / meetingParticipants. */
  userRef?: string | null;
  organizerRef?: string | null;
  meetingRef?: string | null;
  requesterRef?: string | null;
  addresseeRef?: string | null;
  /** The caller's role in this meeting, when the caller is a participant. */
  callerRoleInMeeting?: "host" | "participant" | "observer" | null;
}

export interface RowClassDecision {
  class: AccessClass;
  reason: string;
}

export function decideRowClass(ctx: RowClassContext): RowClassDecision {
  const t = ctx.table;

  if ((USER_KEYED_TABLES as readonly string[]).includes(t)) {
    return ctx.userRef === ctx.callerRef
      ? { class: "owner", reason: "caller's own row" }
      : { class: "excluded", reason: "another user's row — caller-only export" };
  }

  if (t === "meetingParticipants") {
    return ctx.userRef === ctx.callerRef
      ? { class: "owner", reason: "caller's own participation record" }
      : {
          class: "excluded",
          reason: "other members' presence rows — permissionsForResource('meetingParticipants') never grants export (refusal, not a guess)",
        };
  }

  if (t === "meetings") {
    if (ctx.organizerRef === ctx.callerRef) {
      return { class: "owner", reason: "caller organizes this meeting" };
    }
    if (ctx.callerRoleInMeeting) {
      return { class: "shared", reason: "caller participates (assertMeetingAccess read scope)" };
    }
    return { class: "excluded", reason: "no_meeting_participation" };
  }

  if (t in MEETING_SCOPED_EXPORTABLE) {
    if (!ctx.callerRoleInMeeting) {
      return { class: "excluded", reason: "no_meeting_participation" };
    }
    const grant = MEETING_SCOPED_EXPORTABLE[t];
    return ctx.callerRoleInMeeting === grant.grantRole
      ? { class: "shared", reason: `export grant: permissionsForResource('${grant.resource}','host') includes 'export'` }
      : {
          class: "excluded",
          reason: `refused_missing_export_permission (role=${ctx.callerRoleInMeeting}, resource=${grant.resource})`,
        };
  }

  if (t === "connections") {
    return ctx.requesterRef === ctx.callerRef || ctx.addresseeRef === ctx.callerRef
      ? { class: "shared", reason: "caller is a party to the connection" }
      : { class: "excluded", reason: "another pair's connection" };
  }

  if ((MEETING_SCOPED_NO_GRANT as readonly string[]).includes(t)) {
    return {
      class: "excluded",
      reason: "no_export_authority_defined — permissionsForResource has no resource entry; refusal, not a guessed permission",
    };
  }

  return { class: "excluded", reason: "outside the export contract (system/infrastructure/global data)" };
}

// ---------------------------------------------------------------------------
// Row projection
// ---------------------------------------------------------------------------

/**
 * Projects a row for export: strips sensitive fields. Returns a shallow copy
 * (_id preserved for the ref receipts; _creationTime is a Convex system field
 * outside every policy field list and is dropped).
 */
export function projectRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const policy = TABLE_POLICIES.find((p) => p.table === table);
  if (!policy) {
    throw new Error(`no projection policy for table "${table}" — refusing to export unknown table`);
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (policy.sensitiveFields.includes(key)) continue;
    if (key === "_creationTime") continue;
    out[key] = row[key];
  }
  return out;
}

/** Field-list cross-check: every known schema field must be covered by the policy. */
export function assertPolicyCoversRow(table: string, rowKeys: string[]): void {
  const policy = TABLE_POLICIES.find((p) => p.table === table);
  if (!policy) {
    throw new Error(`no projection policy for table "${table}"`);
  }
  const covered = new Set([...policy.fields, "_id", "_creationTime"]);
  for (const key of rowKeys) {
    if (!covered.has(key)) {
      throw new Error(`policy drift: field "${key}" of table "${table}" is not covered by the projection policy`);
    }
  }
}
