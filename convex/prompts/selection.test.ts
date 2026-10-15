import { describe, expect, it, vi } from "vitest";
import {
  candidatesFor,
  decisionRequest,
  selectPrompt,
  stageFor,
  type PromptContext,
} from "./selection";
import { PROMPT_BANK } from "./bank";

const context: PromptContext = {
  participants: [
    { interests: ["music"], role: "Designer" },
    { interests: ["music"], role: "Student" },
  ],
  elapsedSeconds: 0,
  durationSeconds: 1800,
  shown: [],
  notes: "We both play guitar.",
};

describe("live prompt selection", () => {
  it("has unique, tagged prompts in every stage", () => {
    expect(PROMPT_BANK.length).toBeGreaterThanOrEqual(60);
    expect(PROMPT_BANK.length).toBeLessThanOrEqual(120);
    expect(new Set(PROMPT_BANK.map((p) => p.id)).size).toBe(PROMPT_BANK.length);
    expect(new Set(PROMPT_BANK.map((p) => p.content)).size).toBe(
      PROMPT_BANK.length,
    );
    expect(PROMPT_BANK.every((p) => p.tags.length > 0)).toBe(true);
    expect(new Set(PROMPT_BANK.map((p) => p.stage)).size).toBe(5);
  });
  it("ranks overlapping interests within the stage and excludes shown questions", () => {
    expect(candidatesFor(context)[0].id).toBe("opener-repeat-song");
    expect(
      candidatesFor({ ...context, shown: ["opener-repeat-song"] }).map(
        (p) => p.id,
      ),
    ).not.toContain("opener-repeat-song");
    expect(candidatesFor(context)).toHaveLength(6);
    expect(candidatesFor(context).every((p) => p.stage === "opener")).toBe(
      true,
    );
  });
  it.each([
    [0, "opener"],
    [180, "shared-interest"],
    [800, "career"],
    [1300, "going-deeper"],
    [1700, "wrap-up"],
  ])("paces %s seconds as %s", (elapsed, stage) => {
    expect(stageFor(Number(elapsed), 1800)).toBe(stage);
  });
  it("sends both profiles, elapsed time, shown questions and the latest notes", () => {
    const input = JSON.parse(
      decisionRequest(
        { ...context, shown: ["opener-repeat-song"] },
        candidatesFor(context),
      ).input,
    );
    expect(input).toEqual({
      participants: context.participants,
      elapsedSeconds: 0,
      promptsAlreadyShown: ["Is there a song you've had on repeat lately?"],
      sharedNotes: "We both play guitar.",
    });
  });
  it("matches the answer by name and uses probabilities instead of blindly using choice", async () => {
    const candidates = candidatesFor(context);
    const transport = vi.fn(async () =>
      Response.json({
        answers: [
          { type: "refusal", name: "unrelated" },
          {
            type: "choice",
            name: "next_prompt",
            choice: candidates[0].id,
            probabilities: candidates.map((p, i) => ({
              value: p.id,
              probability: i === 2 ? 0.75 : 0.05,
            })),
          },
        ],
      }),
    );
    const result = await selectPrompt(context, {
      key: "unit-test-only",
      transport,
    });
    expect(result).toEqual({
      prompt: candidates[2],
      source: "decisions",
      probability: 0.75,
    });
  });
  it("uses the bank without issuing a request when no key exists", async () => {
    const transport = vi.fn();
    expect((await selectPrompt(context, { transport }))?.prompt.id).toBe(
      "opener-repeat-song",
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([429, 500])("falls back on HTTP %s", async (status) => {
    const result = await selectPrompt(context, {
      key: "unit-test-only",
      transport: async () => new Response("", { status }),
    });
    expect(result?.prompt.id).toBe("opener-repeat-song");
    expect(result?.source).toBe("bank");
  });
  it.each([
    { answers: [{ type: "refusal", name: "next_prompt" }] },
    { answers: [] },
    {
      answers: [
        {
          type: "choice",
          name: "next_prompt",
          choice: "invented",
          probabilities: [],
        },
      ],
    },
    {
      answers: [
        {
          type: "choice",
          name: "next_prompt",
          choice: "opener-repeat-song",
          probabilities: [{ value: "opener-repeat-song", probability: 1 }],
        },
      ],
    },
  ])("falls back on refusal or an invalid answer", async (response) => {
    const result = await selectPrompt(context, {
      key: "unit-test-only",
      transport: async () => Response.json(response),
    });
    expect(result?.prompt.id).toBe("opener-repeat-song");
    expect(result?.source).toBe("bank");
  });
  it("falls back on timeout even if the transport ignores abort", async () => {
    const result = await selectPrompt(context, {
      key: "unit-test-only",
      timeoutMs: 5,
      transport: () => new Promise(() => {}),
    });
    expect(result?.prompt.id).toBe("opener-repeat-song");
    expect(result?.source).toBe("bank");
  });
  it("falls back on a network rejection or malformed JSON", async () => {
    for (const transport of [
      async () => {
        throw new Error("offline");
      },
      async () => new Response("not json"),
    ]) {
      expect(
        (await selectPrompt(context, { key: "unit-test-only", transport }))
          ?.prompt.id,
      ).toBe("opener-repeat-song");
    }
  });
});
