import { describe, expect, it } from "vitest";
import { parseRunOutput, participantLetter } from "./convex-signaling.mjs";
import { RunContext } from "./context.mjs";
import { wiredScenarioIds } from "./run.mjs";

describe("parseRunOutput", () => {
  it("reads the object or array convex run printed, notices around it included", () => {
    expect(parseRunOutput('✔ ok\n{\n  "meetingId": "k17"\n}\n', "{")).toEqual({ meetingId: "k17" });
    expect(parseRunOutput('[\n  { "participant": "local-test-a", "reason": "left", "at": 1 }\n]', "[")).toEqual([
      { participant: "local-test-a", reason: "left", at: 1 },
    ]);
    expect(parseRunOutput("[]\n", "[")).toEqual([]);
  });

  it("fails loudly when there is no JSON", () => {
    expect(() => parseRunOutput("Error: function not found", "{")).toThrow(/printed no JSON object/);
  });
});

describe("participantLetter", () => {
  it("maps seeded test users to harness letters", () => {
    expect(participantLetter("local-test-a")).toBe("A");
    expect(participantLetter("local-test-o")).toBe("O");
  });

  it("refuses anyone else", () => {
    expect(() => participantLetter("user_01HXYZ")).toThrow(/not a seeded local test user/);
    expect(() => participantLetter("local-test-ab")).toThrow();
  });
});

describe("signaling over Convex", () => {
  it("runs only on the real page with a base URL", () => {
    expect(() => new RunContext({ signaling: "convex", page: "bench", baseUrl: "http://x" })).toThrow(/real call page/);
    expect(() => new RunContext({ signaling: "convex", page: "real", baseUrl: null })).toThrow(/real call page/);
    expect(() => new RunContext({ signaling: /** @type {any} */ ("ws") })).toThrow(/reference or convex/);
    expect(new RunContext({ signaling: "convex", page: "real", baseUrl: "http://x" }).signalingMode).toBe("convex");
  });

  it("wires H-14 in, since the backend is live", () => {
    expect(wiredScenarioIds("H")).not.toContain("H-14");
    expect(wiredScenarioIds("H", { signaling: "convex" })).toContain("H-14");
  });
});
