/** Only actual call timestamps establish duration; scheduled length does not. */
export function formatRecordedDuration(
  startedAt: number | null | undefined,
  endedAt: number | null | undefined,
): string | null {
  if (typeof startedAt !== "number" || typeof endedAt !== "number") return null;
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}${remainder ? ` ${remainder} ${remainder === 1 ? "second" : "seconds"}` : ""}`;
}
