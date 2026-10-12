"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

// Eval-only call bench (tools/call-eval/CONTRACT.md): while
// NEXT_PUBLIC_CONNVO_CALL_BENCH=1, the bench route alone renders without the
// Convex provider, so it boots with no Convex deployment and no sign-in.
// Every other route keeps Convex whatever the flag says.
const BENCH_FLAG = process.env.NEXT_PUBLIC_CONNVO_CALL_BENCH;

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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
  if (BENCH_FLAG === "1" && pathname?.startsWith("/dev/call-bench")) return shell;
  return <ConvexClientProvider>{shell}</ConvexClientProvider>;
}
