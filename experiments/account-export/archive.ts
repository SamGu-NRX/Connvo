/**
 * Archive validation and leak-token derivation for the account-export study.
 *
 * validateArchive checks the archive's INTERNAL consistency only (envelope
 * shape, policy checksum, per-table ordering, refs, sensitive-field
 * redaction, pagination math). It knows nothing about the fixture universe —
 * that cross-check lives in run.ts and the tests.
 */

import { createHash } from "node:crypto";
import { POLICY_CHECKSUM, POLICY_VERSION, TABLE_POLICIES } from "./projection";
import type { ExportArchive, PaginationReceipt, Refusal } from "./functions";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Leak tokens: distinctive private strings that must NOT appear in the archive
// ---------------------------------------------------------------------------

export interface LeakToken {
  token: string;
  origin: string;
}

export function buildLeakTokens(fixture: any, classification: any[]): LeakToken[] {
  const tokens: LeakToken[] = [];
  const push = (token: unknown, origin: string) => {
    if (typeof token === "string" && token.length > 0) tokens.push({ token, origin });
  };

  const callerRef: string = fixture.callerRef;

  // Row ids the policy excludes from the export. NOTE: excluded ids may still
  // appear as foreign keys inside OWNER rows (documented exception), so these
  // are checked against refs receipts and refusal entries, not row bodies.
  const excludedRowIds = classification
    .filter((r) => r.class === "excluded")
    .map((r) => r.id);

  const exportedMeetingRefs = new Set(
    classification
      .filter((r) => r.table === "meetings" && r.class !== "excluded")
      .map((r) => r.ref),
  );

  for (const u of fixture.users as any[]) {
    push(u.workosUserId, `users.${u.ref}.workosUserId`);
    if (u.ref !== callerRef) {
      push(u.email, `users.${u.ref}.email`);
      push(u.displayName, `users.${u.ref}.displayName`);
      push(u.profile?.bio, `users.${u.ref}.profile.bio`);
    }
    for (const ins of u.insights as any[]) {
      if (u.ref !== callerRef) push(ins.summary, `insights.${ins.ref}.summary`);
    }
  }

  for (const m of fixture.meetings as any[]) {
    // Stream room ids and recording urls are redacted from every exported row.
    push(m.streamRoomId, `meetings.${m.ref}.streamRoomId`);
    if (m.recording) push(m.recording.recordingUrl, `meetingRecordings.${m.recording.ref}.recordingUrl`);
    if (m.videoRoomConfig) push(m.videoRoomConfig.roomId, `videoRoomConfigs.${m.videoRoomConfig.ref}.roomId`);

    // Content of meetings without export scope for the caller.
    if (!exportedMeetingRefs.has(m.ref)) {
      push(m.title, `meetings.${m.ref}.title`);
      push(m.description, `meetings.${m.ref}.description`);
      for (const tr of m.transcripts.explicit as any[]) push(tr.text, `transcripts.${tr.ref}.text`);
      if (m.notes) push(m.notes.content, `meetingNotes.${m.notes.ref}.content`);
    }
    for (const msg of m.messages as any[]) push(msg.content, `messages.${msg.ref}.content`);
  }

  return { tokens, excludedRowIds };
}

// ---------------------------------------------------------------------------
// Archive validation (internal consistency, fixture-agnostic)
// ---------------------------------------------------------------------------

export interface ValidationOptions {
  /** Expected pagination page size the runner requested (for receipt math). */
  requestedPageSize?: number;
}

export function validateArchive(archive: any, opts: ValidationOptions = {}): {
  perTable: Record<string, number>;
  total: number;
} {
  if (!archive || typeof archive !== "object") throw new Error("archive: not an object");
  if (typeof archive.exportId !== "string" || !archive.exportId.startsWith("export-")) {
    throw new Error("envelope: exportId missing or malformed");
  }
  if (archive.status !== "completed") throw new Error("envelope: status must be 'completed'");
  if (archive.format !== "json") throw new Error("envelope: format must be 'json'");

  const meta = archive.metadata;
  if (!meta || typeof meta.requestedAt !== "number" || typeof meta.completedAt !== "number" || typeof meta.recordCount !== "number") {
    throw new Error("envelope: metadata incomplete");
  }
  if (meta.completedAt !== meta.requestedAt) throw new Error("envelope: completedAt must equal requestedAt (deterministic clock)");

  const receipts = archive.receipts;
  if (!receipts?.policy) throw new Error("receipts: missing policy receipt");
  if (receipts.policy.version !== POLICY_VERSION) throw new Error("receipts.policy: version mismatch");
  if (receipts.policy.checksum !== POLICY_CHECKSUM) throw new Error("receipts.policy: checksum mismatch");
  if (receipts.policy.checksum !== receipts.schema.fingerprint) throw new Error("receipts: policy checksum and schema fingerprint disagree");
  if (receipts.version.policyVersion !== POLICY_VERSION) throw new Error("receipts.version: mismatch");
  if (receipts.version.archiveFormat !== "account-export-archive-v1") throw new Error("receipts.version: archive format mismatch");

  const expectedTables = TABLE_POLICIES.map((p) => p.table);
  if (JSON.stringify(receipts.schema.tableNames) !== JSON.stringify(expectedTables)) {
    throw new Error("receipts.schema: tableNames do not match policy order");
  }

  const perTable: Record<string, number> = {};
  let total = 0;

  for (const p of TABLE_POLICIES) {
    const table = p.table;
    const rows: any[] = archive.records[table];
    if (!Array.isArray(rows)) throw new Error(`records.${table}: missing array`);

    // deterministic ordering by _id
    const ids = rows.map((r) => String(r._id));
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(ids) !== JSON.stringify(sorted)) {
      throw new Error(`records.${table}: rows not sorted by _id`);
    }

    // refs receipt mirrors the exported rows exactly
    if (JSON.stringify(receipts.refs[table]) !== JSON.stringify(ids)) {
      throw new Error(`receipts.refs.${table}: does not match exported rows`);
    }

    // no sensitive top-level field survives
    for (const row of rows) {
      for (const sf of p.sensitiveFields) {
        if (Object.prototype.hasOwnProperty.call(row, sf)) {
          throw new Error(`records.${table}: sensitive field "${sf}" present in exported row`);
        }
      }
      // every surviving key must be a policy field
      for (const key of Object.keys(row)) {
        if (key === "_id") continue; // system field, kept for ref receipts
        if (!p.fields.includes(key)) {
          throw new Error(`records.${table}: key "${key}" is not in the policy field list`);
        }
      }
    }

    // pagination receipt math
    const receipt: PaginationReceipt | undefined = receipts.pagination[table];
    if (!receipt) throw new Error(`receipts.pagination.${table}: missing`);
    if (receipt.rows !== rows.length) throw new Error(`receipts.pagination.${table}: row count mismatch`);
    if (receipt.pageSize < 1 || receipt.pageSize > 100) throw new Error(`receipts.pagination.${table}: pageSize out of bounds`);
    if (rows.length === 0 && receipt.pages > 1) throw new Error(`receipts.pagination.${table}: empty table claims multiple pages`);
    if (rows.length > 0 && !receipt.truncated) {
      const expectedPages = Math.ceil(rows.length / receipt.pageSize);
      if (receipt.mode !== "unique" && receipt.mode !== "merged-index" && receipt.pages !== expectedPages) {
        throw new Error(`receipts.pagination.${table}: pages ${receipt.pages} != ceil(rows/pageSize) ${expectedPages}`);
      }
    }
    if (receipt.truncated && rows.length > 1000) {
      throw new Error(`receipts.pagination.${table}: truncation claimed but over the row cap`);
    }

    perTable[table] = rows.length;
    total += rows.length;
  }

  if (total !== meta.recordCount) throw new Error(`envelope: recordCount ${meta.recordCount} != summed rows ${total}`);

  // refusals: every entry names its authority source; none carries db ids.
  const refusals: Refusal[] = archive.refusals;
  if (!Array.isArray(refusals)) throw new Error("refusals: missing array");
  const idShaped = /\b[a-z0-9]{20,}\b/i;
  for (const r of refusals) {
    if (!r.table || !r.reason || !r.authoritySource) throw new Error("refusals: entry missing table/reason/authoritySource");
    const json = JSON.stringify(r);
    for (const p of TABLE_POLICIES) {
      for (const id of receipts.refs[p.table]) {
        if (json.includes(id)) {
          throw new Error(`refusals: entry for ${r.table} leaks a document id`);
        }
      }
    }
    if (idShaped.test(r.meeting ?? "")) {
      throw new Error("refusals: meeting label looks like a document id");
    }
  }

  return { perTable, total };
}
