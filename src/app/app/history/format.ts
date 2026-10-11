import { format } from "date-fns";

export function formatMeetingDate(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "-";
  try {
    return format(new Date(ms), "EEE, MMM d, yyyy - HH:mm");
  } catch {
    return "-";
  }
}

export function formatSegmentClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}
