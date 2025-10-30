// RootLayout.jsx
"use client";

import "../globals.css";
import type React from "react";
import { Inter } from "next/font/google";
import { MobileNavigation } from "@/components/mvp/MobileNavigation";
import { DesktopNavigation } from "@/components/mvp/DesktopNavigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import Image from "next/image";
import { motion } from "motion/react";

import { Providers } from "./providers";
import { Sidebar } from "@/components/mvp/dashboard/sidebar";
import { ModeToggle } from "@/components/mvp/dashboard/ModeToggle";
import Link from "next/link";
import { useTheme } from "next-themes";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // This layout is nested under the real root layout. Do NOT render <html> or <body> here.
  // Also bypass Clerk auth UI for now by keeping the header static (no SignedIn/SignedOut).
  return (
    <div className={`${inter.className} antialiased`}>
      <Providers>
        <div className="relative flex min-h-screen flex-col">
          <header className="bg-background/80 sticky top-0 z-50 flex h-16 items-center gap-4 border-b px-6 backdrop-blur-xs transition-colors duration-300">
            <div className="relative z-10">
              <Link
                className="flex items-center gap-2 font-semibold transition-all duration-300 hover:opacity-80"
                href="/app"
              >
                <motion.h1
                  className="text-xl font-medium text-emerald-600 dark:text-emerald-300"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  Connvo
                </motion.h1>
              </Link>
            </div>

            <div className="flex-1" />
            <ModeToggle />
            {/* Auth UI removed for local frontend-only flow */}
          </header>

          <div className="flex flex-1 overflow-hidden">
            <div className="hidden border-r transition-all duration-300 md:block md:w-64">
              <DesktopNavigation />
            </div>

            <div className="flex flex-1 flex-col overflow-hidden">
              <main className="flex-1 overflow-y-auto p-6 transition-all duration-300">
                <div className="relative min-h-[calc(100vh-10rem)] w-full">
                  {children}
                </div>
              </main>
              <div className="md:hidden">
                <MobileNavigation />
              </div>
            </div>
          </div>
        </div>
      </Providers>
    </div>
  );
}
