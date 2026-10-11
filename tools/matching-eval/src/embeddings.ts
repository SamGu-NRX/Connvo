/**
 * Local bio embeddings via fastembed MiniLM (L2-normalised), with a
 * deterministic fallback when the model is unavailable. Mirrors
 * convex/matching/embeddings.ts: deriveEmbedding + cosine similarity.
 *
 * README §embeddings: no network at runtime; fastembed caches its ONNX
 * weights at install. All vectors are L2-normalised so dot = cosine.
 */

export const EMBEDDING_DIM = 384;
export const EMBEDDING_MODEL = "local-MiniLM-fallback-v1";

type FastembedModule = {
  embed: (input: string[]) => Promise<Array<AsyncIterable<number[]>>>;
};

let fastembed: FastembedModule | null | undefined;
let tried = false;

async function tryLoadFastembed(): Promise<FastembedModule | null> {
  if (!tried) {
    tried = true;
    try {
      // Optional dependency — harness works without it.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = await import("fastembed");
      fastembed = mod as unknown as FastembedModule;
    } catch {
      fastembed = null;
    }
  }
  return fastembed;
}

/**
 * Deterministic fallback: character 4-gram hashing into 384 dims,
 * L2-normalised. Weaker than MiniLM but stable, offline, and captures
 * lexical overlap — enough for the interest/bio signal the eval uses.
 */
export function hashEmbedding(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  const t = text.toLowerCase();
  for (let i = 0; i < t.length - 3; i++) {
    const gram = t.slice(i, i + 4);
    let h = 2166136261;
    for (let j = 0; j < gram.length; j++) {
      h ^= gram.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    v[Math.abs(h) % EMBEDDING_DIM] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** Interface mirrors the Convex action's deriveEmbedding. */
export async function deriveEmbedding(
  text: string,
  isQuery = false,
): Promise<number[]> {
  void isQuery;
  const mod = await tryLoadFastembed();
  if (mod) {
    try {
      const iterables = await mod.embed([text]);
      for await (const vec of iterables[0]) {
        const norm = Math.sqrt(vec.reduce((a, x) => a + x * x, 0)) || 1;
        return vec.map((x) => x / norm);
      }
    } catch {
      // fall through to hashing
    }
  }
  return hashEmbedding(text);
}
