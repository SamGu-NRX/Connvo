/**
 * Deterministic RNG (mulberry32) + sampling helpers.
 * Every stochastic component takes explicit Rng instances so a whole
 * experiment replays from seeds recorded in results.json.
 */

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  bool(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box-Muller. */
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Sample without replacement. */
  sample<T>(arr: T[], k: number): T[] {
    const pool = arr.slice();
    const out: T[] = [];
    for (let i = 0; i < k && pool.length > 0; i++) {
      out.push(pool.splice(this.int(pool.length), 1)[0]);
    }
    return out;
  }

  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
