/**
 * Outcome simulator — the "world" responding to matches.
 *
 * The simulator may use ground truth (it IS the world); it never leaks
 * back into matcher inputs (README §outcomes).
 *
 * - P(accept) depends on the pair's true utility G, both users' latent
 *   sociability, and fatigue from repeated unanswered invites.
 * - Fatigue accumulates per declined/no-show invite, decays 0.8x/round.
 * - P(complete | accepted) drops with thin timezone overlap.
 * - Sociability only enters response propensity.
 */

import { Rng } from "./rng";
import type { GroundTruth } from "./ground-truth";
import type { EvalProfile, Latent, PairOutcome, Population } from "./types";

export interface SimState {
  fatigue: Map<string, number>;
  history: PairOutcome[];
}

export function newSimState(): SimState {
  return { fatigue: new Map(), history: [] };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export interface RoundContext {
  population: Population;
  gt: GroundTruth;
  state: SimState;
  rng: Rng;
}

export function simulatePair(
  ctx: RoundContext,
  a: EvalProfile,
  b: EvalProfile,
): PairOutcome {
  const { population, gt, state, rng } = ctx;
  const ia = population.profiles.indexOf(a);
  const ib = population.profiles.indexOf(b);
  const la = population.latents[ia];
  const lb = population.latents[ib];

  const g = gt.utility(a, b, la, lb, rng);
  const soc = (la.sociability + lb.sociability) / 2;
  const fatigue = Math.max(
    state.fatigue.get(a.id) ?? 0,
    state.fatigue.get(b.id) ?? 0,
  );

  const pAccept = sigmoid(9 * (g - 0.52) + 2.2 * (soc - 0.5) - 1.1 * fatigue);
  const outcome: PairOutcome = { userA: a.id, userB: b.id, outcome: "declined" };

  if (rng.bool(pAccept)) {
    const dTz = Math.abs((a.timezoneOffset ?? 0) - (b.timezoneOffset ?? 0));
    const tzPenalty = Math.max(0, (dTz - 3) / 9) * 1.3;
    const pComplete = sigmoid(7 * (g - 0.42) - tzPenalty);
    outcome.outcome = rng.bool(pComplete) ? "completed" : "no_show";
  }

  state.history.push(outcome);
  if (outcome.outcome !== "completed") {
    const bump = outcome.outcome === "declined" ? 0.5 : 0.35;
    state.fatigue.set(a.id, Math.min(2.5, (state.fatigue.get(a.id) ?? 0) + bump));
    state.fatigue.set(b.id, Math.min(2.5, (state.fatigue.get(b.id) ?? 0) + bump));
  }
  return outcome;
}

/** Decay fatigue between rounds. */
export function decayFatigue(state: SimState): void {
  for (const [k, v] of state.fatigue) state.fatigue.set(k, v * 0.8);
}

export type OutcomeKind = PairOutcome["outcome"];

/** Training sample for the learning direction. */
export interface LearningSample {
  features: number[]; // eight features as the matcher observed them
  /** completed 1, no_show 0.4, declined 0 */
  label: number;
  baseA: number;
  baseB: number;
}

export function outcomeValue(o: OutcomeKind): number {
  return o === "completed" ? 1 : o === "no_show" ? 0.4 : 0;
}
