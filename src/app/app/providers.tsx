"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import StreamVideoProvider from "@/providers/StreamClientProvider";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

// The real call page in its local eval setup (bench and real-call flags both
// on) runs with no Stream keys, like the call bench. Convex, when configured,
// comes from the root provider (src/app/providers.tsx).
// The after-call pages (/app/meetings) need no Stream either, and its
// token action cannot run without WorkOS, so the eval setup skips it there.
const STREAMLESS_EVAL_ROUTE = /^\/app\/(call\/[^/]+|meetings(\/[^/]+)?)$/;
const CALL_EVAL =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_CONNVO_CALL_BENCH === "1" &&
  process.env.NEXT_PUBLIC_CONNVO_REAL_CALL === "1";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const shell = (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <div className="bg-background min-h-screen">
        {children}
      </div>
      <Toaster className="dark:hidden" />
      <Toaster theme="dark" className="hidden dark:block" />
    </ThemeProvider>
  );
  if (CALL_EVAL && pathname && STREAMLESS_EVAL_ROUTE.test(pathname))
    return shell;
  return (
    <ConvexClientProvider>
      <StreamVideoProvider>{shell}</StreamVideoProvider>
    </ConvexClientProvider>
  );
}
