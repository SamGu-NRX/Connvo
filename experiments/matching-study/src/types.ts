/**
 * Shared study types. This module must stay free of node-only imports so the
 * vitest bridge (edge-runtime environment) can import it.
 */

import type { Id } from "@convex/_generated/dataModel";
import type { ClockControl } from "./clock.js";
/** Synthetic identity handle used to enter the queue as a generated user. */
export type SyntheticIdentity = {
  subject: string;
  tokenIdentifier: string;
  email: string;
  name: string;
  issuer: string;
};

export interface StudyConstraints {
  interests: string[];
  roles: string[];
  orgConstraints?: string;
}

/** One planned queue entry (declarative objective; not social ground truth). */
export interface PlannedEntry {
  index: number;
  userId: Id<"users">;
  identity: SyntheticIdentity;
  enqueueAt: number;
  availableFrom: number;
  availableTo: number;
  constraints: StudyConstraints;
  interests: string[];
  profile: {
    displayName: string;
    experience: string;
    field: string;
    company?: string;
    languages: string[];
  };
  orgId: string;
  embedding: number[]; // rounded floats; materializer rebuilds Float32Array
  availabilityClass: "always_on" | "daytime" | "short";
  cohort: number;
  /** Cycle index (1-based) at which this user re-enters, if planned. */
  rejoinAtCycle?: number;
}

export interface PopulationPlan {
  scenarioName: string;
  seed: number;
  params: PopulationParams;
  startClockMs: number;
  entries: PlannedEntry[];
}

export interface PopulationParams {
  count: number;
  arrivalProfile: "burst" | "staggered";
  availabilityMix: { always_on: number; daytime: number; short: number };
  staleFraction: number;
  rejoinFraction: number;
  horizonMs: number;
  embedding: { model: string; dimensions: number };
  cohortCount: number;
}

/** One manifest scenario (frozen seed + params; engineOverrides feed the cycle args). */
export interface ScenarioSpec {
  name: string;
  family: string;
  seed: number;
  quality?: boolean;
  maxCycles?: number;
  engineOverrides?: { minScore?: number; maxMatches?: number; shardCount?: number };
  params: Partial<PopulationParams>;
  noQueue?: boolean;
  tier?: string;
}

/** Minimal convex-test environment surface the scenarios rely on. */
export interface StudyEnv {
  /** Unauthenticated run (raw db access / internal functions). */
  run<T>(fn: (ctx: StudyCtx) => Promise<T>): Promise<T>;
  action<Args, R>(fn: unknown, args: Args): Promise<R>;
  mutation<Args, R>(fn: unknown, args: Args): Promise<R>;
  withIdentity(identity: SyntheticIdentity): {
    mutation<Args, R>(fn: unknown, args: Args): Promise<R>;
    query<Args, R>(fn: unknown, args: Args): Promise<R>;
  };
}

/** Structural subset of the convex-test ctx the study uses. */
export interface StudyCtx {
  db: {
    insert(table: string, doc: Record<string, unknown>): Promise<string>;
    get(id: string): Promise<Record<string, unknown> | null>;
    patch(id: string, doc: Record<string, unknown>): Promise<void>;
    query(table: string): {
      collect(): Promise<Array<Record<string, unknown>>>;
      withIndex(name: string, fn?: unknown): {
        eq(field: string, value: unknown): unknown;
        collect(): Promise<Array<Record<string, unknown>>>;
        first(): Promise<Record<string, unknown> | null>;
        order(dir: "asc" | "desc"): { take(n: number): Promise<Array<Record<string, unknown>>> };
        filter(fn: unknown): { collect(): Promise<Array<Record<string, unknown>>> };
      };
    };
  };
}

export interface ScenarioResult {
  name: string;
  passed: boolean;
  observations: Record<string, unknown>;
  failure?: string;
}

export interface ScenarioContext {
  env: StudyEnv;
  clock: ClockControl;
  /** Fresh environment factory (new in-memory database per call). */
  freshEnv(): StudyEnv;
  defaults: {
    minScore: number;
    maxMatches: number;
    shardCount: number;
  };
}

export type ScenarioFn = (ctx: ScenarioContext) => Promise<ScenarioResult>;

export class StudyAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyAssertionError";
  }
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new StudyAssertionError(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new StudyAssertionError(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
