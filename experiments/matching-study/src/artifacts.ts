/**
 * Result artifact writers: every artifact embeds the frozen seed, source
 * hashes, and run identity so results bind to exact code + seed.
 */

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import { createHash } from "node:crypto";

export function sha256File(path: string): string {
  return createHash("sha256").update(nodeFs.readFileSync(path)).digest("hex");
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function hashStudySources(root: string): Record<string, string> {
  const dir = nodePath.join(root, "experiments", "matching-study");
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of nodeFs.readdirSync(d, { withFileTypes: true })) {
      const p = nodePath.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "results") continue;
        walk(p);
      } else if (/\.(ts|json|md)$/.test(e.name)) {
        out[nodePath.relative(dir, p)] = sha256File(p);
      }
    }
  };
  walk(dir);
  return out;
}

export function writeJson(path: string, value: unknown): void {
  nodeFs.mkdirSync(nodePath.dirname(path), { recursive: true });
  nodeFs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function environment(gitSha: string): Record<string, unknown> {
  const cpus = nodeOs.cpus();
  return {
    recordedAt: new Date().toISOString(),
    platform: `${nodeOs.platform()} ${nodeOs.arch()}`,
    uname: `${nodeOs.type()} ${nodeOs.release()}`,
    node: process.version,
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    totalMemBytes: nodeOs.totalmem(),
    freeMemBytes: nodeOs.freemem(),
    gitSha,
    note: "package versions pinned in package.json / pnpm-lock.yaml (convex, convex-test, vitest)",
  };
}

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.floor((p / 100) * sortedValues.length));
  return sortedValues[idx];
}

export function percentileSummary(values: number[]): { p50: number; p90: number; p99: number; max: number; count: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    count: sorted.length,
  };
}
