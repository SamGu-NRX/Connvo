/**
 * Strict boundary validation for the matching module.
 *
 * Convex validators (`v.*`) pin the *shape* of function arguments, but the
 * validator DSL cannot express numeric ranges, string lengths, array sizes,
 * or finiteness (NaN/Infinity). This module adds those domain checks as pure
 * functions with specific, stable error messages, so invalid input fails
 * loudly at the boundary instead of corrupting state deep inside the engine.
 *
 * Contract:
 * - `find*Violations` helpers are pure: they return a list of specific
 *   violation messages and never throw.
 * - `assert*` helpers throw a `ConvexError` with `code: VALIDATION_ERROR`
 *   (via `createError.validation`) whose message is exactly the first
 *   violation joined with "; " when several apply.
 * - Error message texts are part of this module's public contract and are
 *   pinned by validators.test.ts. Messages that callers and tests already
 *   depend on are preserved verbatim:
 *   - "Rating must be between 1 and 5"
 *   - "Availability window cannot start in the past"
 *   - "Availability end time must be after start time"
 */

import { v } from "convex/values";
import { createError } from "@convex/lib/errors";

/** Hard limits for matching module inputs (pinned by validators.test.ts). */
export const MATCHING_LIMITS = {
  /** Max items accepted in constraints.interests. */
  MAX_INTERESTS: 20,
  /** Max items accepted in constraints.roles. */
  MAX_ROLES: 10,
  /** Max characters per interest string. */
  MAX_INTEREST_LENGTH: 64,
  /** Max characters per role string. */
  MAX_ROLE_LENGTH: 32,
  /** Max characters for constraints.orgConstraints. */
  MAX_ORG_CONSTRAINT_LENGTH: 32,
  /** Longest availability window accepted, in ms (30 days). */
  MAX_WINDOW_MS: 30 * 24 * 60 * 60 * 1000,
  /** How far in the future a window may start, in ms (30 days). */
  MAX_WINDOW_START_HORIZON_MS: 30 * 24 * 60 * 60 * 1000,
  /** Max characters for a matchId. */
  MAX_MATCH_ID_LENGTH: 256,
  /** Max characters for feedback comments. */
  MAX_COMMENTS_LENGTH: 2000,
  /** Feedback rating bounds (inclusive). */
  MIN_RATING: 1,
  MAX_RATING: 5,
  /** Matching cycle shard bounds. */
  MIN_SHARD_COUNT: 1,
  MAX_SHARD_COUNT: 64,
  /** Score threshold bounds (inclusive). */
  MIN_SCORE: 0,
  MAX_SCORE: 1,
  /** Global cap for result-set sizes. */
  MAX_LIMIT: 1000,
  /** Optimization sample-size bounds. */
  MIN_MIN_SAMPLES: 1,
  MAX_MIN_SAMPLES: 1000,
  /** getGlobalMatchingAnalytics time-range cap, ms (366 days). */
  MAX_TIME_RANGE_MS: 366 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Values the scoring engine understands for `constraints.orgConstraints`.
 * Anything else silently scores as neutral, so it is rejected at the
 * boundary instead of being accepted and ignored.
 */
export const ORG_CONSTRAINT_VALUES = [
  "any",
  "same_org",
  "different_org",
] as const;

export type OrgConstraintValue = (typeof ORG_CONSTRAINT_VALUES)[number];

/** Matching constraint object as accepted at the API boundary. */
export interface MatchingConstraintsInput {
  interests: string[];
  roles: string[];
  orgConstraints?: string;
}

/** Shape validator for constraints (bounds are enforced by the assert helpers). */
export const strictConstraintsV = v.object({
  interests: v.array(v.string()),
  roles: v.array(v.string()),
  orgConstraints: v.optional(v.string()),
});

/**
 * Returns every violation of the constraints contract, or an empty list.
 * Pure: never throws.
 */
export function findConstraintsViolations(
  constraints: MatchingConstraintsInput,
): string[] {
  const violations: string[] = [];
  const { interests, roles, orgConstraints } = constraints;

  if (
    interests.length < 1 ||
    interests.length > MATCHING_LIMITS.MAX_INTERESTS
  ) {
    violations.push(
      `constraints.interests: must contain between 1 and ${MATCHING_LIMITS.MAX_INTERESTS} interests (got ${interests.length})`,
    );
  }
  interests.forEach((interest, i) => {
    if (typeof interest !== "string" || interest.trim().length === 0) {
      violations.push(`constraints.interests[${i}]: must be a non-empty string`);
    } else if (interest.length > MATCHING_LIMITS.MAX_INTEREST_LENGTH) {
      violations.push(
        `constraints.interests[${i}]: must be at most ${MATCHING_LIMITS.MAX_INTEREST_LENGTH} characters (got ${interest.length})`,
      );
    }
  });

  if (roles.length < 1 || roles.length > MATCHING_LIMITS.MAX_ROLES) {
    violations.push(
      `constraints.roles: must contain between 1 and ${MATCHING_LIMITS.MAX_ROLES} roles (got ${roles.length})`,
    );
  }
  roles.forEach((role, i) => {
    if (typeof role !== "string" || role.trim().length === 0) {
      violations.push(`constraints.roles[${i}]: must be a non-empty string`);
    } else if (role.length > MATCHING_LIMITS.MAX_ROLE_LENGTH) {
      violations.push(
        `constraints.roles[${i}]: must be at most ${MATCHING_LIMITS.MAX_ROLE_LENGTH} characters (got ${role.length})`,
      );
    }
  });

  if (orgConstraints !== undefined) {
    if (typeof orgConstraints !== "string") {
      violations.push(
        "constraints.orgConstraints: must be one of any, same_org, different_org",
      );
    } else if (
      !(ORG_CONSTRAINT_VALUES as readonly string[]).includes(orgConstraints)
    ) {
      violations.push(
        `constraints.orgConstraints: must be one of any, same_org, different_org (got "${orgConstraints}")`,
      );
    } else if (
      orgConstraints.length > MATCHING_LIMITS.MAX_ORG_CONSTRAINT_LENGTH
    ) {
      violations.push(
        `constraints.orgConstraints: must be at most ${MATCHING_LIMITS.MAX_ORG_CONSTRAINT_LENGTH} characters (got ${orgConstraints.length})`,
      );
    }
  }

  return violations;
}

/**
 * Returns every violation of the availability-window contract, or an empty
 * list. Pure: never throws. Legacy message texts are preserved verbatim.
 */
export function findAvailabilityWindowViolations(
  availableFrom: number,
  availableTo: number,
  now: number = Date.now(),
): string[] {
  const violations: string[] = [];

  if (!Number.isFinite(availableFrom)) {
    violations.push("availableFrom: must be a finite number");
  }
  if (!Number.isFinite(availableTo)) {
    violations.push("availableTo: must be a finite number");
  }
  if (violations.length > 0) {
    return violations;
  }

  if (availableFrom < now) {
    violations.push("Availability window cannot start in the past");
  }
  if (availableTo <= availableFrom) {
    violations.push("Availability end time must be after start time");
  }
  if (availableTo - availableFrom > MATCHING_LIMITS.MAX_WINDOW_MS) {
    violations.push(
      `Availability window: must be at most ${MATCHING_LIMITS.MAX_WINDOW_MS}ms (30 days)`,
    );
  }
  if (availableFrom - now > MATCHING_LIMITS.MAX_WINDOW_START_HORIZON_MS) {
    violations.push(
      `availableFrom: must be at most ${MATCHING_LIMITS.MAX_WINDOW_START_HORIZON_MS}ms (30 days) in the future`,
    );
  }

  return violations;
}

/**
 * Returns the violation for an out-of-range or non-finite rating, or an
 * empty list. Pure: never throws. NaN ratings are rejected (previously NaN
 * passed the range check because both comparisons are false for NaN).
 */
export function findRatingViolations(rating: number): string[] {
  if (
    !Number.isFinite(rating) ||
    rating < MATCHING_LIMITS.MIN_RATING ||
    rating > MATCHING_LIMITS.MAX_RATING
  ) {
    return [
      `Rating must be between ${MATCHING_LIMITS.MIN_RATING} and ${MATCHING_LIMITS.MAX_RATING} (got ${rating})`,
    ];
  }
  return [];
}

/**
 * Returns the violation when a numeric argument is not a finite integer in
 * [min, max], or an empty list. Pure: never throws.
 */
export function findIntegerInRangeViolations(
  name: string,
  value: number,
  options: { min: number; max: number },
): string[] {
  const { min, max } = options;
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return [
      `${name}: must be an integer between ${min} and ${max} (got ${value})`,
    ];
  }
  return [];
}

/**
 * Returns the violation when a numeric argument is not a finite number in
 * [min, max], or an empty list. Pure: never throws.
 */
export function findNumberInRangeViolations(
  name: string,
  value: number,
  options: { min: number; max: number },
): string[] {
  const { min, max } = options;
  if (!Number.isFinite(value) || value < min || value > max) {
    return [
      `${name}: must be a number between ${min} and ${max} (got ${value})`,
    ];
  }
  return [];
}

/**
 * Returns the violation when an optional string exceeds the max length, or
 * an empty list. Pure: never throws.
 */
export function findStringLengthViolations(
  name: string,
  value: string | undefined,
  max: number,
): string[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value !== "string" || value.length > max) {
    return [
      `${name}: must be a string of at most ${max} characters (got ${
        typeof value === "string" ? value.length : typeof value
      })`,
    ];
  }
  return [];
}

function throwFirst(violations: string[]): void {
  if (violations.length > 0) {
    throw createError.validation(violations.join("; "));
  }
}

/** Throws a VALIDATION_ERROR ConvexError if constraints violate their contract. */
export function assertValidConstraints(
  constraints: MatchingConstraintsInput,
): void {
  throwFirst(findConstraintsViolations(constraints));
}

/** Throws a VALIDATION_ERROR ConvexError if the availability window is invalid. */
export function assertValidAvailabilityWindow(
  availableFrom: number,
  availableTo: number,
  now: number = Date.now(),
): void {
  throwFirst(findAvailabilityWindowViolations(availableFrom, availableTo, now));
}

/** Throws a VALIDATION_ERROR ConvexError if the rating is out of range or NaN. */
export function assertValidRating(rating: number): void {
  throwFirst(findRatingViolations(rating));
}

/** Throws a VALIDATION_ERROR ConvexError unless value is an integer in [min, max]. */
export function assertIntegerInRange(
  name: string,
  value: number,
  options: { min: number; max: number },
): void {
  throwFirst(findIntegerInRangeViolations(name, value, options));
}

/** Throws a VALIDATION_ERROR ConvexError unless value is a finite number in [min, max]. */
export function assertNumberInRange(
  name: string,
  value: number,
  options: { min: number; max: number },
): void {
  throwFirst(findNumberInRangeViolations(name, value, options));
}

/** Throws a VALIDATION_ERROR ConvexError if the optional string exceeds max length. */
export function assertStringLength(
  name: string,
  value: string | undefined,
  max: number,
): void {
  throwFirst(findStringLengthViolations(name, value, max));
}
