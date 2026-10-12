// @vitest-environment node
/**
 * The Meetings nav entry must exist only when the after-call candidate
 * flag is on, and rendering the gated sections must never mutate the
 * shared navSections export.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getNavSections,
  meetingsNavItem,
  navSections,
} from "./navigation.config";

const FLAG = "NEXT_PUBLIC_CONNVO_AFTER_CALL";

beforeEach(() => {
  delete process.env[FLAG];
});

afterEach(() => {
  delete process.env[FLAG];
});

describe("getNavSections flag gating", () => {
  it("returns the base sections unchanged when the flag is off", () => {
    expect(getNavSections()).toBe(navSections);
  });

  it("appends the Meetings entry to Connections when the flag is on", () => {
    process.env[FLAG] = "1";
    const sections = getNavSections();
    const connections = sections.find((s) => s.title === "Connections");
    expect(connections?.items.at(-1)).toEqual(meetingsNavItem);
    expect(meetingsNavItem.href).toBe("/app/meetings");
  });

  it("leaves navSections untouched", () => {
    process.env[FLAG] = "1";
    getNavSections();
    expect(navSections.at(-1)?.title).toBe("Connections");
    expect(navSections.at(-1)?.items.map((i) => i.name)).toEqual([
      "Casual",
      "Professional",
    ]);
  });
});
