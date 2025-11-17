import * as React from "react";

import { cn } from "@/lib/utils";

interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: boolean;
}

/**
 * Shared glassmorphism surface that mirrors the landing page aesthetic.
 * Use `padding={false}` when the wrapped content already handles its own spacing.
 */
export function GlassPanel({
  className,
  children,
  padding = true,
  ...props
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-sm border border-surface bg-white/60 backdrop-blur-lg transition-all duration-300 dark:bg-white/10",
        "before:absolute before:inset-px before:rounded-[inherit] before:bg-linear-to-br before:from-white/80 before:via-white/28 before:to-white/10 before:opacity-75 before:content-[''] before:pointer-events-none dark:before:from-white/12 dark:before:via-white/6 dark:before:to-white/0",
        className,
      )}
      {...props}
    >
      <div className={cn("relative", padding && "p-3 sm:p-3.5")}>{children}</div>
    </div>
  );
}
