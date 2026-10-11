/**
 * Hidden ground truth: the world's real compatibility function.
 *
 * G(a,b) in [0,1] plus idiosyncratic pair noise. Operates on latents and
 * profiles; NOTHING here is imported by a matcher — that separation is
 * the point of the eval (README §threat-model).
 */

import { Rng } from "./rng";
import type { EvalProfile, Latent, Population } from "./types";

export interface GroundTruth {
  /** Deterministic part (used for the noise-limited ceiling). */
  deterministic(a: EvalProfile, b: EvalProfile, la: Latent, lb: Latent): number;
  /** Sampled utility = deterministic + idiosyncratic noise. */
  utility(a: EvalProfile, b: EvalProfile, la: Latent, lb: Latent, rng: Rng): number;
  /** Timezone "viability" — can these two plausibly share a call hour? */
  viable(a: EvalProfile, b: EvalProfile): boolean;
  /** Ground-truth threshold for "worth showing up" (set at runtime). */
  threshold: number;
}

const GT_WEIGHTS = {
  tasteSim: 0.3,
  trueInterestAlign: 0.2,
  experienceComplement: 0.12,
  tzCompat: 0.13,
  langCompat: 0.1,
  roleComplement: 0.1,
  orgFit: 0.05,
};

/** Role-family complementarity — cross-family pairs, with build×gtm high. */
const FAMILY_COMPLEMENT: Record<string, Record<string, number>> = {
  build: { build: 0.6, product: 0.95, gtm: 0.85, operate: 0.5 },
  product: { product: 0.6, build: 0.95, gtm: 0.9, operate: 0.7 },
  gtm: { gtm: 0.55, build: 0.85, product: 0.9, operate: 0.75 },
  operate: { operate: 0.6, build: 0.5, product: 0.7, gtm: 0.75 },
};

/** Idiosyncratic pair noise: ~N(0, 0.06), clamped to +/-0.4. */
const NOISE_SD = 0.06;

function cosine(u: number[], v: number[]): number {
  let dot = 0;
  let nu = 0;
  let nv = 0;
  for (let i = 0; i < u.length; i++) {
    dot += u[i] * v[i];
    nu += u[i] * u[i];
    nv += v[i] * v[i];
  }
  return dot / Math.sqrt(Math.max(nu * nv, 1e-12));
}

export function makeGroundTruth(population: Population): GroundTruth {
  const n = population.profiles.length;
  const idxOf = new Map<string, number>();
  population.profiles.forEach((p, i) => idxOf.set(p.id, i));
  // Affinity vectors: taste drives both interest choice and bio phrasing,
  // so this is the hidden signal both observable channels partially carry.
  const affinities: number[][] = population.latents.map((l) => l.taste.slice());

  const deterministic = (
    a: EvalProfile,
    b: EvalProfile,
    la: Latent,
    lb: Latent,
  ): number => {
    const ia = idxOf.get(a.id) as number;
    const ib = idxOf.get(b.id) as number;
    const tasteSim = (cosine(la.taste, lb.taste) + 1) / 2; // [0,1]
    const interestAlign = (cosine(affinities[ia], affinities[ib]) + 1) / 2;

    const dGap = Math.abs(a.experienceYears ?? 0 - b.experienceYears ?? 0);
    const expScore = Math.exp(-Math.pow(dGap - 4, 2) / 18);

    const dTz = Math.abs(a.timezoneOffset ?? 0 - b.timezoneOffset ?? 0);
    const tz = Math.max(0, 1 - Math.pow(dTz / 10, 1.5));

    const shared = a.languages.some((l) => b.languages.includes(l));
    const lang = shared ? 1 : 0.15;

    const role = FAMILY_COMPLEMENT[a.roleFamily][b.roleFamily];

    let org: number;
    if (a.orgId && b.orgId && a.orgId === b.orgId) {
      org = a.orgPreference === "same" || b.orgPreference === "same" ? 1 : 0.55;
    } else {
      org =
        a.orgPreference === "different" || b.orgPreference === "different"
          ? 1
          : 0.7;
    }

    return (
      GT_WEIGHTS.tasteSim * tasteSim +
      GT_WEIGHTS.trueInterestAlign * interestAlign +
      GT_WEIGHTS.experienceComplement * expScore +
      GT_WEIGHTS.tzCompat * tz +
      GT_WEIGHTS.langCompat * lang +
      GT_WEIGHTS.roleComplement * role +
      GT_WEIGHTS.orgFit * org
    );
  };

  const utility = (
    a: EvalProfile,
    b: EvalProfile,
    la: Latent,
    lb: Latent,
    rng: Rng,
  ): number => {
    const base = deterministic(a, b, la, lb);
    const noise = NOISE_SD * rng.normal();
    return Math.max(0, Math.min(1, base + noise));
  };

  const viable = (a: EvalProfile, b: EvalProfile): boolean => {
    const dTz = Math.abs((a.timezoneOffset ?? 0) - (b.timezoneOffset ?? 0));
    return dTz <= 8;
  };

  // Calibrate tau at runtime: the 87.5th percentile of deterministic G
  // over a random pair sample (~13% of pairs are "worth showing up").
  const calib = new Rng(99);
  const sample: number[] = [];
  for (let k = 0; k < 20000; k++) {
    const i = calib.int(n);
    let j = calib.int(n);
    if (j === i) j = (j + 1) % n;
    sample.push(
      deterministic(
        population.profiles[i],
        population.profiles[j],
        population.latents[i],
        population.latents[j],
      ),
    );
  }
  sample.sort((x, y) => x - y);
  const threshold = sample[Math.floor(sample.length * 0.875)];

  return { deterministic, utility, viable, threshold };
}
