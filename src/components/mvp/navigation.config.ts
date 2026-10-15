import type { ComponentType } from "react";

import { Home, User, Users, Settings, Briefcase, Phone } from "lucide-react";

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
        name: "Your network",
        href: "/app/dashboard",
        icon: Users,
        description: "People you met and kept",
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
