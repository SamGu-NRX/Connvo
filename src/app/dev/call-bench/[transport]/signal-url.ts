/**
 * Parses the runner's additive `?signal=` param (the DOM contract's pinned
 * params are unchanged): only ws:// URLs are accepted — anything else,
 * including wss://, http(s):// or garbage, is treated as absent so the
 * transport falls back to its env default.
 */
export function signalUrlFromParam(
  value: string | string[] | undefined,
): string | null {
  const first = Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  if (!first) return null;
  try {
    const parsed = new URL(first);
    if (parsed.protocol === "ws:") return parsed.toString();
  } catch {
    // not a URL — treated as absent (dev bench convenience param)
  }
  return null;
}
