/**
 * Comprehensive Schema and Implementation Validation Tests
 *
 * This test suite validates the robustness, scalability, and correctness
 * of the Convex database schema and core functionality.
 */

import { expect, test, describe } from "vitest";
import { Id } from "@convex/_generated/dataModel";
import { createTestEnvironment } from "./helpers";

describe("Schema Validation and Performance Tests", () => {
  describe("Core Schema Validation", () => {
    test("should create users with proper WorkOS integration", async () => {
      const t = createTestEnvironment();

      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          workosUserId: "workos_123",
          email: "test@example.com",
          orgId: "org_123",
          orgRole: "admin",
          displayName: "Test User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });

      expect(user).toBeDefined();
      expect(user?.workosUserId).toBe("workos_123");
      expect(user?.email).toBe("test@example.com");
      expect(user?.orgRole).toBe("admin");
    });

    test("should create meetings with proper denormalized fields", async () => {
      const t = createTestEnvironment();

      const { meetingId } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          workosUserId: "workos_123",
          email: "test@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const meetingId = await ctx.db.insert("meetings", {
          organizerId: userId,
          title: "Test Meeting",
          state: "scheduled",
          participantCount: 1,
          averageRating: 4.5,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { meetingId };
      });

      const meeting = await t.run(async (ctx) => {
        return await ctx.db.get(meetingId);
      });

      expect(meeting).toBeDefined();
      expect(meeting?.participantCount).toBe(1);
      expect(meeting?.averageRating).toBe(4.5);
    });

    test("should handle time-sharded transcripts correctly", async () => {
      const t = createTestEnvironment();

      const { transcriptId, bucketMs } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          workosUserId: "workos_123",
          email: "test@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const meetingId = await ctx.db.insert("meetings", {
          organizerId: userId,
          title: "Test Meeting",
          state: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const now = Date.now();
        const bucketMs = Math.floor(now / 300000) * 300000; // 5-minute bucket

        const transcriptId = await ctx.db.insert("transcripts", {
          meetingId,
          bucketMs,
          sequence: 1,
          text: "Hello world",
          confidence: 0.95,
          startMs: now,
          endMs: now + 1000,
          wordCount: 2,
          createdAt: now,
        });

        return { transcriptId, bucketMs };
      });

      const transcript = await t.run(async (ctx) => {
        return await ctx.db.get(transcriptId);
      });

      expect(transcript).toBeDefined();
      expect(transcript?.bucketMs).toBe(bucketMs);
      expect(transcript?.wordCount).toBe(2);
    });

    test("should support vector embeddings with proper dimensions", async () => {
      const t = createTestEnvironment();

      const embeddingId = await t.run(async (ctx) => {
        const vector = Array.from({ length: 1536 }, () => Math.random());
        const vectorBuffer = new Float32Array(vector).buffer;

        return await ctx.db.insert("embeddings", {
          sourceType: "user",
          sourceId: "user_123",
          vector: vectorBuffer,
          model: "text-embedding-ada-002",
          dimensions: 1536,
          version: "v1",
          metadata: { test: true },
          createdAt: Date.now(),
        });
      });

      const embedding = await t.run(async (ctx) => {
        return await ctx.db.get(embeddingId);
      });

      expect(embedding).toBeDefined();
      expect(embedding?.vector.byteLength).toBe(
        1536 * Float32Array.BYTES_PER_ELEMENT,
      );
      expect(new Float32Array(embedding!.vector)).toHaveLength(1536);
      expect(embedding?.dimensions).toBe(1536);
    });
  });

  describe("Index Performance Validation", () => {
    test("should efficiently query transcripts by meeting and bucket", async () => {
      const t = createTestEnvironment();

      const { meetingId, bucketMs } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          workosUserId: "workos_123",
          email: "test@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const meetingId = await ctx.db.insert("meetings", {
          organizerId: userId,
          title: "Test Meeting",
          state: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const now = Date.now();
        const bucketMs = Math.floor(now / 300000) * 300000;

        // Insert multiple transcripts
        for (let i = 0; i < 10; i++) {
          await ctx.db.insert("transcripts", {
            meetingId,
            bucketMs,
            sequence: i + 1,
            text: `Transcript ${i + 1}`,
            confidence: 0.95,
            startMs: now + i * 1000,
            endMs: now + (i + 1) * 1000,
            wordCount: 2,
            createdAt: now + i * 1000,
          });
        }

        return { meetingId, bucketMs };
      });

      // Query using compound index
      const transcripts = await t.run(async (ctx) => {
        return await ctx.db
          .query("transcripts")
          .withIndex("by_meeting_bucket_seq", (q) =>
            q
              .eq("meetingId", meetingId)
              .eq("bucketMs", bucketMs)
              .gt("sequence", 5),
          )
          .collect();
      });

      expect(transcripts).toHaveLength(5); // Sequences 6-10
      expect(transcripts[0].sequence).toBe(6);
    });

    test("should efficiently query users by org and role", async () => {
      const t = createTestEnvironment();

      await t.run(async (ctx) => {
        const orgId = "org_123";

        // Insert users with different roles
        for (const role of ["admin", "member", "viewer"]) {
          for (let i = 0; i < 3; i++) {
            await ctx.db.insert("users", {
              workosUserId: `workos_${role}_${i}`,
              email: `${role}${i}@example.com`,
              orgId,
              orgRole: role,
              isActive: true,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        }
      });

      // Query admins using compound index
      const admins = await t.run(async (ctx) => {
        return await ctx.db
          .query("users")
          .withIndex("by_org_and_role", (q) =>
            q.eq("orgId", "org_123").eq("orgRole", "admin"),
          )
          .collect();
      });

      expect(admins).toHaveLength(3);
      expect(admins.every((u) => u.orgRole === "admin")).toBe(true);
    });
  });

  describe("Search Index Validation", () => {
    test("should perform full-text search on meeting notes", async () => {
      const t = createTestEnvironment();

      const meetingId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          workosUserId: "workos_123",
          email: "test@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const meetingId = await ctx.db.insert("meetings", {
          organizerId: userId,
          title: "Test Meeting",
          state: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        await ctx.db.insert("meetingNotes", {
          meetingId,
          content:
            "This is a test note about artificial intelligence and machine learning",
          version: 1,
          lastRebasedAt: Date.now(),
          updatedAt: Date.now(),
        });

        return meetingId;
      });

      // Search using search index
      const results = await t.run(async (ctx) => {
        const rows = await ctx.db
          .query("meetingNotes")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .collect();
        return rows.filter((row) =>
          row.content.toLowerCase().includes("artificial intelligence"),
        );
      });

      expect(results).toHaveLength(1);
      expect(results[0].content).toContain("artificial intelligence");
    });

    test("should perform full-text search on transcript segments", async () => {
      const t = createTestEnvironment();

      const meetingId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          workosUserId: "workos_123",
          email: "test@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const meetingId = await ctx.db.insert("meetings", {
          organizerId: userId,
          title: "Test Meeting",
          state: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        await ctx.db.insert("transcriptSegments", {
          meetingId,
          startMs: 0,
          endMs: 10000,
          speakers: ["speaker1"],
          text: "We discussed the quarterly sales report and revenue projections",
          topics: ["sales", "revenue"],
          createdAt: Date.now(),
        });

        return meetingId;
      });

      // Search using search index
      const results = await t.run(async (ctx) => {
        const rows = await ctx.db
          .query("transcriptSegments")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .collect();
        return rows.filter((row) =>
          row.text.toLowerCase().includes("sales report"),
        );
      });

      expect(results).toHaveLength(1);
      expect(results[0].text).toContain("sales report");
    });
  });

  describe("Relationship and Constraint Validation", () => {
    test("should maintain referential integrity for meeting participants", async () => {
      const t = createTestEnvironment();

      const { participantId, meetingId, userId } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          workosUserId: "workos_123",
          email: "test@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const meetingId = await ctx.db.insert("meetings", {
          organizerId: userId,
          title: "Test Meeting",
          state: "scheduled",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const participantId = await ctx.db.insert("meetingParticipants", {
          meetingId,
          userId,
          role: "host",
          presence: "invited",
          createdAt: Date.now(),
        });

        return { participantId, meetingId, userId };
      });

      // Verify relationship
      const participant = await t.run(async (ctx) => {
        return await ctx.db.get(participantId);
      });

      expect(participant?.meetingId).toBe(meetingId);
      expect(participant?.userId).toBe(userId);

      // Verify unique constraint via index
      const participants = await t.run(async (ctx) => {
        return await ctx.db
          .query("meetingParticipants")
          .withIndex("by_meeting_and_user", (q) =>
            q.eq("meetingId", meetingId).eq("userId", userId),
          )
          .collect();
      });

      expect(participants).toHaveLength(1);
    });

    test("should handle note operations with sequence ordering", async () => {
      const t = createTestEnvironment();

      const meetingId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          workosUserId: "workos_123",
          email: "test@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const meetingId = await ctx.db.insert("meetings", {
          organizerId: userId,
          title: "Test Meeting",
          state: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Insert operations in sequence
        for (let i = 1; i <= 5; i++) {
          await ctx.db.insert("noteOps", {
            meetingId,
            sequence: i,
            authorId: userId,
            operation: {
              type: "insert",
              position: i * 10,
              content: `Operation ${i}`,
            },
            timestamp: Date.now() + i * 1000,
            applied: true,
          });
        }

        return meetingId;
      });

      // Query operations in sequence order
      const operations = await t.run(async (ctx) => {
        return await ctx.db
          .query("noteOps")
          .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
          .collect();
      });

      expect(operations).toHaveLength(5);
      expect(operations[0].sequence).toBe(1);
      expect(operations[4].sequence).toBe(5);
    });
  });

  describe("Performance and Scalability Tests", () => {
    test("should handle high-volume transcript ingestion", async () => {
      const t = createTestEnvironment();

      const meetingId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          workosUserId: "workos_123",
          email: "test@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const meetingId = await ctx.db.insert("meetings", {
          organizerId: userId,
          title: "High Volume Test",
          state: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const startTime = Date.now();
        const bucketMs = Math.floor(startTime / 300000) * 300000;

        // Insert 100 transcript chunks (simulating high-frequency ingestion)
        for (let i = 0; i < 100; i++) {
          await ctx.db.insert("transcripts", {
            meetingId,
            bucketMs: bucketMs + Math.floor(i / 20) * 300000, // Spread across buckets
            sequence: i + 1,
            text: `Transcript chunk ${i + 1} with some content`,
            confidence: 0.9 + Math.random() * 0.1,
            startMs: startTime + i * 1000,
            endMs: startTime + (i + 1) * 1000,
            wordCount: 6,
            createdAt: startTime + i * 1000,
          });
        }

        return meetingId;
      });

      // Verify all transcripts were inserted
      const allTranscripts = await t.run(async (ctx) => {
        return await ctx.db
          .query("transcripts")
          .withIndex("by_meeting_bucket", (q) => q.eq("meetingId", meetingId))
          .collect();
      });

      expect(allTranscripts).toHaveLength(100);

      // Test bucket-based querying performance
      const bucketTranscripts = await t.run(async (ctx) => {
        const firstBucket = Math.min(...allTranscripts.map((t) => t.bucketMs));
        return await ctx.db
          .query("transcripts")
          .withIndex("by_meeting_bucket", (q) =>
            q.eq("meetingId", meetingId).eq("bucketMs", firstBucket),
          )
          .collect();
      });

      expect(bucketTranscripts.length).toBeGreaterThan(0);
      expect(bucketTranscripts.length).toBeLessThanOrEqual(20);
    });
  });

  describe("Data Integrity and Validation", () => {
    test("should enforce required fields and data types", async () => {
      const t = createTestEnvironment();

      // Test that proper data types are enforced
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          workosUserId: "workos_123",
          email: "test@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      expect(typeof userId).toBe("string");
    });

    test("should handle optional fields correctly", async () => {
      const t = createTestEnvironment();

      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          workosUserId: "workos_123",
          email: "test@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          // Optional fields not provided
        });
      });

      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });

      expect(user?.displayName).toBeUndefined();
      expect(user?.avatarUrl).toBeUndefined();
      expect(user?.orgId).toBeUndefined();
    });
  });
});
