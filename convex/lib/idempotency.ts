// Simple hash function for idempotency keys (V8 compatible)
export function hashRequest(input: any): string {
  const str = JSON.stringify(input);
  let hash = 0;

  if (str.length === 0) return hash.toString();

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return Math.abs(hash).toString(36);
}
