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
    <nav data-testid="mobile-navigation" className="pointer-events-none fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex justify-center">
      <GlassPanel
        padding={false}
        className="pointer-events-auto w-[min(96vw,430px)] rounded-lg"
      >
        <div className="flex items-center justify-around px-2 py-2">
        {navItems.map((item) => (
          <TransitionLink
            key={item.name}
            href={item.href}
            className="group relative flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1.5 py-2 text-[10px] font-medium uppercase tracking-[0.06em] whitespace-nowrap text-emerald-900/80 transition-colors duration-300 hover:text-emerald-700 dark:text-white hover:underline underline-offset-4"
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
            <span className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-white/45 bg-white/70 text-emerald-700 transition-transform duration-200 group-active:scale-95 group-hover:scale-105 dark:border-white/10 dark:bg-white/10 dark:text-emerald-200">
              <item.icon className="h-4 w-4" />
            </span>
            <span className="relative">{item.name}</span>
          </TransitionLink>
        ))}
        </div>
      </GlassPanel>
    </nav>
  );
}
