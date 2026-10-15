/**
 * Written banks for proposal reasons and the suggested first question.
 *
 * No model writes text (docs/plan/MATCHING-PLAN.md, step 8): reasons are
 * sentences from the features that contributed most, named specifically, and
 * the first question comes from a bank keyed by shared interest and goal.
 */

import { normalizeInterestTag } from "./scoring";

/** Human phrasing for the normalized interest tags that can appear in pairs. */
const INTEREST_LABELS: Record<string, string> = {
  "artificial intelligence": "AI",
  "machine learning": "machine learning",
  javascript: "JavaScript",
  typescript: "TypeScript",
  "venture capital": "venture capital",
};

function interestLabel(tag: string): string {
  return INTEREST_LABELS[tag] ?? tag;
}

/** A reason sentence for a shared interest, naming it. */
export function interestReason(tag: string): string {
  return `You both work on or enjoy ${interestLabel(tag)}`;
}

const GOAL_REASON: Record<string, string> = {
  "find_mentor|mentor":
    "You're looking for a mentor and they mentor people",
  "collaborate|collaborate":
    "You're both looking for collaborators or a cofounder",
  "hiring|job_seeking": "They're hiring and you're looking for a job",
  "peers|peers": "You're both meeting peers in your field",
  "explore_field|find_mentor":
    "You want to explore a new field and they can show you how it works",
  "explore_field|mentor":
    "You want to explore a new field and they can show you how it works",
  "explore_field|peers":
    "You want to explore a new field and they work in one",
  "explore_field|hiring":
    "You want to explore a new field and they know who is hiring in one",
  "explore_field|collaborate":
    "You want to explore a new field and they're building something",
  "explore_field|job_seeking":
    "You want to explore a new field and they're navigating the job market",
};

/** The goal-pair sentence, when the pair's goals fit. */
export function goalReason(goalPairKey: string): string | null {
  return GOAL_REASON[goalPairKey] ?? null;
}

/** A reason sentence when both people work in the same field. */
export function fieldReason(field: string): string {
  return `You both work in ${field}`;
}

/**
 * The two or three specific reasons for a proposal, from the features that
 * contributed most: the rarest shared interests by name, then the goal pair,
 * then the field. Ordered most specific first.
 */
export function buildReasons(input: {
  sharedTags: string[];
  goalPairKey: string;
  sameField: boolean;
  field?: string | null;
}): string[] {
  const reasons: string[] = [];
  for (const tag of input.sharedTags.slice(0, 2)) {
    reasons.push(interestReason(tag));
  }
  const goal = goalReason(input.goalPairKey);
  if (goal) reasons.push(goal);
  if (input.sameField && input.field && reasons.length < 3) {
    reasons.push(fieldReason(input.field));
  }
  return reasons.slice(0, 3);
}

/** First-question bank entries, keyed by normalized shared interest. */
const INTEREST_QUESTIONS: Record<string, string[]> = {
  rust: [
    "What are you building with Rust, and what sold you on it?",
    "Where has Rust been worth the fight for you, and where has it not?",
  ],
  bouldering: [
    "How did you get into bouldering, and what's the hardest problem you've solved?",
  ],
  "artificial intelligence": [
    "What's the most surprising thing AI has changed in your work this year?",
  ],
  "machine learning": [
    "Are you closer to the research side or the shipping side of ML?",
  ],
  javascript: [
    "What's a JavaScript tool that quietly made your work better?",
  ],
  typescript: [
    "How strict do you run your TypeScript, and why?",
  ],
  startup: [
    "What's the problem you'd drop everything to work on?",
  ],
  design: [
    "What's a product whose design you keep coming back to?",
  ],
  photography: [
    "What do you photograph, and what does it let you notice?",
  ],
  cooking: [
    "What dish do you make when you want to impress someone?",
  ],
  running: [
    "What are you training for, or what do you run away from?",
  ],
  writing: [
    "What are you writing right now, and who is it for?",
  ],
};

const GOAL_QUESTIONS: Record<string, string[]> = {
  "find_mentor|mentor": [
    "When you look back, what did your best mentor actually do for you?",
    "What's the one decision in front of you that you'd most want a second view on?",
  ],
  "collaborate|collaborate": [
    "What are you each building, and where do the two overlap?",
    "What kind of collaborator do you work best with?",
  ],
  "hiring|job_seeking": [
    "What would your next role have to have that your last one didn't?",
    "What does your team actually need right now?",
  ],
  "peers|peers": [
    "What's changed in your field in the last year that people outside it wouldn't notice?",
  ],
};

const DEFAULT_QUESTIONS = [
  "What's the most interesting thing you've worked on this year?",
  "What are you curious about right now that work doesn't cover?",
];

/**
 * The suggested first question: up to four candidates from the written bank
 * keyed by shared interest and goal; the caller (or the Decisions API) picks
 * among them. Deterministic and pure.
 */
export function firstQuestionCandidates(input: {
  sharedTags: string[];
  goalPairKey: string;
}): string[] {
  const out: string[] = [];
  for (const tag of input.sharedTags) {
    const bank = INTEREST_QUESTIONS[normalizeInterestTag(tag)];
    if (bank) out.push(...bank);
  }
  const goalBank = GOAL_QUESTIONS[input.goalPairKey];
  if (goalBank) out.push(...goalBank);
  out.push(...DEFAULT_QUESTIONS);
  return [...new Set(out)].slice(0, 4);
}

/**
 * The deterministic pick when the Decisions API is unavailable: the first
 * candidate that comes from a shared interest, else the first goal question,
 * else the default.
 */
export function pickFirstQuestion(input: {
  sharedTags: string[];
  goalPairKey: string;
}): string {
  return firstQuestionCandidates(input)[0];
}
