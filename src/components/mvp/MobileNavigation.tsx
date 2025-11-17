"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { TransitionLink } from "@/utils/TransitionLink";
import { motion } from "motion/react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { navSections } from "./navigation.config";

const MOBILE_ITEM_ORDER = ["Home", "Smart Match", "Match Queue", "Profile"];

export function MobileNavigation() {
  const pathname = usePathname();
  const navItems = navSections
    .flatMap((section) => section.items)
    .filter((item) => MOBILE_ITEM_ORDER.includes(item.name))
    .sort(
      (a, b) =>
        MOBILE_ITEM_ORDER.indexOf(a.name) -
        MOBILE_ITEM_ORDER.indexOf(b.name),
    );

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center">
      <GlassPanel
        padding={false}
        className="pointer-events-auto flex w-[min(92vw,420px)] items-center justify-around rounded-lg px-3 py-2"
      >
        {navItems.map((item) => (
          <TransitionLink
            key={item.name}
            href={item.href}
            className="group relative flex flex-1 flex-col items-center gap-1 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-900/60 transition-colors duration-300 hover:text-emerald-600 dark:text-emerald-100/60 dark:hover:text-emerald-300"
          >
            {(pathname === item.href ||
              pathname.startsWith(`${item.href}/`)) && (
              <motion.span
                layoutId="mobile-nav-active"
                className="absolute inset-0 rounded-lg bg-white/90 ring-1 ring-white/50 dark:bg-emerald-500/20 dark:ring-emerald-300/20"
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 32,
                }}
              />
            )}
            <span className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/45 bg-white/70 text-emerald-600 transition-transform duration-200 group-active:scale-95 group-hover:scale-105 dark:border-white/10 dark:bg-white/10 dark:text-emerald-200">
              <item.icon className="h-4 w-4" />
            </span>
            <span className="relative">{item.name}</span>
          </TransitionLink>
        ))}
      </GlassPanel>
    </nav>
  );
}
