"use client";

import React from "react";
import { TransitionLink } from "@/utils/TransitionLink";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/shadcn";
import { motion } from "motion/react";
import { Button } from "../ui/button";
import { navSections } from "./navigation.config";

export function DesktopNavigation() {
  const pathname = usePathname();

  return (
    <nav className="flex min-h-0 flex-1 flex-col py-3">
      <div className="flex-1 space-y-3.5 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.title} className="space-y-2">
            <p className="px-3 text-[11px] font-medium uppercase tracking-[0.2em] text-emerald-900/60 dark:text-emerald-100/60">
              {section.title}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/app" &&
                    pathname.startsWith(`${item.href}/`));

                return (
                  <TransitionLink
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "group relative flex h-10 items-center gap-3 overflow-hidden rounded-lg px-3 text-sm font-medium text-emerald-900/70 transition-colors duration-200 hover:text-emerald-600 dark:text-emerald-100/70 dark:hover:text-emerald-300",
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-0 rounded-lg bg-white/85 ring-1 ring-white/50 dark:bg-emerald-500/15 dark:ring-emerald-300/20"
                        transition={{
                          type: "spring",
                          stiffness: 350,
                          damping: 28,
                        }}
                      />
                    )}
                    <span className="relative flex h-8 w-8 items-center justify-center rounded-md border border-white/35 bg-white/70 transition-colors duration-200 dark:border-white/10 dark:bg-white/10">
                      <item.icon
                        className={cn(
                          "h-4 w-4 transition-transform duration-200",
                          isActive ? "scale-105" : "group-hover:scale-[1.05]",
                        )}
                      />
                    </span>
                    <span className="relative flex flex-col">
                      <span className="leading-tight">{item.name}</span>
                      <span className="text-[11px] font-normal text-emerald-900/50 transition-opacity duration-200 group-hover:opacity-100 dark:text-emerald-200/50">
                        {item.description}
                      </span>
                    </span>
                  </TransitionLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto px-3 pt-104">
        <Button
          onClick={() => {
            window.location.href = "/api/auth/signout";
          }}
          variant="ghost"
          className="group flex w-full items-center justify-center gap-2 rounded-md border border-white/30 bg-white/65 px-3 py-2 text-sm font-semibold text-emerald-900/80 transition-colors duration-200 hover:bg-white/80 hover:text-red-500 focus-visible:ring-emerald-500/30 dark:border-white/10 dark:bg-white/10 dark:text-emerald-100/80 dark:hover:bg-white/15 dark:hover:text-red-300"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Log out
        </Button>
      </div>
    </nav>
  );
}
