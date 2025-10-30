"use client";

import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexClientProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
      >
        <div className="bg-background min-h-screen">
          <main>
            {children}
          </main>
        </div>
        <Toaster className="dark:hidden" />
        <Toaster theme="dark" className="hidden dark:block" />
      </ThemeProvider>
    </ConvexClientProvider>
  );
}
