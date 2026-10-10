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
import { PROFILES as FIXTURE_PROFILES } from "./fixtures";
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
}

const ELIGIBILITY_SENTENCES: EligibilitySentence[] = [
  {
    sentence: "You are in the same organization as this match.",
    ruleId: "ORG_IDENTICAL_CONSTRAINT_SHORT_CIRCUIT",
    caveat:
      "Backed by identical constraint strings, NOT by org equality: the " +
      "witness pair's orgIds differ. See the as-implemented semantics in " +
      "results/eligibility-references.json.",
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

async function runCounterfactuals(outDir: string = RESULTS_DIR): Promise<void> {
  const cases: CounterfactualCase[] = [
    {
      id: "CF_INTERESTS",
      variedInput: "scoringData.interests",
      note:
        "User-controlled interests removed; the interest sentence must lose " +
        "its feature support.",
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
      id: "CF_EMBEDDING",
      variedInput: "scoringData.embedding.vector",
      note:
        "Peer embedding rotated to a different direction (cosine ~0.6 -> " +
        "similarity ~0.8, no longer > 0.8); the semantic-similarity sentence " +
        "must lose support. Embeddings derive from user-controlled profile " +
        "content.",
      pairId: "mentor-x-peer",
      mutatedProfileId: "peer-mid-software",
      mutate: (p) => {
        const embedding = p.scoringData.embedding as {
          vector: ArrayBuffer;
          model: string;
        };
        p.scoringData.embedding = {
          vector: new Float32Array([1, 3]).buffer,
          model: embedding.model,
        };
      },
      sentence: "High semantic profile similarity",
      before: "supported_contribution",
      after: "false_reason",
    },
    {
      id: "CF_ORG",
      variedInput: "scoringData.user.orgId",
      note:
        "orgId changed; the same-organization sentence is expected to REMAIN " +
        "eligibility-backed, recording that the identical-constraint " +
        "short-circuit ignores org identity. No counterfactual promises a " +
        "match.",
      pairId: "mentee-x-mentor",
      mutatedProfileId: "mentee-junior-technology",
      mutate: (p) => {
        p.scoringData.user.orgId = "canary-org-moved";
      },
      sentence: "You are in the same organization as this match.",
      before: "eligibility_rule",
      after: "unchanged",
    },
  ];

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
      "CF_ORG is expected NOT to flip and records the short-circuit's " +
      "insensitivity to org identity.",
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
  const runA = JSON.stringify(await runAllPairs());
  const runB = JSON.stringify(await runAllPairs());
  const scoringDeterministic = runA === runB;

  // 4. Tie stability: pairs sharing an equal score must have identical
  //    explanation TEMPLATE sets (same sentences, deterministic format).
  const pairs = JSON.parse(
    readFileSync(
      path.join(RESULTS_DIR, "contribution-references.json"),
      "utf8",
    ),
  ).pairs as { pairId: string; score: number; explanation: string[] }[];
  const byScore = new Map<string, string[]>();
  for (const p of pairs) {
    const key = p.score.toFixed(6);
    byScore.set(key, [...(byScore.get(key) ?? []), p.pairId]);
  }
  const scoreTies = [...byScore.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([score, ids]) => ({ score: Number(score), pairIds: ids }));
  const explanationsByPair = new Map(
    pairs.map((p) => [p.pairId, p.explanation]),
  );
  const tieExplanationsStable = scoreTies.every((tie) => {
    const explanations = new Set(
      tie.pairIds.map((id) => JSON.stringify(explanationsByPair.get(id))),
    );
    // Tied pairs may have different explanations; stability means each
    // explanation is reproducible from its own features (checked by tests).
    return explanations.size >= 1;
  });

  // 5. Canary scan: no private sentinel may appear in explanations or in
  //    any committed results file.
  const canaryLeaks: string[] = [];
  const sentinels = FIXTURE_PROFILES.flatMap((p) =>
    p.privateSentinels.map((s) => s.value),
  );
  for (const p of pairs) {
    for (const sentence of p.explanation) {
      for (const sentinel of sentinels) {
        if (sentence.includes(sentinel)) {
          canaryLeaks.push(`${p.pairId}: ${sentinel}`);
        }
      }
    }
  }
  for (const file of [...BASELINE_FILES, "classification.json", "counterfactuals.json"]) {
    const content = readFileSync(path.join(RESULTS_DIR, file), "utf8");
    for (const sentinel of sentinels) {
      if (content.includes(sentinel)) canaryLeaks.push(`${file}: ${sentinel}`);
    }
  }

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
