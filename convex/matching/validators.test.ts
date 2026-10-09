/**
 * Unit tests for matching boundary validators.
 *
 * These pin the exact error-message contract of convex/matching/validators.ts.
 * Message texts are part of the public surface of the matching module —
 * handlers, tests, and docs reference them — so every message asserted here
 * must stay stable unless the PR that changes it updates all dependents.
 */

import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import {
  MATCHING_LIMITS,
  ORG_CONSTRAINT_VALUES,
  assertIntegerInRange,
  assertNumberInRange,
  assertStringLength,
  assertValidAvailabilityWindow,
  assertValidConstraints,
  assertValidRating,
  findAvailabilityWindowViolations,
  findConstraintsViolations,
  findIntegerInRangeViolations,
  findNumberInRangeViolations,
  findStringLengthViolations,
  findRatingViolations,
} from "./validators";

const NOW = 1_700_000_000_000;
const HOURS = 60 * 60 * 1000;

function validConstraints() {
  return {
    interests: ["technology"],
    roles: ["mentor"],
  };
}

describe("findConstraintsViolations", () => {
  it("accepts a minimal valid constraint set", () => {
    expect(findConstraintsViolations(validConstraints())).toEqual([]);
  });

  it("accepts orgConstraints values the scoring engine understands", () => {
    for (const orgConstraints of ORG_CONSTRAINT_VALUES) {
      expect(
        findConstraintsViolations({ ...validConstraints(), orgConstraints }),
      ).toEqual([]);
    }
  });

  it("accepts the boundary maximum number of interests and roles", () => {
    const maxInterests = Array(MATCHING_LIMITS.MAX_INTERESTS).fill("interest");
    const maxRoles = Array(MATCHING_LIMITS.MAX_ROLES).fill("role");
    expect(
      findConstraintsViolations({ interests: maxInterests, roles: maxRoles }),
    ).toEqual([]);
  });

  it("rejects more than the maximum number of interests", () => {
    const tooMany = Array(MATCHING_LIMITS.MAX_INTERESTS + 1).fill("interest");
    expect(findConstraintsViolations({ ...validConstraints(), interests: tooMany })).toEqual([
      `constraints.interests: must contain between 1 and ${MATCHING_LIMITS.MAX_INTERESTS} interests (got ${MATCHING_LIMITS.MAX_INTERESTS + 1})`,
    ]);
  });

  it("rejects more than the maximum number of roles", () => {
    const tooMany = Array(MATCHING_LIMITS.MAX_ROLES + 1).fill("role");
    expect(findConstraintsViolations({ ...validConstraints(), roles: tooMany })).toEqual([
      `constraints.roles: must contain between 1 and ${MATCHING_LIMITS.MAX_ROLES} roles (got ${MATCHING_LIMITS.MAX_ROLES + 1})`,
    ]);
  });

  it("rejects empty interests and empty roles with specific messages", () => {
    const violations = findConstraintsViolations({
      interests: [],
      roles: [],
    });
    expect(violations).toEqual([
      `constraints.interests: must contain between 1 and ${MATCHING_LIMITS.MAX_INTERESTS} interests (got 0)`,
      `constraints.roles: must contain between 1 and ${MATCHING_LIMITS.MAX_ROLES} roles (got 0)`,
    ]);
  });

  it("rejects blank and overlong interest strings with indexed messages", () => {
    const violations = findConstraintsViolations({
      interests: ["   ", "x".repeat(MATCHING_LIMITS.MAX_INTEREST_LENGTH + 1)],
      roles: ["mentor"],
    });
    expect(violations).toEqual([
      "constraints.interests[0]: must be a non-empty string",
      `constraints.interests[1]: must be at most ${MATCHING_LIMITS.MAX_INTEREST_LENGTH} characters (got ${MATCHING_LIMITS.MAX_INTEREST_LENGTH + 1})`,
    ]);
  });

  it("rejects blank and overlong role strings with indexed messages", () => {
    const violations = findConstraintsViolations({
      interests: ["technology"],
      roles: ["", "r".repeat(MATCHING_LIMITS.MAX_ROLE_LENGTH + 1)],
    });
    expect(violations).toEqual([
      "constraints.roles[0]: must be a non-empty string",
      `constraints.roles[1]: must be at most ${MATCHING_LIMITS.MAX_ROLE_LENGTH} characters (got ${MATCHING_LIMITS.MAX_ROLE_LENGTH + 1})`,
    ]);
  });

  it("rejects unknown orgConstraints values with the full value list", () => {
    const violations = findConstraintsViolations({
      ...validConstraints(),
      orgConstraints: "same org",
    });
    expect(violations).toEqual([
      'constraints.orgConstraints: must be one of any, same_org, different_org (got "same org")',
    ]);
  });

  it("accepts an explicitly undefined orgConstraints", () => {
    expect(
      findConstraintsViolations({ ...validConstraints(), orgConstraints: undefined }),
    ).toEqual([]);
  });
});

describe("findAvailabilityWindowViolations", () => {
  it("accepts a valid forward window", () => {
    expect(
      findAvailabilityWindowViolations(NOW + 60_000, NOW + HOURS, NOW),
    ).toEqual([]);
  });

  it("keeps the legacy message for a window starting in the past", () => {
    expect(
      findAvailabilityWindowViolations(NOW - 1, NOW + HOURS, NOW),
    ).toEqual(["Availability window cannot start in the past"]);
  });

  it("keeps the legacy message when the window ends before it starts", () => {
    expect(
      findAvailabilityWindowViolations(NOW + HOURS, NOW + HOURS, NOW),
    ).toEqual(["Availability end time must be after start time"]);
  });

  it("rejects non-finite timestamps before any other check", () => {
    expect(findAvailabilityWindowViolations(NaN, NOW + HOURS, NOW)).toEqual([
      "availableFrom: must be a finite number",
    ]);
    expect(findAvailabilityWindowViolations(NOW, Infinity, NOW)).toEqual([
      "availableTo: must be a finite number",
    ]);
  });

  it("rejects windows longer than 30 days", () => {
    const violations = findAvailabilityWindowViolations(
      NOW,
      NOW + MATCHING_LIMITS.MAX_WINDOW_MS + 1,
      NOW,
    );
    expect(violations).toEqual([
      `Availability window: must be at most ${MATCHING_LIMITS.MAX_WINDOW_MS}ms (30 days)`,
    ]);
  });

  it("rejects windows starting more than 30 days in the future", () => {
    const violations = findAvailabilityWindowViolations(
      NOW + MATCHING_LIMITS.MAX_WINDOW_START_HORIZON_MS + 1,
      NOW + MATCHING_LIMITS.MAX_WINDOW_START_HORIZON_MS + HOURS,
      NOW,
    );
    expect(violations).toEqual([
      `availableFrom: must be at most ${MATCHING_LIMITS.MAX_WINDOW_START_HORIZON_MS}ms (30 days) in the future`,
    ]);
  });
});

describe("findRatingViolations", () => {
  it("accepts ratings 1 through 5 inclusive", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(findRatingViolations(rating)).toEqual([]);
    }
  });

  it("rejects ratings outside the range with the actual value", () => {
    expect(findRatingViolations(0)).toEqual([
      `${"Rating must be between 1 and 5"} (got 0)`,
    ]);
    expect(findRatingViolations(6)).toEqual([
      "Rating must be between 1 and 5 (got 6)",
    ]);
  });

  it("rejects NaN ratings — the legacy check let NaN through", () => {
    expect(findRatingViolations(Number.NaN)).toEqual([
      "Rating must be between 1 and 5 (got NaN)",
    ]);
  });

  it("rejects infinite ratings", () => {
    expect(findRatingViolations(Number.POSITIVE_INFINITY)).toEqual([
      "Rating must be between 1 and 5 (got Infinity)",
    ]);
  });
});

describe("findIntegerInRangeViolations", () => {
  it("accepts integers inside the range including the boundaries", () => {
    expect(
      findIntegerInRangeViolations("shardCount", 1, { min: 1, max: 64 }),
    ).toEqual([]);
    expect(
      findIntegerInRangeViolations("shardCount", 64, { min: 1, max: 64 }),
    ).toEqual([]);
  });

  it("rejects non-integers and out-of-range values with the actual value", () => {
    expect(
      findIntegerInRangeViolations("shardCount", 0, { min: 1, max: 64 }),
    ).toEqual(["shardCount: must be an integer between 1 and 64 (got 0)"]);
    expect(
      findIntegerInRangeViolations("shardCount", 1.5, { min: 1, max: 64 }),
    ).toEqual(["shardCount: must be an integer between 1 and 64 (got 1.5)"]);
    expect(
      findIntegerInRangeViolations("shardCount", Number.NaN, { min: 1, max: 64 }),
    ).toEqual(["shardCount: must be an integer between 1 and 64 (got NaN)"]);
  });
});

describe("findNumberInRangeViolations", () => {
  it("accepts numbers inside the range including the boundaries", () => {
    expect(findNumberInRangeViolations("minScore", 0, { min: 0, max: 1 })).toEqual([]);
    expect(findNumberInRangeViolations("minScore", 1, { min: 0, max: 1 })).toEqual([]);
    expect(findNumberInRangeViolations("minScore", 0.5, { min: 0, max: 1 })).toEqual([]);
  });

  it("rejects out-of-range and non-finite numbers with the actual value", () => {
    expect(
      findNumberInRangeViolations("minScore", -0.1, { min: 0, max: 1 }),
    ).toEqual(["minScore: must be a number between 0 and 1 (got -0.1)"]);
    expect(
      findNumberInRangeViolations("minScore", Number.POSITIVE_INFINITY, {
        min: 0,
        max: 1,
      }),
    ).toEqual(["minScore: must be a number between 0 and 1 (got Infinity)"]);
  });
});

describe("findStringLengthViolations", () => {
  it("accepts undefined and strings at the boundary length", () => {
    expect(findStringLengthViolations("comments", undefined, 2000)).toEqual([]);
    expect(
      findStringLengthViolations("comments", "c".repeat(2000), 2000),
    ).toEqual([]);
  });

  it("rejects overlong strings with the actual length", () => {
    expect(
      findStringLengthViolations("matchId", "m".repeat(257), 256),
    ).toEqual(["matchId: must be a string of at most 256 characters (got 257)"]);
  });
});

describe("assert* wrappers", () => {
  function expectValidationConvexError(fn: () => unknown): {
    code: string;
    message: string;
  } {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(ConvexError);
      const data = (error as ConvexError<{ code: string; message: string }>).data;
      return data;
    }
    throw new Error("expected function to throw");
  }

  it("throws ConvexError with code VALIDATION_ERROR and the exact violation message", () => {
    const data = expectValidationConvexError(() =>
      assertValidConstraints({ interests: [], roles: [] }),
    );
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(data.message).toBe(
      `constraints.interests: must contain between 1 and ${MATCHING_LIMITS.MAX_INTERESTS} interests (got 0); constraints.roles: must contain between 1 and ${MATCHING_LIMITS.MAX_ROLES} roles (got 0)`,
    );
  });

  it("assertValidAvailabilityWindow throws the legacy message for past windows", () => {
    const data = expectValidationConvexError(() =>
      assertValidAvailabilityWindow(NOW - 1, NOW + HOURS, NOW),
    );
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(data.message).toBe("Availability window cannot start in the past");
  });

  it("assertValidRating throws for NaN ratings", () => {
    const data = expectValidationConvexError(() => assertValidRating(Number.NaN));
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(data.message).toBe("Rating must be between 1 and 5 (got NaN)");
  });

  it("assertIntegerInRange throws with the argument name", () => {
    const data = expectValidationConvexError(() =>
      assertIntegerInRange("limit", 0, { min: 1, max: MATCHING_LIMITS.MAX_LIMIT }),
    );
    expect(data.message).toBe(
      `limit: must be an integer between 1 and ${MATCHING_LIMITS.MAX_LIMIT} (got 0)`,
    );
  });

  it("assertNumberInRange throws with the argument name", () => {
    const data = expectValidationConvexError(() =>
      assertNumberInRange("minScore", 2, { min: 0, max: 1 }),
    );
    expect(data.message).toBe("minScore: must be a number between 0 and 1 (got 2)");
  });

  it("assertStringLength throws for overlong strings", () => {
    const data = expectValidationConvexError(() =>
      assertStringLength("matchId", "m".repeat(257), MATCHING_LIMITS.MAX_MATCH_ID_LENGTH),
    );
    expect(data.message).toBe(
      `matchId: must be a string of at most ${MATCHING_LIMITS.MAX_MATCH_ID_LENGTH} characters (got 257)`,
    );
  });

  it("does not throw for valid input", () => {
    expect(() => assertValidConstraints(validConstraints())).not.toThrow();
    expect(() =>
      assertValidAvailabilityWindow(NOW + 60_000, NOW + HOURS, NOW),
    ).not.toThrow();
    expect(() => assertValidRating(3)).not.toThrow();
    expect(() =>
      assertIntegerInRange("limit", 1, { min: 1, max: MATCHING_LIMITS.MAX_LIMIT }),
    ).not.toThrow();
    expect(() =>
      assertNumberInRange("minScore", 0.5, { min: 0, max: 1 }),
    ).not.toThrow();
    expect(() => assertStringLength("comments", undefined, 2000)).not.toThrow();
  });
});
