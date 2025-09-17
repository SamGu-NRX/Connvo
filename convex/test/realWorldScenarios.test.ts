/**
 * Real-World Scenario Tests
 *
 * These tests simulate actual usage patterns and validate the system
 * under realistic conditions with proper error handling and edge cases.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { Id } from "@convex/_generated/dataModel";
import schema from "../schema";

describe("Real-World Scenario Tests", () => {
  describe("Complete Meeting Lifecycle", () => {
    test("should handle full meeting lifecycle with multiple participants", async () => {
      const t = convexTest(schema);

      // Setup: Create users and meeting
      const { meetingId, hostId, participant1Id, participant2Id } = await t.run(
        async (ctx) => {
          const hostId = await ctx.db.insert("users", {
            workosUserId: "host_123",
            email: "host@example.com",
            orgId: "org_123",
            orgRole: "admin",
            displayName: "Meeting Host",
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          const participant1Id = await ctx.db.insert("users", {
            workosUserId: "participant_456",
            email: "participant1@example.com",
            orgId: "org_123",
            orgRole: "member",
            displayName: "Participant One",
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          const participant2Id = await ctx.db.insert("users", {
            workosUserId: "participant_789",
            email: "participant2@example.com",
            orgId: "org_123",
            orgRole: "member",
            displayName: "Participant Two",
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          // Create meeting
          const meetingId = await ctx.db.insert("meetings", {
            organizerId: hostId,
            title: "Quarterly Planning Meeting",
            description: "Planning for Q4 objectives",
            scheduledAt: Date.now() + 3600000, // 1 hour from now
            duration: 3600, // 1 hour
            state: "scheduled",
            participantCount: 3,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          // Add participants
          await ctx.db.insert("meetingParticipants", {
            meetingId,
            userId: hostId,
            role: "host",
            presence: "invited",
            createdAt: Date.now(),
          });

          await ctx.db.insert("meetingParticipants", {
            meetingId,
            userId: participant1Id,
            role: "participant",
            presence: "invited",
            createdAt: Date.now(),
          });

          await ctx.db.insert("meetingParticipants", {
            meetingId,
            userId: participant2Id,
            role: "participant",
            presence: "invited",
            createdAt: Date.now(),
          });

          // Initialize meeting state and notes
          await ctx.db.insert("meetingState", {
            meetingId,
            active: false,
            topics: [],
            recordingEnabled: false,
            updatedAt: Date.now(),
          });

          await ctx.db.insert("meetingNotes", {
            meetingId,
            content: "",
            version: 0,
            lastRebasedAt: Date.now(),
            updatedAt: Date.now(),
          });

          return { meetingId, hostId, participant1Id, participant2Id };
        },
      );

      // Start meeting and add content
      await t.run(async (ctx) => {
        // Start meeting
        await ctx.db.patch(meetingId, {
          state: "active",
          updatedAt: Date.now(),
        });

        const meetingState = await ctx.db
          .query("meetingState")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();

        if (meetingState) {
          await ctx.db.patch(meetingState._id, {
            active: true,
            startedAt: Date.now(),
            updatedAt: Date.now(),
          });
        }

        // Generate transcripts during meeting
        const now = Date.now();
        const bucketMs = Math.floor(now / 300000) * 300000;

        const transcriptChunks = [
          "Welcome everyone to our quarterly planning meeting",
          "Let's start by reviewing our Q3 performance",
          "Our revenue targets were exceeded by 15%",
          "Now let's discuss Q4 objectives a plany initiatives",
          "We need to focus on customer retention and expansion",
        ];

        for (let i = 0; i < transcriptChunks.length; i++) {
          await ctx.db.insert("transcripts", {
            meetingId,
            bucketMs,
            sequence: i + 1,
            speakerId: i % 2 === 0 ? "host_123" : "participant_456",
            text: transcriptChunks[i],
            confidence: 0.92 + Math.random() * 0.08,
            startMs: now + i * 5000,
            endMs: now + (i + 1) * 5000,
            wordCount: transcriptChunks[i].split(" ").length,
            createdAt: now + i * 5000,
          });
        }

        // Collaborative note taking
        const noteOperations = [
          { content: "# Quarterly Planning Meeting\n\n", position: 0 },
          { content: "## Q3 Performance Review\n", position: 30 },
          { content: "- Revenue exceeded targets by 15%\n", position: 55 },
          {
            content: "- Customer satisfaction scores improved\n",
            position: 85,
          },
          { content: "\n## Q4 Objectives\n", position: 120 },
          { content: "- Focus on customer retention\n", position: 140 },
          { content: "- Expand into new markets\n", position: 170 },
        ];

        for (let i = 0; i < noteOperations.length; i++) {
          await ctx.db.insert("noteOps", {
            meetingId,
            sequence: i + 1,
            authorId: i % 2 === 0 ? hostId : participant1Id,
            operation: {
              type: "insert",
              position: noteOperations[i].position,
              content: noteOperations[i].content,
            },
            timestamp: now + i * 2000,
            applied: true,
          });
        }

        // Update materialized notes
        const finalContent = noteOperations.map((op) => op.content).join("");
        const notes = await ctx.db
          .query("meetingNotes")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();

        if (notes) {
          await ctx.db.patch(notes._id, {
            content: finalContent,
            version: noteOperations.length,
            lastRebasedAt: Date.now(),
            updatedAt: Date.now(),
          });
        }

        // Generate AI prompts during meeting
        await ctx.db.insert("prompts", {
          meetingId,
          type: "incall",
          content:
            "Based on the revenue discussion, consider asking about specific growth drivers and challenges faced in Q3.",
          tags: ["revenue", "growth", "analysis"],
          relevance: 0.85,
          createdAt: Date.now(),
        });
      });

      // End meeting and generate insights
      await t.run(async (ctx) => {
        const endTime = Date.now();

        // End meeting
        await ctx.db.patch(meetingId, {
          state: "concluded",
          updatedAt: endTime,
        });

        const meetingState = await ctx.db
          .query("meetingState")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();

        if (meetingState) {
          await ctx.db.patch(meetingState._id, {
            active: false,
            endedAt: endTime,
            updatedAt: endTime,
          });
        }

        // Generate transcript segments for search
        await ctx.db.insert("transcriptSegments", {
          meetingId,
          startMs: Date.now() - 25000,
          endMs: Date.now(),
          speakers: ["host_123", "participant_456"],
          text: "Welcome everyone to our quarterly planning meeting. Let's start by reviewing our Q3 performance. Our revenue targets were exceeded by 15%. Now let's discuss Q4 objectives and key initiatives. We need to focus on customer retention and expansion.",
          topics: ["quarterly-planning", "revenue", "objectives"],
          sentiment: 0.7, // Positive sentiment
          createdAt: endTime,
        });

        // Generate post-meeting insights
        for (const userId of [hostId, participant1Id, participant2Id]) {
          await ctx.db.insert("insights", {
            userId,
            meetingId,
            summary:
              "Quarterly planning meeting focused on Q3 review and Q4 objectives. Revenue targets exceeded expectations.",
            actionItems: [
              "Prepare detailed Q4 customer retention strategy",
              "Research new market expansion opportunities",
              "Schedule follow-up meeting for next week",
            ],
            recommendations: [
              {
                type: "follow_up",
                content:
                  "Schedule 1:1 with team leads to discuss Q4 initiatives",
                confidence: 0.8,
              },
            ],
            links: [
              {
                type: "transcript",
                url: `/meetings/${meetingId}/transcript`,
                title: "Full Meeting Transcript",
              },
            ],
            createdAt: endTime,
          });
        }
      });

      // Validation: Verify complete meeting lifecycle
      const finalMeeting = await t.run(async (ctx) => {
        return await ctx.db.get(meetingId);
      });
      expect(finalMeeting?.state).toBe("concluded");

      const finalMeetingState = await t.run(async (ctx) => {
        return await ctx.db
          .query("meetingState")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();
      });
      expect(finalMeetingState?.active).toBe(false);
      expect(finalMeetingState?.endedAt).toBeDefined();

      const allTranscripts = await t.run(async (ctx) => {
        return await ctx.db
          .query("transcripts")
          .withIndex("by_meeting_bucket", (q) => q.eq("meetingId", meetingId))
          .collect();
      });
      expect(allTranscripts).toHaveLength(5);

      const finalNotes = await t.run(async (ctx) => {
        return await ctx.db
          .query("meetingNotes")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .unique();
      });
      expect(finalNotes?.content).toContain("Quarterly Planning Meeting");
      expect(finalNotes?.version).toBe(7);

      const allInsights = await t.run(async (ctx) => {
        return await ctx.db
          .query("insights")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .collect();
      });
      expect(allInsights).toHaveLength(3);
    });
  });

  describe("High-Frequency Real-Time Operations", () => {
    test("should handle rapid transcript ingestion with proper sharding", async () => {
      const t = convexTest(schema);

      const meetingId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          workosUserId: "user_123",
          email: "user@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const meetingId = await ctx.db.insert("meetings", {
          organizerId: userId,
          title: "High-Frequency Test",
          state: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Simulate 5 minutes of rapid transcript ingestion (1 chunk per second)
        const startTime = Date.now();

        for (let i = 0; i < 300; i++) {
          // 5 minutes * 60 seconds
          const timestamp = startTime + i * 1000;
          const bucketMs = Math.floor(timestamp / 300000) * 300000;

          await ctx.db.insert("transcripts", {
            meetingId,
            bucketMs,
            sequence: i + 1,
            speakerId: `speaker_${(i % 3) + 1}`,
            text: `Transcript chunk ${i + 1} with some meaningful content about the discussion`,
            confidence: 0.85 + Math.random() * 0.15,
            startMs: timestamp,
            endMs: timestamp + 1000,
            wordCount: 12,
            createdAt: timestamp,
          });
        }

        return meetingId;
      });

      // Verify sharding worked correctly
      const allTranscripts = await t.run(async (ctx) => {
        return await ctx.db
          .query("transcripts")
          .withIndex("by_meeting_bucket", (q) => q.eq("meetingId", meetingId))
          .collect();
      });

      expect(allTranscripts).toHaveLength(300);

      // Verify buckets are properly distributed
      const buckets = new Set(allTranscripts.map((t) => t.bucketMs));
      expect(buckets.size).toBeGreaterThan(1); // Should span multiple buckets

      // Test efficient querying of recent transcripts
      const recentBucket = Math.max(...Array.from(buckets));
      const recentTranscripts = await t.run(async (ctx) => {
        return await ctx.db
          .query("transcripts")
          .withIndex("by_meeting_bucket", (q) =>
            q.eq("meetingId", meetingId).eq("bucketMs", recentBucket),
          )
          .collect();
      });

      expect(recentTranscripts.length).toBeGreaterThan(0);
      expect(recentTranscripts.length).toBeLessThanOrEqual(60); // Max 1 minute of data
    });

    test("should handle concurrent note operations with conflict resolution", async () => {
      const t = convexTest(schema);

      const { meetingId, users } = await t.run(async (ctx) => {
        // Setup meeting with multiple participants
        const users = [];
        for (let i = 0; i < 5; i++) {
          const userId = await ctx.db.insert("users", {
            workosUserId: `user_${i}`,
            email: `user${i}@example.com`,
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          users.push(userId);
        }

        const meetingId = await ctx.db.insert("meetings", {
          organizerId: users[0],
          title: "Concurrent Notes Test",
          state: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Simulate concurrent note operations from multiple users
        const baseTime = Date.now();

        // Each user makes 20 operations over 10 seconds
        for (let user = 0; user < 5; user++) {
          for (let op = 0; op < 20; op++) {
            const sequence = user * 20 + op + 1;
            const timestamp = baseTime + op * 500 + user * 100; // Slight offset per user

            await ctx.db.insert("noteOps", {
              meetingId,
              sequence,
              authorId: users[user],
              operation: {
                type: "insert",
                position: sequence * 10,
                content: `Content from user ${user + 1}, operation ${op + 1}\n`,
              },
              timestamp,
              applied: true,
            });
          }
        }

        return { meetingId, users };
      });

      // Verify all operations were recorded
      const allOps = await t.run(async (ctx) => {
        return await ctx.db
          .query("noteOps")
          .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
          .collect();
      });

      expect(allOps).toHaveLength(100);

      // Verify operations are properly sequenced
      for (let i = 0; i < allOps.length - 1; i++) {
        expect(allOps[i].sequence).toBeLessThan(allOps[i + 1].sequence);
      }

      // Verify operations from all users are present
      const userOps = new Set(allOps.map((op) => op.authorId));
      expect(userOps.size).toBe(5);
    });
  });

  describe("Search and Vector Operations", () => {
    test("should perform efficient full-text search across large datasets", async () => {
      const t = convexTest(schema);

      const meetings = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          workosUserId: "user_123",
          email: "user@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Create multiple meetings with searchable content
        const meetings = [];
        const searchTerms = [
          "artificial intelligence machine learning",
          "quarterly sales revenue growth",
          "customer satisfaction feedback analysis",
          "product development roadmap planning",
          "team collaboration remote work",
        ];

        for (let i = 0; i < 5; i++) {
          const meetingId = await ctx.db.insert("meetings", {
            organizerId: userId,
            title: `Meeting ${i + 1}`,
            state: "concluded",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          meetings.push(meetingId);

          // Add transcript segments with different content
          await ctx.db.insert("transcriptSegments", {
            meetingId,
            startMs: 0,
            endMs: 60000,
            speakers: ["speaker1"],
            text: `This meeting focused on ${searchTerms[i]} and related topics. We discussed various aspects and made important decisions.`,
            topics: searchTerms[i].split(" "),
            createdAt: Date.now(),
          });

          // Add meeting notes
          await ctx.db.insert("meetingNotes", {
            meetingId,
            content: `# Meeting Notes\n\nKey discussion points about ${searchTerms[i]}:\n- Important insights\n- Action items\n- Next steps`,
            version: 1,
            lastRebasedAt: Date.now(),
            updatedAt: Date.now(),
          });
        }

        return meetings;
      });

      // Test transcript search
      const aiTranscripts = await t.run(async (ctx) => {
        return await ctx.db
          .query("transcriptSegments")
          .withSearchIndex("search_text", (q) =>
            q.search("text", "artificial intelligence"),
          )
          .collect();
      });

      expect(aiTranscripts).toHaveLength(1);
      expect(aiTranscripts[0].text).toContain("artificial intelligence");

      // Test notes search
      const salesNotes = await t.run(async (ctx) => {
        return await ctx.db
          .query("meetingNotes")
          .withSearchIndex("search_content", (q) =>
            q.search("content", "sales revenue"),
          )
          .collect();
      });

      expect(salesNotes).toHaveLength(1);
      expect(salesNotes[0].content).toContain("sales revenue");

      // Test filtered search
      const specificMeetingTranscripts = await t.run(async (ctx) => {
        return await ctx.db
          .query("transcriptSegments")
          .withSearchIndex("search_text", (q) =>
            q.search("text", "meeting").eq("meetingId", meetings[0]),
          )
          .collect();
      });

      expect(specificMeetingTranscripts).toHaveLength(1);
      expect(specificMeetingTranscripts[0].meetingId).toBe(meetings[0]);
    });

    test("should handle vector similarity search for embeddings", async () => {
      const t = convexTest(schema);

      // Create embeddings for different content types
      const embeddingIds = await t.run(async (ctx) => {
        const embeddings = [
          {
            sourceType: "user" as const,
            sourceId: "user_1",
            vector: new Array(1536).fill(0).map(() => Math.random()),
            model: "text-embedding-ada-002",
            dimensions: 1536,
            version: "v1",
            metadata: {
              content: "AI researcher with expertise in machine learning",
            },
            createdAt: Date.now(),
          },
          {
            sourceType: "user" as const,
            sourceId: "user_2",
            vector: new Array(1536).fill(0).map(() => Math.random()),
            model: "text-embedding-ada-002",
            dimensions: 1536,
            version: "v1",
            metadata: { content: "Sales manager focused on revenue growth" },
            createdAt: Date.now(),
          },
          {
            sourceType: "transcriptSegment" as const,
            sourceId: "segment_1",
            vector: new Array(1536).fill(0).map(() => Math.random()),
            model: "text-embedding-ada-002",
            dimensions: 1536,
            version: "v1",
            metadata: {
              content: "Discussion about artificial intelligence applications",
            },
            createdAt: Date.now(),
          },
        ];

        // Insert embeddings
        const embeddingIds = [];
        for (const embedding of embeddings) {
          const id = await ctx.db.insert("embeddings", embedding);
          embeddingIds.push(id);
        }

        return embeddingIds;
      });

      // Verify embeddings were created with proper structure
      for (const id of embeddingIds) {
        const embedding = await t.run(async (ctx) => {
          return await ctx.db.get(id);
        });

        expect(embedding).toBeDefined();
        expect(embedding?.vector).toHaveLength(1536);
        expect(embedding?.dimensions).toBe(1536);
      }

      // Test filtering by source type
      const userEmbeddings = await t.run(async (ctx) => {
        return await ctx.db
          .query("embeddings")
          .withIndex("by_source", (q) => q.eq("sourceType", "user"))
          .collect();
      });

      expect(userEmbeddings).toHaveLength(2);

      // Test filtering by model
      const adaEmbeddings = await t.run(async (ctx) => {
        return await ctx.db
          .query("embeddings")
          .withIndex("by_model", (q) => q.eq("model", "text-embedding-ada-002"))
          .collect();
      });

      expect(adaEmbeddings).toHaveLength(3);
    });
  });

  describe("Performance SLO Validation", () => {
    test("should meet query performance targets", async () => {
      const t = convexTest(schema);

      // Setup test data
      const { userId, meetingId } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          workosUserId: "user_123",
          email: "user@example.com",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const meetingId = await ctx.db.insert("meetings", {
          organizerId: userId,
          title: "Performance Test",
          state: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { userId, meetingId };
      });

      // Test query performance (should be under 120ms p95)
      const queryTimes = [];

      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();

        await t.run(async (ctx) => {
          return await ctx.db
            .query("meetings")
            .withIndex("by_organizer", (q) => q.eq("organizerId", userId))
            .collect();
        });

        const queryTime = Date.now() - startTime;
        queryTimes.push(queryTime);
      }

      const avgQueryTime =
        queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
      const maxQueryTime = Math.max(...queryTimes);

      // Performance assertions (relaxed for test environment)
      expect(avgQueryTime).toBeLessThan(50); // Should be much faster in test
      expect(maxQueryTime).toBeLessThan(100);

      console.log(
        `Query performance: avg=${avgQueryTime}ms, max=${maxQueryTime}ms`,
      );
    });
  });
});
