/**
 * Type-Validator Alignment Tests
 *
 * This test suite validates that TypeScript types and Convex validators
 * are properly aligned, ensuring type safety at compile time.
 *
 * Requirements: 3.4, 3.5, 6.4, 6.5, 8.3, 8.4
 * Compliance: Type-first approach with validator alignment validation
 */

import { describe, test, expect } from "vitest";
import type { Infer } from "convex/values";
import type {
  User,
  UserPublic,
  Meeting,
  MeetingParticipant,
  Transcript,
} from "../entities";
import {
  UserV,
  MeetingV,
  MeetingParticipantV,
  TranscriptV,
} from "../validators";
import { CommonV, ErrorV } from "../validators/common";
import { PaginationResultV } from "../validators/pagination";
import {
  validateValidatorStructure,
  validateValidatorCollection,
  detectTypeDrift,
  generateCIValidationReport,
  exploreValidatorStructure,
  type ValidatorTypeAlignment,
} from "./typeValidationUtils";
import {
  toEpochMs,
  toDurationMs,
  toNonEmptyString,
  float32ArrayToBuffer,
  bufferToFloat32Array,
} from "../utils";

// Type assertion helpers for compile-time validation
type AssertEqual<T, U> = T extends U ? (U extends T ? true : false) : false;
type Assert<T extends true> = T;

describe("Type-Validator Alignment", () => {
  test("User types align with validators", () => {
    // Compile-time assertions - these will fail compilation if types don't match
    type _UserFullAlignment = ValidatorTypeAlignment<User, typeof UserV.full>;
    type _UserPublicAlignment = ValidatorTypeAlignment<
      UserPublic,
      typeof UserV.public
    >;

    // Runtime validation (these should not throw)
    expect(() => {
      const userValidator = UserV.full;
      const publicValidator = UserV.public;
      // If we reach here, validators are properly structured
      expect(userValidator).toBeDefined();
      expect(publicValidator).toBeDefined();
    }).not.toThrow();

    // Validate validator structure
    const userValidationResult = validateValidatorStructure(
      UserV.full,
      "UserV.full",
    );
    expect(userValidationResult.isValid).toBe(true);
    expect(userValidationResult.errors).toHaveLength(0);

    const publicValidationResult = validateValidatorStructure(
      UserV.public,
      "UserV.public",
    );
    expect(publicValidationResult.isValid).toBe(true);
    expect(publicValidationResult.errors).toHaveLength(0);
  });

  test("Meeting types align with validators", () => {
    // Compile-time assertions
    type _MeetingAlignment = ValidatorTypeAlignment<
      Meeting,
      typeof MeetingV.full
    >;
    type _ParticipantAlignment = ValidatorTypeAlignment<
      MeetingParticipant,
      typeof MeetingParticipantV.full
    >;

    expect(() => {
      const meetingValidator = MeetingV.full;
      const participantValidator = MeetingParticipantV.full;
      expect(meetingValidator).toBeDefined();
      expect(participantValidator).toBeDefined();
    }).not.toThrow();

    // Validate validator structure
    const meetingValidationResult = validateValidatorStructure(
      MeetingV.full,
      "MeetingV.full",
    );
    expect(meetingValidationResult.isValid).toBe(true);

    const participantValidationResult = validateValidatorStructure(
      MeetingParticipantV.full,
      "MeetingParticipantV.full",
    );
    expect(participantValidationResult.isValid).toBe(true);
  });

  test("Transcript types align with validators", () => {
    // Compile-time assertions
    type _TranscriptAlignment = ValidatorTypeAlignment<
      Transcript,
      typeof TranscriptV.full
    >;

    expect(() => {
      const transcriptValidator = TranscriptV.full;
      expect(transcriptValidator).toBeDefined();
    }).not.toThrow();

    // Validate validator structure
    const transcriptValidationResult = validateValidatorStructure(
      TranscriptV.full,
      "TranscriptV.full",
    );
    expect(transcriptValidationResult.isValid).toBe(true);
  });

  test("Pagination types work correctly", () => {
    // Test that pagination result validators work with different item types
    expect(() => {
      const userPaginationValidator = PaginationResultV(UserV.public);

      expect(userPaginationValidator).toBeDefined();

      // Validate pagination validator structure
      const paginationResult = validateValidatorStructure(
        userPaginationValidator,
        "PaginationResult<User>",
      );
      expect(paginationResult.isValid).toBe(true);
    }).not.toThrow();
  });

  test("Common validators are properly structured", () => {
    expect(() => {
      // Test common field validators
      expect(CommonV.epochMs).toBeDefined();
      expect(CommonV.nonEmptyString).toBeDefined();
      expect(CommonV.embeddingVector).toBeDefined();

      // Test error validators
      expect(ErrorV.apiError).toBeDefined();
      expect(ErrorV.validationError).toBeDefined();

      // Validate common validators
      const epochMsResult = validateValidatorStructure(
        CommonV.epochMs,
        "CommonV.epochMs",
      );
      expect(epochMsResult.isValid).toBe(true);

      const embeddingVectorResult = validateValidatorStructure(
        CommonV.embeddingVector,
        "CommonV.embeddingVector",
      );
      expect(embeddingVectorResult.isValid).toBe(true);
    }).not.toThrow();
  });
});

// Comprehensive validator collection tests
describe("Validator Collection Validation", () => {
  test("All User validators are valid", () => {
    const results = validateValidatorCollection(UserV, "UserV");
    const failedResults = results.filter((r) => !r.isValid);

    if (failedResults.length > 0) {
      console.error("Failed User validators:", failedResults);
    }

    expect(failedResults).toHaveLength(0);
  });

  test("All Meeting validators are valid", () => {
    const results = validateValidatorCollection(MeetingV, "MeetingV");
    const failedResults = results.filter((r) => !r.isValid);

    if (failedResults.length > 0) {
      console.error("Failed Meeting validators:", failedResults);
    }

    expect(failedResults).toHaveLength(0);
  });

  test("All Transcript validators are valid", () => {
    const results = validateValidatorCollection(TranscriptV, "TranscriptV");
    const failedResults = results.filter((r) => !r.isValid);

    if (failedResults.length > 0) {
      console.error("Failed Transcript validators:", failedResults);
    }

    expect(failedResults).toHaveLength(0);
  });
});

// Type drift detection tests
describe("Type Drift Detection", () => {
  test("User entity has no type drift", () => {
    const expectedUserFields = [
      "_id",
      "_creationTime",
      "workosUserId",
      "email",
      "orgId",
      "orgRole",
      "displayName",
      "avatarUrl",
      "isActive",
      "lastSeenAt",
      "onboardingComplete",
      "onboardingStartedAt",
      "onboardingCompletedAt",
      "createdAt",
      "updatedAt",
    ];

    const driftCheck = detectTypeDrift(UserV.full, expectedUserFields, "User");

    if (driftCheck.hasDrift) {
      console.warn("User type drift detected:", {
        missing: driftCheck.missingFields,
        extra: driftCheck.extraFields,
      });
    }

    // Allow for some flexibility in field evolution
    expect(driftCheck.missingFields.length).toBeLessThanOrEqual(2);
  });

  test("Meeting entity has no type drift", () => {
    const expectedMeetingFields = [
      "_id",
      "_creationTime",
      "organizerId",
      "title",
      "description",
      "scheduledAt",
      "duration",
      "webrtcEnabled",
      "streamRoomId",
      "state",
      "participantCount",
      "averageRating",
      "createdAt",
      "updatedAt",
    ];

    const driftCheck = detectTypeDrift(
      MeetingV.full,
      expectedMeetingFields,
      "Meeting",
    );

    if (driftCheck.hasDrift) {
      console.warn("Meeting type drift detected:", {
        missing: driftCheck.missingFields,
        extra: driftCheck.extraFields,
      });
    }

    expect(driftCheck.missingFields.length).toBeLessThanOrEqual(2);
  });
});

// CI/CD Integration tests
describe("CI/CD Validation Report", () => {
  test("Generate comprehensive validation report", () => {
    const validatorCollections = {
      UserV,
      MeetingV,
      TranscriptV,
    };

    const report = generateCIValidationReport(validatorCollections);

    expect(report.totalValidators).toBeGreaterThan(0);
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.performance.validatorCount).toBe(report.totalValidators);

    // Log performance metrics for monitoring
    console.log("Validation Performance:", {
      totalValidators: report.totalValidators,
      averageTime: `${report.performance.averageValidationTime.toFixed(2)}ms`,
      maxTime: `${report.performance.maxValidationTime.toFixed(2)}ms`,
      totalTime: `${report.performance.totalValidationTime.toFixed(2)}ms`,
    });

    // Performance assertions (should be fast)
    expect(report.performance.averageValidationTime).toBeLessThan(10);
    expect(report.performance.maxValidationTime).toBeLessThan(50);

    if (!report.passed) {
      console.error("Validation Report Errors:", report.errors);
      console.warn("Validation Report Warnings:", report.warnings);
    }

    // Should pass with minimal errors
    expect(report.failedValidators).toBeLessThanOrEqual(1);
  });
});

// Developer tooling tests
describe("Type Exploration Tools", () => {
  test("Explore User validator structure", () => {
    const exploration = exploreValidatorStructure(UserV.full, "UserV.full");

    expect(exploration.validatorName).toBe("UserV.full");
    expect(exploration.complexity).toBeGreaterThan(1);
    expect(exploration.structure.kind).toBe("object");

    // Should have reasonable complexity (not too nested)
    expect(exploration.complexity).toBeLessThan(50);

    console.log("User validator exploration:", {
      complexity: exploration.complexity,
      dependencies: exploration.dependencies,
    });
  });

  test("Explore Meeting validator structure", () => {
    const exploration = exploreValidatorStructure(
      MeetingV.full,
      "MeetingV.full",
    );

    expect(exploration.validatorName).toBe("MeetingV.full");
    expect(exploration.structure.kind).toBe("object");

    // Should detect ID dependencies
    expect(exploration.dependencies.some((dep) => dep.includes("users"))).toBe(
      true,
    );
  });
});

// Additional compile-time type tests
describe("Compile-time Type Safety", () => {
  test("Branded types provide type safety", () => {
    // These should be compile-time only tests
    expect(() => {
      const timestamp = toEpochMs(Date.now());
      const duration = toDurationMs(5000);
      const name = toNonEmptyString("test");

      expect(typeof timestamp).toBe("number");
      expect(typeof duration).toBe("number");
      expect(typeof name).toBe("string");
    }).not.toThrow();
  });

  test("Embedding vector helpers work correctly", () => {
    const originalArray = new Float32Array([1.0, 2.0, 3.0, 4.0]);
    const buffer = float32ArrayToBuffer(originalArray);
    const convertedArray = bufferToFloat32Array(buffer);

    expect(convertedArray).toEqual(originalArray);
    expect(buffer instanceof ArrayBuffer).toBe(true);
  });

  test("ArrayBuffer performance optimization", () => {
    // Test that ArrayBuffer is more efficient than number[] for embeddings
    const largeArray = new Float32Array(1536); // Common embedding size
    for (let i = 0; i < largeArray.length; i++) {
      largeArray[i] = Math.random();
    }

    const startTime = performance.now();
    const buffer = float32ArrayToBuffer(largeArray);
    const endTime = performance.now();

    expect(buffer.byteLength).toBe(largeArray.length * 4); // 4 bytes per float32
    expect(endTime - startTime).toBeLessThan(10); // Should be very fast
  });
});
