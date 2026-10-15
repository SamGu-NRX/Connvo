"use client";

/**
 * The home-screen clock: one shared ticking `now` plus the countdown wording
 * used on the proposal and upcoming-chat cards. A one-second tick only while
 * a card is on screen; the interval clears on unmount.
 */

import { useEffect, useState } from "react";

export function useNow(tickMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);
  return now;
}

/**
 * "2d 4h", "3h 12m", "9m 41s", "less than a minute" — the two largest
 * non-zero units, so a long wait does not read as a stopwatch.
 */
export function formatCountdown(ms: number): string {
  if (ms <= 60_000) return "less than a minute";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
