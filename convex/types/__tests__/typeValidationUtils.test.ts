import { describe, expect, test } from "vitest";
import { v } from "convex/values";
import {
  exploreValidatorStructure,
  validateValidatorStructure,
} from "./typeValidationUtils.helpers";

describe("record validator inspection", () => {
  test("accepts a real Convex record", () => {
    const result = validateValidatorStructure(
      v.record(v.string(), v.number()),
      "scores",
    );
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test.each([
    { kind: "record", value: v.number() },
    { kind: "record", key: v.string() },
    { kind: "record", keys: v.string(), values: v.number() },
  ])("rejects missing record validators: %j", (validator) => {
    const result = validateValidatorStructure(validator, "scores");
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      "scores record validator missing 'key' or 'value'",
    ]);
  });

  test("explores both keys and values from a real Convex record", () => {
    const result = exploreValidatorStructure(
      v.record(v.string(), v.array(v.number())),
      "scores",
    );
    expect(result.structure).toEqual({
      kind: "record",
      keys: { kind: "string" },
      values: { kind: "array", element: { kind: "float64" } },
    });
  });
});
