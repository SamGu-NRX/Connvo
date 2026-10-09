/**
 * Transcription Ingestion Pipeline Tests
 *
 * This module provides comprehensive tests for the transcript ingestion
 * system including rate limiting, sharding, and performance validation.
 *
 * Requirements: 18.1, 18.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex test patterns
 */

import { expect, test, describe, beforeEach } from "vitest";
import { api, internal } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { createTestEnvironment } from "../../test/convex/helpers";
import { joinTranscriptText } from "@convex/lib/transcriptText";

describe("Transcript Ingestion Pipeline", () => {
  let t: ReturnType<typeof createTestEnvironment>;
  let testMeetingId: Id<"meetings">;
  let testUserId: Id<"users">;
  let authedT: any;

  beforeEach(async () => {
    t = createTestEnvironment();

    // Create test user
    testUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        workosUserId: "test_user_123",
        email: "test@example.com",
        orgId: "test_org",
        orgRole: "member",
        displayName: "Test User",
        avatarUrl: undefined,
        isActive: true,
        lastSeenAt: Date.now(),
        onboardingComplete: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    authedT = t.withIdentity({
      subject: "test_user_123",
      email: "test@example.com",
      name: "Test User",
      org_id: "test_org",
      org_role: "member",
    });

    // Create test meeting
    testMeetingId = await t.run(async (ctx) => {
      const meetingId = await ctx.db.insert("meetings", {
        organizerId: testUserId,
        title: "Test Meeting",
        description: "Test meeting for transcript ingestion",
        scheduledAt: Date.now(),
        duration: 3600000, // 1 hour
        webrtcEnabled: true,
        state: "active",
        participantCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Add user as participant
      await ctx.db.insert("meetingParticipants", {
        meetingId,
        userId: testUserId,
        role: "host",
        joinedAt: Date.now(),
        presence: "joined",
        createdAt: Date.now(),
      });

      // Create meeting state
      await ctx.db.insert("meetingState", {
        meetingId,
        active: true,
        startedAt: Date.now(),
        speakingStats: undefined,
        lullState: undefined,
        topics: [],
        recordingEnabled: false,
        updatedAt: Date.now(),
      });

      return meetingId;
    });
  });

  /**
   * Adds a second user as a non-host participant of the test meeting and
   * returns an identity-scoped test client for them. Also creates a third
   * "stranger" user with no participant row for attribution rejection tests.
   */
  async function addSecondParticipant() {
    const participantUserId: Id<"users"> = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        workosUserId: "participant_user_1",
        email: "participant@example.com",
        orgId: "test_org",
        orgRole: "member",
        displayName: "Participant One",
        avatarUrl: undefined,
        isActive: true,
        lastSeenAt: Date.now(),
        onboardingComplete: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("meetingParticipants", {
        meetingId: testMeetingId,
        userId: participantUserId,
        role: "participant",
        joinedAt: Date.now(),
        presence: "joined",
        createdAt: Date.now(),
      });
    });

    const participantT = t.withIdentity({
      subject: "participant_user_1",
      email: "participant@example.com",
      name: "Participant One",
      org_id: "test_org",
      org_role: "member",
    });

    // A user who exists but holds no meetingParticipants row for this meeting
    const strangerUserId: Id<"users"> = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        workosUserId: "stranger_user_1",
        email: "stranger@example.com",
        orgId: "test_org",
        orgRole: "member",
        displayName: "Stranger",
        avatarUrl: undefined,
        isActive: true,
        lastSeenAt: Date.now(),
        onboardingComplete: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    return { participantT, participantUserId, strangerUserId };
  }

  test("should ingest single transcript chunk successfully", async () => {
    const result = await authedT.mutation(
      api.transcripts.ingestion.ingestTranscriptChunk,
      {
        meetingId: testMeetingId,
        text: "Hello, this is a test transcript chunk.",
        confidence: 0.95,
        startTime: Date.now(),
        endTime: Date.now() + 5000,
        language: "en",
      },
    );

    expect(result.success).toBe(true);
    expect(result.sequence).toBe(1);
    expect(result.bucketMs).toBeGreaterThan(0);
    expect(result.rateLimitRemaining).toBeGreaterThan(0);
  });

  test("should validate transcript chunk input", async () => {
    // Test empty text
    await expect(
      authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: testMeetingId,
        text: "",
        confidence: 0.95,
        startTime: Date.now(),
        endTime: Date.now() + 5000,
      }),
    ).rejects.toThrow("Transcript text cannot be empty");

    // Test invalid confidence
    await expect(
      authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: testMeetingId,
        text: "Valid text",
        confidence: 1.5,
        startTime: Date.now(),
        endTime: Date.now() + 5000,
      }),
    ).rejects.toThrow("Confidence must be between 0 and 1");

    // Test invalid time range
    const now = Date.now();
    await expect(
      authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: testMeetingId,
        text: "Valid text",
        confidence: 0.95,
        startTime: now + 5000,
        endTime: now,
      }),
    ).rejects.toThrow("Start time must be before end time");
  });

  test("should handle time-bucketed sharding correctly", async () => {
    // Pin baseTime to an exact 5-minute bucket boundary so bucket assertions
    // hold regardless of the wall clock at run time (R5 flake baseline: a
    // Date.now()-derived baseTime plus 60s could cross the bucket boundary
    // whenever the run started within the last 60s of a bucket).
    const baseTime = 1_800_000_000_000; // exactly on a 300000ms boundary
    const chunks = [
      {
        text: "First chunk",
        startTime: baseTime,
        endTime: baseTime + 2000,
      },
      {
        text: "Second chunk in same bucket",
        startTime: baseTime + 60000, // 1 minute later, same bucket
        endTime: baseTime + 62000,
      },
      {
        text: "Third chunk in different bucket",
        startTime: baseTime + 360000, // 6 minutes later, different bucket
        endTime: baseTime + 362000,
      },
    ];

    const results = [];
    for (const chunk of chunks) {
      const result = await authedT.mutation(
        api.transcripts.ingestion.ingestTranscriptChunk,
        {
          meetingId: testMeetingId,
          text: chunk.text,
          confidence: 0.95,
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          language: "en",
        },
      );
      results.push(result);
    }

    // Verify sequences are incremental
    expect(results[0].sequence).toBe(1);
    expect(results[1].sequence).toBe(2);
    expect(results[2].sequence).toBe(3);

    // Verify different buckets for chunks 1-2 vs chunk 3
    const bucket1 = Math.floor(baseTime / 300000) * 300000;
    const bucket3 = Math.floor((baseTime + 360000) / 300000) * 300000;

    expect(results[0].bucketMs).toBe(bucket1);
    expect(results[1].bucketMs).toBe(bucket1);
    expect(results[2].bucketMs).toBe(bucket3);
    expect(bucket3).toBeGreaterThan(bucket1);
  });

  test("should enforce rate limits", async () => {
    // Attempt to exceed rate limit (50 chunks per minute)
    const promises = [];
    for (let i = 0; i < 52; i++) {
      promises.push(
        authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
          meetingId: testMeetingId,
          text: `Chunk ${i}`,
          confidence: 0.95,
          startTime: Date.now() + i * 100,
          endTime: Date.now() + i * 100 + 1000,
          language: "en",
        }),
      );
    }

    // First 50 should succeed, remaining should fail
    const results = await Promise.allSettled(promises);
    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    expect(successful).toBeLessThanOrEqual(50);
    expect(failed).toBeGreaterThan(0);
  });

  test("should batch ingest transcript chunks efficiently", async () => {
    const chunks = Array.from({ length: 25 }, (_, i) => ({
      speakerId: `speaker_${i % 3}`,
      text: `Batch chunk ${i} with some content to test processing`,
      confidence: 0.9 + (i % 10) * 0.01,
      startTime: Date.now() + i * 2000,
      endTime: Date.now() + i * 2000 + 1500,
      language: "en",
    }));

    const result = await authedT.mutation(
      internal.transcripts.ingestion.batchIngestTranscriptChunks,
      {
        meetingId: testMeetingId,
        chunks,
        batchId: "test_batch_001",
      },
    );

    expect(result.success).toBe(true);
    expect(result.processed).toBe(25);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.batchId).toBe("test_batch_001");
    expect(result.performance.processingTimeMs).toBeGreaterThan(0);
    expect(result.performance.chunksPerSecond).toBeGreaterThan(0);
  });

  test("should calculate transcript statistics correctly", async () => {
    const { participantUserId } = await addSecondParticipant();

    // Host ingests: one attributed to self by default, one attributed to the
    // other participant (host may attribute across speakers), one to self.
    await authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
      meetingId: testMeetingId,
      text: "Hello world",
      confidence: 0.95,
      startTime: Date.now(),
      endTime: Date.now() + 2000,
      language: "en",
    });
    await authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
      meetingId: testMeetingId,
      speakerId: participantUserId,
      text: "How are you doing today?",
      confidence: 0.88,
      startTime: Date.now() + 3000,
      endTime: Date.now() + 6000,
      language: "en",
    });
    await authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
      meetingId: testMeetingId,
      text: "I am doing great, thanks for asking!",
      confidence: 0.92,
      startTime: Date.now() + 7000,
      endTime: Date.now() + 11000,
      language: "en",
    });

    const stats = await authedT.query(
      api.transcripts.ingestion.getTranscriptStats,
      {
        meetingId: testMeetingId,
      },
    );

    expect(stats.totalChunks).toBe(3);
    expect(stats.totalWords).toBeGreaterThan(0);
    expect(stats.averageConfidence).toBeCloseTo(0.917, 2);
    expect(stats.speakers).toContain(testUserId);
    expect(stats.speakers).toContain(participantUserId);
    expect(stats.languages).toContain("en");
    expect(stats.duration).toBeGreaterThan(0);
  });

  test("should cleanup old transcripts", async () => {
    // Insert old transcript
    await t.run(async (ctx) => {
      const oldTime = Date.now() - 100 * 24 * 60 * 60 * 1000; // 100 days ago
      await ctx.db.insert("transcripts", {
        meetingId: testMeetingId,
        bucketMs: Math.floor(oldTime / 300000) * 300000,
        sequence: 1,
        speakerId: "old_speaker",
        text: "This is an old transcript",
        confidence: 0.9,
        startMs: oldTime,
        endMs: oldTime + 5000,
        wordCount: 5,
        language: "en",
        createdAt: oldTime,
      });
    });

    // Insert recent transcript
    await authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
      meetingId: testMeetingId,
      text: "This is a recent transcript",
      confidence: 0.95,
      startTime: Date.now(),
      endTime: Date.now() + 5000,
      language: "en",
    });

    // Cleanup old transcripts (older than 90 days)
    const result = await authedT.mutation(
      internal.transcripts.ingestion.cleanupOldTranscripts,
      {
        olderThanMs: 90 * 24 * 60 * 60 * 1000,
        meetingId: testMeetingId,
      },
    );

    expect(result.deleted).toBe(1);

    // Verify recent transcript still exists
    const stats = await authedT.query(
      api.transcripts.ingestion.getTranscriptStats,
      {
        meetingId: testMeetingId,
      },
    );
    expect(stats.totalChunks).toBe(1);
  });

  test("should handle concurrent ingestion without conflicts", async () => {
    const concurrentChunks = Array.from({ length: 10 }, (_, i) => ({
      text: `Concurrent chunk ${i}`,
      confidence: 0.9,
      startTime: Date.now() + i * 1000,
      endTime: Date.now() + i * 1000 + 800,
      language: "en",
    }));

    // Execute all ingestions concurrently
    const promises = concurrentChunks.map((chunk) =>
      authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: testMeetingId,
        ...chunk,
      }),
    );

    const results: Array<{
      success: boolean;
      sequence: number;
      bucketMs: number;
      rateLimitRemaining: number;
    }> = await Promise.all(promises);

    // Verify all succeeded
    expect(results.every((r: { success: boolean }) => r.success)).toBe(true);

    // Verify sequences are unique and ordered
    const sequences = results
      .map((r) => r.sequence)
      .sort((a: number, b: number) => a - b);
    const expectedSequences = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(sequences).toEqual(expectedSequences);
  });

  test("should reject ingestion for inactive meetings", async () => {
    // Create inactive meeting
    const inactiveMeetingId = await t.run(async (ctx) => {
      const meetingId = await ctx.db.insert("meetings", {
        organizerId: testUserId,
        title: "Inactive Meeting",
        state: "concluded",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.insert("meetingParticipants", {
        meetingId,
        userId: testUserId,
        role: "host",
        presence: "left",
        createdAt: Date.now(),
      });

      return meetingId;
    });

    await expect(
      authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: inactiveMeetingId,
        text: "This should fail",
        confidence: 0.95,
        startTime: Date.now(),
        endTime: Date.now() + 5000,
      }),
    ).rejects.toThrow("Meeting is not currently active");
  });

  test("defaults speakerId to the calling participant", async () => {
    const { participantT, participantUserId } = await addSecondParticipant();

    // No speakerId supplied: the chunk must be attributed to the caller
    await participantT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
      meetingId: testMeetingId,
      text: "From the participant",
      confidence: 0.9,
      startTime: Date.now(),
      endTime: Date.now() + 1000,
    });

    // Explicit self-attribution is always allowed
    await participantT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
      meetingId: testMeetingId,
      speakerId: participantUserId,
      text: "From the participant again",
      confidence: 0.9,
      startTime: Date.now() + 2000,
      endTime: Date.now() + 3000,
    });

    const chunks = await participantT.query(
      api.transcripts.ingestion.getTranscriptChunks,
      { meetingId: testMeetingId },
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0].speakerId).toBe(participantUserId);
    expect(chunks[1].speakerId).toBe(participantUserId);
  });

  test("host may attribute transcript text to another participant", async () => {
    const { participantUserId } = await addSecondParticipant();

    await authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
      meetingId: testMeetingId,
      speakerId: participantUserId,
      text: "Attributed by the host to the participant",
      confidence: 0.9,
      startTime: Date.now(),
      endTime: Date.now() + 1000,
    });

    const chunks = await authedT.query(
      api.transcripts.ingestion.getTranscriptChunks,
      { meetingId: testMeetingId },
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].speakerId).toBe(participantUserId);
  });

  test("non-host cannot attribute transcript text to another speaker", async () => {
    const { participantT } = await addSecondParticipant();

    // The caller is a plain participant; the host holds a participant row,
    // so this fails on the host-only rule, not on participant existence.
    await expect(
      participantT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: testMeetingId,
        speakerId: testUserId,
        text: "Spoofed attribution",
        confidence: 0.9,
        startTime: Date.now(),
        endTime: Date.now() + 1000,
      }),
    ).rejects.toThrow(
      "Only the meeting host may attribute transcript text to a different speaker",
    );
  });

  test("cannot attribute transcript text to a userId with no participant row", async () => {
    const { strangerUserId } = await addSecondParticipant();

    // Host may attribute across speakers, but only to real participants
    await expect(
      authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: testMeetingId,
        speakerId: strangerUserId,
        text: "Attributed to a non-participant",
        confidence: 0.9,
        startTime: Date.now(),
        endTime: Date.now() + 1000,
      }),
    ).rejects.toThrow("not a participant of this meeting");

    // Arbitrary non-id strings are rejected by the same rule
    await expect(
      authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: testMeetingId,
        speakerId: "ghost_speaker",
        text: "Attributed to a fabricated speaker",
        confidence: 0.9,
        startTime: Date.now() + 2000,
        endTime: Date.now() + 3000,
      }),
    ).rejects.toThrow("not a participant of this meeting");
  });

  test("transcript reads are registered as queries, not mutations", async () => {
    // Convex-test routes by registration type: t.query on a mutation would
    // fail, so these calls double as registration checks.
    const chunks = await authedT.query(
      api.transcripts.ingestion.getTranscriptChunks,
      { meetingId: testMeetingId },
    );
    expect(chunks).toEqual([]);

    const stats = await authedT.query(
      api.transcripts.ingestion.getTranscriptStats,
      { meetingId: testMeetingId },
    );
    expect(stats.totalChunks).toBe(0);
  });

  test("getTranscriptChunks excludes interim chunks by default and filters on request", async () => {
    // Bucket-align the base time so all chunks land in one deterministic
    // bucket while staying recent enough for the optimizer's time window.
    const aligned = Math.floor(Date.now() / 300000) * 300000;
    const base = aligned + 30000;

    await authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
      meetingId: testMeetingId,
      text: "Final one",
      confidence: 0.9,
      startTime: base,
      endTime: base + 1000,
    });
    await authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
      meetingId: testMeetingId,
      text: "Interim guess",
      confidence: 0.6,
      startTime: base + 2000,
      endTime: base + 3000,
      isInterim: true,
    });
    await authedT.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
      meetingId: testMeetingId,
      text: "Final two",
      confidence: 0.9,
      startTime: base + 4000,
      endTime: base + 5000,
    });

    // Default: settled view (interims excluded)
    const settled = await authedT.query(
      api.transcripts.ingestion.getTranscriptChunks,
      { meetingId: testMeetingId },
    );
    expect(settled.map((c) => c.text)).toEqual(["Final one", "Final two"]);

    // Explicit request: only interims
    const interims = await authedT.query(
      api.transcripts.ingestion.getTranscriptChunks,
      { meetingId: testMeetingId, isInterim: true },
    );
    expect(interims.map((c) => c.text)).toEqual(["Interim guess"]);

    // Explicit request: only finals
    const finals = await authedT.query(
      api.transcripts.ingestion.getTranscriptChunks,
      { meetingId: testMeetingId, isInterim: false },
    );
    expect(finals.map((c) => c.text)).toEqual(["Final one", "Final two"]);

    // The bucketed index path applies the same filter
    const bucketMs = Math.floor(base / 300000) * 300000;
    const viaBucket = await authedT.query(
      api.transcripts.ingestion.getTranscriptChunks,
      { meetingId: testMeetingId, bucketMs, isInterim: true },
    );
    expect(viaBucket.map((c) => c.text)).toEqual(["Interim guess"]);
    const viaBucketSettled = await authedT.query(
      api.transcripts.ingestion.getTranscriptChunks,
      { meetingId: testMeetingId, bucketMs },
    );
    expect(viaBucketSettled.map((c) => c.text)).toEqual([
      "Final one",
      "Final two",
    ]);
  });

  test("coalescing merges same-speaker chunks without double spaces", async () => {
    const now = Date.now();
    const result = await t.mutation(
      internal.transcripts.ingestion.coalescedIngestTranscriptChunks,
      {
        meetingId: testMeetingId,
        chunks: [
          {
            speakerId: "spk_a",
            text: "Hello ",
            confidence: 0.9,
            startTime: now,
            endTime: now + 100,
            language: "en",
          },
          {
            speakerId: "spk_a",
            text: " world",
            confidence: 0.9,
            startTime: now + 200,
            endTime: now + 300,
            language: "en",
          },
          {
            speakerId: "spk_a",
            text: " how are you?",
            confidence: 0.9,
            startTime: now + 400,
            endTime: now + 500,
            language: "en",
          },
        ],
      },
    );

    expect(result.success).toBe(true);
    expect(result.processed).toBe(1);
    expect(result.performance.coalescedChunks).toBe(1);

    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("transcripts")
        .withIndex("by_meeting_time_range", (q) =>
          q.eq("meetingId", testMeetingId),
        )
        .collect();
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe("Hello world how are you?");
    expect(stored[0].text).not.toContain("  ");
  });

  test("aggregation merges same-speaker chunks without double spaces", async () => {
    const base = 1_800_000_000_000;
    // Seed raw chunks directly (bypassing ingestion's trim) with boundary
    // whitespace on both sides of the merge point.
    await t.run(async (ctx) => {
      await ctx.db.insert("transcripts", {
        meetingId: testMeetingId,
        bucketMs: base,
        sequence: 1,
        speakerId: "spk_a",
        text: "The quick brown fox ",
        confidence: 0.95,
        startMs: base,
        endMs: base + 1000,
        isInterim: false,
        wordCount: 4,
        language: "en",
        createdAt: base,
      });
      await ctx.db.insert("transcripts", {
        meetingId: testMeetingId,
        bucketMs: base,
        sequence: 2,
        speakerId: "spk_a",
        text: " jumps over the lazy dog.",
        confidence: 0.95,
        startMs: base + 1500,
        endMs: base + 2500,
        isInterim: false,
        wordCount: 5,
        language: "en",
        createdAt: base + 1,
      });
    });

    const result = await t.action(
      internal.transcripts.aggregation.aggregateTranscriptSegments,
      { meetingId: testMeetingId },
    );
    expect(result.success).toBe(true);
    expect(result.segmentsCreated).toBe(1);

    const segments = await t.run(async (ctx) => {
      return await ctx.db
        .query("transcriptSegments")
        .withIndex("by_meeting", (q) => q.eq("meetingId", testMeetingId))
        .collect();
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe(
      "The quick brown fox jumps over the lazy dog.",
    );
    expect(segments[0].text).not.toContain("  ");
  });

  test("batch summary reports per-chunk validation failures", async () => {
    const result = await t.mutation(
      internal.transcripts.ingestion.batchIngestTranscriptChunks,
      {
        meetingId: testMeetingId,
        chunks: [
          {
            text: "Valid chunk",
            confidence: 0.9,
            startTime: 1_800_000_000_000,
            endTime: 1_800_000_000_000 + 1000,
          },
          {
            text: "   ",
            confidence: 0.9,
            startTime: 1_800_000_000_000 + 2000,
            endTime: 1_800_000_000_000 + 3000,
          },
          {
            text: "Bad confidence",
            confidence: 1.5,
            startTime: 1_800_000_000_000 + 4000,
            endTime: 1_800_000_000_000 + 5000,
          },
          {
            text: "Bad times",
            confidence: 0.9,
            startTime: 1_800_000_000_000 + 6000,
            endTime: 1_800_000_000_000 + 6000,
          },
          {
            text: `Too long: ${"x".repeat(10001)}`,
            confidence: 0.9,
            startTime: 1_800_000_000_000 + 7000,
            endTime: 1_800_000_000_000 + 8000,
          },
        ],
      },
    );

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(4);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(4);
    expect(result.errors[0]).toContain("chunk 1");
    expect(result.errors[0]).toContain("text is empty");
    expect(result.errors[1]).toContain("chunk 2");
    expect(result.errors[1]).toContain("confidence must be between 0 and 1");
    expect(result.errors[2]).toContain("chunk 3");
    expect(result.errors[2]).toContain("start time must be before end time");
    expect(result.errors[3]).toContain("chunk 4");
    expect(result.errors[3]).toContain("text too long");

    // The valid chunk is stored and the invalid ones are dropped, not thrown
    const stored = await t.run(async (ctx) => {
      return await ctx.db
        .query("transcripts")
        .withIndex("by_meeting_time_range", (q) =>
          q.eq("meetingId", testMeetingId),
        )
        .collect();
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe("Valid chunk");
  });

  test("joinTranscriptText normalizes boundary whitespace", () => {
    expect(joinTranscriptText("Hello", "world")).toBe("Hello world");
    expect(joinTranscriptText("Hello ", "world")).toBe("Hello world");
    expect(joinTranscriptText("Hello", " world")).toBe("Hello world");
    expect(joinTranscriptText("Hello ", " world")).toBe("Hello world");
    expect(joinTranscriptText("", "world")).toBe("world");
    expect(joinTranscriptText("Hello", "")).toBe("Hello");
  });
});
