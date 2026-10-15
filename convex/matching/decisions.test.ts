import { describe, expect, it } from "vitest";

import {
  candidatesKeyHash,
  matcherDecisionRequest,
  rerankShortlist,
  type DecisionsPerson,
} from "./decisions";

const person: DecisionsPerson = {
  userId: "u_alice",
  summary: "Goals: find_mentor; Field: software engineering",
};
const candidates: DecisionsPerson[] = [
  { userId: "u_bob", summary: "Goals: mentor" },
  { userId: "u_carol", summary: "Goals: peers" },
];

/** A Decisions answer body for the given probabilities. */
function answerBody(
  probabilities: { value: string; probability: number }[],
  choice = probabilities[0]?.value,
) {
  return {
    answers: [
      { type: "choice", name: "best_partner", choice, probabilities },
    ],
  };
}

function okTransport(body: unknown) {
  return async () =>
    new Response(JSON.stringify(body), { status: 200 });
}

describe("rerankShortlist", () => {
  it("returns null without a key", async () => {
    const result = await rerankShortlist(person, candidates, {
      transport: okTransport(answerBody([{ value: "u_bob", probability: 1 }])),
    });
    expect(result).toBeNull();
  });

  it("returns null under two candidates", async () => {
    const result = await rerankShortlist(person, [candidates[0]], {
      key: "sk-test",
      transport: okTransport(answerBody([{ value: "u_bob", probability: 1 }])),
    });
    expect(result).toBeNull();
  });

  it("returns probabilities on a valid answer", async () => {
    const result = await rerankShortlist(person, candidates, {
      key: "sk-test",
      transport: okTransport(
        answerBody([
          { value: "u_bob", probability: 0.7 },
          { value: "u_carol", probability: 0.3 },
        ]),
      ),
    });
    expect(result?.get("u_bob")).toBe(0.7);
    expect(result?.get("u_carol")).toBe(0.3);
  });

  it("returns null on an HTTP error", async () => {
    const result = await rerankShortlist(person, candidates, {
      key: "sk-test",
      transport: async () => new Response("nope", { status: 503 }),
    });
    expect(result).toBeNull();
  });

  it("returns null on a refusal", async () => {
    const result = await rerankShortlist(person, candidates, {
      key: "sk-test",
      transport: okTransport({
        answers: [{ type: "refusal", name: "best_partner" }],
      }),
    });
    expect(result).toBeNull();
  });

  it("returns null when the choice is not an offered candidate", async () => {
    const result = await rerankShortlist(person, candidates, {
      key: "sk-test",
      transport: okTransport(
        answerBody(
          [
            { value: "u_bob", probability: 0.7 },
            { value: "u_carol", probability: 0.3 },
          ],
          "u_intruder",
        ),
      ),
    });
    expect(result).toBeNull();
  });

  it("returns null on partial probability lists", async () => {
    const result = await rerankShortlist(person, candidates, {
      key: "sk-test",
      transport: okTransport(
        answerBody([{ value: "u_bob", probability: 1.0 }]),
      ),
    });
    expect(result).toBeNull();
  });

  it("returns null when probabilities do not sum to 1", async () => {
    const result = await rerankShortlist(person, candidates, {
      key: "sk-test",
      transport: okTransport(
        answerBody([
          { value: "u_bob", probability: 0.7 },
          { value: "u_carol", probability: 0.7 },
        ]),
      ),
    });
    expect(result).toBeNull();
  });

  it("returns null on timeout", async () => {
    const result = await rerankShortlist(person, candidates, {
      key: "sk-test",
      timeoutMs: 20,
      transport: () =>
        new Promise<Response>((resolve) => {
          // Resolved long after the timeout; the race must already be done.
          setTimeout(
            () => resolve(new Response(JSON.stringify(answerBody([{ value: "u_bob", probability: 1 }])))),
            5000,
          );
        }),
    });
    expect(result).toBeNull();
  }, 10_000);

  it("does not leak the key or profile text in transport failures", async () => {
    const transport = async () => {
      throw new Error("fetch failed with key sk-test and " + JSON.stringify(candidates));
    };
    const result = await rerankShortlist(person, candidates, {
      key: "sk-test",
      transport,
    });
    expect(result).toBeNull();
  });
});

describe("matcherDecisionRequest", () => {
  it("sends one choice question over the offered candidate ids", () => {
    const request = matcherDecisionRequest(person, candidates);
    expect(request.model).toBe("gpt-6-luna");
    expect(request.questions).toHaveLength(1);
    expect(request.questions[0].type).toBe("choice");
    expect(request.questions[0].choices.map((c) => c.value)).toEqual([
      "u_bob",
      "u_carol",
    ]);
    expect(request.questions[0].instructions).toMatch(/untrusted data/);
  });
});

describe("candidatesKeyHash", () => {
  it("is stable across calls and candidate order", () => {
    const a = candidatesKeyHash(person, ["u_bob", "u_carol"]);
    const b = candidatesKeyHash(person, ["u_carol", "u_bob"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when the profile summary changes", () => {
    const a = candidatesKeyHash(person, ["u_bob", "u_carol"]);
    const b = candidatesKeyHash(
      { ...person, summary: person.summary + "; new interest" },
      ["u_bob", "u_carol"],
    );
    expect(a).not.toBe(b);
  });
});
