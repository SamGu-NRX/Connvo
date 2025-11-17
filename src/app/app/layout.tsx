// RootLayout.jsx
"use client";

import "../globals.css";
import type React from "react";
import { Inter } from "next/font/google";
import Image from "next/image";
import { MobileNavigation } from "@/components/mvp/MobileNavigation";
import { DesktopNavigation } from "@/components/mvp/DesktopNavigation";
import { motion } from "motion/react";

import { Providers } from "./providers";
import { ModeToggle } from "@/components/mvp/dashboard/ModeToggle";
import Link from "next/link";
import { GlassPanel } from "@/components/ui/glass-panel";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This layout is nested under the real root layout. Do NOT render <html> or <body> here.
  // Also bypass Clerk auth UI for now by keeping the header static (no SignedIn/SignedOut).
  return (
    <div className={`${inter.className} antialiased`}>
      <Providers>
        <div className="relative min-h-screen overflow-hidden bg-linear-to-br from-emerald-50 via-white to-sky-50 dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950">
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -top-32 -left-32 h-64 w-64 rounded-full bg-emerald-200/50 blur-3xl dark:bg-emerald-500/20" />
            <div className="absolute -bottom-36 -right-24 h-80 w-80 rounded-full bg-sky-200/45 blur-3xl dark:bg-sky-500/25" />
            <div className="absolute inset-x-0 top-1/2 h-px bg-white/40 mix-blend-overlay dark:bg-white/5" />
          </div>
          <div className="relative flex min-h-screen flex-col gap-2.5 px-2.5 py-4 sm:px-4 lg:px-7">
            <GlassPanel
              padding={false}
              className="rounded-sm border border-surface px-3 py-1.5 sm:px-3.5"
            >
              <div className="flex w-full items-center gap-2.5">
                <Link
                  className="flex items-center gap-2.5 font-semibold transition-opacity duration-150 hover:opacity-80"
                  href="/app"
                >
                  <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-sm">
                    <Image
                      src="/ConnvoLogos/Connvo-black.png"
                      alt="Connvo logo"
                      width={28}
                      height={28}
                      className="h-7 w-7 object-contain dark:hidden"
                      priority
                    />
                    <Image
                      src="/ConnvoLogos/Connvo-white.png"
                      alt="Connvo logo"
                      width={28}
                      height={28}
                      className="hidden h-7 w-7 object-contain dark:block"
                      priority
                    />
                  </span>
                  <motion.span
                    className="text-sm font-semibold tracking-tight text-emerald-600 dark:text-emerald-300"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                  >
                    Connvo
                  </motion.span>
                </Link>

                <div className="ml-auto flex items-center justify-end">
                  <ModeToggle />
                </div>
              </div>
            </GlassPanel>

            <div className="flex flex-1 flex-col gap-2.5 md:flex-row">
              <GlassPanel
                padding={false}
                className="hidden w-full min-w-[14.5rem] max-w-[16rem] flex-col px-2.5 py-2.5 md:flex"
              >
                <DesktopNavigation />
              </GlassPanel>

              <GlassPanel
                padding={false}
                className="relative flex flex-1 flex-col overflow-hidden"
              >
                <main className="relative z-10 flex-1 overflow-hidden px-3.5 py-4 sm:px-4 lg:px-6">
                  {children}
                </main>
                <div className="md:hidden">
                  <MobileNavigation />
                </div>
              </GlassPanel>
            </div>
          </div>
        </div>
      </Providers>
    </div>
  );
}
