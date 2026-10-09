import { generateAvatarColor, getInitials } from "@/data/avatar-utils";
import type { PresenceStatus, UserInfo } from "@/types/user";

/**
 * Render-ready view model for one featured connection on the dashboard.
 *
 * Every value the page renders is precomputed here — including the avatar
 * gradient colors and initials, which the page previously recomputed on
 * every render — so the render loop reads plain fields instead of calling
 * helpers.
 */
export interface ConnectionViewModel {
  id: string;
  name: string;
  /** Passthrough of `UserInfo.avatar`: image URL, or null for initials fallback. */
  avatar: string | null;
  profession: string;
  company: string;
  status: PresenceStatus | undefined;
  initials: string;
  colors: { from: string; to: string; text: string };
}

/**
 * Build the dashboard's featured-connections view models: take the first
 * `limit` users, then derive initials and avatar colors for each.
 *
 * Pure: `users` is only read, never mutated.
 */
export function buildFeaturedConnections(
  users: UserInfo[],
  limit: number,
): ConnectionViewModel[] {
  return users.slice(0, limit).map((user) => ({
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    profession: user.profession,
    company: user.company,
    status: user.status,
    initials: getInitials(user.name),
    colors: generateAvatarColor(user.name),
  }));
}
