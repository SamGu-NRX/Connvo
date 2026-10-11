"use client";

import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

// Eval-only call bench (tools/call-eval/CONTRACT.md): while
// NEXT_PUBLIC_CONNVO_CALL_BENCH=1 the provider tree omits Convex entirely —
// the bench boots with no Convex deployment and no sign-in. Normal routes
// (flag off) are unchanged.
const BENCH_FLAG = process.env.NEXT_PUBLIC_CONNVO_CALL_BENCH;

export function Providers({ children }: { children: React.ReactNode }) {
  const shell = (
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
  );
  if (BENCH_FLAG === "1") return shell;
  return <ConvexClientProvider>{shell}</ConvexClientProvider>;
}
