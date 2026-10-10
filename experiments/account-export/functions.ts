/**
 * Experiment functions for the caller-only account export study.
 *
 * These functions are NOT registered in the production Convex function tree:
 * they live under experiments/ and are bound into convex-test through a
 * virtual module entry ("accountExport") at test time. The committed
 * _generated/api tree is stale and offline codegen is unavailable, so the
 * study invokes these handlers through convex-test's function-ref resolution
 * with validator-checked arguments — the same execution, transaction, and
 * auth-mocking path production functions get, without adding anything to
 * convex/ or src/.
 *
 * Authority is derived ONLY from the production contract:
 *   - requireIdentity (convex/auth/guards.ts:42) — anonymous and deactivated
 *     callers are refused outright.
 *   - Meeting-scoped inclusion requires a caller participant row (the
 *     assertMeetingAccess rule) and an export grant from the production
 *     permission matrix (permissionsForResource). Missing authority produces
 *     a recorded REFUSAL — never a guessed permission and never silent data.
 */

import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireIdentity } from "../../convex/auth/guards";
import { normalizeRole, permissionsForResource } from "../../convex/lib/permissions";
import {
  AUTHORITY_SOURCES,
  MAX_PAGE_SIZE,
  MAX_ROWS_PER_TABLE,
  MEETING_SCOPED_EXPORTABLE,
  MEETING_SCOPED_NO_GRANT,
  POLICY_CHECKSUM,
  POLICY_VERSION,
  TABLE_POLICIES,
  projectRow,
} from "./projection";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PaginationReceipt {
  mode: "index" | "unique" | "bounded-scan" | "merged-index";
  pages: number;
  pageSize: number;
  rows: number;
  truncated: boolean;
}

export interface Refusal {
  table: string;
  meeting?: string;
  role?: string;
  scope?: Record<string, number>;
  reason: string;
  authoritySource: string;
}

export interface ExportArchive {
  exportId: string;
  status: "completed";
  format: "json";
  metadata: {
    requestedAt: number;
    completedAt: number;
    recordCount: number;
  };
  receipts: {
    policy: {
      version: string;
      checksum: string;
      tables: Array<{ table: string; sensitiveFields: string[] }>;
      authoritySources: Record<string, string>;
    };
    schema: {
      tablesInPolicy: number;
      tableNames: string[];
      fingerprint: string;
    };
    version: {
      policyVersion: string;
      archiveFormat: "account-export-archive-v1";
    };
    refs: Record<string, string[]>;
    pagination: Record<string, PaginationReceipt>;
  };
  refusals: Refusal[];
  records: Record<string, Array<Record<string, unknown>>>;
}

// ---------------------------------------------------------------------------
// Pagination helpers (bounded)
// ---------------------------------------------------------------------------

interface PageResult {
  rows: Array<Record<string, any>>;
  pages: number;
  truncated: boolean;
}

async function paginateIndex(
  makeQuery: () => any,
  pageSize: number,
  maxRows: number,
): Promise<PageResult> {
  const rows: Array<Record<string, any>> = [];
  let cursor: string | null = null;
  let pages = 0;
  let isDone = false;
  while (rows.length < maxRows) {
    // A fresh builder per page: the cursor carries the position, but a query
    // object may not be re-chained after iteration begins under convex-test.
    const page = await makeQuery().paginate({
      numItems: Math.min(pageSize, maxRows - rows.length),
      cursor,
    });
    pages++;
    isDone = page.isDone;
    for (const row of page.page) {
      rows.push(row);
    }
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return { rows, pages, truncated: !isDone || rows.length >= maxRows };
}

function sortedById(rows: Array<Record<string, any>>): Array<Record<string, any>> {
  return [...rows].sort((a, b) => String(a._id).localeCompare(String(b._id)));
}

// ---------------------------------------------------------------------------
// The export function
// ---------------------------------------------------------------------------

export const exportMyAccountData = queryGeneric({
  args: {
    /** Deterministic clock for reproducible archives. Defaults to wall clock. */
    requestedAt: v.optional(v.number()),
    /** Page size for bounded pagination; clamped to MAX_PAGE_SIZE (100). */
    pageSize: v.optional(v.number()),
    /** Per-table row cap; clamped to MAX_ROWS_PER_TABLE (1000). */
    maxRowsPerTable: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ExportArchive> => {
    // ---- AUTHORITY GATE ---------------------------------------------------
    // Anonymous callers (no JWT) and deactivated accounts are refused here.
    const identity = await requireIdentity(ctx);

    const now = args.requestedAt ?? Date.now();
    const pageSize = Math.max(1, Math.min(args.pageSize ?? 50, MAX_PAGE_SIZE));
    const maxRowsPerTable = Math.max(
      1,
      Math.min(args.maxRowsPerTable ?? MAX_ROWS_PER_TABLE, MAX_ROWS_PER_TABLE),
    );

    const records: Record<string, Array<Record<string, unknown>>> = {};
    const refs: Record<string, string[]> = {};
    const pagination: Record<string, PaginationReceipt> = {};
    // Uniform envelope: every policy table appears in receipts, even when the
    // export produced no rows (refusal-covered tables export empty records).
    for (const p of TABLE_POLICIES) {
      records[p.table] = [];
      refs[p.table] = [];
      pagination[p.table] = { mode: "index", pages: 0, pageSize, rows: 0, truncated: false };
    }
    const refusals: Refusal[] = [];

    const record = (
      table: string,
      rows: Array<Record<string, any>>,
      receipt: Omit<PaginationReceipt, "rows">,
      mode: PaginationReceipt["mode"],
    ) => {
      const projected = sortedById(rows).map((r) => projectRow(table, r));
      records[table] = projected;
      refs[table] = projected.map((r) => String(r._id));
      pagination[table] = { ...receipt, mode, rows: projected.length };
    };

    // ---- OWNER TABLES (caller's own rows, by identity-scoped indexes) ------

    const userRow = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q: any) => q.eq("workosUserId", identity.workosUserId))
      .unique();
    if (userRow) {
      record("users", [userRow], { pages: 1, pageSize, truncated: false }, "unique");
    } else {
      refusals.push({
        table: "users",
        reason: "caller_identity_unresolved",
        authoritySource: AUTHORITY_SOURCES.requireIdentity,
      });
    }

    const userKeyedIndexes: Array<[string, string]> = [
      ["profiles", "by_user"],
      ["userSettings", "by_user"],
      ["userInterests", "by_user"],
      ["insights", "by_user"],
      ["matchingQueue", "by_user"],
      ["matchingAnalytics", "by_user"],
    ];
    for (const [table, indexName] of userKeyedIndexes) {
      const { rows, pages, truncated } = await paginateIndex(
        () =>
          ctx.db.query(table).withIndex(indexName, (q: any) => q.eq("userId", identity.userId)),
        pageSize,
        maxRowsPerTable,
      );
      record(table, rows, { pages, pageSize, truncated }, "index");
    }

    // connections: either party
    const asRequester = await paginateIndex(
      () =>
        ctx.db.query("connections").withIndex("by_requester", (q: any) => q.eq("requesterId", identity.userId)),
      pageSize,
      maxRowsPerTable,
    );
    const asAddressee = await paginateIndex(
      () =>
        ctx.db.query("connections").withIndex("by_addressee", (q: any) => q.eq("addresseeId", identity.userId)),
      pageSize,
      maxRowsPerTable,
    );
    const seen = new Set<string>();
    const connectionRows: Array<Record<string, any>> = [];
    for (const row of [...asRequester.rows, ...asAddressee.rows]) {
      const id = String(row._id);
      if (!seen.has(id)) {
        seen.add(id);
        connectionRows.push(row);
      }
    }
    record(
      "connections",
      connectionRows,
      {
        pages: asRequester.pages + asAddressee.pages,
        pageSize,
        truncated: asRequester.truncated || asAddressee.truncated,
      },
      "merged-index",
    );

    // meetings: organized by caller (owner pass)
    const organized = await paginateIndex(
      () =>
        ctx.db.query("meetings").withIndex("by_organizer", (q: any) => q.eq("organizerId", identity.userId)),
      pageSize,
      maxRowsPerTable,
    );

    // ---- CALLER'S PARTICIPATION + SHARED MEETINGS ---------------------------

    const myParticipation = await paginateIndex(
      () =>
        ctx.db.query("meetingParticipants").withIndex("by_user", (q: any) => q.eq("userId", identity.userId)),
      pageSize,
      maxRowsPerTable,
    );
    record("meetingParticipants", myParticipation.rows, { ...myParticipation, pageSize }, "index");

    const roleByMeeting = new Map<string, string>();
    const myMeetingIds = new Set<string>();
    for (const row of myParticipation.rows) {
      roleByMeeting.set(String(row.meetingId), row.role);
      myMeetingIds.add(String(row.meetingId));
    }

    // participant-only meetings (shared pass; organizer pass already covered them)
    const sharedMeetingRows: Array<Record<string, any>> = [];
    for (const meetingId of [...myMeetingIds].sort()) {
      const meeting = await ctx.db.get(meetingId as any);
      if (!meeting) {
        refusals.push({
          table: "meetings",
          meeting: meetingId,
          reason: "referenced_meeting_missing",
          authoritySource: AUTHORITY_SOURCES.assertMeetingAccess,
        });
        continue;
      }
      if (String(meeting.organizerId) === String(identity.userId)) continue; // owner pass
      sharedMeetingRows.push(meeting);
    }

    // ---- MEETING UNIVERSE SCAN (bounded, id-only read for refusals) ---------
    const universeScan = await paginateIndex(
      () =>
        ctx.db.query("meetings"),
      pageSize,
      maxRowsPerTable,
    );
    const allMeetingRows = sortedById([...organized.rows, ...sharedMeetingRows, ...universeScan.rows].filter(
      (row, idx, arr) => arr.findIndex((r) => String(r._id) === String(row._id)) === idx,
    ));
    const meetingOrdinal = new Map<string, number>();
    allMeetingRows.forEach((row, idx) => meetingOrdinal.set(String(row._id), idx + 1));

    // ---- MEETING-SCOPED TABLES ----------------------------------------------

    // Exportable resources: authority per meeting from the production matrix.
    for (const [table, grant] of Object.entries(MEETING_SCOPED_EXPORTABLE)) {
      const collected: Array<Record<string, any>> = [];
      let pages = 0;
      let truncated = false;
      for (const meetingId of [...myMeetingIds].sort()) {
        const role = roleByMeeting.get(meetingId)!;
        const perms = permissionsForResource(grant.resource, normalizeRole(role as any));
        if (!perms.includes("export")) {
          refusals.push({
            table,
            meeting: `meeting-${meetingOrdinal.get(meetingId)}`,
            role,
            reason: `missing_export_permission — permissionsForResource('${grant.resource}','${normalizeRole(role as any)}') has no 'export'`,
            authoritySource: AUTHORITY_SOURCES.permissionsForResource,
          });
          continue;
        }
        // Index availability differs per table (schema-verified): transcripts
        // has no bare by_meeting; its meeting-prefixed composite index sorts
        // by meetingId first, so a leading eq() scan is equivalent here.
        const meetingIndex: Record<string, string> = {
          transcripts: "by_meeting_and_created_at",
          transcriptSegments: "by_meeting",
          meetingNotes: "by_meeting",
        };
        const { rows, pages: p, truncated: t } = await paginateIndex(
          () =>
            ctx.db
              .query(table)
              .withIndex(meetingIndex[table], (q: any) => q.eq("meetingId", meetingId as any)),
          pageSize,
          maxRowsPerTable,
        );
        pages += p;
        truncated = truncated || t;
        collected.push(...rows);
      }
      record(table, collected, { pages, pageSize, truncated }, "index");
    }

    // No-grant meeting-scoped tables: refusal by construction, aggregated per
    // table over the caller's in-scope meetings.
    for (const table of MEETING_SCOPED_NO_GRANT) {
      refusals.push({
        table,
        scope: { meetings: myMeetingIds.size },
        reason:
          "no_export_authority_defined — permissionsForResource has no resource entry for this table; missing authority is a refusal, not a guessed permission",
        authoritySource: AUTHORITY_SOURCES.permissionsForResource,
      });
    }

    // Meetings the caller has no participation in: refusal per meeting
    // (existence-free labels only — no ids, titles, or metadata).
    for (const row of allMeetingRows) {
      const meetingId = String(row._id);
      if (!myMeetingIds.has(meetingId)) {
        refusals.push({
          table: "<meeting-scoped>",
          meeting: `meeting-${meetingOrdinal.get(meetingId)}`,
          reason: "no_meeting_participation — assertMeetingAccess would refuse; no content exported",
          authoritySource: AUTHORITY_SOURCES.assertMeetingAccess,
        });
      }
    }

    // meetings record: owner + shared passes, minus sensitive fields.
    record("meetings", [...organized.rows, ...sharedMeetingRows], organized, "merged-index");

    // ---- EXCLUDED SYSTEM TABLES ---------------------------------------------
    for (const table of TABLE_POLICIES) {
      if (records[table.table] === undefined) {
        records[table.table] = [];
        refs[table.table] = [];
        pagination[table.table] = { mode: "index", pages: 0, pageSize, rows: 0, truncated: false };
      }
    }

    // ---- ENVELOPE ------------------------------------------------------------
    let recordCount = 0;
    for (const table of TABLE_POLICIES) recordCount += records[table.table].length;

    return {
      exportId: `export-${POLICY_VERSION.replace("/", "-")}-${now}`,
      status: "completed",
      format: "json",
      metadata: {
        requestedAt: now,
        completedAt: now,
        recordCount,
      },
      receipts: {
        policy: {
          version: POLICY_VERSION,
          checksum: POLICY_CHECKSUM,
          tables: TABLE_POLICIES.map((p) => ({
            table: p.table,
            sensitiveFields: [...p.sensitiveFields],
          })),
          authoritySources: { ...AUTHORITY_SOURCES },
        },
        schema: {
          tablesInPolicy: TABLE_POLICIES.length,
          tableNames: TABLE_POLICIES.map((p) => p.table),
          fingerprint: POLICY_CHECKSUM,
        },
        version: {
          policyVersion: POLICY_VERSION,
          archiveFormat: "account-export-archive-v1",
        },
        refs,
        pagination,
      },
      refusals,
      records,
    };
  },
});
