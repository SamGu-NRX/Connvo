import { describe, expect, test } from "vitest";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import {
  createTestEnvironment,
  createCompleteTestUser,
  createTestMeeting,
  addMeetingParticipant,
  createTestInterest,
} from "./helpers";
import {
  getDocstringInfoForOperation,
  getExampleValue,
} from "./openapiExamples";

describe("OpenAPI shared examples", () => {
  test("meetings/queries/getMeeting example aligns with query output", async () => {
    const t = createTestEnvironment();

    const docInfo = getDocstringInfoForOperation("convex/meetings/queries.ts", "getMeeting");
    const requestExample = getExampleValue(docInfo, "request") as { args: { meetingId: string } };
    const responseExample = getExampleValue(docInfo, "response") as {
      status: string;
      value: Record<string, any>;
    };
    const meetingData = getExampleValue(docInfo, "datamodel") as Record<string, any>;

    expect(requestExample).toBeDefined();
    expect(responseExample).toBeDefined();
    expect(meetingData).toBeDefined();
    expect(responseExample?.value).toMatchObject(meetingData);

    const { meetingId, userId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        workosUserId: meetingData.organizerId,
        email: "host@example.com",
        displayName: "Meeting Host",
        orgId: "org_123",
        orgRole: "admin",
        isActive: true,
        createdAt: meetingData.createdAt,
        updatedAt: meetingData.updatedAt,
      });

      const meetingId = await ctx.db.insert("meetings", {
        organizerId: userId,
        title: meetingData.title,
        description: meetingData.description,
        scheduledAt: meetingData.scheduledAt,
        duration: meetingData.duration,
        state: meetingData.state,
        participantCount: meetingData.participantCount,
        averageRating: meetingData.averageRating,
        streamRoomId: meetingData.streamRoomId,
        webrtcEnabled: meetingData.webrtcEnabled,
        createdAt: meetingData.createdAt,
        updatedAt: meetingData.updatedAt,
      });

      await ctx.db.insert("meetingParticipants", {
        meetingId,
        userId,
        role: meetingData.userRole,
        presence: meetingData.userPresence,
        joinedAt: meetingData.userPresence === "joined" ? meetingData.updatedAt : undefined,
        createdAt: meetingData.createdAt,
      });

      const makeSession = async (
        sessionId: string,
        state: "connecting" | "connected" | "disconnected",
      ) => {
        await ctx.db.insert("webrtcSessions", {
          meetingId,
          sessionId,
          userId,
          state,
          metadata: undefined,
          createdAt: meetingData.createdAt,
          updatedAt: meetingData.updatedAt,
        });
      };

      await makeSession("session-a", "connected");
      await makeSession("session-b", "connecting");

      return { meetingId, userId };
    });

    const authed = t.withIdentity({
      subject: meetingData.organizerId,
      tokenIdentifier: "test-token",
      email: "host@example.com",
      name: "Meeting Host",
    });

    const result = await authed.query(api.meetings.queries.getMeeting, {
      meetingId: meetingId as Id<"meetings">,
    });

    expect(result).toBeTruthy();
    if (!result) {
      throw new Error("Query returned null result for meeting.");
    }

    // Align dynamic identifiers/timestamps with sample placeholders before comparison.
    const normalizedActual = {
      ...result,
      _id: meetingData._id,
      _creationTime: meetingData._creationTime,
      createdAt: meetingData.createdAt,
      updatedAt: meetingData.updatedAt,
      scheduledAt: meetingData.scheduledAt,
      organizerId: meetingData.organizerId,
    };

    expect(normalizedActual).toMatchObject(meetingData);
    expect(result.activeWebRTCSessions).toBe(meetingData.activeWebRTCSessions);
  });

  test("prompts/actions/generatePreCallIdeas examples align with action behavior", async () => {
    const t = createTestEnvironment();

    const docInfo = getDocstringInfoForOperation(
      "convex/prompts/actions.ts",
      "generatePreCallIdeas",
    );
    const requestExample = getExampleValue(docInfo, "request") as {
      args: { meetingId: string };
    };
    const responseExample = getExampleValue(docInfo, "response") as {
      status: string;
      value: { promptIds: string[]; generated: boolean; fromCache: boolean };
    };
    const cachedExample = getExampleValue(docInfo, "response-cache") as {
      value: { promptIds: string[]; generated: boolean; fromCache: boolean };
    };
    const datamodelExample = getExampleValue(docInfo, "datamodel") as {
      prompts: Array<{
        content: string;
        tags: string[];
        relevance: number;
      }>;
    };
    const errorExample = getExampleValue(docInfo, "response-error") as {
      status: string;
      errorMessage: string;
      errorData: { code: string; message: string; metadata: { id: string } };
    };

    expect(requestExample.args.meetingId).toBeTruthy();
    expect(responseExample.status).toBe("success");
    expect(responseExample.value.promptIds).toHaveLength(6);
    expect(responseExample.value.generated).toBe(true);
    expect(responseExample.value.fromCache).toBe(false);
    expect(cachedExample.value.generated).toBe(false);
    expect(cachedExample.value.fromCache).toBe(true);
    expect(datamodelExample.prompts).toHaveLength(6);
    expect(errorExample.status).toBe("error");
    expect(errorExample.errorMessage).toBe(errorExample.errorData.message);
    expect(errorExample.errorData.code).toBe("NOT_FOUND");
    expect(errorExample.errorData.metadata.id).toBe(requestExample.args.meetingId);

    await createTestInterest(t, "ai-ml", "AI / ML", "academic");
    await createTestInterest(t, "startups", "Startups", "personal");

    const host = await createCompleteTestUser(
      t,
      {
        workosUserId: "host-workos-user",
        email: "host@example.com",
        displayName: "Meeting Host",
        orgRole: "admin",
      },
      {
        field: "Technology",
        experience: "senior",
        goals: "Share AI adoption playbooks for enterprise teams.",
      },
      ["ai-ml"],
    );

    const guest = await createCompleteTestUser(
      t,
      {
        workosUserId: "guest-workos-user",
        email: "guest@example.com",
        displayName: "Participant Guest",
      },
      {
        field: "Product",
        experience: "mid-level",
        goals: "Learn how to embed ML insights into product roadmaps.",
      },
      ["ai-ml", "startups"],
    );

    const meetingId = await createTestMeeting(t, host.userId, {
      title: "AI Strategy Sync",
      description: "Prep for upcoming enterprise pilots.",
      scheduledAt: 1716484800000,
      duration: 3600,
    });

    await addMeetingParticipant(t, meetingId, host.userId, "host", "joined");
    await addMeetingParticipant(t, meetingId, guest.userId, "participant", "invited");

    const authed = t.withIdentity({
      subject: host.workosUserId,
      tokenIdentifier: "test-token",
      email: "host@example.com",
      name: "Meeting Host",
    });

    const firstCall = await authed.action(api.prompts.actions.generatePreCallIdeas, {
      meetingId: meetingId as Id<"meetings">,
    });

    expect(firstCall.generated).toBe(true);
    expect(firstCall.fromCache).toBe(false);
    expect(firstCall.promptIds).toHaveLength(responseExample.value.promptIds.length);

    const prompts = await t.run(async (ctx) => {
      return await ctx.db
        .query("prompts")
        .withIndex("by_meeting_type", (q) =>
          q.eq("meetingId", meetingId).eq("type", "precall"),
        )
        .collect();
    });

    const sortedActual = prompts.sort((a, b) => b.relevance - a.relevance);
    const examplePrompts = datamodelExample.prompts;

    expect(sortedActual).toHaveLength(examplePrompts.length);
    const actualSummary = sortedActual.map((p) => ({
      content: p.content,
      tags: p.tags,
      relevance: p.relevance,
    }));
    const exampleSummary = examplePrompts.map((p) => ({
      content: p.content,
      tags: p.tags,
      relevance: p.relevance,
    }));
    expect(actualSummary).toEqual(exampleSummary);

    const secondCall = await authed.action(api.prompts.actions.generatePreCallIdeas, {
      meetingId: meetingId as Id<"meetings">,
    });

    expect(secondCall.generated).toBe(false);
    expect(secondCall.fromCache).toBe(true);
    expect(secondCall.promptIds).toEqual(firstCall.promptIds);
    expect(secondCall.promptIds).toHaveLength(cachedExample.value.promptIds.length);
  });
});
