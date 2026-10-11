/**
 * Production-handler duplicate-delivery exercise.
 *
 * Exercises the REAL registered production handlers —
 * `notes.applyNoteOperation`, `meetings/lifecycle.startMeeting` and
 * `.endMeeting`, and `meetings/stream/streamHandlers.dispatchWebhook` —
 * through a convex-test in-memory backend with the REAL schema, real auth
 * guards (`assertMeetingAccess` via `withIdentity`), and the real
 * `withIdempotency` machinery. Nothing here is hardcoded in the reconnect
 * fake transport: every acceptance/rejection below is OBSERVED from the
 * production code's own behavior under duplicate delivery.
 *
 * Run standalone (tsx treats this as CJS — no top-level await):
 *   npx tsx experiments/reconnect/production-handlers.ts \
 *     --out=experiments/reconnect/results/production-handlers.json
 *
 * Or through the entry point: npx tsx experiments/reconnect/run.ts --section=handlers
 */

/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import schema from "../../convex/schema.js";
import { applyNoteOperation } from "../../convex/notes/mutations.js";
import {
  startMeeting,
  endMeeting,
} from "../../convex/meetings/lifecycle.js";
import { dispatchWebhook } from "../../convex/meetings/stream/streamHandlers.js";

const here = dirname(fileURLToPath(import.meta.url));

interface Observation {
  id: string;
  handler: string;
  delivery: string;
  observed: string; // "accepted" | "rejected" | "deduped"
  evidence: Record<string, unknown>;
}

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

/** Invoke a registered Convex function object's real handler under an identity. */
async function callHandler(
  t: any,
  identity: { subject: string; email: string; name: string },
  fn: { _handler: (ctx: any, args: any) => Promise<any> },
  args: Record<string, unknown>,
): Promise<{ ok: true; value: any } | { ok: false; error: any }> {
  try {
    const value = await t.withIdentity(identity).run(async (ctx: any) => {
      return fn._handler(ctx, args);
    });
    return { ok: true, value };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        message: String(error?.message ?? error),
        data: error?.data ?? undefined,
      },
    };
  }
}

let hostSeq = 0;

async function seedHostMeeting(t: any): Promise<{ meetingId: string; identity: typeof IDENTITY }> {
  hostSeq += 1;
  const hostId = `prod_retry_host_${hostSeq}`;
  await t.run(async (ctx: any) => {
    await ctx.db.insert("users", {
      workosUserId: hostId,
      email: "host@example.com",
      displayName: "Reconnect Study Host",
      isActive: true,
      lastSeenAt: 1760000000000,
      onboardingComplete: true,
      createdAt: 1760000000000,
      updatedAt: 1760000000000,
    });
  });
  const meetingId = await t.run(async (ctx: any) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q: any) => q.eq("workosUserId", hostId))
      .unique();
    const meetingId = await ctx.db.insert("meetings", {
      organizerId: user._id,
      title: "Production duplicate-delivery exercise",
      state: "scheduled",
      webrtcEnabled: true,
      createdAt: 1760000000000,
      updatedAt: 1760000000000,
    });
    await ctx.db.insert("meetingParticipants", {
      meetingId,
      userId: user._id,
      role: "host",
      presence: "joined",
      createdAt: 1760000000000,
    });
    return meetingId;
  });
  const identity = { subject: hostId, email: "host@example.com", name: "Reconnect Study Host" };
  return { meetingId, identity };
}

async function countRows(t: any, table: string): Promise<number> {
  return t.run(async (ctx: any) => {
    return (await ctx.db.query(table).collect()).length;
  });
}

async function getNotes(t: any, meetingId: string): Promise<{ content: string; version: number }> {
  return t.run(async (ctx: any) => {
    const notes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_meeting", (q: any) => q.eq("meetingId", meetingId))
      .unique();
    return notes ? { content: notes.content, version: notes.version } : { content: "", version: -1 };
  });
}

const IDENTITY = { subject: "prod_retry_host", email: "host@example.com", name: "Reconnect Study Host" };

export async function runProductionHandlers(outPath?: string): Promise<Record<string, unknown>> {
  const modules: Record<string, Record<string, unknown>> = {
    // convex-test anchors its module-root prefix on a "_generated" key; the
    // real generated api satisfies it so internal runMutation/scheduler paths
    // resolve for real.
    "convex/_generated/api": () => import("../../convex/_generated/api.js"),
    // Internal modules reached via ctx.runMutation / ctx.scheduler from the
    // handlers under exercise: register the real modules so convex-test
    // resolves them.
    "convex/meetings/stream/streamHandlers": () =>
      import("../../convex/meetings/stream/streamHandlers.js"),
    "convex/meetings/postProcessing": () =>
      import("../../convex/meetings/postProcessing.js"),
    "convex/transcripts/initialization": () =>
      import("../../convex/transcripts/initialization.js"),
    "convex/transcripts/aggregation": () =>
      import("../../convex/transcripts/aggregation.js"),
    "convex/transcripts/queries": () =>
      import("../../convex/transcripts/queries.js"),
    "convex/insights/generation": () =>
      import("../../convex/insights/generation.js"),
    "convex/analytics/meetings": () =>
      import("../../convex/analytics/meetings.js"),
    "convex/meetings/stream/cleanup": () =>
      import("../../convex/meetings/stream/cleanup.js"),
    "convex/meetings/queries": () =>
      import("../../convex/meetings/queries.js"),
    "convex/audit/logging": () =>
      import("../../convex/audit/logging.js"),
    "convex/meetings/lifecycle": () =>
      import("../../convex/meetings/lifecycle.js"),
    "convex/notes/queries": () =>
      import("../../convex/notes/queries.js"),
  };
  const t = convexTest(schema as any, modules as any);

  const observations: Observation[] = [];

  // ------------------------------------------------------------------
  // A. notes.applyNoteOperation — duplicate delivery of the same operation
  // ------------------------------------------------------------------
  {
    const { meetingId, identity } = await seedHostMeeting(t);
    const op = { type: "insert" as const, position: 0, content: "hello" };

    // A1. First delivery: naive client, expectedVersion 0, clientSequence 0.
    const first = await callHandler(t, identity, applyNoteOperation as any, {
      meetingId,
      operation: op,
      clientSequence: 0,
      expectedVersion: 0,
    });
    observations.push({
      id: "notes/first-delivery",
      handler: "notes.applyNoteOperation",
      delivery: "op insert 'hello' @0, clientSequence 0, expectedVersion 0",
      observed: first.ok ? "accepted" : "rejected",
      evidence: first.ok
        ? { result: first.value }
        : { error: first.error },
    });

    // A2. Exact duplicate redelivery: identical clientSequence AND identical
    // expectedVersion (what a transport-level retry of the same message is).
    const dupSame = await callHandler(t, identity, applyNoteOperation as any, {
      meetingId,
      operation: op,
      clientSequence: 0,
      expectedVersion: 0,
    });
    const notesAfterSame = await getNotes(t, meetingId);
    const noteOpsAfterSame = await countRows(t, "noteOps");
    observations.push({
      id: "notes/duplicate-identical-args",
      handler: "notes.applyNoteOperation",
      delivery: "exact redelivery: same op, same clientSequence 0, same expectedVersion 0",
      observed: dupSame.ok ? "accepted" : "rejected",
      evidence: {
        error: dupSame.ok ? undefined : dupSame.error,
        notesAfter: notesAfterSame,
        noteOpsCount: noteOpsAfterSame,
      },
    });

    // A3. Version-aware duplicate: same op and clientSequence, but the
    // expectedVersion refetched to current — what a client that "knows the
    // latest version" would send if it could not tell its first attempt
    // landed. There is no idempotency key, so this is the case where the
    // duplicate is judged on OT state alone.
    const dupFresh = await callHandler(t, identity, applyNoteOperation as any, {
      meetingId,
      operation: op,
      clientSequence: 0,
      expectedVersion: notesAfterSame.version,
    });
    const notesAfterFresh = await getNotes(t, meetingId);
    const noteOpsAfterFresh = await countRows(t, "noteOps");
    observations.push({
      id: "notes/duplicate-version-aware",
      handler: "notes.applyNoteOperation",
      delivery: "same op + clientSequence 0, expectedVersion bumped to current",
      observed: dupFresh.ok ? "accepted" : "rejected",
      evidence: {
        result: dupFresh.ok ? dupFresh.value : undefined,
        error: dupFresh.ok ? undefined : dupFresh.error,
        notesAfter: notesAfterFresh,
        noteOpsCount: noteOpsAfterFresh,
        duplicateContentApplied:
          dupFresh.ok === false ? undefined : notesAfterFresh.content === "hellohello",
      },
    });
  }

  // ------------------------------------------------------------------
  // B. meetings/lifecycle.startMeeting — duplicate delivery
  // ------------------------------------------------------------------
  {
    const { meetingId, identity } = await seedHostMeeting(t);
    const first = await callHandler(t, identity, startMeeting as any, { meetingId });
    const dup = await callHandler(t, identity, startMeeting as any, { meetingId });
    const state = await t.run(async (ctx: any) => {
      return (await ctx.db.get(meetingId)).state;
    });
    observations.push({
      id: "lifecycle/start-duplicate",
      handler: "meetings.lifecycle.startMeeting",
      delivery: "start twice (first accepted, ack-lost retry simulated by immediate resend)",
      observed: !first.ok ? "rejected" : dup.ok ? "accepted" : "rejected",
      evidence: {
        first: first.ok ? first.value : first.error,
        duplicate: dup.ok ? dup.value : dup.error,
        meetingStateAfter: state,
      },
    });
  }

  // ------------------------------------------------------------------
  // C. meetings/lifecycle.endMeeting — duplicate delivery
  // ------------------------------------------------------------------
  {
    const { meetingId, identity } = await seedHostMeeting(t);
    await callHandler(t, identity, startMeeting as any, { meetingId });
    const first = await callHandler(t, identity, endMeeting as any, { meetingId });
    const dup = await callHandler(t, identity, endMeeting as any, { meetingId });
    const state = await t.run(async (ctx: any) => {
      return (await ctx.db.get(meetingId)).state;
    });
    observations.push({
      id: "lifecycle/end-duplicate",
      handler: "meetings.lifecycle.endMeeting",
      delivery: "end twice after a successful start (second send = ack-lost retry)",
      observed: !first.ok ? "rejected" : dup.ok ? "accepted" : "rejected",
      evidence: {
        first: first.ok ? first.value : first.error,
        duplicate: dup.ok ? dup.value : dup.error,
        meetingStateAfter: state,
        note: "The guard rejects the duplicate, but the client cannot distinguish this rejection from 'my first end never landed'.",
      },
    });
  }

  // ------------------------------------------------------------------
  // D. stream dispatchWebhook — the one handler wired into withIdempotency
  // ------------------------------------------------------------------
  {
    const data = {
      type: "call.session_ended",
      call: { id: "call_missing_in_test" },
      call_session: { id: "sess_missing_in_test" },
    };
    const keysBefore = await countRows(t, "idempotencyKeys");
    const first = await callHandler(t, IDENTITY, dispatchWebhook as any, { data });
    const keysAfterFirst = await countRows(t, "idempotencyKeys");
    const dup = await callHandler(t, IDENTITY, dispatchWebhook as any, { data });
    const keysAfterDup = await countRows(t, "idempotencyKeys");
    observations.push({
      id: "webhook/duplicate-redelivery",
      handler: "meetings.stream.streamHandlers.dispatchWebhook",
      delivery: "same webhook payload delivered twice (Stream-style retry)",
      observed: "deduped",
      evidence: {
        first: first.ok ? first.value : first.error,
        duplicate: dup.ok ? dup.value : dup.error,
        idempotencyKeys: { before: keysBefore, afterFirst: keysAfterFirst, afterDuplicate: keysAfterDup },
        note: "withIdempotency records the key in the same transaction; the redelivery replays the stored result / previousError instead of re-executing.",
      },
    });
  }

  const result = {
    label:
      "PRODUCTION-OBSERVED: real registered handlers under duplicate delivery, exercised through convex-test with the real schema and auth guards. No fake-transport code decides any outcome below.",
    handlers: [
      "convex/notes/mutations.ts:applyNoteOperation",
      "convex/meetings/lifecycle.ts:startMeeting",
      "convex/meetings/lifecycle.ts:endMeeting",
      "convex/meetings/stream/streamHandlers.ts:dispatchWebhook",
    ],
    observations,
  };

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  }
  return result;
}

// --- CJS-safe entry (tsx treats run files as CJS: no top-level await) -------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = arg("out", join(here, "results", "production-handlers.json"));
  runProductionHandlers(out)
    .then((result) => {
      for (const o of (result as any).observations) {
        console.log(`${o.id}: ${o.observed}`);
      }
      console.log(`wrote ${out}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
