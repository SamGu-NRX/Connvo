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
const REAL_CALL_FLAG = process.env.NEXT_PUBLIC_CONNVO_REAL_CALL;
const CONVEX_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

/**
 * The bench, and the real call page in its local eval setup (both flags on)
 * when no Convex deployment is configured. With one configured, the call
 * page signals over Convex and needs this provider.
 */
function runsWithoutBackend(pathname: string): boolean {
  if (pathname.startsWith("/dev/call-bench")) return true;
  return (
    REAL_CALL_FLAG === "1" &&
    !CONVEX_CONFIGURED &&
    /^\/app\/call\/[^/]+$/.test(pathname)
  );
}

/** /app's layout puts its own <main> around page content, inside its header and nav. */
const APP_SHELL_ROUTE = /^\/app(\/|$)/;

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const Content = pathname && APP_SHELL_ROUTE.test(pathname) ? "div" : "main";
  const shell = (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
    >
      <div className="bg-background min-h-screen">
        <Content>{children}</Content>
      </div>
      <Toaster className="dark:hidden" />
      <Toaster theme="dark" className="hidden dark:block" />
    </ThemeProvider>
  );
  if (BENCH_FLAG === "1" && pathname && runsWithoutBackend(pathname)) return shell;
  return <ConvexClientProvider>{shell}</ConvexClientProvider>;
}
