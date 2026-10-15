import { expect, test } from "vitest";
import { formatRecordedDuration } from "./duration";

test("formats elapsed timestamps including short calls and omits unrecorded duration", () => {
  expect(formatRecordedDuration(1000, 32000)).toBe("31 seconds");
  expect(formatRecordedDuration(1000, 92000)).toBe("1 minute 31 seconds");
  expect(formatRecordedDuration(1000, 121000)).toBe("2 minutes");
  expect(formatRecordedDuration(null, 121000)).toBeNull();
});
