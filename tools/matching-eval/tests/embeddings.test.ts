/**
 * Review fix 3 (PR #32): pins the fastembed 3.0.0 provider contract —
 * supported model enum id, batch-yielding embed(), finite 384-dim vectors,
 * and sensible relative cosine similarity on known sentences. Downloads
 * the MiniLM model on first run (cached afterwards).
 */
import { describe, expect, it } from "vitest";
import { deriveEmbedding, EMBEDDING_DIM, EMBEDDING_MODEL } from "../src/embeddings";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

describe("fastembed provider contract", () => {
  it("uses the supported fastembed 3.0.0 model id", () => {
    expect(EMBEDDING_MODEL).toBe("fast-all-MiniLM-L6-v2");
  });

  it("embeds known sentences as finite 384-dim vectors with sensible cosine", async () => {
    const a = await deriveEmbedding("Product manager who loves hiking and cooking with friends");
    const b = await deriveEmbedding("Product lead who enjoys trail hiking and making pasta");
    const x = await deriveEmbedding("Kernel engineer optimizing distributed database storage engines");
    expect(a.length).toBe(EMBEDDING_DIM);
    expect(b.length).toBe(EMBEDDING_DIM);
    expect(x.length).toBe(EMBEDDING_DIM);
    expect(a.every(Number.isFinite)).toBe(true);
    expect(b.every(Number.isFinite)).toBe(true);
    expect(x.every(Number.isFinite)).toBe(true);
    const near = cosine(a, b);
    const far = cosine(a, x);
    expect(near).toBeGreaterThan(0.5);
    expect(near).toBeGreaterThan(far);
  }, 240000);
});
