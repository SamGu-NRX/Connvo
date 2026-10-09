import { describe, expect, it } from "vitest";

import { generateAvatarColor, getInitials } from "@/data/avatar-utils";
import { mockUsers } from "@/data/mock-users";
import type { UserInfo } from "@/types/user";

import { buildFeaturedConnections } from "../connections-view";

// FROZEN ORIGINAL — copied verbatim from dashboard/page.tsx before the change.
// The page took `mockUsers.slice(0, 8)` and, inside the render map, computed
// `generateAvatarColor(user.name)` and `getInitials(user.name)` per user.
// Rebuilt here as data (same derivations, same fields) so the helper's output
// can be compared 1:1.
const originalFeaturedConnections = (users: UserInfo[], limit: number) =>
  users.slice(0, limit).map((user) => {
    const avatarColors = generateAvatarColor(user.name);
    return {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      profession: user.profession,
      company: user.company,
      status: user.status,
      initials: getInitials(user.name),
      colors: {
        from: avatarColors.from,
        to: avatarColors.to,
        text: avatarColors.text,
      },
    };
  });

const makeUser = (overrides: Partial<UserInfo> = {}): UserInfo => ({
  id: "synthetic",
  name: "Ada Lovelace",
  avatar: null,
  bio: "",
  profession: "Engineer",
  company: "Analytical Engines",
  school: "",
  experience: 3,
  sharedInterests: [],
  connectionType: "collaboration",
  status: "online",
  ...overrides,
});

// Synthetic users covering name/initials and avatar edge cases the page's
// inline logic was exposed to.
const syntheticUsers: UserInfo[] = [
  makeUser({ id: "s1", name: "", status: undefined }), // empty name → initials "?"
  makeUser({ id: "s2", name: "Yi" }), // single-word name
  makeUser({ id: "s3", name: "   ", status: "away" }), // whitespace-only name
  makeUser({ id: "s4", name: "Grace B. Hopper", status: "offline" }),
  makeUser({ id: "s5", name: "  Padded  Name  ", status: "online" }),
  makeUser({ id: "s6", name: "Ünicode Nâme" }),
  makeUser({ id: "s7", name: "One", avatar: "https://example.com/one.png" }),
  makeUser({
    id: "s8",
    name: "Two Words",
    avatar: "https://example.com/two.png",
  }),
  makeUser({ id: "s9", name: "Three Part Name", status: undefined }),
  makeUser({ id: "s10", name: "Zh", status: "away" }),
];

describe("buildFeaturedConnections", () => {
  it("matches the frozen original for mockUsers at the page limit (8)", () => {
    expect(buildFeaturedConnections(mockUsers, 8)).toEqual(
      originalFeaturedConnections(mockUsers, 8),
    );
  });

  it("matches the frozen original for synthetic users across limits", () => {
    for (const limit of [0, 1, 3, 5, 8, 10, 11, 25]) {
      expect(buildFeaturedConnections(syntheticUsers, limit)).toEqual(
        originalFeaturedConnections(syntheticUsers, limit),
      );
    }
  });

  it("matches the frozen original for an empty user list", () => {
    expect(buildFeaturedConnections([], 8)).toEqual(
      originalFeaturedConnections([], 8),
    );
    expect(buildFeaturedConnections([], 0)).toEqual([]);
  });

  it("matches the frozen original for limit edge cases (0, negative, > length)", () => {
    // limit 0 selects nothing.
    expect(buildFeaturedConnections(mockUsers, 0)).toEqual([]);

    // Negative limits: `slice(0, -n)` counts from the end — surprising, but it
    // is the frozen semantics, so the helper must reproduce it exactly.
    for (const limit of [-1, -3, -100]) {
      expect(buildFeaturedConnections(mockUsers, limit)).toEqual(
        originalFeaturedConnections(mockUsers, limit),
      );
      expect(buildFeaturedConnections(syntheticUsers, limit)).toEqual(
        originalFeaturedConnections(syntheticUsers, limit),
      );
    }

    // Limits beyond the array length select everything; exactly length too.
    expect(buildFeaturedConnections(mockUsers, mockUsers.length + 10)).toEqual(
      originalFeaturedConnections(mockUsers, mockUsers.length + 10),
    );
    expect(buildFeaturedConnections(mockUsers, mockUsers.length)).toHaveLength(
      mockUsers.length,
    );
  });

  it("is deterministic across repeated calls", () => {
    const first = buildFeaturedConnections(syntheticUsers, 8);
    const second = buildFeaturedConnections(syntheticUsers, 8);
    expect(second).toEqual(first);
  });

  it("does not mutate the input array", () => {
    const users = syntheticUsers.map((user) => ({ ...user }));
    const snapshot = syntheticUsers.map((user) => ({ ...user }));
    buildFeaturedConnections(users, 8);
    expect(users).toEqual(snapshot);
    expect(users).toHaveLength(syntheticUsers.length);
  });

  it("derives initials and colors from the same helpers the page used inline", () => {
    const viewModels = buildFeaturedConnections(
      syntheticUsers,
      syntheticUsers.length,
    );
    expect(viewModels).toHaveLength(syntheticUsers.length);
    viewModels.forEach((viewModel, i) => {
      const user = syntheticUsers[i];
      expect(viewModel.initials).toBe(getInitials(user.name));
      expect(viewModel.colors).toEqual(generateAvatarColor(user.name));
    });
  });
});
