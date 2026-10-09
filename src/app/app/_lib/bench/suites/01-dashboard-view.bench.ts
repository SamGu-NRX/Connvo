/**
 * Benchmark suite for part 01-dashboard-view.
 *
 * Hot path: the dashboard used to rebuild its featured-connections view
 * model on every render — `mockUsers.slice(0, 8)` plus a per-user
 * `generateAvatarColor` / `getInitials` inside the JSX map. It now reads a
 * module-scope precomputed array (mockUsers is static).
 *
 * Convention (see src/app/app/_lib/README.md):
 *  - `before`: FROZEN copy of the original inline code, copied verbatim
 *    from the page on the base branch before editing it.
 *  - `after`: the optimized path the page now uses.
 *  - benchPair() medians over interleaved samples.
 */
import { generateAvatarColor, getInitials } from "@/data/avatar-utils";
import type { UserInfo } from "@/types/user";

import { buildFeaturedConnections } from "../../../dashboard/connections-view";
import { benchPair } from "../harness";
import type { Suite } from "../types";

// Synthetic 10,000-user array, built in-suite (mockUsers is far smaller and
// its exact size would couple the benchmark to mock data).
const N = 10_000;
const syntheticUsers: UserInfo[] = Array.from({ length: N }, (_, i) => ({
  id: `bench-user-${i}`,
  name: i % 3 === 0 ? `User ${i}` : `User ${i} Extended`,
  avatar: null,
  bio: "",
  profession: "Bench Profession",
  company: "Bench Co",
  school: "Bench U",
  experience: i % 30,
  sharedInterests: [],
  connectionType: i % 2 === 0 ? "collaboration" : "mentorship",
  status: (["online", "away", "offline"] as const)[i % 3],
}));

// FROZEN ORIGINAL — copied verbatim from dashboard/page.tsx before the change:
// `mockUsers.slice(0, 8)` plus the per-user computation inside the render map
// (`generateAvatarColor(user.name)` / `getInitials(user.name)`).
const before = () => {
  const featured = syntheticUsers.slice(0, 8);
  return featured.map((user) => {
    const avatarColors = generateAvatarColor(user.name);
    return {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      profession: user.profession,
      company: user.company,
      status: user.status,
      initials: getInitials(user.name),
      colors: avatarColors,
    };
  });
};

// AFTER — what the page now does: `buildFeaturedConnections(mockUsers, 8)`
// runs once at module scope; every render only references the precomputed
// array. (Precomputed here over the same synthetic array at module scope.)
const PRECOMPUTED = buildFeaturedConnections(syntheticUsers, 8);
const after = () => PRECOMPUTED;

const suite: Suite = {
  name: "01-dashboard-view",
  run: () => {
    benchPair({
      suite: "01-dashboard-view",
      name: "featured connections view model (slice + map + colors vs precomputed)",
      note: `n=${N} synthetic users, limit=8; before recomputes per render, after returns module-scope precompute`,
      iterations: 1_000,
      samples: 9,
      before,
      after,
    });
  },
};

export default suite;
