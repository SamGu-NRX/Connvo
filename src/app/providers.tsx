"use client";

import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ClerkProvider } from "@clerk/nextjs";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <div className="bg-background min-h-screen">
          <main
          // className="container mx-auto px-4 py-6"
          >
            {children}
          </main>
        </div>
        <Toaster className="dark:hidden" />
        <Toaster theme="dark" className="hidden dark:block" />
      </ThemeProvider>
    </ClerkProvider>
  );
}
