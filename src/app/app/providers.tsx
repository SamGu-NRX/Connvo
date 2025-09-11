"use client";

import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import StreamVideoProvider from "@/providers/StreamClientProvider";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexClientProvider>
      <StreamVideoProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="bg-background min-h-screen">
            <main>{children}</main>
          </div>
          <Toaster className="dark:hidden" />
          <Toaster theme="dark" className="hidden dark:block" />
        </ThemeProvider>
      </StreamVideoProvider>
    </ConvexClientProvider>
  );
}
