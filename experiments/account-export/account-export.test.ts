/**
 * Caller-only account export study — scoped test suite.
 *
 * Every assertion is grounded in the production contract:
 *   - requireIdentity (convex/auth/guards.ts) refuses anonymous/deactivated
 *   - permissionsForResource grants export to hosts only for transcripts,
 *     transcriptSegments, and meetingNotes
 *   - the projection policy decides every inclusion/redaction decision
 *
 * Fixture universe (fixtures.json): caller = alice.
 *   m1 — alice hosts (bob, carol participate; dave's participant row was
 *        seeded then removed; erin deactivated)
 *   m2 — bob hosts, alice participates
 *   m3 — carol hosts, alice has no participation
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import schema from "../../convex/schema.js";
import { seedFixture } from "./seed";
import { exportMyAccountData } from "./functions";
import { validateArchive, buildLeakTokens } from "./archive";
import {
  MEETING_SCOPED_NO_GRANT,
  MAX_PAGE_SIZE,
  POLICY_CHECKSUM,
  POLICY_VERSION,
  TABLE_POLICIES,
} from "./projection";

/* eslint-disable @typescript-eslint/no-explicit-any */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));
const caller = fixture.users.find((u) => u.ref === fixture.callerRef);
const requestedAt = 1760000000000;

function makeModules(): Record<string, Record<string, unknown>> {
  return {
    // convex-test anchors its module-root prefix on a "_generated" key; the
    // real generated api stub satisfies it and the virtual experiment module
    // (registered under the same prefix) carries the export handler.
    "convex/_generated/api": () => import("../../convex/_generated/api.js"),
    "convex/experiments/account-export/functions": { exportMyAccountData },
  };
}

async function runExport(t: any, args: Record<string, unknown> = {}) {
  return (t as any)
    .withIdentity({
      subject: caller.workosUserId,
      email: caller.email,
      name: caller.displayName,
    })
    .run((ctx: any) => exportMyAccountData._handler(ctx, { requestedAt, pageSize: 100, ...args }));
}

/** Hardcoded expected export counts, committed from the fixture universe. */
const EXPECTED_PER_TABLE: Record<string, number> = {
  users: 1,
  profiles: 1,
  userSettings: 0,
  userInterests: 2,
  interests: 0,
  connections: 1,
  meetings: 2,
  meetingParticipants: 2,
  meetingState: 0,
  meetingNotes: 1,
  noteOps: 0,
  meetingCounters: 0,
  meetingEvents: 0,
  meetingRecordings: 0,
  videoRoomConfigs: 0,
  transcripts: 250,
  transcriptionSessions: 0,
  transcriptSegments: 2,
  messages: 0,
  prompts: 0,
  insights: 2,
  embeddings: 0,
  vectorIndexMeta: 0,
  matchingQueue: 1,
  matchingAnalytics: 1,
  offlineOperationQueue: 0,
  offlineCheckpoints: 0,
  idempotencyKeys: 0,
  alerts: 0,
  performanceMetrics: 0,
  rateLimits: 0,
  auditLogs: 0,
  featureFlags: 0,
};
const EXPECTED_TOTAL = Object.values(EXPECTED_PER_TABLE).reduce((a, b) => a + b, 0); // 266
const EXPECTED_CLASS_COUNTS = { owner: 11, shared: 255, excluded: 51, total: 317 };

async function harness() {
  const t = convexTest(schema as any, makeModules() as any);
  const seeded = await seedFixture(t as any, fixture as any);
  return { t, seeded };
}

describe("caller-only account export", () => {
  it("exports exactly the classified owner/shared rows and validates", async () => {
    const { t, seeded } = await harness();
    const archive = await runExport(t);
    const { perTable, total } = validateArchive(archive);

    expect(seeded.classCounts).toEqual(EXPECTED_CLASS_COUNTS);
    expect(perTable).toEqual(EXPECTED_PER_TABLE);
    expect(total).toBe(EXPECTED_TOTAL);
    expect(archive.metadata.recordCount).toBe(EXPECTED_TOTAL);
  });

  it("is deterministic: two runs produce identical archives", async () => {
    const { t } = await harness();
    const a = await runExport(t);
    const b = await runExport(t);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(a.exportId).toEqual(b.exportId);
  });

  it("refuses anonymous callers outright (requireIdentity)", async () => {
    const { t } = await harness();
    await expect(
      t.run((ctx: any) => exportMyAccountData._handler(ctx, { requestedAt })),
    ).rejects.toThrow(/UNAUTHORIZED|Authentication required/i);
  });

  it("refuses deactivated accounts outright (requireIdentity)", async () => {
    const { t, seeded } = await harness();
    await t.run(async (ctx: any) => {
      const userId = seeded.refToId[caller.ref];
      await ctx.db.patch(userId, { isActive: false });
    });
    await expect(runExport(t)).rejects.toThrow(/deactivated/i);
  });

  it("exports host-meeting content, refuses participant meeting content with a receipt", async () => {
    const { t } = await harness();
    const archive = await runExport(t);

    const transcripts = archive.records.transcripts;
    const texts = transcripts.map((r: any) => r.text);
    expect(texts).toContain("m1 transcript: welcome to the weekly sync");
    expect(texts).toContain("m1 transcript: bob shares the status update");
    // the 200k-character segment is exported in full (bounded pagination, not truncation)
    expect(texts.some((x: string) => x.length === 200_000)).toBe(true);
    // participant meeting content never crosses
    expect(texts).not.toContain("m2 private retro transcript line one");
    expect(texts).not.toContain("m2 private retro transcript line two");

    const notes = archive.records.meetingNotes;
    expect(notes).toHaveLength(1);
    expect((notes[0] as any).content).toContain("m1 shared sync notes content v3");
    expect(notes.map((n: any) => n.content)).not.toContain("m2 bob private retro note content");

    const missingScope = archive.refusals.filter((r: any) => r.reason.startsWith("missing_export_permission"));
    expect(missingScope).toHaveLength(3); // transcripts, segments, notes @ m2
    for (const r of missingScope) {
      expect(r.meeting).toMatch(/^meeting-\d+$/);
      expect(r.authoritySource).toMatch(/permissionsForResource/);
    }
  });

  it("never references the non-participant meeting in records or refs", async () => {
    const { t, seeded } = await harness();
    const archive = await runExport(t);
    const m3Id = seeded.refToId["m3"];
    expect(JSON.stringify(archive)).not.toContain(m3Id);
    // Unrelated meetings are not discovered at all: no refusal receipt, no
    // ordinal, nothing that reveals they exist or how many there are.
    const noPart = archive.refusals.filter((r: any) => r.reason.startsWith("no_meeting_participation"));
    expect(noPart).toHaveLength(0);
    expect(JSON.stringify(archive.refusals)).not.toContain("no_meeting_participation");
  });

  it("excludes the removed member's participant row entirely", async () => {
    const { t, seeded } = await harness();
    const archive = await runExport(t);
    expect(archive.records.meetingParticipants).toHaveLength(2);
    expect(archive.receipts.refs.meetingParticipants).not.toContain(seeded.refToId["m1:part:dave"]);
    // and nowhere in the archive at all
    expect(JSON.stringify(archive)).not.toContain(seeded.refToId["m1:part:dave"]);
  });

  it("redacts sensitive fields per table policy", async () => {
    const { t } = await harness();
    const archive = await runExport(t);

    const user: any = archive.records.users[0];
    // Policy: workosUserId (the IdP subject) is redacted even from the caller's
    // own row; email and displayName are the caller's portable data and stay.
    expect(user).not.toHaveProperty("workosUserId");
    expect(user.email).toBe(caller.email);
    expect(user.displayName).toBe(caller.displayName);

    for (const meeting of archive.records.meetings as any[]) {
      expect(meeting).not.toHaveProperty("streamRoomId");
    }
    expect(archive.records.meetingRecordings).toHaveLength(0); // recording url row excluded with its meeting
  });

  it("emits a refusal receipt for every meeting-scoped table with no export authority", async () => {
    const { t } = await harness();
    const archive = await runExport(t);
    const noGrant = archive.refusals.filter((r: any) => r.reason.startsWith("no_export_authority_defined"));
    expect(noGrant.map((r: any) => r.table).sort()).toEqual([...MEETING_SCOPED_NO_GRANT].sort());
    expect(archive.refusals).toHaveLength(
      3 /* missing scope @ m2 */ + MEETING_SCOPED_NO_GRANT.length + 0 /* m3 is never discovered */,
    );
    expect(archive.refusals.length).toBe(12);
  });

  it("is indifferent to unrelated meetings: adding them leaves the archive byte-identical", async () => {
    const a = await harness();
    const baseline = await runExport(a.t);

    const b = await harness();
    await b.t.run(async (ctx: any) => {
      const carolId = b.seeded.refToId["carol"];
      const daveId = b.seeded.refToId["dave"];
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
          participantCount: 2,
          createdAt: 1760000000000,
          updatedAt: 1760000000000,
        });
        for (const [uid, role] of [[carolId, "host"], [daveId, "participant"]] as const) {
          await ctx.db.insert("meetingParticipants", {
            meetingId: mid,
            userId: uid,
            role,
            joinedAt: 1760000000000,
            presence: "joined",
            createdAt: 1760000000000,
          });
        }
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
          createdAt: 1760000000000,
        });
      }
    });
    const perturbed = await runExport(b.t);

    // Same fixture clock and seeding order → identical ids; the caller's scope
    // is unchanged, so the entire archive must be byte-identical.
    expect(JSON.stringify(perturbed)).toBe(JSON.stringify(baseline));
  });

  it("bounds pagination: pageSize clamps to 100 and receipts report real pages", async () => {
    const { t } = await harness();
    const archive = await runExport(t, { pageSize: 100_000 });
    expect(archive.receipts.pagination.transcripts.pageSize).toBe(MAX_PAGE_SIZE);
    const transcripts = archive.receipts.pagination.transcripts;
    expect(transcripts.rows).toBe(250);
    expect(transcripts.pages).toBe(Math.ceil(250 / MAX_PAGE_SIZE)); // 3
    expect(transcripts.truncated).toBe(false);
  });

  it("truncates a table at maxRowsPerTable and says so in the receipt", async () => {
    const { t } = await harness();
    const archive = await runExport(t, { maxRowsPerTable: 10 });
    const transcripts = archive.receipts.pagination.transcripts;
    expect(transcripts.rows).toBe(10);
    expect(transcripts.truncated).toBe(true);
    validateArchive(archive);
  });

  it("leak-scans the archive: no private token appears anywhere", async () => {
    const { t, seeded } = await harness();
    const archive = await runExport(t);
    const { tokens } = buildLeakTokens(fixture, seeded.classification as any);
    const json = JSON.stringify(archive);
    const hits = tokens.filter((tk) => json.includes(tk.token));
    expect(hits).toEqual([]);
    expect(tokens.length).toBeGreaterThan(10);
  });

  it("carries the committed policy version and checksum in receipts", async () => {
    const { t } = await harness();
    const archive = await runExport(t);
    expect(archive.receipts.policy.version).toBe(POLICY_VERSION);
    expect(archive.receipts.policy.checksum).toBe(POLICY_CHECKSUM);
    expect(archive.receipts.schema.tableNames).toEqual(TABLE_POLICIES.map((p) => p.table));
  });

  it("validates the committed archive and passes the independent reader", async () => {
    // Runs the reader as a subprocess against the committed results — this
    // exercises run.ts's committed artifacts, not in-process state.
    const out = execFileSync(
      "node",
      [join(here, "reader.mjs"), join(here, "results", "export.json"), join(here, "results", "manifest.json")],
      { encoding: "utf8" },
    );
    expect(out).toContain("independent reader: PASS");
    expect(out).toContain("identical record counts to manifest");
  });

  it("detects tampering: a mutated archive fails the independent reader", () => {
    const archive = JSON.parse(readFileSync(join(here, "results", "export.json"), "utf8"));
    // mutate: re-attach a redacted field with leaked content
    (archive.records.users[0] as any).email = "bob.example@example.com";
    delete archive.receipts.refs;

    const tmpArchive = join(here, "results", ".tampered.json");
    const tmpManifest = join(here, "results", ".tampered-manifest.json");
    const manifest = JSON.parse(readFileSync(join(here, "results", "manifest.json"), "utf8"));
    writeFileSync(tmpArchive, JSON.stringify(archive, null, 2) + "\n");
    // manifest keeps the ORIGINAL checksum, so tampering is caught at step 1
    writeFileSync(tmpManifest, JSON.stringify(manifest));

    let failed = false;
    try {
      execFileSync("node", ["reader.mjs", tmpArchive, tmpManifest], { cwd: here, encoding: "utf8", stdio: "pipe" });
    } catch (e: any) {
      failed = true;
      expect(e.status).toBe(1);
      expect(String(e.stdout) + String(e.stderr)).toMatch(/checksum mismatch|FAIL/);
    }
    expect(failed).toBe(true);
  });
});
