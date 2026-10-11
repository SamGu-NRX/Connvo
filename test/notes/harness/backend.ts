/**
 * Self-contained convex-test backend for the notes ledger suite.
 *
 * Wraps the shared M1 helpers (test/convex/helpers.ts) so every ledger test
 * runs against the REAL merged notes mutations/queries — no mock server —
 * and adds the subscription/push plumbing the fault-injecting transport
 * needs (docs/notes-ledger-f1/design.md §5).
 */

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  addMeetingParticipant,
  createTestEnvironment,
  createTestMeeting,
  createTestUser,
} from "../../convex/helpers";
import type { BatchApplyNoteOperationsResponse, NotesServerSnapshot } from "@/hooks/notes/types";

type TestEnv = ReturnType<typeof createTestEnvironment>;
type AuthedEnv = ReturnType<TestEnv["withIdentity"]>;

export interface BackendParticipant {
  meetingId: Id<"meetings">;
  /** Authed convex-test face for this participant. */
  face: AuthedEnv;
  tag: string;
  workosUserId: string;
}

interface Subscription {
  face: AuthedEnv;
  clientId: string;
  onSnapshot: (snapshot: NotesServerSnapshot | undefined) => void;
  /** When true, pushes are withheld (the transport is "offline"). */
  withheld: boolean;
}

/** A batch payload as the pinned NotesTransport.applyBatch accepts it. */
export interface OutgoingBatch {
  operations: Array<{
    operation: {
      type: "insert" | "delete" | "retain";
      position: number;
      content?: string;
      length?: number;
    };
    clientSequence: number;
    clientOpId: string;
  }>;
  expectedVersion?: number;
}

export class NotesBackend {
  private readonly t: TestEnv;
  private readonly subscriptions = new Map<string, Set<Subscription>>();
  private userCounter = 0;

  constructor() {
    this.t = createTestEnvironment();
  }

  /** Creates a user + meeting + "participant" membership, all synthetic. */
  async addParticipant(tag: string): Promise<BackendParticipant> {
    const workosUserId = `m2-${tag}-${++this.userCounter}`;
    const organizerId = await createTestUser(this.t, {
      workosUserId: `organizer-${workosUserId}`,
    });
    const meetingId = await createTestMeeting(this.t, organizerId);
    const userId = await createTestUser(this.t, { workosUserId });
    await addMeetingParticipant(this.t, meetingId, userId, "participant");
    return { meetingId, face: this.asAuthed(workosUserId), tag, workosUserId };
  }

  /** Adds an additional participant to an existing meeting. */
  async joinMeeting(meetingId: Id<"meetings">, tag: string): Promise<BackendParticipant> {
    const workosUserId = `m2-${tag}-${++this.userCounter}`;
    const userId = await createTestUser(this.t, { workosUserId });
    await addMeetingParticipant(this.t, meetingId, userId, "participant");
    return { meetingId, face: this.asAuthed(workosUserId), tag, workosUserId };
  }

  asAuthed(workosUserId: string): AuthedEnv {
    return this.t.withIdentity({
      subject: workosUserId,
      tokenIdentifier: `tok-${workosUserId}`,
      name: workosUserId,
    });
  }

  /**
   * Applies a batch through the REAL merged mutation as the given face, then
   * pushes a fresh read to every live subscriber of the meeting.
   */
  async applyBatch(
    face: AuthedEnv,
    meetingId: Id<"meetings">,
    clientId: string,
    batch: OutgoingBatch,
  ): Promise<BatchApplyNoteOperationsResponse> {
    const response = (await face.mutation(api.notes.mutations.batchApplyNoteOperations, {
      meetingId,
      clientId,
      operations: batch.operations,
    })) as BatchApplyNoteOperationsResponse;
    await this.pushToSubscribers(meetingId);
    return response;
  }

  /** Direct materialized-row read (server truth + version). */
  async readServerText(meetingId: Id<"meetings">): Promise<{
    content: string;
    version: number;
  }> {
    return this.t.run(async (ctx) => {
      const row = await ctx.db
        .query("meetingNotes")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .unique();
      if (!row) return { content: "", version: 0 };
      return { content: row.content, version: row.version };
    });
  }

  /**
   * Runs the REAL getMeetingNotes query as `face` and normalizes:
   *  - no notes row (a completed read returning null) → the version-0 empty
   *    snapshot, mirroring the production transport's normalization;
   *  - caller-requested `undefined` models a loading result.
   */
  async readSnapshot(
    face: AuthedEnv,
    meetingId: Id<"meetings">,
    clientId: string,
  ): Promise<NotesServerSnapshot | undefined> {
    const row = (await face.query(api.notes.queries.getMeetingNotes, {
      meetingId,
      clientId,
    })) as {
      content: string;
      version: number;
      headSequence?: number;
      clientAcks?: NotesServerSnapshot["clientAcks"];
    } | null;
    if (row === null) {
      return { content: "", version: 0, headSequence: 0, clientAcks: [] };
    }
    return {
      content: row.content,
      version: row.version,
      headSequence: row.headSequence ?? 0,
      clientAcks: row.clientAcks ?? [],
    };
  }

  /** Full noteOps rows for a meeting — identity-level server evidence. */
  async readNoteOps(meetingId: Id<"meetings">): Promise<
    Array<{
      sequence: number;
      applied: boolean;
      clientId?: string;
      clientOpId?: string;
      clientSequence?: number;
    }>
  > {
    return this.t.run(async (ctx) => {
      const rows = await ctx.db
        .query("noteOps")
        .withIndex("by_meeting_sequence", (q) => q.eq("meetingId", meetingId))
        .collect();
      return rows.map((row) => ({
        sequence: row.sequence,
        applied: row.applied,
        clientId: row.clientId,
        clientOpId: row.clientOpId,
        clientSequence: row.clientSequence,
      }));
    });
  }

  // ----- subscription plumbing (used by the fault transport) -----

  subscribe(
    meetingId: Id<"meetings">,
    face: AuthedEnv,
    clientId: string,
    onSnapshot: (snapshot: NotesServerSnapshot | undefined) => void,
  ): { deliver: (withhold: boolean) => void; unsubscribe: () => void } {
    const set = this.subscriptions.get(meetingId) ?? new Set<Subscription>();
    const subscription: Subscription = { face, clientId, onSnapshot, withheld: false };
    set.add(subscription);
    this.subscriptions.set(meetingId, set);
    return {
      deliver: (withhold: boolean) => {
        subscription.withheld = withhold;
      },
      unsubscribe: () => {
        set.delete(subscription);
      },
    };
  }

  /** Re-reads and pushes to every non-withheld subscriber of the meeting. */
  async pushToSubscribers(meetingId: Id<"meetings">): Promise<void> {
    const set = this.subscriptions.get(meetingId);
    if (!set) return;
    for (const subscription of set) {
      if (subscription.withheld) continue;
      const snapshot = await this.readSnapshot(
        subscription.face,
        meetingId,
        subscription.clientId,
      );
      subscription.onSnapshot(snapshot);
    }
  }
}
