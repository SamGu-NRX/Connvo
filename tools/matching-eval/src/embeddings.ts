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

/** Declared model served by this provider (fastembed dep in package.json).
 *  fastembed 3.0.0's supported id is the enum value
 *  EmbeddingModel.AllMiniLML6V2 = "fast-all-MiniLM-L6-v2". The HuggingFace
 *  repo name "Xenova/all-MiniLM-L6-v2" is NOT a supported init id in v3. */
export const EMBEDDING_MODEL = "fast-all-MiniLM-L6-v2";

type FastembedModule = typeof import("fastembed");
type FastembedEmbedder = InstanceType<FastembedModule["FlagEmbedding"]>;

let loader: Promise<FastembedEmbedder> | null = null;

async function loadEmbedder(): Promise<FastembedEmbedder> {
  if (!loader) {
    loader = (async () => {
      // Fails loud when the declared dependency is missing or the model
      // cannot be loaded. Never falls back to a surrogate embedding.
      const mod = (await import("fastembed")) as FastembedModule;
      if (!mod?.FlagEmbedding?.init || !mod?.EmbeddingModel) {
        throw new Error(
          "fastembed did not expose FlagEmbedding/EmbeddingModel — cannot embed honestly",
        );
      }
      // fastembed 3.0.0 contract: init takes { model: EmbeddingModel };
      // enum members carry the supported ids ("fast-all-MiniLM-L6-v2").
      const embedder = await mod.FlagEmbedding.init({
        model: mod.EmbeddingModel.AllMiniLML6V2,
      });
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
  if (isQuery) {
    // fastembed 3.0.0: queryEmbed(query: string) => Promise<number[]>
    const vec = await embedder.queryEmbed(text);
    if (!vec || vec.length === 0 || !vec.every(Number.isFinite)) {
      throw new Error("fastembed queryEmbed produced an empty or non-finite vector");
    }
    return l2Normalize(vec);
  }
  // fastembed 3.0.0: embed(texts, batchSize?) yields BATCHES of vectors
  // (AsyncGenerator<number[][]) — take the first vector of the first batch.
  for await (const batchVectors of embedder.embed([text], 1)) {
    const vec = batchVectors[0];
    if (!vec || vec.length === 0 || !vec.every(Number.isFinite)) {
      throw new Error("fastembed produced an empty or non-finite vector");
    }
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
