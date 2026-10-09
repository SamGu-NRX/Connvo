/**
 * Barrel for convex/lib runnable examples.
 *
 * Each `<module>.examples.ts` file exports `runExamples(): Promise<ExampleResult[]>`
 * with self-asserting, hermetic demonstrations of the corresponding convex/lib module.
 * Two entry points consume this barrel:
 *
 *   npx tsx convex/lib/examples/run.ts            # human-readable run, exit 1 on failure
 *   npx vitest run convex/lib/examples            # CI-style assertion of the same examples
 */

import { runExamples as runAlerting } from "./alerting.examples";
import { runExamples as runAudit } from "./audit.examples";
import { runExamples as runBatching } from "./batching.examples";
import { runExamples as runClientOptimizations } from "./clientOptimizations.examples";
import { runExamples as runConfigInfra } from "./config-infra.examples";
import { runExamples as runErrors } from "./errors.examples";
import { runExamples as runIdempotency } from "./idempotency.examples";
import { runExamples as runObsMonitoring } from "./obs-monitoring.examples";
import { runExamples as runPerformance } from "./performance.examples";
import { runExamples as runQueryOptimization } from "./queryOptimization.examples";
import { runExamples as runRateLimit } from "./rateLimit.examples";
import { runExamples as runRateLimiter } from "./rateLimiter.examples";
import { runExamples as runResilience } from "./resilience.examples";
import { runExamples as runUtils } from "./utils.examples";
import { runExamples as runVideo } from "./video.examples";

export interface ExampleResult {
  name: string;
  detail: string;
}

type ExampleModule = () => Promise<ExampleResult[]>;

export const exampleModules: Array<{ module: string; run: ExampleModule }> = [
  { module: "alerting", run: runAlerting },
  { module: "audit", run: runAudit },
  { module: "batching", run: runBatching },
  { module: "clientOptimizations", run: runClientOptimizations },
  { module: "config-infra", run: runConfigInfra },
  { module: "errors", run: runErrors },
  { module: "idempotency", run: runIdempotency },
  { module: "obs-monitoring", run: runObsMonitoring },
  { module: "performance", run: runPerformance },
  { module: "queryOptimization", run: runQueryOptimization },
  { module: "rateLimit", run: runRateLimit },
  { module: "rateLimiter", run: runRateLimiter },
  { module: "resilience", run: runResilience },
  { module: "utils", run: runUtils },
  { module: "video", run: runVideo },
];
