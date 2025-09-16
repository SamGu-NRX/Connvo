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
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

describe("Transcript Ingestion Pipeline", () => {
  let t: ReturnType<typeof convexTest>;
  let testMeetingId: Id<"meetings">;
  let testUserId: Id<"users">;

  beforeEach(async () => {
    t = convexTest();

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

  test("should ingest single transcript chunk successfully", async () => {
    const result = await t.mutation(
      api.transcripts.ingestion.ingestTranscriptChunk,
      {
        meetingId: testMeetingId,
        speakerId: "speaker_1",
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
      t.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: testMeetingId,
        speakerId: "speaker_1",
        text: "",
        confidence: 0.95,
        startTime: Date.now(),
        endTime: Date.now() + 5000,
      }),
    ).rejects.toThrow("Transcript text cannot be empty");

    // Test invalid confidence
    await expect(
      t.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: testMeetingId,
        speakerId: "speaker_1",
        text: "Valid text",
        confidence: 1.5,
        startTime: Date.now(),
        endTime: Date.now() + 5000,
      }),
    ).rejects.toThrow("Confidence must be between 0 and 1");

    // Test invalid time range
    const now = Date.now();
    await expect(
      t.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: testMeetingId,
        speakerId: "speaker_1",
        text: "Valid text",
        confidence: 0.95,
        startTime: now + 5000,
        endTime: now,
      }),
    ).rejects.toThrow("Start time must be before end time");
  });

  test("should handle time-bucketed sharding correctly", async () => {
    const baseTime = Date.now();
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
      const result = await t.mutation(
        api.transcripts.ingestion.ingestTranscriptChunk,
        {
          meetingId: testMeetingId,
          speakerId: "speaker_1",
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
        t.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
          meetingId: testMeetingId,
          speakerId: "speaker_1",
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

    const result = await t.mutation(
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
    expect(result.batchId).toBe("test_batch_001");
    expect(result.performance.processingTimeMs).toBeGreaterThan(0);
    expect(result.performance.chunksPerSecond).toBeGreaterThan(0);
  });

  test("should calculate transcript statistics correctly", async () => {
    // Insert test transcript chunks
    const chunks = [
      {
        speakerId: "speaker_1",
        text: "Hello world",
        confidence: 0.95,
        startTime: Date.now(),
        endTime: Date.now() + 2000,
        language: "en",
      },
      {
        speakerId: "speaker_2",
        text: "How are you doing today?",
        confidence: 0.88,
        startTime: Date.now() + 3000,
        endTime: Date.now() + 6000,
        language: "en",
      },
      {
        speakerId: "speaker_1",
        text: "I am doing great, thanks for asking!",
        confidence: 0.92,
        startTime: Date.now() + 7000,
        endTime: Date.now() + 11000,
        language: "en",
      },
    ];

    for (const chunk of chunks) {
      await t.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: testMeetingId,
        ...chunk,
      });
    }

    const stats = await t.mutation(
      api.transcripts.ingestion.getTranscriptStats,
      {
        meetingId: testMeetingId,
      },
    );

    expect(stats.totalChunks).toBe(3);
    expect(stats.totalWords).toBeGreaterThan(0);
    expect(stats.averageConfidence).toBeCloseTo(0.917, 2);
    expect(stats.speakers).toContain("speaker_1");
    expect(stats.speakers).toContain("speaker_2");
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
    await t.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
      meetingId: testMeetingId,
      speakerId: "recent_speaker",
      text: "This is a recent transcript",
      confidence: 0.95,
      startTime: Date.now(),
      endTime: Date.now() + 5000,
      language: "en",
    });

    // Cleanup old transcripts (older than 90 days)
    const result = await t.mutation(
      internal.transcripts.ingestion.cleanupOldTranscripts,
      {
        olderThanMs: 90 * 24 * 60 * 60 * 1000,
        meetingId: testMeetingId,
      },
    );

    expect(result.deleted).toBe(1);

    // Verify recent transcript still exists
    const stats = await t.mutation(
      api.transcripts.ingestion.getTranscriptStats,
      {
        meetingId: testMeetingId,
      },
    );
    expect(stats.totalChunks).toBe(1);
  });

  test("should handle concurrent ingestion without conflicts", async () => {
    const concurrentChunks = Array.from({ length: 10 }, (_, i) => ({
      speakerId: `speaker_${i % 2}`,
      text: `Concurrent chunk ${i}`,
      confidence: 0.9,
      startTime: Date.now() + i * 1000,
      endTime: Date.now() + i * 1000 + 800,
      language: "en",
    }));

    // Execute all ingestions concurrently
    const promises = concurrentChunks.map((chunk) =>
      t.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
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
      t.mutation(api.transcripts.ingestion.ingestTranscriptChunk, {
        meetingId: inactiveMeetingId,
        speakerId: "speaker_1",
        text: "This should fail",
        confidence: 0.95,
        startTime: Date.now(),
        endTime: Date.now() + 5000,
      }),
    ).rejects.toThrow("Meeting is not currently active");
  });
});
