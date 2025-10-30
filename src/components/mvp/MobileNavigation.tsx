"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, BarChart2, User, Settings } from "lucide-react";
import { cn } from "@/lib/shadcn";
import { TransitionLink } from "@/utils/TransitionLink";

const navItems = [
  { name: "Home", href: "/", icon: Home },
  { name: "Dashboard", href: "/dashboard", icon: BarChart2 },
  { name: "Profile", href: "/profile", icon: User },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function MobileNavigation() {
  const pathname = usePathname();

  return (
    <nav className="fixed right-0 bottom-0 left-0 border-t border-gray-200 bg-white">
      <div className="flex justify-around">
        {navItems.map((item) => (
          <TransitionLink
            key={item.name}
            href={item.href}
            className={cn(
              "flex flex-col items-center px-3 py-2",
              pathname === item.href
                ? "text-blue-600"
                : "text-gray-600 hover:text-blue-600",
            )}
          >
            <item.icon className="h-6 w-6" />
            <span className="mt-1 text-xs">{item.name}</span>
          </TransitionLink>
        ))}
      </div>
    </nav>
  );
}
