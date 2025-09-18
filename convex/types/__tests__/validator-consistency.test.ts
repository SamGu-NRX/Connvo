/**
 * Validator Consistency Tests
 *
 * This test suite validates that centralized validators are properly structured
 * and can be used consistently across Convex functions.
 *
 * Requirements: 3.1, 3.2, 3.3, 4.3, 4.4, 6.1, 6.2, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 * Compliance: steering/convex_rules.mdc - All functions must have args and returns validators
 */

import { describe, test, expect } from "vitest";
import { validateValidatorStructure } from "./type-validation-utils";
import { UserV, MeetingV, TranscriptV } from "../validators";
import { PaginationResultV } from "../validators/pagination";
import { CommonV } from "../validators/common";

describe("Validator Consistency for Function Usage", () => {
  describe("User Validators", () => {
    test("UserV.full can be used as function return validator", () => {
      const result = validateValidatorStructure(UserV.full, "UserV.full");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("UserV.public can be used as function return validator", () => {
      const result = validateValidatorStructure(UserV.public, "UserV.public");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("UserV validators have consistent structure", () => {
      const validators = Object.entries(UserV);

      for (const [name, validator] of validators) {
        const result = validateValidatorStructure(validator, `UserV.${name}`);
        expect(result.isValid).toBe(true);
        expect(result.typeName).toBe("object");
      }
    });
  });

  describe("Meeting Validators", () => {
    test("MeetingV.full can be used as function return validator", () => {
      const result = validateValidatorStructure(MeetingV.full, "MeetingV.full");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("MeetingV validators have consistent structure", () => {
      const validators = Object.entries(MeetingV);

      for (const [name, validator] of validators) {
        const result = validateValidatorStructure(
          validator,
          `MeetingV.${name}`,
        );
        expect(result.isValid).toBe(true);
        expect(result.typeName).toBe("object");
      }
    });
  });

  describe("Transcript Validators", () => {
    test("TranscriptV.full can be used as function return validator", () => {
      const result = validateValidatorStructure(
        TranscriptV.full,
        "TranscriptV.full",
      );
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("TranscriptV validators have consistent structure", () => {
      const validators = Object.entries(TranscriptV);

      for (const [name, validator] of validators) {
        const result = validateValidatorStructure(
          validator,
          `TranscriptV.${name}`,
        );
        expect(result.isValid).toBe(true);
        expect(result.typeName).toBe("object");
      }
    });
  });

  describe("Pagination Validators", () => {
    test("PaginationResultV creates valid validators", () => {
      const userPaginationValidator = PaginationResultV(UserV.public);
      const result = validateValidatorStructure(
        userPaginationValidator,
        "PaginationResult<User>",
      );

      expect(result.isValid).toBe(true);
      expect(result.typeName).toBe("object");
    });

    test("PaginationResultV works with different item types", () => {
      const validators = [
        { name: "User", validator: PaginationResultV(UserV.public) },
        { name: "Meeting", validator: PaginationResultV(MeetingV.full) },
        { name: "Transcript", validator: PaginationResultV(TranscriptV.full) },
      ];

      for (const { name, validator } of validators) {
        const result = validateValidatorStructure(
          validator,
          `PaginationResult<${name}>`,
        );
        expect(result.isValid).toBe(true);
        expect(result.typeName).toBe("object");
      }
    });
  });

  describe("Common Validators", () => {
    test("CommonV validators are properly structured", () => {
      const commonValidators = [
        { name: "epochMs", validator: CommonV.epochMs },
        { name: "nonEmptyString", validator: CommonV.nonEmptyString },
        { name: "positiveNumber", validator: CommonV.positiveNumber },
        { name: "stringArray", validator: CommonV.stringArray },
      ];

      for (const { name, validator } of commonValidators) {
        const result = validateValidatorStructure(validator, `CommonV.${name}`);
        expect(result.isValid).toBe(true);
      }
    });

    test("CommonV.embeddingVector uses ArrayBuffer", () => {
      const result = validateValidatorStructure(
        CommonV.embeddingVector,
        "CommonV.embeddingVector",
      );
      expect(result.isValid).toBe(true);
      expect(result.typeName).toBe("object");

      // Should have a 'data' field that uses bytes (ArrayBuffer)
      const validator = CommonV.embeddingVector as any;
      expect(validator.fields?.data?.kind).toBe("bytes");
    });
  });

  describe("Validator Composition", () => {
    test("Validators can be used in complex patterns", () => {
      // Test that our validators have the right structure for composition
      expect(UserV.full.kind).toBe("object");
      expect(UserV.public.kind).toBe("object");
      expect(MeetingV.full.kind).toBe("object");

      // Test that they have the required properties for composition
      expect(UserV.full.fields).toBeDefined();
      expect(UserV.public.fields).toBeDefined();
      expect(MeetingV.full.fields).toBeDefined();
    });

    test("Pagination validators demonstrate composition", () => {
      // PaginationResultV is an example of validator composition
      const userPaginationValidator = PaginationResultV(UserV.public);

      expect(userPaginationValidator.kind).toBe("object");
      expect(userPaginationValidator.fields).toBeDefined();
      expect(userPaginationValidator.fields.page).toBeDefined();
      expect(userPaginationValidator.fields.isDone).toBeDefined();
      expect(userPaginationValidator.fields.continueCursor).toBeDefined();
    });
  });

  describe("Performance Validation", () => {
    test("Validator validation is fast", () => {
      const startTime = performance.now();

      // Validate multiple validators
      const validators = [
        UserV.full,
        UserV.public,
        MeetingV.full,
        TranscriptV.full,
        PaginationResultV(UserV.public),
        CommonV.embeddingVector,
      ];

      for (const validator of validators) {
        validateValidatorStructure(validator, "test");
      }

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // Should be very fast (less than 10ms for all validators)
      expect(totalTime).toBeLessThan(10);
    });

    test("Large validator collections perform well", () => {
      const startTime = performance.now();

      // Test with many validators
      const allValidators = [
        ...Object.values(UserV),
        ...Object.values(MeetingV),
        ...Object.values(TranscriptV),
        ...Object.values(CommonV),
      ];

      for (const validator of allValidators) {
        validateValidatorStructure(validator, "test");
      }

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // Should handle large collections efficiently
      expect(totalTime).toBeLessThan(50);

      console.log(
        `Validated ${allValidators.length} validators in ${totalTime.toFixed(2)}ms`,
      );
    });
  });

  describe("Type Safety Patterns", () => {
    test("ID validators reference correct tables", () => {
      // Check that ID validators reference the correct table names
      const userIdField = (UserV.full as any).fields?._id;
      expect(userIdField?.kind).toBe("id");
      expect(userIdField?.tableName).toBe("users");

      const meetingIdField = (MeetingV.full as any).fields?._id;
      expect(meetingIdField?.kind).toBe("id");
      expect(meetingIdField?.tableName).toBe("meetings");
    });

    test("Optional fields are properly marked", () => {
      // Check that optional fields use the optional validator
      const userFields = (UserV.full as any).fields;

      // These should be optional (have isOptional: "optional")
      expect(userFields?.orgId?.isOptional).toBe("optional");
      expect(userFields?.displayName?.isOptional).toBe("optional");
      expect(userFields?.avatarUrl?.isOptional).toBe("optional");

      // These should be required (have isOptional: "required")
      expect(userFields?.workosUserId?.isOptional).toBe("required");
      expect(userFields?.email?.isOptional).toBe("required");
      expect(userFields?.isActive?.isOptional).toBe("required");

      // All should have the correct underlying types
      expect(userFields?.orgId?.kind).toBe("string");
      expect(userFields?.workosUserId?.kind).toBe("string");
      expect(userFields?.email?.kind).toBe("string");
      expect(userFields?.isActive?.kind).toBe("boolean");
    });

    test("System fields are included", () => {
      // Check that Convex system fields are included
      const userFields = (UserV.full as any).fields;

      expect(userFields?._id?.kind).toBe("id");
      expect(userFields?._creationTime?.kind).toBe("float64");
    });
  });

  describe("Convex Compliance", () => {
    test("Validators use supported Convex types", () => {
      const supportedKinds = [
        "id",
        "null",
        "number",
        "float64",
        "int64",
        "boolean",
        "string",
        "bytes",
        "array",
        "object",
        "record",
        "union",
        "literal",
        "optional",
      ];

      const checkValidator = (validator: any, path: string) => {
        if (!validator || typeof validator !== "object") return;

        if (validator.kind) {
          expect(supportedKinds).toContain(validator.kind);
        }

        // Recursively check nested validators
        if (validator.fields) {
          for (const [key, field] of Object.entries(validator.fields)) {
            checkValidator(field, `${path}.${key}`);
          }
        }
        if (validator.element) {
          checkValidator(validator.element, `${path}[]`);
        }
        if (validator.members) {
          validator.members.forEach((member: any, index: number) => {
            checkValidator(member, `${path}[${index}]`);
          });
        }
        if (validator.value) {
          checkValidator(validator.value, `${path}?`);
        }
      };

      // Test all major validators
      checkValidator(UserV.full, "UserV.full");
      checkValidator(MeetingV.full, "MeetingV.full");
      checkValidator(TranscriptV.full, "TranscriptV.full");
    });

    test("No unsupported validator types", () => {
      // Ensure we don't use v.map() or v.set() which are unsupported
      const checkForUnsupported = (validator: any, path: string) => {
        if (!validator || typeof validator !== "object") return;

        // These are not supported in Convex
        expect(validator.kind).not.toBe("map");
        expect(validator.kind).not.toBe("set");

        // Recursively check
        if (validator.fields) {
          for (const [key, field] of Object.entries(validator.fields)) {
            checkForUnsupported(field, `${path}.${key}`);
          }
        }
        if (validator.element) {
          checkForUnsupported(validator.element, `${path}[]`);
        }
        if (validator.members) {
          validator.members.forEach((member: any, index: number) => {
            checkForUnsupported(member, `${path}[${index}]`);
          });
        }
      };

      checkForUnsupported(UserV.full, "UserV.full");
      checkForUnsupported(MeetingV.full, "MeetingV.full");
      checkForUnsupported(TranscriptV.full, "TranscriptV.full");
    });
  });
});
