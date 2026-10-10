/**
 * Runner for the caller-only account export study.
 *
 * Executes the full pipeline against a convex-test backend:
 *   1. seed the deterministic fixture universe (fixtures.json)
 *   2. invoke the export function as the caller (alice) with a fixed clock
 *   3. validate the archive's internal consistency
 *   4. cross-check the runtime outcome against the fixture classification
 *   5. leak-scan the serialized archive against tokens derived from data
 *      the policy must not export
 *   6. write the archive, an independent-reader manifest, and per-run receipts
 *
 * Usage: npx tsx experiments/account-export/run.ts [--out results/export.json]
 *        [--manifest results/manifest.json] [--pageSize 100]
 *
 * Determinism: the fixture clock fixes requestedAt/completedAt, seeding order
 * fixes document ids, and the projection policy sorts records by _id — two
 * runs against the same fixture produce byte-identical archives apart from
 * nothing (exportId embeds the clock, not wall time).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../../convex/schema.js";
import { seedFixture, type Fixture } from "./seed";
import { exportMyAccountData } from "./functions";
import { validateArchive, buildLeakTokens } from "./archive";
import { TABLE_POLICIES, POLICY_CHECKSUM, POLICY_VERSION } from "./projection";

/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

const here = dirname(fileURLToPath(import.meta.url));

// --- args ------------------------------------------------------------------
function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}
const outPath = arg("out", join(here, "results", "export.json"));
const manifestPath = arg("manifest", join(here, "results", "manifest.json"));
const pageSize = parseInt(arg("pageSize", "100"), 10);
const requestedAt = 1760000000000; // fixture clock — deterministic

// --- fixture ----------------------------------------------------------------
const fixturePath = join(here, "fixtures.json");
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

// --- harness ----------------------------------------------------------------
async function main() {
const modules: Record<string, Record<string, unknown>> = {
  // convex-test anchors its module-root prefix on a "_generated" key; the
  // real generated api stub satisfies it and the virtual experiment module
  // (registered under the same prefix) carries the export handler.
  "convex/_generated/api": () => import("../../convex/_generated/api.js"),
  "convex/experiments/account-export/functions": { exportMyAccountData },
};

const t = convexTest(schema as any, modules as any);

// --- seed -------------------------------------------------------------------
const seeded = await seedFixture(t as any, fixture as any);

// --- run the export as the caller -------------------------------------------
const caller = fixture.users.find((u) => u.ref === fixture.callerRef)!;

const archive = await (t as any)
  .withIdentity({
    subject: caller.workosUserId,
    email: caller.email,
    name: caller.displayName,
  })
  .run(async (ctx: any) => {
    return exportMyAccountData._handler(ctx, {
      requestedAt,
      pageSize,
    });
  });

// --- 3. internal validation --------------------------------------------------
const validation = validateArchive(archive, { requestedPageSize: pageSize });

// --- 4. cross-check against the fixture classification ----------------------
const ownerSharedByTable = new Map<string, Set<string>>();
for (const row of seeded.classification) {
  if (row.class === "excluded") continue;
  const set = ownerSharedByTable.get(row.table) ?? new Set<string>();
  set.add(row.id);
  ownerSharedByTable.set(row.table, set);
}

const crossCheck: { table: string; fixture: number; exported: number; match: boolean }[] = [];
for (const p of TABLE_POLICIES) {
  const exported = validation.perTable[p.table] ?? 0;
  const fixtureCount = ownerSharedByTable.get(p.table)?.size ?? 0;
  crossCheck.push({ table: p.table, fixture: fixtureCount, exported, match: exported === fixtureCount });

  // every exported id must be a classified owner/shared id of that table
  for (const id of archive.receipts.refs[p.table]) {
    if (!ownerSharedByTable.get(p.table)?.has(id)) {
      throw new Error(`cross-check: exported row ${id} in ${p.table} was not classified owner/shared`);
    }
  }
}

// refusal receipt expectations from the classification
const refusedMeetings = new Set(
  seeded.classification.filter((r) => r.table === "meetings" && r.class === "excluded").map((r) => r.id),
);
// The classification rows excluded for missing export authority: the fixture's
// m2 rows in the three exportable meeting-scoped tables (transcripts,
// transcriptSegments, meetingNotes) — alice participates but does not host.
const noExportScope = seeded.classification.filter(
  (r) =>
    r.class === "excluded" && r.reason.startsWith("refused_missing_export_permission"),
).length;
const noGrantAggregates = new Set(
  seeded.classification.filter((r) => r.class === "excluded" && r.reason.startsWith("no_export_authority_defined")).map((r) => r.table),
).size;
// Unrelated meetings (the caller holds no organizer or participants row) are
// never discovered, so the export emits no receipt for them — the archive
// cannot reveal their existence or count.
const noParticipation = 0;

const refusalSummary = {
  missing_export_permission: archive.refusals.filter((r) => r.reason.startsWith("missing_export_permission")).length,
  no_export_authority_defined: archive.refusals.filter((r) => r.reason.startsWith("no_export_authority_defined")).length,
  no_meeting_participation: archive.refusals.filter((r) => r.reason.startsWith("no_meeting_participation")).length,
};

const refusalExpectations = { noExportScope, noGrantAggregates, noParticipation };
const refusalCheck = {
  expected: refusalExpectations,
  actual: refusalSummary,
  match:
    refusalSummary.missing_export_permission === noExportScope &&
    refusalSummary.no_export_authority_defined === noGrantAggregates &&
    refusalSummary.no_meeting_participation === noParticipation,
};
if (!refusalCheck.match) {
  throw new Error(
    `refusal receipt mismatch: expected ${JSON.stringify(refusalExpectations)}, got ${JSON.stringify(refusalSummary)}`,
  );
}

// --- 5. leak scan -------------------------------------------------------------
const { tokens, excludedRowIds } = buildLeakTokens(fixture as any, seeded.classification as any);
const archiveJson = JSON.stringify(archive, null, 2);
const tokenHits = tokens.filter((t) => archiveJson.includes(t.token));
if (tokenHits.length > 0) {
  throw new Error(
    `LEAK: ${tokenHits.length} private tokens present in archive, e.g. ${JSON.stringify(tokenHits.slice(0, 3))}`,
  );
}

// excluded row ids must not appear as exported refs or inside refusal entries
const refsJson = JSON.stringify(archive.receipts.refs);
const refusalsJson = JSON.stringify(archive.refusals);
const refIdHits = excludedRowIds.filter((id: string) => refsJson.includes(id) || refusalsJson.includes(id));
if (refIdHits.length > 0) {
  throw new Error(`LEAK: ${refIdHits.length} excluded row ids surfaced in refs/refusals`);
}

// --- 5b. indifference proof ----------------------------------------------------
// Two extra meetings owned by other users (carol hosts, each with private
// transcript content) are inserted after the baseline export. If discovery is
// scoped correctly, re-running the export produces a byte-identical archive:
// unrelated meetings must never change the output.
const perturbedArchive = await (t as any)
  .withIdentity({
    subject: caller.workosUserId,
    email: caller.email,
    name: caller.displayName,
  })
  .run(async (ctx: any) => {
    const carolId = seeded.refToId["carol"];
    for (let i = 0; i < 2; i++) {
      const mid = await ctx.db.insert("meetings", {
        organizerId: carolId,
        title: `unrelated private meeting ${i}`,
        description: "belongs to other users entirely",
        scheduledAt: 1759996800000 + (i + 1) * 3_600_000,
        duration: 1800,
        webrtcEnabled: true,
        streamRoomId: `stream-room-unrelated-${i}-secret`,
        state: "concluded",
        participantCount: 1,
        createdAt: requestedAt,
        updatedAt: requestedAt,
      });
      await ctx.db.insert("meetingParticipants", {
        meetingId: mid,
        userId: carolId,
        role: "host",
        joinedAt: requestedAt,
        presence: "joined",
        createdAt: requestedAt,
      });
      await ctx.db.insert("transcripts", {
        meetingId: mid,
        bucketMs: 0,
        sequence: 1,
        speakerId: "spk-carol",
        text: `unrelated private transcript line ${i} — must never surface`,
        confidence: 0.9,
        startMs: 0,
        endMs: 900,
        wordCount: 8,
        language: "en",
        createdAt: requestedAt,
      });
    }
    return exportMyAccountData._handler(ctx, { requestedAt, pageSize });
  });
const perturbedJson = JSON.stringify(perturbedArchive, null, 2);
if (perturbedJson !== archiveJson) {
  throw new Error(
    "INDIFFERENCE CHECK FAILED: adding unrelated meetings changed the caller's archive",
  );
}

// --- 6. write outputs -----------------------------------------------------------
mkdirSync(dirname(outPath), { recursive: true });
mkdirSync(dirname(manifestPath), { recursive: true });
const archiveBytes = Buffer.from(archiveJson + "\n", "utf8");
writeFileSync(outPath, archiveBytes);

const manifest = {
  manifestVersion: "account-export/manifest-v1",
  fixtureId: fixture.fixtureId,
  fixtureSha256: createHash("sha256").update(readFileSync(fixturePath)).digest("hex"),
  repoSha: process.env.CONNVO_REPO_SHA ?? null,
  policy: {
    version: POLICY_VERSION,
    checksum: POLICY_CHECKSUM,
  },
  archiveSha256: createHash("sha256").update(archiveBytes).digest("hex"),
  caller: {
    ref: fixture.callerRef,
    email: caller.email,
    orgRole: caller.orgRole,
    identity: "workosUserId — requireIdentity resolves via users.by_workos_id",
  },
  clock: {
    requestedAt,
    note: "deterministic clock from the fixture; exportId embeds it, not wall time",
  },
  classification: seeded.classCounts,
  exportedRows: {
    perTable: validation.perTable,
    total: validation.total,
  },
  refusals: {
    count: archive.refusals.length,
    byReason: refusalSummary,
    expectations: refusalExpectations,
    match: refusalCheck.match,
  },
  indifference: {
    addedUnrelatedMeetings: 2,
    archiveSha256Unchanged: perturbedJson === archiveJson,
    note: "two extra meetings owned by other users were inserted after the baseline export; the re-run archive is byte-identical — unrelated meetings are never discovered, counted, or receipted",
  },
  leakScan: {
    tokenCount: tokens.length,
    tokenHits: 0,
    excludedRowIdCount: excludedRowIds.length,
    excludedRowIdHits: 0,
    note: "excluded row ids may appear as foreign keys inside owner rows (documented exception); they are checked against refs receipts and refusal entries only",
  },
  leakTokens: tokens,
  excludedRowIds,
  ordering: {
    by: ["table", "_id"],
    stableAcrossRuns: true,
    note: "two runs against the same fixture produce byte-identical archives",
  },
  reader: {
    command: "node experiments/account-export/reader.mjs experiments/account-export/results/export.json",
    note: "independent reader: imports no Convex, no project code, no projection policy",
  },
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

// --- run receipt (append-only per run) ---------------------------------------
const runReceiptPath = join(here, "results", "runs.jsonl");
const runReceipt = {
  at: new Date().toISOString(),
  archiveSha256: manifest.archiveSha256,
  recordCount: validation.total,
  refusalCount: archive.refusals.length,
  leakTokenCount: tokens.length,
  ok: true,
};
try {
  const existing = readFileSync(runReceiptPath, "utf8").trimEnd();
  writeFileSync(runReceiptPath, existing + "\n" + JSON.stringify(runReceipt) + "\n");
} catch {
  writeFileSync(runReceiptPath, JSON.stringify(runReceipt) + "\n");
}

// --- summary ------------------------------------------------------------------
console.log("=== caller-only account export: PASS ===");
console.log(`fixture rows: ${JSON.stringify(seeded.classCounts)}`);
console.log(`exported rows: ${validation.total} across ${TABLE_POLICIES.length} tables`);
for (const row of crossCheck.filter((c) => c.exported > 0)) {
  console.log(`  ${row.table}: ${row.exported} (fixture ${row.fixture}) ${row.match ? "✓" : "✗"}`);
}
console.log(`refusals: ${archive.refusals.length} ${JSON.stringify(refusalSummary)}`);
console.log(`leak scan: ${tokens.length} tokens, ${tokenHits.length} hits`);
console.log(`archive: ${outPath} (sha256 ${manifest.archiveSha256.slice(0, 16)}…)`);
console.log(`manifest: ${manifestPath}`);
}

main().catch((err) => {
  console.error("=== caller-only account export: FAIL ===");
  console.error(err);
  process.exit(1);
});
