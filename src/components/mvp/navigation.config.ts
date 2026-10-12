import type { ComponentType } from "react";

import {
  Home,
  BarChart2,
  User,
  Settings,
  Briefcase,
  Phone,
  History,
} from "lucide-react";

import { isAfterCallEnabled } from "@/lib/featureFlags";

export type NavItem = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
};

export const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      {
        name: "Home",
        href: "/app",
        icon: Home,
        description: "Welcome overview",
      },
      {
        name: "Dashboard",
        href: "/app/dashboard",
        icon: BarChart2,
        description: "Metrics and insights",
      },
    ],
  },
  {
    title: "Profile",
    items: [
      {
        name: "Profile",
        href: "/app/profile",
        icon: User,
        description: "Personal details",
      },
      {
        name: "Settings",
        href: "/app/settings",
        icon: Settings,
        description: "Preferences and controls",
      },
    ],
  },
  {
    title: "Connections",
    items: [
      {
        name: "Casual",
        href: "/app/smart-connection?type=casual",
        icon: Phone,
        description: "Friendly voice introductions",
      },
      {
        name: "Professional",
        href: "/app/smart-connection?type=professional",
        icon: Briefcase,
        description: "Targeted matches",
      },
    ],
  },
];

/** The gated after-call entry: present only when the candidate flag is on. */
export const meetingsNavItem: NavItem = {
  name: "Meetings",
  href: "/app/meetings",
  icon: History,
  description: "Past calls and recaps",
};

/**
 * Nav sections including the after-call Meetings entry when the candidate
 * flag (NEXT_PUBLIC_CONNVO_AFTER_CALL=1) is on. With the flag off this
 * returns the base sections unchanged, so the surface stays fully
 * invisible — matching the server-side CONNVO_AFTER_CALL gate.
 */
export function getNavSections(): { title: string; items: NavItem[] }[] {
  if (!isAfterCallEnabled()) return navSections;
  return navSections.map((section) =>
    section.title === "Connections"
      ? { ...section, items: [...section.items, meetingsNavItem] }
      : section,
  );
}
