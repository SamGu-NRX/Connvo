import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { useCollaborativeNotes } from "@/hooks/useCollaborativeNotes";
import { useInCallPrompts } from "@/hooks/useInCallPrompts";
import { usePreCallPrompts } from "@/hooks/usePreCallPrompts";
import { useMeetingLifecycle } from "@/hooks/useMeetingLifecycle";
import { usePostCallInsights } from "@/hooks/usePostCallInsights";
import { useTranscription } from "@/hooks/useTranscription";

const backend = vi.hoisted(() => ({
  query: vi.fn(),
  mutate: vi.fn(),
  action: vi.fn(),
  mutationFor: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: backend.query,
  useMutation: backend.mutationFor,
  useAction: () => backend.action,
}));

const meetingId = "meeting-test" as Id<"meetings">;
const promptId = "prompt-test" as Id<"prompts">;

beforeEach(() => {
  backend.query.mockReset();
  backend.mutate.mockReset().mockResolvedValue({});
  backend.action.mockReset().mockResolvedValue({});
  backend.mutationFor.mockReset().mockReturnValue(backend.mutate);
});

describe("legacy hook API adapters", () => {
  it("sends note content and the current history basis in single and batch operations", async () => {
    backend.query.mockReturnValue({ content: "hello", version: 8 });
    const { result } = renderHook(() => useCollaborativeNotes(meetingId));
    const operation = { type: "insert" as const, position: 5, text: "!" };
    await act(() => result.current.applyOperation(operation));
    expect(backend.mutate).toHaveBeenLastCalledWith({
      meetingId,
      operation: {
        type: "insert",
        position: 5,
        content: "!",
        length: undefined,
      },
      clientSequence: 8,
    });
    await act(() => result.current.applyOperations([operation]));
    expect(backend.mutate).toHaveBeenLastCalledWith({
      meetingId,
      operations: [
        {
          operation: {
            type: "insert",
            position: 5,
            content: "!",
            length: undefined,
          },
          clientSequence: 8,
        },
      ],
    });
  });

  it("updates prompt unread state when prompts are marked as seen", () => {
    backend.query.mockReturnValue({ prompts: [], lastUpdated: 10 });
    const { result, rerender } = renderHook(() => useInCallPrompts(meetingId));
    expect(result.current.hasNewPrompts).toBe(true);
    act(() => result.current.markPromptsAsSeen());
    expect(result.current.hasNewPrompts).toBe(false);
    backend.query.mockReturnValue({ prompts: [], lastUpdated: 11 });
    rerender();
    expect(result.current.hasNewPrompts).toBe(true);
  });

  it("sends only the accepted feedback arguments for both prompt hooks", async () => {
    const inCall = renderHook(() => useInCallPrompts(meetingId));
    await act(() => inCall.result.current.submitFeedback(promptId, "used"));
    expect(backend.mutate).toHaveBeenLastCalledWith({
      promptId,
      feedback: "used",
    });
    const preCall = renderHook(() => usePreCallPrompts(meetingId));
    await act(() =>
      preCall.result.current.submitFeedback(promptId, "dismissed"),
    );
    expect(backend.mutate).toHaveBeenLastCalledWith({
      promptId,
      feedback: "dismissed",
    });
  });

  it("adapts stored sentiment scores for transcription consumers", () => {
    backend.query.mockReturnValue(
      [0.5, -0.3, 0, undefined].map((sentiment, index) => ({
        _id: `segment-${index}`,
        startMs: index * 100,
        endMs: (index + 1) * 100,
        text: "hello",
        speakers: ["A"],
        topics: [],
        sentiment,
      })),
    );
    const { result } = renderHook(() => useTranscription(meetingId));
    expect(result.current.segments.map((segment) => segment.sentiment)).toEqual(
      [
        { score: 0.5, label: "positive" },
        { score: -0.3, label: "negative" },
        { score: 0, label: "neutral" },
        undefined,
      ],
    );
  });
});

describe("meeting data adapters", () => {
  it("never returns another meeting's connection while a mutation is pending", async () => {
    const first = "first" as Id<"meetings">;
    const second = "second" as Id<"meetings">;
    let finishFirst!: (value: {
      videoProvider: "webrtc";
      connectionInfo: { roomId: string };
    }) => void;
    let finishSecond!: typeof finishFirst;
    const connect = vi.fn(
      ({ meetingId }: { meetingId: Id<"meetings"> }) =>
        new Promise((resolve) => {
          if (meetingId === first) finishFirst = resolve;
          else finishSecond = resolve;
        }),
    );
    backend.mutationFor.mockImplementation((reference) =>
      getFunctionName(reference).endsWith(":getMeetingConnectionInfo")
        ? connect
        : backend.mutate,
    );
    const { result, rerender } = renderHook(
      ({ id }) => {
        const lifecycle = useMeetingLifecycle();
        return lifecycle.getConnectionInfo(id);
      },
      { initialProps: { id: first } },
    );
    expect(result.current).toBeUndefined();
    await act(async () =>
      finishFirst({
        videoProvider: "webrtc",
        connectionInfo: { roomId: "first" },
      }),
    );
    expect(result.current?.connectionInfo.roomId).toBe("first");
    rerender({ id: second });
    expect(result.current).toBeUndefined();
    await act(async () =>
      finishSecond({
        videoProvider: "webrtc",
        connectionInfo: { roomId: "second" },
      }),
    );
    expect(result.current?.connectionInfo.roomId).toBe("second");
  });

  it("includes neutral scores when averaging stored sentiment", () => {
    backend.query.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name.endsWith(":getMeeting")) return { state: "concluded" };
      if (name.endsWith(":getMeetingNotes")) return null;
      return [0, 1, undefined].map((sentiment, index) => ({
        startMs: index * 100,
        endMs: (index + 1) * 100,
        text: "hello",
        speakers: ["A"],
        topics: [],
        sentiment,
      }));
    });
    const { result } = renderHook(() => usePostCallInsights(meetingId));
    expect(result.current.insights.averageSentiment).toBe(0.5);
  });
});
