"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

// The real call page in its local eval setup (bench and real-call flags both
// on) renders without the nested Convex provider, like the call bench; Convex,
// when configured, comes from the root provider (src/app/providers.tsx).
// The after-call pages (/app/meetings) are included for the same reason.
// No Stream provider is mounted anywhere: the client modules nothing could
// reach were removed, and the real call runs on the P2P transport.
const EVAL_SKIP_ROUTE = /^\/app\/(call\/[^/]+|meetings(\/[^/]+)?)$/;
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
  if (CALL_EVAL && pathname && EVAL_SKIP_ROUTE.test(pathname))
    return shell;
  return <ConvexClientProvider>{shell}</ConvexClientProvider>;
}
