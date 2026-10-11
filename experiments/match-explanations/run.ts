/**
 * Milestone-2 classifier and counterfactuals for the match-explanations
 * experiment.
 *
 * Modes:
 *   --manifest <path>     Classify each proposed public sentence for every
 *                         pair and commit results/classification.json.
 *   --counterfactual      Recompute the REAL handler with one user-controlled
 *                         input varied and record whether the affected
 *                         sentence's classification flips as expected.
 *
 * Classification classes:
 *   supported_contribution  production template whose computed feature
 *                           satisfies its threshold
 *   eligibility_rule        sentence backed by a recorded eligibility rule
 *   missing_data_statement  missing-data claim corroborated by neutral-branch
 *                           (0.5) features
 *   fallback_sentinel       the production fallback sentence (traceable as a
 *                           documented absence of supported contributions)
 *   false_reason            sentence IS a known template but the computed
 *                           feature contradicts it
 *   untraceable_assertion   no rule or feature backs the sentence
 *
 * Usage:
 *   corepack pnpm exec tsx experiments/match-explanations/run.ts --manifest manifest.json
 *   corepack pnpm exec tsx experiments/match-explanations/run.ts --counterfactual
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PAIRS, PROFILES, type SyntheticProfile } from "./fixtures";
import { REPO_ROOT, runAllPairs, runHandlerPair } from "./harness";
import { buildBaseline } from "./emit-baseline";
import {
  deriveEmbedding,
  PROFILES as FIXTURE_PROFILES,
  profileById,
} from "./fixtures";
import { pathToFileURL } from "node:url";
import {
  COMPUTED_BUT_UNSURFACED,
  CONTRIBUTION_CONDITIONS,
  FALLBACK_SENTENCE,
} from "./references";

const RESULTS_DIR = path.join(__dirname, "results");

type SentenceClass =
  | "supported_contribution"
  | "eligibility_rule"
  | "missing_data_statement"
  | "fallback_sentinel"
  | "false_reason"
  | "untraceable_assertion";

const TRACEABLE: Set<SentenceClass> = new Set([
  "supported_contribution",
  "eligibility_rule",
  "missing_data_statement",
  "fallback_sentinel",
]);

interface EligibilitySentence {
  sentence: string;
  ruleId: string;
  caveat?: string;
  /**
   * When the computed feature equals this value, the rule's outcome
   * contradicts the sentence's claim and the sentence is a false reason
   * rather than an eligibility-backed statement.
   */
  contradicts?: { feature: string; value: number };
}

const ELIGIBILITY_SENTENCES: EligibilitySentence[] = [
  {
    sentence: "You are in the same organization as this match.",
    ruleId: "ORG_IDENTICAL_CONSTRAINT_SHORT_CIRCUIT",
    caveat:
      "Backed by identical constraint strings, NOT by org equality: the " +
      "witness pair's orgIds differ. See the as-implemented semantics in " +
      "results/eligibility-references.json.",
    contradicts: { feature: "orgConstraintMatch", value: 0 },
  },
];

const MISSING_DATA_CLAIM_RE = /limited (profile )?data|data (was|were|is) missing/i;

const PROMISE_RE =
  /\b(definitely|guaranteed|perfect match|destined|are sure to|will)\b/i;

const UNTRACEABLE_NOTES: { match: RegExp; reason: string }[] = [
  {
    match: /time zone/i,
    reason:
      "timezoneCompatibility is a hardcoded 1.0 placeholder " +
      "(TIMEZONE_PLACEHOLDER): it derives from no user-controlled data, so " +
      "no sentence can truthfully cite it.",
  },
  {
    match: /same industry/i,
    reason:
      "industryMatch is computed but never cited by any explanation " +
      "sentence (the COMPUTED_BUT_UNSURFACED finding).",
  },
];

type Features = Record<string, number | undefined | null>;

interface Classification {
  classification: SentenceClass;
  reason?: string;
  flag?: string;
  feature?: string;
  condition?: string;
  computedValue?: number | undefined | null;
  ruleId?: string;
  caveat?: string;
  neutralFeatures?: string[];
}

function classifySentence(sentence: string, features: Features): Classification {
  // 0. Promise language is never traceable, even if it shares template words.
  if (PROMISE_RE.test(sentence)) {
    return {
      classification: "untraceable_assertion",
      reason: "Promise language: explanations must not promise a match.",
      flag: "promise_language",
    };
  }
  // 1. Production fallback: traceable as documented absence.
  if (sentence === FALLBACK_SENTENCE) {
    return {
      classification: "fallback_sentinel",
      reason: "Production fallback; emitted when no contribution condition fired.",
    };
  }
  // 2. Contribution template: check the computed feature against threshold.
  const condition = CONTRIBUTION_CONDITIONS.find(
    (c) => c.sentence === sentence,
  );
  if (condition) {
    const value = features[condition.feature];
    // A null/undefined value (e.g. missing embedding) can never satisfy a
    // contribution threshold.
    const holds =
      value !== null && value !== undefined
        ? condition.holds({ [condition.feature]: value } as never)
        : false;
    return holds
      ? {
          classification: "supported_contribution",
          feature: condition.feature,
          condition: condition.condition,
          computedValue: value,
        }
      : {
          classification: "false_reason",
          feature: condition.feature,
          condition: condition.condition,
          computedValue: value,
          reason: "Known template contradicted by the computed feature value.",
        };
  }
  // 3. Eligibility-backed sentence.
  const eligibility = ELIGIBILITY_SENTENCES.find(
    (e) => e.sentence === sentence,
  );
  if (eligibility) {
    if (
      eligibility.contradicts &&
      features[eligibility.contradicts.feature] ===
        eligibility.contradicts.value
    ) {
      return {
        classification: "false_reason",
        ruleId: eligibility.ruleId,
        feature: eligibility.contradicts.feature,
        computedValue: features[eligibility.contradicts.feature],
        reason:
          "Eligibility rule outcome contradicts the claim " +
          `(${eligibility.contradicts.feature} === ${eligibility.contradicts.value}).`,
      };
    }
    return {
      classification: "eligibility_rule",
      ruleId: eligibility.ruleId,
      caveat: eligibility.caveat,
    };
  }
  // 4. Missing-data claim: corroborated only when the FULL neutral-branch
  //    signature is present (all three features at 0.5 — the null-profile
  //    path). A lone 0.5 can be a genuine computed value (e.g. one of two
  //    languages shared) and must not corroborate the claim.
  if (MISSING_DATA_CLAIM_RE.test(sentence)) {
    const neutral = ["experienceGap", "industryMatch", "languageOverlap"].filter(
      (f) => features[f] === 0.5,
    );
    return neutral.length === 3
      ? {
          classification: "missing_data_statement",
          reason: "Corroborated by the full neutral-branch signature (experienceGap, industryMatch, and languageOverlap all 0.5).",
          neutralFeatures: neutral,
        }
      : {
          classification: "false_reason",
          reason: "Missing-data claim contradicted: the neutral-branch signature is incomplete.",
        };
  }
  // 5. Known untraceable reasons.
  for (const note of UNTRACEABLE_NOTES) {
    if (note.match.test(sentence)) {
      return {
        classification: "untraceable_assertion",
        reason: note.reason,
      };
    }
  }
  // 6. Default: nothing backs this sentence.
  return {
    classification: "untraceable_assertion",
    reason: "No contribution template, eligibility rule, or feature witness.",
  };
}

async function classifyManifest(
  manifestPath: string,
  outDir: string = RESULTS_DIR,
): Promise<void> {
  const referencesPath = path.join(RESULTS_DIR, "contribution-references.json");
  const references = JSON.parse(readFileSync(referencesPath, "utf8"));
  const featuresByPair = new Map<string, Features>();
  for (const pair of references.pairs) {
    featuresByPair.set(pair.pairId, pair.features);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const classified = manifest.pairs.map(
    (pair: { pairId: string; proposedExplanation: string[] }) => {
      const features = featuresByPair.get(pair.pairId);
      if (!features) throw new Error(`unknown pairId ${pair.pairId}`);
      const sentences = pair.proposedExplanation.map((sentence) => ({
        sentence,
        ...classifySentence(sentence, features),
      }));
      const traceable = sentences.filter((s) =>
        TRACEABLE.has(s.classification as SentenceClass),
      ).length;
      return {
        pairId: pair.pairId,
        sentences,
        counts: {
          total: sentences.length,
          traceable,
          traceableShare: Number((traceable / sentences.length).toFixed(3)),
        },
      };
    },
  );

  const payload = {
    manifest: path.basename(manifestPath),
    note:
      "Classification of proposed public explanation sentences against " +
      "computed features (from results/contribution-references.json) and " +
      "recorded eligibility rules. Traceable share counts supported " +
      "contributions, eligibility-backed sentences, corroborated " +
      "missing-data statements, and the production fallback sentinel.",
    computedButUnsurfaced: COMPUTED_BUT_UNSURFACED,
    pairs: classified,
  };
  writeFileSync(
    path.join(outDir, "classification.json"),
    JSON.stringify(payload, null, 2) + "\n",
  );

  for (const pair of classified) {
    console.log(
      `${pair.pairId}: traceable share ${pair.counts.traceableShare} ` +
        `(${pair.counts.traceable}/${pair.counts.total})`,
    );
  }
}

interface CounterfactualCase {
  id: string;
  /** The user-facing surface through which this input is legitimately changed. */
  permittedInput: string;
  variedInput: string;
  note: string;
  pairId: string;
  /** Which side of the pair is mutated (profile id). */
  mutatedProfileId: string;
  mutate: (profile: SyntheticProfile) => void;
  sentence: string;
  before: SentenceClass;
  /** Expected class after mutation, or "unchanged". */
  after: SentenceClass | "unchanged";
}

function cloneProfile(profile: SyntheticProfile): SyntheticProfile {
  // structuredClone preserves ArrayBuffers (JSON round-trips destroy
  // embedding vectors).
  return structuredClone(profile);
}

export const COUNTERFACTUAL_CASES: CounterfactualCase[] = [
  {
    id: "CF_INTERESTS",
    permittedInput: "Profile editor: the user edits their interest list.",
    variedInput: "scoringData.interests",
    note:
      "User-controlled interests no longer overlap; the interest sentence " +
      "must lose its feature support.",
    pairId: "mentee-x-mentor",
    mutatedProfileId: "mentee-junior-technology",
    mutate: (p) => {
      p.scoringData.interests = ["cooking"];
    },
    sentence: "Strong interest alignment",
    before: "supported_contribution",
    after: "false_reason",
  },
  {
    id: "CF_EXPERIENCE",
    permittedInput: "Profile editor: the user updates their experience level.",
    variedInput: "scoringData.profile.experience",
    note:
      "Experience moved to the mentor's own level (gap 0 -> 0.7); the " +
      "ideal-gap sentence must lose support.",
    pairId: "mentee-x-mentor",
    mutatedProfileId: "mentee-junior-technology",
    mutate: (p) => {
      p.scoringData.profile!.experience = "senior";
    },
    sentence: "Ideal experience gap for mentorship",
    before: "supported_contribution",
    after: "false_reason",
  },
  {
    id: "CF_FIELD_REEMBED",
    permittedInput:
      "Profile editor: the user changes their professional field from " +
      "Software to Design; the platform then recomputes the profile " +
      "embedding from profile content.",
    variedInput:
      "scoringData.profile.field, with the embedding recomputed via " +
      "deriveEmbedding (the synthetic embedder standing in for the " +
      "production embedding model)",
    note:
      "The embedding vector is NEVER edited directly: only the " +
      "user-controlled profile field changes, and the embedder recomputes " +
      "the vector from it, exactly as the production pipeline would. " +
      "Cosine similarity with the mentor drops from ~0.99 to ~0.32, below " +
      "the 0.8 threshold; the semantic-similarity sentence must lose support.",
    pairId: "mentor-x-peer",
    mutatedProfileId: "peer-mid-software",
    mutate: (p) => {
      p.scoringData.profile!.field = "Design";
      const re = deriveEmbedding(p.scoringData);
      if (re) p.scoringData.embedding = re;
    },
    sentence: "High semantic profile similarity",
    before: "supported_contribution",
    after: "false_reason",
  },
  {
    id: "CF_ROLE_PREFERENCE",
    permittedInput:
      "Match-settings editor: the user changes the role they are seeking " +
      "from mentee to mentor.",
    variedInput: "constraints.roles (user matching preferences)",
    note:
      "With both sides seeking the mentor role the roles are same-role " +
      "(0.7), no longer complementary (1.0); the complementary-roles " +
      "sentence must lose support.",
    pairId: "mentor-x-peer",
    mutatedProfileId: "peer-mid-software",
    mutate: (p) => {
      p.constraints.roles = ["mentor"];
    },
    sentence: "Complementary professional roles",
    before: "supported_contribution",
    after: "false_reason",
  },
  {
    id: "CF_ORG_PREFERENCE",
    permittedInput:
      "Match-settings editor: the user changes their organization " +
      "matching preference. orgId itself is system-assigned and is never " +
      "varied here.",
    variedInput: "constraints.orgConstraints (user matching preferences)",
    note:
      "The mentee's org matching preference changes from same_org to " +
      "different_org. With constraint strings no longer identical the " +
      "short-circuit is gone and the differing orgs resolve to " +
      "orgConstraintMatch 0.0; the same-organization sentence must become " +
      "a false reason.",
    pairId: "mentee-x-mentor",
    mutatedProfileId: "mentee-junior-technology",
    mutate: (p) => {
      p.constraints.orgConstraints = "different_org";
    },
    sentence: "You are in the same organization as this match.",
    before: "eligibility_rule",
    after: "false_reason",
  },
];

async function runCounterfactuals(outDir: string = RESULTS_DIR): Promise<void> {
  const cases = COUNTERFACTUAL_CASES;

  const results: unknown[] = [];
  let allExpected = true;

  for (const cf of cases) {
    const pair = PAIRS.find((p) => p.pairId === cf.pairId);
    if (!pair) throw new Error(`unknown pairId ${cf.pairId}`);
    const left = cloneProfile(
      PROFILES.find((p) => p.id === pair.leftId)!,
    );
    const right = cloneProfile(
      PROFILES.find((p) => p.id === pair.rightId)!,
    );
    const mutated =
      pair.leftId === cf.mutatedProfileId ? left : right;
    if (mutated.id !== cf.mutatedProfileId) {
      throw new Error(
        `mutatedProfileId ${cf.mutatedProfileId} is on neither side of ${cf.pairId}`,
      );
    }

    // BEFORE: unmutated pair through the same real-handler path.
    const beforeFeatures = (await runHandlerPair(
      left,
      right,
    )) as unknown as Features;
    const beforeDetail = classifySentence(cf.sentence, beforeFeatures);

    // AFTER: one user-controlled input varied, same path.
    cf.mutate(mutated);
    const afterFeatures = (await runHandlerPair(
      left,
      right,
    )) as unknown as Features;
    const afterDetail = classifySentence(cf.sentence, afterFeatures);

    const beforeMatched = beforeDetail.classification === cf.before;
    const afterMatched =
      cf.after === "unchanged"
        ? afterDetail.classification === cf.before
        : afterDetail.classification === cf.after;
    const matched = beforeMatched && afterMatched;
    if (!matched) allExpected = false;
    results.push({
      id: cf.id,
      permittedInput: cf.permittedInput,
      variedInput: cf.variedInput,
      note: cf.note,
      sentence: cf.sentence,
      before: {
        classification: beforeDetail.classification,
        computedValue: beforeDetail.computedValue,
      },
      after: {
        classification: afterDetail.classification,
        computedValue: afterDetail.computedValue,
      },
      expectation: { before: cf.before, after: cf.after },
      expectationMet: matched,
    });
  }

  const payload = {
    note:
      "Counterfactuals vary ONE user-controlled input at a time, re-score " +
      "through the REAL handler, and re-classify the affected sentence. " +
      "Every varied input is something a user can legitimately change " +
      "(profile content or matching preferences); system-assigned fields " +
      "(orgId) and derived artifacts (embedding vectors) are never edited " +
      "directly.",
    allExpectationsMet: allExpected,
    cases: results,
  };
  writeFileSync(
    path.join(outDir, "counterfactuals.json"),
    JSON.stringify(payload, null, 2) + "\n",
  );
  console.log(`Counterfactuals: allExpectationsMet=${allExpected}`);
  if (!allExpected) process.exitCode = 1;
}


export interface LeakHit {
  corpus: string;
  sentinel: string;
}

/**
 * Canary scanner: report every occurrence of a private-field sentinel in a
 * proposed-public text corpus. Exported so tests can exercise it directly,
 * including the deliberately leaked negative control.
 */
export function scanCorpusForLeaks(
  corpus: string[],
  sentinels: string[],
): LeakHit[] {
  const hits: LeakHit[] = [];
  for (const text of corpus) {
    for (const sentinel of sentinels) {
      if (text.includes(sentinel)) {
        hits.push({ corpus: text.slice(0, 100), sentinel });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Milestone 3: replay, stability, and page generation
// ---------------------------------------------------------------------------

const BASELINE_FILES = [
  "source-hashes.json",
  "fixture-inventory.json",
  "contribution-references.json",
  "eligibility-references.json",
];

interface StabilityReport {
  replayMatches: { file: string; matches: boolean }[];
  classificationReplayMatches: boolean;
  counterfactualReplayMatches: boolean;
  scoringDeterministic: boolean;
  scoreTies: { score: number; pairIds: string[] }[];
  tieExplanationsStable: boolean;
  canaryLeaks: string[];
  canaryControl: {
    corpus: string;
    sentinelPlanted: string;
    detectedLeaks: string[];
    detected: boolean;
  };
  falseReasonMutations: { total: number; met: number };
  pageKeyboardStructure: {
    focusableElements: number;
    positiveTabindex: number;
    detailsWithoutSummary: number;
    passed: boolean;
  };
  allPassed: boolean;
}

/** Generate the experiment-only read-only results page. */
function generatePage(resultsDir: string): string {
  const classification = JSON.parse(
    readFileSync(path.join(resultsDir, "classification.json"), "utf8"),
  );
  const references = JSON.parse(
    readFileSync(path.join(resultsDir, "contribution-references.json"), "utf8"),
  );
  const counterfactuals = JSON.parse(
    readFileSync(path.join(resultsDir, "counterfactuals.json"), "utf8"),
  );
  const data = {
    classification,
    scores: references.pairs.map((p: { pairId: string; score: number }) => ({
      pairId: p.pairId,
      score: p.score,
    })),
    counterfactuals: {
      allExpectationsMet: counterfactuals.allExpectationsMet,
      cases: counterfactuals.cases.map(
        (c: { id: string; expectationMet: boolean }) => ({
          id: c.id,
          expectationMet: c.expectationMet,
        }),
      ),
    },
  };

  const escapeHtml = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const pairSections = classification.pairs.map(
    (pair: {
      pairId: string;
      counts: { traceableShare: number; traceable: number; total: number };
      sentences: {
        sentence: string;
        classification: string;
        feature?: string;
        computedValue?: number | undefined | null;
      }[];
    }) => `
      <details class="pair" id="${escapeHtml(pair.pairId)}">
        <summary>
          <strong>${escapeHtml(pair.pairId)}</strong>
          — traceable share ${pair.counts.traceableShare} (${pair.counts.traceable}/${pair.counts.total})
        </summary>
        <table>
          <caption>Sentence-level classification for ${escapeHtml(pair.pairId)}</caption>
          <thead>
            <tr><th scope="col">Sentence</th><th scope="col">Class</th><th scope="col">Feature</th><th scope="col">Value</th></tr>
          </thead>
          <tbody>
            ${pair.sentences
              .map(
                (s) => `<tr><td>${escapeHtml(s.sentence)}</td><td>${escapeHtml(s.classification)}</td><td>${escapeHtml(s.feature ?? "—")}</td><td>${s.computedValue === undefined || s.computedValue === null ? "—" : escapeHtml(String(s.computedValue))}</td></tr>`,
              )
              .join("\n")}
          </tbody>
        </table>
      </details>`,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Match Explanations — Traceability Snapshot</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 40rem; padding: 1rem 1.25rem 3rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); padding: 0.35rem 0.5rem; text-align: left; }
  summary { cursor: pointer; padding: 0.4rem 0; }
  summary strong { font-family: ui-monospace, monospace; font-size: 0.95rem; }
  .badge { display: inline-block; border: 1px solid currentColor; border-radius: 999px; padding: 0.1rem 0.6rem; font-size: 0.8rem; }
  .met { color: #1a7f37; } .failed { color: #c0392b; }
  :focus-visible { outline: 3px solid #4c9aff; outline-offset: 2px; }
  .skip { position: absolute; left: -9999px; }
  .skip:focus { left: 1rem; top: 1rem; background: canvas; padding: 0.5rem; }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to results</a>
<header>
  <h1>Match Explanations — Traceability Snapshot</h1>
  <p>Read-only snapshot of experiment results. No data can be changed here.</p>
</header>
<main id="main">
  <h2>Per-pair traceability</h2>
  ${pairSections.join("\n")}
  <h2>Counterfactual mutations</h2>
  <p>All ${
    data.counterfactuals.cases.length
  } single-input mutations met expectations:
    <span class="badge ${data.counterfactuals.allExpectationsMet ? "met" : "failed"}">${
      data.counterfactuals.allExpectationsMet ? "PASS" : "FAIL"
    }</span></p>
  <h2>Composite scores</h2>
  <ul>
    ${data.scores
      .map(
        (s: { pairId: string; score: number }) =>
          `<li><code>${escapeHtml(s.pairId)}</code>: ${s.score.toFixed(3)}</li>`,
      )
      .join("\n")}
  </ul>
</main>
<footer>
  <p>Generated by experiments/match-explanations/run.ts — synthetic data only.</p>
</footer>
</body>
</html>
`;
}

/** Structural keyboard-accessibility checks on the generated page. */
function checkPageKeyboardStructure(pagePath: string): StabilityReport["pageKeyboardStructure"] {
  const html = readFileSync(pagePath, "utf8");
  const focusable = (html.match(/<summary|<a\s|<button/g) ?? []).length;
  const positiveTabindex = (html.match(/tabindex="\d+"/g) ?? []).filter(
    (t) => Number(t.match(/\d+/)![0]) > 0,
  ).length;
  const detailsCount = (html.match(/<details/g) ?? []).length;
  const summaryCount = (html.match(/<summary/g) ?? []).length;
  return {
    focusableElements: focusable,
    positiveTabindex,
    detailsWithoutSummary: Math.max(0, detailsCount - summaryCount),
    passed: positiveTabindex === 0 && detailsCount === summaryCount,
  };
}

async function runReplay(): Promise<void> {
  // 1. Baseline replay: recompute into a temp dir, byte-compare.
  const tmp = mkdtempSync(path.join(tmpdir(), "mx-replay-"));
  await buildBaseline(tmp);
  const replayMatches = BASELINE_FILES.map((file) => {
    const committed = readFileSync(path.join(RESULTS_DIR, file));
    const fresh = readFileSync(path.join(tmp, file));
    return { file, matches: committed.equals(fresh) };
  });
  rmSync(tmp, { recursive: true, force: true });

  // 2. Classification + counterfactual replays into temp, byte-compare.
  const tmp2 = mkdtempSync(path.join(tmpdir(), "mx-replay2-"));
  await classifyManifest(path.join(__dirname, "manifest.json"), tmp2);
  await runCounterfactuals(tmp2);
  const classificationReplayMatches = readFileSync(
    path.join(tmp2, "classification.json"),
  ).equals(readFileSync(path.join(RESULTS_DIR, "classification.json")));
  const counterfactualReplayMatches = readFileSync(
    path.join(tmp2, "counterfactuals.json"),
  ).equals(readFileSync(path.join(RESULTS_DIR, "counterfactuals.json")));
  rmSync(tmp2, { recursive: true, force: true });

  // 3. Scoring determinism: two consecutive full runs must agree exactly.
  const runA = await runAllPairs();
  const runB = await runAllPairs();
  const scoringDeterministic = JSON.stringify(runA) === JSON.stringify(runB);

  // 4. Tie stability: pairs that tie on composite score AND share identical
  //    computed features (the twin pairs) must also produce identical
  //    explanations — a deterministic generator cannot disagree with itself
  //    on identical inputs.
  const byScore = new Map<string, typeof runA>();
  for (const r of runA) {
    const key = r.score.toFixed(6);
    byScore.set(key, [...(byScore.get(key) ?? []), r]);
  }
  const scoreTies = [...byScore.entries()]
    .filter(([, rs]) => rs.length > 1)
    .map(([score, rs]) => ({
      score: Number(score),
      pairIds: rs.map((r) => r.pairId),
    }));
  const tieExplanationsStable = scoreTies.every((tie) => {
    const group = tie.pairIds.map(
      (id) => runA.find((r) => r.pairId === id)!,
    );
    const featureSignatures = new Set(
      group.map((r) => JSON.stringify(r.features)),
    );
    if (featureSignatures.size !== 1) return true; // numeric-only tie
    const explanationSignatures = new Set(
      group.map((r) => JSON.stringify(r.explanation)),
    );
    return explanationSignatures.size === 1;
  });

  // 5. Canary scan: no private sentinel may appear in any explanation or in
  //    any committed results file — and the NEGATIVE CONTROL corpus (a
  //    deliberately leaked sentence) MUST be flagged, proving the scan
  //    fails when a leak actually exists.
  const canaryLeaks: string[] = [];
  const sentinels = FIXTURE_PROFILES.flatMap((p) =>
    p.privateSentinels.map((s) => s.value),
  );
  for (const p of runA) {
    for (const leak of scanCorpusForLeaks(p.explanation, sentinels)) {
      canaryLeaks.push(`${p.pairId}: ${leak.sentinel}`);
    }
  }
  for (const file of [...BASELINE_FILES, "classification.json", "counterfactuals.json"]) {
    const content = readFileSync(path.join(RESULTS_DIR, file), "utf8");
    for (const leak of scanCorpusForLeaks([content], sentinels)) {
      canaryLeaks.push(`${file}: ${leak.sentinel}`);
    }
  }

  // 5b. Negative control: fabricate the leak a broken generator would emit
  //     (a real explanation sentence with a private displayName interpolated)
  //     and require the scanner to flag it. The real handler is NOT leaking —
  //     this corpus is deliberately corrupted to exercise the check.
  const controlProfile = profileById("leaky-mentee-control");
  const controlSentinel =
    controlProfile.privateSentinels.find((s) => s.field === "displayName")!
      .value;
  const baseExplanation =
    runA.find((r) => r.pairId === "mentee-x-mentor")!.explanation;
  const controlCorpus = [
    `${baseExplanation[0]} — recommended by ${controlSentinel} (admin note)`,
  ];
  const controlLeaks = scanCorpusForLeaks(controlCorpus, sentinels);
  const canaryControl = {
    corpus:
      "fabricated leak: real mentee-x-mentor explanation sentence with the " +
      "private displayName of leaky-mentee-control interpolated",
    sentinelPlanted: controlSentinel,
    detectedLeaks: controlLeaks.map((l) => l.sentinel),
    detected: controlLeaks.length > 0,
  };

  // 6. False-reason mutation outcomes.
  const counterfactuals = JSON.parse(
    readFileSync(path.join(RESULTS_DIR, "counterfactuals.json"), "utf8"),
  );
  const cfCases = counterfactuals.cases as { expectationMet: boolean }[];
  const falseReasonMutations = {
    total: cfCases.length,
    met: cfCases.filter((c) => c.expectationMet).length,
  };

  // 7. Regenerate the page and check its keyboard structure.
  const pagePath = path.join(__dirname, "page", "index.html");
  mkdirSync(path.dirname(pagePath), { recursive: true });
  writeFileSync(pagePath, generatePage(RESULTS_DIR));
  const pageKeyboardStructure = checkPageKeyboardStructure(pagePath);

  const allPassed =
    replayMatches.every((r) => r.matches) &&
    classificationReplayMatches &&
    counterfactualReplayMatches &&
    scoringDeterministic &&
    tieExplanationsStable &&
    canaryLeaks.length === 0 &&
    canaryControl.detected &&
    falseReasonMutations.met === falseReasonMutations.total &&
    pageKeyboardStructure.passed;

  const report: StabilityReport = {
    replayMatches,
    classificationReplayMatches,
    counterfactualReplayMatches,
    scoringDeterministic,
    scoreTies,
    tieExplanationsStable,
    canaryLeaks,
    canaryControl,
    falseReasonMutations,
    pageKeyboardStructure,
    allPassed,
  };
  writeFileSync(
    path.join(RESULTS_DIR, "stability.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(`Replay + stability: allPassed=${allPassed}`);
  if (!allPassed) process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--manifest")) {
    const manifestArg = args[args.indexOf("--manifest") + 1] ?? "manifest.json";
    const manifestPath = manifestArg.startsWith("/")
      ? manifestArg
      : path.join(__dirname, manifestArg);
    await classifyManifest(manifestPath);
    return;
  }
  if (args.includes("--counterfactual")) {
    await runCounterfactuals();
    return;
  }
  if (args.includes("--replay")) {
    await runReplay();
    return;
  }
  console.error(
    "Usage: run.ts --manifest <path> | run.ts --counterfactual | run.ts --replay",
  );
  process.exit(1);
}

// Only execute when invoked directly (tsx run.ts ...); importing this module
// (e.g. from the test suite) must stay side-effect free.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
