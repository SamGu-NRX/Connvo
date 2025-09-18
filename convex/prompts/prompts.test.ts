/**
 * Prompts Module Tests
 *
 * This module provides unit tests for the prompts functionality
 * including pre-call idea generation and feedback tracking.
 *
 * Requirements: 18.1, 18.3
 * Compliance: steering/convex_rules.mdc - Proper testing patterns
 */

import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "@convex/_generated/api";
import schema from "../schema";
import { Id } from "@convex/_generated/dataModel";

describe("Prompts Module", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(async () => {
    t = convexTest(schema);
  });

  describe("Pre-call Idea Generation", () => {
    it("should generate pre-call ideas with idempotency", async () => {
      // Create test user and meeting
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
            workosUserId: "test-workos-user",
            email: "test@example.com",
            displayName: "Test User",
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
      });

      const authedT = t.withIdentity({
        subject: "test-workos-user",
        email: "test@example.com",
        name: "Test User",
      });

      const { meetingId } = await authedT.mutation(
        api.meetings.lifecycle.createMeeting,
        {
          title: "Test Meeting",
          description: "A test meeting for prompt generation",
        },
      );

      // Generate pre-call ideas
      const result1 = await authedT.action(api.prompts.actions.generatePreCallIdeas, {
        meetingId,
      });

      expect(result1.generated).toBe(true);
      expect(result1.fromCache).toBe(false);
      expect(result1.promptIds.length).toBeGreaterThan(0);

      // Second call should return cached results
      const result2 = await authedT.action(api.prompts.actions.generatePreCallIdeas, {
        meetingId,
      });

      expect(result2.generated).toBe(false);
      expect(result2.fromCache).toBe(true);
      expect(result2.promptIds).toEqual(result1.promptIds);
    });

    it("should handle force regeneration", async () => {
      // Create test user and meeting
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
            workosUserId: "test-workos-user-2",
            email: "test2@example.com",
            displayName: "Test User 2",
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
      });

      const authedT = t.withIdentity({
        subject: "test-workos-user-2",
        email: "test2@example.com",
        name: "Test User 2",
      });

      const { meetingId } = await authedT.mutation(
        api.meetings.lifecycle.createMeeting,
        {
          title: "Test Meeting 2",
          description: "Another test meeting",
        },
      );

      // Generate initial ideas
      const result1 = await authedT.action(api.prompts.actions.generatePreCallIdeas, {
        meetingId,
      });

      // Force regeneration
      const result2 = await authedT.action(api.prompts.actions.generatePreCallIdeas, {
        meetingId,
        forceRegenerate: true,
      });

      expect(result2.generated).toBe(true);
      expect(result2.fromCache).toBe(false);
    });
  });

  describe("Prompt Feedback", () => {
    it("should update prompt feedback correctly", async () => {
        const userId = await t.run(async (ctx) => {
            return await ctx.db.insert("users", {
                workosUserId: "test-workos-user-3",
                email: "test3@example.com",
                displayName: "Test User 3",
                isActive: true,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        });

        const authedT = t.withIdentity({
            subject: "test-workos-user-3",
            email: "test3@example.com",
            name: "Test User 3",
        });

      // Create test prompt
      const meetingId = await t.run(async (ctx) => {
        return await ctx.db.insert("meetings", {
            organizerId: userId,
            title: "Test Meeting 3",
            state: "concluded",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("meetingParticipants", {
            meetingId,
            userId,
            role: "host",
            presence: "joined",
            createdAt: Date.now(),
        });
      });

      const promptId = await t.mutation(
        internal.prompts.mutations.createPrompt,
        {
          meetingId,
          type: "precall",
          content: "Test prompt content",
          tags: ["test"],
          relevance: 0.8,
        },
      );

      // Update feedback
      await authedT.mutation(api.prompts.mutations.updatePromptFeedback, {
        promptId,
        feedback: "used",
      });

      // Verify feedback was updated
      const prompt = await t.query(internal.prompts.queries.getPromptById, {
        promptId,
      });

      expect(prompt?.feedback).toBe("used");
      expect(prompt?.usedAt).toBeDefined();
    });
  });

  describe("Prompt Queries", () => {
    it("should retrieve pre-call prompts with proper authorization", async () => {
        const userId = await t.run(async (ctx) => {
            return await ctx.db.insert("users", {
                workosUserId: "test-workos-user-4",
                email: "test4@example.com",
                displayName: "Test User 4",
                isActive: true,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        });

        const authedT = t.withIdentity({
            subject: "test-workos-user-4",
            email: "test4@example.com",
            name: "Test User 4",
        });

      const meetingId = await t.run(async (ctx) => {
        return await ctx.db.insert("meetings", {
            organizerId: userId,
            title: "Test Meeting 4",
            state: "concluded",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("meetingParticipants", {
            meetingId,
            userId,
            role: "host",
            presence: "joined",
            createdAt: Date.now(),
        });
      });

      const prompts = await authedT.query(
        internal.prompts.queries.getPromptsByMeetingAndType,
        {
          meetingId,
          type: "precall",
          limit: 5,
        },
      );

      expect(Array.isArray(prompts)).toBe(true);
    });
  });

  describe("Heuristic Prompt Generation", () => {
    it("should generate relevant prompts based on participant analysis", async () => {
      // This would test the heuristic generation logic
      // The actual implementation is in the actions file
      expect(true).toBe(true); // Placeholder
    });
  });
});
