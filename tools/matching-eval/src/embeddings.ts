/**
 * Local bio embeddings via fastembed MiniLM (L2-normalised).
 * Mirrors convex/matching/embeddings.ts: deriveEmbedding + cosine similarity.
 *
 * Review fix 1 (PR #32, 2026-10-11): fastembed is a declared dependency
 * (package.json + lockfile), the loaded model identity is recorded here, and
 * every load or embed failure THROWS. There is no silent character-hash
 * fallback: a hashed surrogate silently invalidates every vector-similarity
 * measurement in the evaluation, which is the failure the review blocked.
 */

export const EMBEDDING_DIM = 384;

/** Declared model served by this provider (fastembed dep in package.json). */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

type FastembedEmbedFn = (
  input: string[],
  isQuery?: boolean,
) => AsyncIterable<number[]> | Array<AsyncIterable<number[]>>;

type FastembedEmbedder = { embed: FastembedEmbedFn };

let loader: Promise<FastembedEmbedder> | null = null;

async function loadEmbedder(): Promise<FastembedEmbedder> {
  if (!loader) {
    loader = (async () => {
      // Fails loud when the declared dependency is missing or the model
      // cannot be loaded. Never falls back to a surrogate embedding.
      const mod = (await import("fastembed")) as unknown as {
        FlagEmbedding: {
          init: (opts?: { model?: string }) => Promise<FastembedEmbedder>;
        };
      };
      if (!mod?.FlagEmbedding?.init) {
        throw new Error(
          "fastembed did not expose FlagEmbedding.init — cannot embed honestly",
        );
      }
      const embedder = await mod.FlagEmbedding.init({ model: EMBEDDING_MODEL });
      if (typeof embedder?.embed !== "function") {
        throw new Error(
          "fastembed loaded but embed() is missing — cannot embed honestly",
        );
      }
      return embedder;
    })();
    void loader.catch(() => {
      loader = null; // transient failure: allow a retry on next call
    });
  }
  return loader;
}

/** Model identity that will actually serve embeddings (loads the provider). */
export async function embeddingModelId(): Promise<string> {
  await loadEmbedder();
  return EMBEDDING_MODEL;
}

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((a, x) => a + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

/** Interface mirrors the Convex action's deriveEmbedding. */
export async function deriveEmbedding(
  text: string,
  isQuery = false,
): Promise<number[]> {
  const embedder = await loadEmbedder();
  const iterables = await embedder.embed([text], isQuery);
  const first: AsyncIterable<number[]> = Array.isArray(iterables)
    ? iterables[0]
    : iterables;
  if (!first) {
    throw new Error("fastembed returned no embedding stream for the input");
  }
  for await (const vec of first) {
    return l2Normalize(vec);
  }
  throw new Error("fastembed embedding stream was empty");
}

/**
 * @deprecated Deterministic character 4-gram hashing. Kept ONLY until the
 * baseline rewiring commit removes its last consumer; it must never feed a
 * vector-similarity measurement again (review fix 1). Do not call.
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
