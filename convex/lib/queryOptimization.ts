/**
 * Query Optimization and Cursor-Based Pagination for Real-Time Subscriptions
 *
 * This module provides optimized query patterns, cursor-based pagination,
 * and resumable subscriptions for high-performance real-time applications.
 *
 * Requirements: 5.1, 5.2, 5.5
 * Compliance: steering/convex_rules.mdc - Uses proper Convex patterns
 */

import { v } from "convex/values";
import { Id } from "@convex/_generated/dataModel";
import { QueryCtx, MutationCtx } from "@convex/_generated/server";

type DbCtx = QueryCtx | MutationCtx;

// Minimal document shapes used by this module
type TranscriptDoc = {
  _id: Id<"transcripts">;
  meetingId: Id<"meetings">;
  sequence: number;
  bucketMs: number;
  speakerId?: string;
  text: string;
  confidence: number;
  startMs: number;
  endMs: number;
  // Align with schema: transcripts.wordCount is required
  wordCount: number;
  // Optional language field per schema
  language?: string;
  // Optional interim flag
  isInterim?: boolean;
  createdAt: number;
};

type NoteOp = {
  _id?: Id<"noteOps">;
  meetingId: Id<"meetings">;
  sequence: number;
};

type MeetingNotesDoc = {
  content?: string;
  version?: number;
  updatedAt?: number;
};

/**
 * Cursor-based pagination configuration
 */
export interface PaginationCursor {
  sequence?: number;
  timestamp?: number;
  id?: string;
  bucketMs?: number;
}

/**
 * Query optimization configuration
 */
export interface QueryOptimization {
  useEarlyTermination: boolean;
  maxBuckets: number;
  batchSize: number;
  timeWindowMs: number;
  enableCaching: boolean;
}

/**
 * Resumable subscription state
 */
export interface SubscriptionState {
  subscriptionId: string;
  lastCursor: PaginationCursor;
  lastUpdate: number;
  resourceType: string;
  resourceId: string;
  userId: Id<"users">;
}

/**
 * Optimized transcript query with time-bucketed sharding
 */
export class TranscriptQueryOptimizer {
  private static readonly BUCKET_SIZE_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly MAX_BUCKETS_PER_QUERY = 12; // 1 hour max

  static async queryTranscripts(
    ctx: DbCtx,
    meetingId: Id<"meetings">,
    fromSequence = 0,
    limit = 50,
    timeWindowMs = 30 * 60 * 1000, // 30 minutes default
  ): Promise<{
    transcripts: TranscriptDoc[];
    nextCursor: PaginationCursor;
    performance: {
      bucketsQueried: number;
      totalResults: number;
      queryTimeMs: number;
      earlyTermination: boolean;
    };
  }> {
    const startTime = Date.now();
    const now = Date.now();

    // Calculate optimal bucket range
    const maxBuckets = Math.min(
      Math.ceil(timeWindowMs / this.BUCKET_SIZE_MS),
      this.MAX_BUCKETS_PER_QUERY,
    );

    const buckets = this.generateOptimalBuckets(now, maxBuckets);
    const allTranscripts: TranscriptDoc[] = [];
    let bucketsQueried = 0;
    let earlyTermination = false;

    // Query buckets with intelligent early termination
    for (const bucketMs of buckets) {
      bucketsQueried++;

      const bucketTranscripts: TranscriptDoc[] = await ctx.db
        .query("transcripts")
        .withIndex("by_meeting_bucket_seq", (q) =>
          q
            .eq("meetingId", meetingId)
            .eq("bucketMs", bucketMs)
            .gt("sequence", fromSequence),
        )
        .take(limit - allTranscripts.length);

      allTranscripts.push(...bucketTranscripts);

      // Early termination conditions
      if (allTranscripts.length >= limit) {
        earlyTermination = true;
        break;
      }

      // If no results in the first 2 recent buckets, likely no more data
      if (bucketsQueried <= 2 && bucketTranscripts.length === 0) {
        earlyTermination = true;
        break;
      }

      // Performance safeguard - don't query too many empty buckets
      if (bucketsQueried > 3 && bucketTranscripts.length === 0) {
        earlyTermination = true;
        break;
      }
    }

    // Sort and apply final limit
    const sortedTranscripts = allTranscripts
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit);

    const nextCursor: PaginationCursor = {
      sequence:
        sortedTranscripts.length > 0
          ? Math.max(...sortedTranscripts.map((t) => t.sequence))
          : fromSequence,
      timestamp: Date.now(),
      bucketMs: buckets[0], // Most recent bucket
    };

    return {
      transcripts: sortedTranscripts,
      nextCursor,
      performance: {
        bucketsQueried,
        totalResults: sortedTranscripts.length,
        queryTimeMs: Date.now() - startTime,
        earlyTermination,
      },
    };
  }

  private static generateOptimalBuckets(
    now: number,
    maxBuckets: number,
  ): number[] {
    const buckets = [];

    // Generate buckets in reverse chronological order (most recent first)
    for (let i = 0; i < maxBuckets; i++) {
      const bucketTime = now - i * this.BUCKET_SIZE_MS;
      buckets.push(
        Math.floor(bucketTime / this.BUCKET_SIZE_MS) * this.BUCKET_SIZE_MS,
      );
    }

    return buckets;
  }

  static parseCursor(cursorString?: string): PaginationCursor {
    if (!cursorString) {
      return { sequence: 0, timestamp: 0 };
    }

    try {
      return JSON.parse(Buffer.from(cursorString, "base64").toString());
    } catch {
      return { sequence: 0, timestamp: 0 };
    }
  }

  static encodeCursor(cursor: PaginationCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString("base64");
  }
}

/**
 * Optimized notes query with operational transform support
 */
export class NotesQueryOptimizer {
  static async queryNoteOps(
    ctx: DbCtx,
    meetingId: Id<"meetings">,
    fromSequence = 0,
    limit = 100,
  ): Promise<{
    operations: NoteOp[];
    nextCursor: PaginationCursor;
    hasMore: boolean;
  }> {
    const operations = await ctx.db
      .query("noteOps")
      .withIndex("by_meeting_sequence", (q) =>
        q.eq("meetingId", meetingId).gt("sequence", fromSequence),
      )
      .order("asc")
      .take(limit + 1); // Take one extra to check if there are more

    const hasMore = operations.length > limit;
    const resultOps = hasMore ? operations.slice(0, limit) : operations;

    const nextCursor: PaginationCursor = {
      sequence:
        resultOps.length > 0
          ? resultOps[resultOps.length - 1].sequence
          : fromSequence,
      timestamp: Date.now(),
    };

    return {
      operations: resultOps,
      nextCursor,
      hasMore,
    };
  }

  static async getMaterializedNotes(
    ctx: DbCtx,
    meetingId: Id<"meetings">,
  ): Promise<{
    content: string;
    version: number;
    lastUpdated: number;
  }> {
    const notes = (await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .unique()) as MeetingNotesDoc | null;

    return {
      content: notes?.content || "",
      version: notes?.version || 0,
      lastUpdated: notes?.updatedAt || Date.now(),
    };
  }
}

/**
 * Subscription state manager for resumable connections
 */
export class SubscriptionStateManager {
  private static states = new Map<string, SubscriptionState>();

  static saveState(state: SubscriptionState): void {
    this.states.set(state.subscriptionId, {
      ...state,
      lastUpdate: Date.now(),
    });
  }

  static getState(subscriptionId: string): SubscriptionState | null {
    return this.states.get(subscriptionId) || null;
  }

  static updateCursor(subscriptionId: string, cursor: PaginationCursor): void {
    const state = this.states.get(subscriptionId);
    if (state) {
      state.lastCursor = cursor;
      state.lastUpdate = Date.now();
    }
  }

  static removeState(subscriptionId: string): void {
    this.states.delete(subscriptionId);
  }

  static cleanup(): void {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes

    for (const [id, state] of this.states.entries()) {
      if (now - state.lastUpdate > staleThreshold) {
        this.states.delete(id);
      }
    }
  }

  static getActiveSubscriptions(): SubscriptionState[] {
    return Array.from(this.states.values());
  }
}

/**
 * Query cache for frequently accessed data
 */
export class QueryCache {
  private static cache = new Map<
    string,
    {
      data: unknown;
      timestamp: number;
      ttl: number;
    }
  >();

  static set<T>(key: string, data: T, ttlMs = 30000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    });
  }

  static get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  static invalidate(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  static clear(): void {
    this.cache.clear();
  }

  static cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  static getStats(): { size: number; hitRate: number } {
    // URGENT TODO: This would need to be implemented with hit/miss tracking
    return {
      size: this.cache.size,
      hitRate: 0, // Placeholder
    };
  }
}

/**
 * Bounded result set utility to prevent unbounded queries
 */
export class BoundedQueryExecutor {
  private static readonly DEFAULT_MAX_RESULTS = 1000;
  private static readonly DEFAULT_TIMEOUT_MS = 5000;

  static async executeBounded<T>(
    queryFn: () => Promise<T[]>,
    maxResults = this.DEFAULT_MAX_RESULTS,
    timeoutMs = this.DEFAULT_TIMEOUT_MS,
  ): Promise<{
    results: T[];
    truncated: boolean;
    executionTimeMs: number;
  }> {
    const startTime = Date.now();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Query timeout")), timeoutMs);
    });

    try {
      const results = (await Promise.race<Promise<T[]> | never>([
        queryFn(),
        timeoutPromise,
      ])) as T[];
      const truncated = results.length > maxResults;

      return {
        results: truncated ? results.slice(0, maxResults) : results,
        truncated,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      throw new Error(
        `Bounded query failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Index usage optimizer
 */
export class IndexOptimizer {
  static validateIndexUsage(
    tableName: string,
    indexName: string,
    queryFields: string[],
  ): {
    optimal: boolean;
    suggestions: string[];
  } {
    const suggestions: string[] = [];

    // Basic validation - this would be enhanced with actual index metadata
    if (!indexName.includes("by_")) {
      suggestions.push('Use descriptive index names with "by_" prefix');
    }

    // Check if query fields match index order
    const indexFields = indexName.replace("by_", "").split("_and_");
    const missingFields = queryFields.filter(
      (field) => !indexFields.includes(field),
    );

    if (missingFields.length > 0) {
      suggestions.push(
        `Consider adding index for fields: ${missingFields.join(", ")}`,
      );
    }

    return {
      optimal: suggestions.length === 0,
      suggestions,
    };
  }

  static suggestOptimalIndex(
    tableName: string,
    queryPattern: {
      equalityFields: string[];
      rangeFields: string[];
      orderBy?: string;
    },
  ): string {
    const { equalityFields, rangeFields, orderBy } = queryPattern;

    // Optimal index order: equality fields first, then range fields, then order by
    const indexFields = [
      ...equalityFields,
      ...rangeFields,
      ...(orderBy &&
      !equalityFields.includes(orderBy) &&
      !rangeFields.includes(orderBy)
        ? [orderBy]
        : []),
    ];

    return `by_${indexFields.join("_and_")}`;
  }
}

/**
 * Cleanup function for all optimizers
 */
export function queryOptimizationCleanup(): void {
  SubscriptionStateManager.cleanup();
  QueryCache.cleanup();
}

// Auto-cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(queryOptimizationCleanup, 5 * 60 * 1000);
}