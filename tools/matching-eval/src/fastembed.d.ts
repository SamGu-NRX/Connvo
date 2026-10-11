/**
 * Ambient declaration for the OPTIONAL `fastembed` dependency. The
 * harness treats it as best-effort — embeddings.ts falls back to the
 * local deterministic hash provider when the package is absent — and
 * relies only on the embed() surface, statically typed here so the
 * dynamic import type-checks whether or not the package is installed.
 */
declare module "fastembed" {
  export function embed(
    input: string[],
  ): Promise<Array<AsyncIterable<number[]>>>;
}
