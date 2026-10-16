/**
 * The asynchronous matching run (docs/plan/MATCHING-PLAN.md, "How matching
 * works").
 *
 * One run builds proposals for everyone eligible at once:
 * eligibility -> hard rules -> deterministic score -> 8-person shortlist ->
 * Decisions rerank (injected) -> greedy assignment with a waiting bonus ->
 * the earliest shared slot plus alternatives -> reasons and a first question.
 *
 * Everything here is pure and serializable so the Convex action can gather a
 * snapshot, compute, and hand the drafts to a mutation for writing. The only
 * impure part, the Decisions API, is injected as a function.
 */

import {
  normalizeInterestTag,
  scoreMatcherPair,
  type MatcherPerson,
} from "./scoring";
import { sharedSlots, hasFreeBlockSoon, type WeeklyBlock } from "./slots";
import { STRIKES_PAUSE_THRESHOLD } from "./strikes";
import { buildReasons, pickFirstQuestion } from "./reasons";
import type { DecisionsPerson } from "./decisions";

/** The 90-day recency window for past meetings. */
export const REMATCH_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** Proposals must be at least 18 hours out. */
export const MIN_LEAD_MS = 18 * 60 * 60 * 1000;
/** Slots proposed for the horizon ahead of a run. */
export const SLOT_HORIZON_DAYS = 10;
/** Shortlist size per person. */
export const SHORTLIST_SIZE = 8;
/** Bonus per run a person has waited without a match, capped. */
export const WAITING_BONUS = 0.05;
export const WAITING_BONUS_RUNS_CAP = 4;
const SHARED_MEETING_STATES = new Set(["scheduled", "active", "concluded"]);

export interface MatcherSnapshotPerson extends MatcherPerson {
  userId: string;
  displayName: string;
  languages: string[];
  timezone: string;
  chatsPerWeek: number;
  blocks: WeeklyBlock[];
  /** Confirmed-cadence meetings already scheduled in this calendar week. */
  meetingsThisWeek: number;
  /** Distinct past runs where this person got a proposal that never confirmed. */
  waitingRuns: number;
  /** Active no-show strikes in the last 30 days; two pause matching. */
  strikes: number;
  /** People they shared a meeting with in the last 90 days (both directions). */
  metRecently: string[];
  /** People both sides said they would talk again with, for the waiver. */
  talkAgainBoth: string[];
}

export interface MatcherSnapshot {
  now: number;
  people: MatcherSnapshotPerson[];
}

export interface ProposalDraft {
  userAId: string;
  userBId: string;
  scheduledAt: number;
  alternatives: number[];
  reasons: string[];
  firstQuestion: string;
  score: number;
  sharedInterestKeys: string[];
  goalPair: string;
}

/** Rerank one person's shortlist; resolves to null on any fallback condition. */
export type RerankFn = (
  person: DecisionsPerson,
  candidates: DecisionsPerson[],
) => Promise<Map<string, number> | null>;

export interface PreparedRun {
  eligible: MatcherSnapshotPerson[];
  /** Deterministic score per allowed pair, keyed "low|high". */
  pairScores: Map<string, number>;
  pairDetails: Map<
    string,
    { sharedTags: string[]; goalPairKey: string; sameField: boolean }
  >;
  /** Each person's up to 8 best candidate user ids by deterministic score. */
  shortlists: Map<string, string[]>;
  docFrequency: Map<string, number>;
}

/** Who is eligible this run: room in the cadence, not paused, free time ahead. */
export function selectEligible(snapshot: MatcherSnapshot): MatcherSnapshotPerson[] {
  return snapshot.people.filter(
    (p) =>
      p.chatsPerWeek > 0 &&
      p.chatsPerWeek > p.meetingsThisWeek &&
      Boolean(p.timezone) &&
      // Two no-show strikes in 30 days pause matching until they age out.
      p.strikes < STRIKES_PAUSE_THRESHOLD &&
      hasFreeBlockSoon(p.blocks, p.timezone, snapshot.now),
  );
}

/**
 * An empty list means the person hasn't said, not that they speak nothing:
 * every profile starts with `languages: []` and no screen collects them yet,
 * so treating empty as a mismatch would block every pair. Only two known,
 * disjoint lists rule a pair out.
 */
function sharesLanguage(a: MatcherSnapshotPerson, b: MatcherSnapshotPerson): boolean {
  if (a.languages.length === 0 || b.languages.length === 0) return true;
  const langsA = a.languages.map((l) => l.toLowerCase());
  const langsB = new Set(b.languages.map((l) => l.toLowerCase()));
  return langsA.some((l) => langsB.has(l));
}

function metWithin90Days(
  a: MatcherSnapshotPerson,
  b: MatcherSnapshotPerson,
): boolean {
  return (
    a.metRecently.includes(b.userId) &&
    !a.talkAgainBoth.includes(b.userId) &&
    !b.talkAgainBoth.includes(a.userId)
  );
}

/**
 * Pair dependencies that reach outside the snapshot. Production passes the
 * canonical block check, convex/profiles/moderation.isBlockedEither, so the
 * matcher inherits the exact semantics of the blocks table.
 */
export interface MatcherDeps {
  /** True when either person has blocked the other. */
  isBlocked?: (a: string, b: string) => Promise<boolean>;
}

/**
 * Pairs that are never allowed: either person blocked the other, no shared
 * language, no free time in common at least 18 hours from now, or a shared
 * meeting in the last 90 days unless both said they would talk again.
 */
export async function hardRuleAllowed(
  a: MatcherSnapshotPerson,
  b: MatcherSnapshotPerson,
  now: number,
  deps?: MatcherDeps,
): Promise<boolean> {
  if (deps?.isBlocked && (await deps.isBlocked(a.userId, b.userId))) {
    return false;
  }
  if (!sharesLanguage(a, b)) return false;
  if (metWithin90Days(a, b)) return false;
  const slots = sharedSlots(a.blocks, a.timezone, b.blocks, b.timezone, {
    now,
    minLeadMs: MIN_LEAD_MS,
    maxSlots: 1,
    horizonDays: SLOT_HORIZON_DAYS,
  });
  return slots.length > 0;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Phase one: eligibility, hard rules, deterministic scores, shortlists.
 * Split from assignment so the action can resolve the Decisions rerank (with
 * caching) in between.
 */
export async function prepare(
  snapshot: MatcherSnapshot,
  deps?: MatcherDeps,
): Promise<PreparedRun> {
  const eligible = selectEligible(snapshot);

  // Document frequency over the eligible population, for rarity weighting.
  // Normalized to match what the overlap lookup will query.
  const docFrequency = new Map<string, number>();
  for (const person of eligible) {
    for (const tag of new Set(person.interests.map(normalizeInterestTag))) {
      docFrequency.set(tag, (docFrequency.get(tag) ?? 0) + 1);
    }
  }

  const pairScores = new Map<string, number>();
  const pairDetails = new Map<
    string,
    { sharedTags: string[]; goalPairKey: string; sameField: boolean }
  >();
  const candidatesByPerson = new Map<string, Set<string>>();

  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      if (!(await hardRuleAllowed(a, b, snapshot.now, deps))) continue;
      const scored = scoreMatcherPair(a, b, docFrequency, eligible.length);
      const key = pairKey(a.userId, b.userId);
      pairScores.set(key, scored.score);
      pairDetails.set(key, {
        sharedTags: scored.sharedTags,
        goalPairKey: scored.goalPairKey,
        sameField: Boolean(
          a.field &&
            b.field &&
            a.field.toLowerCase() === b.field.toLowerCase(),
        ),
      });
      if (!candidatesByPerson.has(a.userId)) candidatesByPerson.set(a.userId, new Set());
      if (!candidatesByPerson.has(b.userId)) candidatesByPerson.set(b.userId, new Set());
      candidatesByPerson.get(a.userId)!.add(b.userId);
      candidatesByPerson.get(b.userId)!.add(a.userId);
    }
  }

  const shortlists = new Map<string, string[]>();
  for (const [userId, candidates] of candidatesByPerson) {
    const ranked = [...candidates]
      .map((candidateId) => ({
        candidateId,
        score: pairScores.get(pairKey(userId, candidateId)) ?? 0,
      }))
      .sort(
        (x, y) => y.score - x.score || x.candidateId.localeCompare(y.candidateId),
      )
      .slice(0, SHORTLIST_SIZE)
      .map((c) => c.candidateId);
    shortlists.set(userId, ranked);
  }
  return { eligible, pairScores, pairDetails, shortlists, docFrequency };
}

/**
 * Phase two: the Decisions rerank (injected), then greedy assignment with a
 * waiting bonus, then slots, reasons and the first question.
 *
 * `rerank` returns candidateId -> probability per person, or null when the
 * deterministic score should stand (no key, error, refusal, timeout).
 */
export async function assign(
  snapshot: MatcherSnapshot,
  prepared: PreparedRun,
  rerank?: RerankFn,
): Promise<ProposalDraft[]> {
  const byId = new Map(prepared.eligible.map((p) => [p.userId, p]));

  // One rerank per person for the whole run, computed lazily and memoized;
  // the injected function may hit the Decisions API or its cache.
  const rerankMemo = new Map<string, Promise<Map<string, number> | null>>();
  const rerankFor = async (
    personId: string,
  ): Promise<Map<string, number> | null | undefined> => {
    if (!rerank) return undefined;
    if (!rerankMemo.has(personId)) {
      const person = byId.get(personId)!;
      rerankMemo.set(
        personId,
        rerank(
          personSummary(person),
          (prepared.shortlists.get(personId) ?? [])
            .filter((id) => byId.has(id))
            .map((id) => personSummary(byId.get(id)!)),
        ),
      );
    }
    return await rerankMemo.get(personId)!;
  };

  // Final pair score: half deterministic, half the average of the two rerank
  // directions, when both directions are available.
  const finalScores = new Map<string, number>();
  for (const [key, detScore] of prepared.pairScores) {
    const [aId, bId] = key.split("|");
    let score = detScore;
    const aToB = await rerankFor(aId);
    const bToA = await rerankFor(bId);
    const aProb = aToB?.get(bId);
    const bProb = bToA?.get(aId);
    if (aProb !== undefined && bProb !== undefined) {
      score = 0.5 * detScore + 0.5 * ((aProb + bProb) / 2);
    }
    finalScores.set(key, score);
  }

  const waitingBonus = (person: MatcherSnapshotPerson) =>
    Math.min(person.waitingRuns, WAITING_BONUS_RUNS_CAP) * WAITING_BONUS;

  // Sort all candidate pairs by score plus the waiting bonus of both people,
  // and take pairs greedily, skipping anyone already taken.
  const ordered = [...finalScores.entries()]
    .map(([key, score]) => {
      const [aId, bId] = key.split("|");
      return {
        key,
        aId,
        bId,
        sortScore:
          score + waitingBonus(byId.get(aId)!) + waitingBonus(byId.get(bId)!),
        score,
      };
    })
    .sort(
      (x, y) =>
        y.sortScore - x.sortScore ||
        x.key.localeCompare(y.key),
    );

  const taken = new Set<string>();
  const drafts: ProposalDraft[] = [];
  for (const pair of ordered) {
    if (taken.has(pair.aId) || taken.has(pair.bId)) continue;
    const a = byId.get(pair.aId)!;
    const b = byId.get(pair.bId)!;
    const slots = sharedSlots(a.blocks, a.timezone, b.blocks, b.timezone, {
      now: snapshot.now,
      minLeadMs: MIN_LEAD_MS,
      maxSlots: 4,
      horizonDays: SLOT_HORIZON_DAYS,
    });
    if (slots.length === 0) continue;
    taken.add(pair.aId);
    taken.add(pair.bId);
    const detail = prepared.pairDetails.get(pair.key)!;
    const sameField = detail.sameField;
    const [userAId, userBId] = normalizePair(a.userId, b.userId);
    drafts.push({
      userAId,
      userBId,
      scheduledAt: slots[0],
      alternatives: slots.slice(1),
      reasons: buildReasons({
        sharedTags: detail.sharedTags,
        goalPairKey: detail.goalPairKey,
        sameField,
        field: a.field,
      }),
      firstQuestion: pickFirstQuestion({
        sharedTags: detail.sharedTags,
        goalPairKey: detail.goalPairKey,
      }),
      score: pair.score,
      sharedInterestKeys: detail.sharedTags,
      goalPair: detail.goalPairKey,
    });
  }
  return drafts;
}

function personSummary(person: MatcherSnapshotPerson): DecisionsPerson {
  const parts = [
    `Goals: ${person.intents.join(", ") || "meeting new people"}`,
    person.field ? `Field: ${person.field}` : null,
    person.experience ? `Experience: ${person.experience}` : null,
    `Interests: ${person.interests.join(", ") || "none listed"}`,
  ].filter(Boolean);
  return { userId: person.userId, summary: parts.join("; ") };
}

/** The whole run without a rerank: deterministic only. */
export async function buildProposals(
  snapshot: MatcherSnapshot,
  deps?: MatcherDeps,
): Promise<ProposalDraft[]> {
  return await assign(snapshot, await prepare(snapshot, deps));
}

export { SHARED_MEETING_STATES };
