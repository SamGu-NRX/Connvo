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

// Type assertion helpers for compile-time validation
type AssertEqual<T, U> = T extends U ? (U extends T ? true : false) : false;
type Assert<T extends true> = T;

describe("Type-Validator Alignment", () => {
  test("User types align with validators", () => {
    // Compile-time assertions
    type UserFullAlignment = Assert<
      AssertEqual<User, Infer<typeof UserV.full>>
    >;
    type UserPublicAlignment = Assert<
      AssertEqual<UserPublic, Infer<typeof UserV.public>>
    >;

    // Runtime validation (these should not throw)
    expect(() => {
      const userValidator = UserV.full;
      const publicValidator = UserV.public;
      // If we reach here, validators are properly structured
      expect(userValidator).toBeDefined();
      expect(publicValidator).toBeDefined();
    }).not.toThrow();
  });

  test("Meeting types align with validators", () => {
    // Compile-time assertions
    type MeetingAlignment = Assert<
      AssertEqual<Meeting, Infer<typeof MeetingV.full>>
    >;
    type ParticipantAlignment = Assert<
      AssertEqual<MeetingParticipant, Infer<typeof MeetingParticipantV.full>>
    >;

    expect(() => {
      const meetingValidator = MeetingV.full;
      const participantValidator = MeetingParticipantV.full;
      expect(meetingValidator).toBeDefined();
      expect(participantValidator).toBeDefined();
    }).not.toThrow();
  });

  test("Transcript types align with validators", () => {
    // Compile-time assertions
    type TranscriptAlignment = Assert<
      AssertEqual<Transcript, Infer<typeof TranscriptV.full>>
    >;

    expect(() => {
      const transcriptValidator = TranscriptV.full;
      expect(transcriptValidator).toBeDefined();
    }).not.toThrow();
  });

  test("Pagination types work correctly", () => {
    // Test that pagination result validators work with different item types
    expect(() => {
      const { PaginationResultV } = require("../validators/common");
      const userPaginationValidator = PaginationResultV(UserV.public);
      const meetingPaginationValidator = PaginationResultV(MeetingV.listItem);

      expect(userPaginationValidator).toBeDefined();
      expect(meetingPaginationValidator).toBeDefined();
    }).not.toThrow();
  });

  test("Common validators are properly structured", () => {
    expect(() => {
      const { CommonV, ErrorV } = require("../validators/common");

      // Test common field validators
      expect(CommonV.epochMs).toBeDefined();
      expect(CommonV.nonEmptyString).toBeDefined();
      expect(CommonV.embeddingVector).toBeDefined();

      // Test error validators
      expect(ErrorV.apiError).toBeDefined();
      expect(ErrorV.validationError).toBeDefined();
    }).not.toThrow();
  });
});

// Additional compile-time type tests
describe("Compile-time Type Safety", () => {
  test("Branded types provide type safety", () => {
    // These should be compile-time only tests
    const { toEpochMs, toDurationMs, toNonEmptyString } = require("../utils");

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
    const { float32ArrayToBuffer, bufferToFloat32Array } = require("../utils");

    const originalArray = new Float32Array([1.0, 2.0, 3.0, 4.0]);
    const buffer = float32ArrayToBuffer(originalArray);
    const convertedArray = bufferToFloat32Array(buffer);

    expect(convertedArray).toEqual(originalArray);
    expect(buffer instanceof ArrayBuffer).toBe(true);
  });
});
