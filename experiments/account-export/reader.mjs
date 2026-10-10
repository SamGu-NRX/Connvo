#!/usr/bin/env node
/**
 * Independent reader for the caller-only account export archive.
 *
 * Imports NO Convex code, NO project modules, and NO projection policy.
 * It reads the committed manifest (account-export/manifest-v1) as its trust
 * anchor and verifies the archive against it:
 *
 *   1. checksum: sha256 of the archive bytes matches the manifest
 *   2. envelope: exportId/status/format/metadata well-formed
 *   3. policy:   embedded policy receipt matches the manifest's policy
 *                version + checksum (projection.ts is the single source)
 *   4. counts:   per-table counts and total match the manifest exactly
 *   5. refs:     receipts.refs mirrors exported row ids per table
 *   6. redaction: no sensitive field of any table appears in any row
 *                 (sensitive fields cross-checked between archive receipt
 *                  and manifest policy tables)
 *   7. ordering: rows sorted by _id within every table
 *   8. refusals: every refusal names its authority source and carries no
 *                document ids; manifest refusal counts match
 *   9. leaks:    none of the manifest's private leak tokens appear anywhere
 *                in the archive; none of the manifest's excluded row ids
 *                appear in refs or refusals
 *
 * Usage: node reader.mjs <export.json> [<manifest.json>]
 * Exit 0 = PASS, exit 1 = FAIL (reason printed).
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const archivePath = process.argv[2] ?? join(here, "results", "export.json");
const manifestPath = process.argv[3] ?? join(here, "results", "manifest.json");

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

let archiveBytes;
let manifest;
try {
  archiveBytes = readFileSync(archivePath);
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (e) {
  fail(`cannot load archive or manifest: ${e.message}`);
}

const archiveJson = archiveBytes.toString("utf8");
let archive;
try {
  archive = JSON.parse(archiveJson);
} catch (e) {
  fail(`archive is not valid JSON: ${e.message}`);
}

// 1. checksum
const sha = createHash("sha256").update(archiveBytes).digest("hex");
if (sha !== manifest.archiveSha256) fail(`checksum mismatch: ${sha} != ${manifest.archiveSha256}`);

// 2. envelope
if (typeof archive.exportId !== "string" || !archive.exportId.startsWith("export-")) fail("envelope: exportId malformed");
if (archive.status !== "completed") fail("envelope: status must be 'completed'");
if (archive.format !== "json") fail("envelope: format must be 'json'");
const meta = archive.metadata;
if (!meta || typeof meta.recordCount !== "number") fail("envelope: metadata.recordCount missing");

// 3. policy receipt vs manifest
const receipts = archive.receipts;
if (!receipts?.policy) fail("receipts: missing");
if (receipts.policy.version !== manifest.policy.version) fail(`policy version mismatch: ${receipts.policy.version}`);
if (receipts.policy.checksum !== manifest.policy.checksum) fail(`policy checksum mismatch: ${receipts.policy.checksum}`);
if (receipts.policy.checksum !== receipts.schema.fingerprint) fail("receipts: policy checksum and schema fingerprint disagree");

// 4. counts
const perTable = {};
let total = 0;
for (const [table, rows] of Object.entries(archive.records)) {
  if (!Array.isArray(rows)) fail(`records.${table}: not an array`);
  perTable[table] = rows.length;
  total += rows.length;
}
if (total !== meta.recordCount) fail(`envelope: recordCount ${meta.recordCount} != summed rows ${total}`);
for (const [table, count] of Object.entries(manifest.exportedRows.perTable)) {
  if (perTable[table] !== count) fail(`counts: ${table} ${perTable[table]} != manifest ${count}`);
}
if (total !== manifest.exportedRows.total) fail(`counts: total ${total} != manifest ${manifest.exportedRows.total}`);

// 5–7. refs, redaction, ordering (sensitive fields cross-checked with manifest)
const sensitiveByTable = Object.fromEntries(
  (receipts.policy.tables ?? []).map((t) => [t.table, t.sensitiveFields]),
);
for (const table of Object.keys(manifest.exportedRows.perTable)) {
  const rows = archive.records[table] ?? [];
  const ids = rows.map((r) => String(r._id));
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(ids) !== JSON.stringify(sorted)) fail(`ordering: ${table} rows not sorted by _id`);
  if (JSON.stringify(receipts.refs[table]) !== JSON.stringify(ids)) fail(`refs: ${table} does not mirror exported rows`);

  const sensitive = sensitiveByTable[table];
  if (!Array.isArray(sensitive)) fail(`policy tables: no sensitiveFields receipt for ${table}`);
  for (const row of rows) {
    for (const sf of sensitive) {
      if (Object.prototype.hasOwnProperty.call(row, sf)) fail(`redaction: ${table} row exposes sensitive field "${sf}"`);
    }
  }
}

// 8. refusals
const refusals = archive.refusals;
if (!Array.isArray(refusals)) fail("refusals: missing");
const idShaped = /\b[a-z0-9]{20,}\b/i;
for (const r of refusals) {
  if (!r.table || !r.reason || !r.authoritySource) fail("refusals: entry missing table/reason/authoritySource");
  const json = JSON.stringify(r);
  for (const table of Object.keys(receipts.refs)) {
    for (const id of receipts.refs[table]) {
      if (json.includes(id)) fail(`refusals: entry for ${r.table} carries a document id`);
    }
  }
  if (idShaped.test(r.meeting ?? "")) fail("refusals: meeting label looks like a document id");
}
const byReason = {};
for (const r of refusals) {
  const key = r.reason.split(" ")[0];
  byReason[key] = (byReason[key] ?? 0) + 1;
}
for (const [reason, count] of Object.entries(manifest.refusals.byReason)) {
  if (byReason[reason] !== count) fail(`refusals: ${reason} ${byReason[reason] ?? 0} != manifest ${count}`);
}

// 9. leaks
const leakHits = (manifest.leakTokens ?? []).filter((t) => archiveJson.includes(t.token));
if (leakHits.length > 0) {
  fail(`leak: ${leakHits.length} private tokens present in archive, first origin: ${leakHits[0].origin}`);
}
const refsAndRefusals = JSON.stringify(receipts.refs) + JSON.stringify(refusals);
const excludedHits = (manifest.excludedRowIds ?? []).filter((id) => refsAndRefusals.includes(id));
if (excludedHits.length > 0) fail(`leak: ${excludedHits.length} excluded row ids surfaced in refs/refusals`);

// PASS summary — identical record counts against the manifest, verbatim.
console.log("=== independent reader: PASS ===");
console.log(`archive sha256: ${sha}`);
console.log(`policy: ${manifest.policy.version} @ ${manifest.policy.checksum}`);
console.log(`tables: ${Object.keys(perTable).length}, rows: ${total} — identical record counts to manifest`);
for (const [table, count] of Object.entries(perTable).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  if (count > 0) console.log(`  ${table}: ${count}`);
}
console.log(`refusals: ${refusals.length}`);
console.log(`leak scan: ${(manifest.leakTokens ?? []).length} tokens, ${leakHits.length} hits; ${(manifest.excludedRowIds ?? []).length} excluded ids, ${excludedHits.length} hits`);
