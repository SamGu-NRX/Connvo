/**
 * Owned fake Convex client + server for the reconnect study.
 *
 * Emulates the observable reconnect semantics of the real `convex/react`
 * client that `src/hooks/useCollaborativeNotes.ts` and
 * `src/hooks/useMeetingLifecycle.ts` are built on:
 *
 *  - `useQuery` serves a local cache and refetches from the server; while
 *    offline it keeps serving the last known value (or `undefined` if that
 *    query was never fetched — isLoading stays true).
 *  - The repo's note/lifecycle mutations define NO server-side
 *    `optimisticUpdate`, so the client library itself applies nothing to the
 *    cache before the ack — this fake is faithful to that. Any "optimistic"
 *    state in this app therefore lives in the consumer, following the hook's
 *    own documented example (immediate `setLocalContent`). The scenario
 *    drivers model that consumer exactly.
 *  - Mutations sent while offline, or whose delivery/ack was lost, are
 *    RE-SENT when the connection is restored (at-least-once, no
 *    idempotency key). Actions (e.g. prompt generation) are NOT replayed —
 *    they fail while offline.
 *  - When a participant has been removed server-side, further note writes
 *    are rejected with a CONFLICT error (mirrors assertMeetingAccess).
 *
 * There are no real timers: ordering is controlled explicitly by scenarios
 * via `flushAcks()` / `flushLateAcks()`, so every run is deterministic.
 */

import { useMemo, useSyncExternalStore } from "react";
import { AcceptedHistory } from "./acceptedHistory";

export type ConnectionState = "online" | "offline";
/**
 * Where the connection broke relative to the server. In this model delivery
 * is synchronous at send time, so the mode describes what the scenario does
 * around `cutConnection`:
 *  - "before-server": cut BEFORE sending — the request is queued locally and
 *    the server never sees it until restore().
 *  - "after-server": send first, then cut before the ack flush — the server
 *    already processed it and the ack becomes a "late ack".
 */
export type CutMode = "before-server" | "after-server";

export interface NoteOperationInput {
  type: "insert" | "delete" | "retain";
  position?: number;
  text?: string;
  length?: number;
}

export interface NoteDoc {
  meetingId: string;
  content: string;
  version: number;
  lastEditedAt: number;
}

export interface MeetingDoc {
  meetingId: string;
  state: "scheduled" | "active" | "concluded";
  participants: string[];
}

// ---------------------------------------------------------------------------
// Server truth
// ---------------------------------------------------------------------------

export class FakeConvexServer {
  readonly history = new AcceptedHistory();
  readonly notes = new Map<string, NoteDoc>();
  readonly meetings = new Map<string, MeetingDoc>();
  /** Meetings where the local user lost write access (removed remotely). */
  readonly writeBlocked = new Set<string>();

  constructor(
    seed?: {
      note?: Partial<NoteDoc> & { meetingId: string };
      meeting?: MeetingDoc;
    },
  ) {
    if (seed?.note) {
      this.notes.set(seed.note.meetingId, {
        content: "",
        version: 0,
        lastEditedAt: 0,
        ...seed.note,
      });
    }
    if (seed?.meeting) {
      this.meetings.set(seed.meeting.meetingId, seed.meeting);
    }
  }

  getNote(meetingId: string): NoteDoc | undefined {
    return this.notes.get(meetingId);
  }

  ensureNote(meetingId: string): NoteDoc {
    let note = this.notes.get(meetingId);
    if (!note) {
      note = { meetingId, content: "", version: 0, lastEditedAt: 0 };
      this.notes.set(meetingId, note);
    }
    return note;
  }

  getMeeting(meetingId: string): MeetingDoc | undefined {
    return this.meetings.get(meetingId);
  }

  createMeeting(meetingId: string, clientMutationId: string, args: unknown): string {
    const doc: MeetingDoc = { meetingId, state: "scheduled", participants: [] };
    this.meetings.set(meetingId, doc);
    this.history.record({
      clientMutationId,
      name: "meetings.lifecycle.createMeeting",
      args,
      before: undefined,
      after: { ...doc },
    });
    return meetingId;
  }

  startMeeting(meetingId: string, clientMutationId: string, args: unknown): MeetingDoc {
    const doc = this.getMeeting(meetingId);
    if (!doc) throw new Error(`meeting ${meetingId} not found`);
    const before = doc.state;
    // Re-applying an already-applied start is a state no-op but still lands
    // in the journal (that is what a duplicate looks like for idempotent ops).
    doc.state = "active";
    this.history.record({
      clientMutationId,
      name: "meetings.lifecycle.startMeeting",
      args,
      before,
      after: doc.state,
    });
    return { ...doc };
  }

  endMeeting(meetingId: string, clientMutationId: string, args: unknown): MeetingDoc {
    const doc = this.getMeeting(meetingId);
    if (!doc) throw new Error(`meeting ${meetingId} not found`);
    const before = doc.state;
    doc.state = "concluded";
    this.history.record({
      clientMutationId,
      name: "meetings.lifecycle.endMeeting",
      args,
      before,
      after: doc.state,
    });
    return { ...doc };
  }

  applyNoteOperation(
    meetingId: string,
    clientMutationId: string,
    op: NoteOperationInput,
  ): { version: number } {
    if (this.writeBlocked.has(meetingId)) {
      throw new Error("Version mismatch: not a participant (removed) — CONFLICT");
    }
    const note = this.ensureNote(meetingId);
    const before = note.content;
    note.content = applyOpToText(note.content, op);
    note.version += 1;
    note.lastEditedAt += 1;
    this.history.record({
      clientMutationId,
      name: "notes.applyNoteOperation",
      args: op,
      before,
      after: note.content,
    });
    return { version: note.version };
  }

  /** A remote participant clears the note (simulated other-user event). */
  remoteClearNote(meetingId: string, actor: string): void {
    const note = this.ensureNote(meetingId);
    const before = note.content;
    note.content = "";
    note.version += 1;
    note.lastEditedAt += 1;
    this.history.record({
      clientMutationId: `remote:${actor}`,
      name: "notes.remoteClearNote",
      args: { actor, meetingId },
      before,
      after: "",
    });
  }

  /** The participant is removed from the meeting while they are offline. */
  remoteRemoveParticipant(meetingId: string, userId: string, actor: string): void {
    const doc = this.getMeeting(meetingId);
    if (!doc) return;
    const before = [...doc.participants];
    doc.participants = doc.participants.filter((p) => p !== userId);
    this.writeBlocked.add(meetingId);
    this.history.record({
      clientMutationId: `remote:${actor}`,
      name: "meetings.remoteRemoveParticipant",
      args: { actor, meetingId, userId },
      before,
      after: [...doc.participants],
    });
  }
}

/** Applies an insert/delete/retain op to plain text (positions clamped). */
export function applyOpToText(content: string, op: NoteOperationInput): string {
  if (op.type === "insert") {
    const pos = Math.max(0, Math.min(op.position ?? content.length, content.length));
    return content.slice(0, pos) + (op.text ?? "") + content.slice(pos);
  }
  if (op.type === "delete") {
    const pos = Math.max(0, Math.min(op.position ?? 0, content.length));
    return content.slice(0, pos) + content.slice(pos + Math.max(0, op.length ?? 0));
  }
  return content; // retain
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

interface AckRecord {
  clientMutationId: string;
  name: string;
  result: { ok: true; value: unknown } | { ok: false; error: Error };
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  /** Re-sendable server effect, captured so a lost ack can be replayed. */
  applyToServer: () => { ok: true; value: unknown } | { ok: false; error: Error };
}

interface QueuedReplay {
  clientMutationId: string;
  name: string;
  args: Record<string, unknown>;
  applyToServer: () => { ok: true; value: unknown } | { ok: false; error: Error };
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

interface QueryState {
  value: unknown;
  fetched: boolean;
  readKey: string;
  readArgs: Record<string, unknown>;
}

export type FnNameHint =
  | { kind: "query"; names: string[] }
  | { kind: "mutation"; names: string[] }
  | { kind: "action"; names: string[] };

export class FakeConvexClient {
  connection: ConnectionState = "online";
  readonly server: FakeConvexServer;
  /** Logical clock, advanced by scenario steps for trace labels. */
  tick = 0;

  private readonly queries = new Map<string, QueryState>();
  private readonly fnCounts = new Map<string, number>();
  private readonly nameHints = new Map<string, string[]>();
  private pendingAcks: AckRecord[] = [];
  private lateAcks: AckRecord[] = [];
  private lostInFlight: AckRecord[] = [];
  private replayQueue: QueuedReplay[] = [];
  private listeners = new Set<() => void>();
  private static mutationCounter = 0;

  constructor(server: FakeConvexServer, nameHints: FnNameHint[] = []) {
    this.server = server;
    for (const hint of nameHints) {
      this.nameHints.set(hint.kind, hint.names);
    }
  }

  // -- connection control ---------------------------------------------------

  cutConnection(_mode: CutMode): void {
    this.connection = "offline";
    // Acks not yet flushed are lost in transit. From the client's point of
    // view these mutations are unacked, so on restore() they are RE-SENT
    // (at-least-once delivery). If the server had already processed them,
    // the re-send is a duplicate; the original ack also shows up late.
    if (this.pendingAcks.length > 0) {
      this.lostInFlight.push(...this.pendingAcks);
      this.lateAcks.push(...this.pendingAcks);
      this.pendingAcks = [];
    }
    this.notify();
  }

  restore(): void {
    this.connection = "online";
    // 1) Replay every queued mutation (at-least-once, no idempotency):
    //    the server may have already accepted some of them.
    const queue = this.replayQueue;
    this.replayQueue = [];
    for (const item of queue) {
      const result = safeApply(item.applyToServer);
      if (result.ok) {
        this.enqueueAck({
          clientMutationId: item.clientMutationId,
          name: item.name,
          result,
          resolve: item.resolve,
          reject: item.reject,
          applyToServer: item.applyToServer,
        });
      } else {
        item.reject(result.error);
      }
    }
    // 2) Re-send mutations whose ack was lost. If the server already
    //    processed them, this is a DUPLICATE acceptance.
    const lost = this.lostInFlight;
    this.lostInFlight = [];
    for (const item of lost) {
      const result = safeApply(item.applyToServer);
      this.enqueueAck({
        clientMutationId: item.clientMutationId,
        name: item.name,
        result,
        resolve: item.resolve,
        reject: item.reject,
        applyToServer: item.applyToServer,
      });
    }
    // 3) Late original acks arrive (they settle promises that the re-sent
    //    acks will also try to settle — harmless, promises settle once).
    this.flushLateAcks();
    // 4) Refetch every known query from server truth. Queries subscribed
    //    for the first time while offline were never fetched — establishing
    //    the subscription is exactly what restore() is for.
    for (const [, q] of this.queries) {
      const value = this.serverRead(q.readKey, q.readArgs);
      q.value = value;
      q.fetched = true;
    }
    this.notify();
  }

  /** Deliver late acks (originally lost when the connection was cut). */
  flushLateAcks(): void {
    const late = this.lateAcks;
    this.lateAcks = [];
    for (const ack of late) settle(ack);
  }

  get hasLateAcks(): boolean {
    return this.lateAcks.length > 0;
  }

  /** Resolve every ack currently pending (normal in-flight completion). */
  async flushAcks(): Promise<void> {
    const pending = this.pendingAcks;
    this.pendingAcks = [];
    for (const ack of pending) settle(ack);
    await Promise.resolve();
    await Promise.resolve();
  }

  /**
   * Simulates full navigation away from the page: the in-memory Convex
   * client (cache + replay queue + pending acks) is destroyed. Anything not
   * yet accepted by the server is lost, no matter what the UI showed.
   */
  reset(): void {
    this.queries.clear();
    this.replayQueue = [];
    this.pendingAcks = [];
    this.lateAcks = [];
    this.lostInFlight = [];
    this.fnCounts.clear();
    this.notify();
  }

  // -- React bindings (drop-in for convex/react) ----------------------------

  useQuery(_ref: unknown, args: Record<string, unknown> | undefined): unknown {
    const key = this.nextName("query");
    const cacheKey = `${key}:${JSON.stringify(args ?? {})}`;
    let q = this.queries.get(cacheKey);
    if (!q) {
      q = { value: undefined, fetched: false, readKey: key, readArgs: args ?? {} };
      this.queries.set(cacheKey, q);
      if (this.connection === "online") {
        const value = this.serverRead(key, args ?? {});
        Promise.resolve().then(() => {
          q!.value = value;
          q!.fetched = true;
          this.notify();
        });
      }
    }
    useSyncExternalStore(
      (cb) => {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
      },
      () => q!.value,
      () => undefined,
    );
    return q.value;
  }

  useMutation(_ref: unknown): (args: Record<string, unknown>) => Promise<unknown> {
    const name = this.nextName("mutation");
    return useMemo(() => (args: Record<string, unknown>) => this.mutate(name, args), [name]);
  }

  useAction(_ref: unknown): (args: Record<string, unknown>) => Promise<unknown> {
    const name = this.nextName("action");
    return useMemo(
      () => (args: Record<string, unknown>) => this.runAction(name, args),
      [name],
    );
  }

  // -- core semantics -------------------------------------------------------

  private nextName(kind: "query" | "mutation" | "action"): string {
    const idx = this.fnCounts.get(kind) ?? 0;
    this.fnCounts.set(kind, idx + 1);
    const hints = this.nameHints.get(kind);
    // Hooks re-render: the same call sites re-run on every render, so map
    // the (fixed) call order back onto the hint list cyclically.
    if (hints && hints.length > 0) return hints[idx % hints.length];
    return `${kind}:${idx}`;
  }

  private serverRead(key: string, args: Record<string, unknown>): unknown {
    const meetingId = String(args?.meetingId ?? "");
    if (key.startsWith("notes.")) {
      const note = this.server.getNote(meetingId);
      return note ? { ...note } : undefined;
    }
    if (key.startsWith("meetings.lifecycle.getConnectionInfo")) {
      const meeting = this.server.getMeeting(meetingId);
      return meeting ? { videoProvider: "webrtc", connectionInfo: { roomId: meetingId } } : undefined;
    }
    return undefined;
  }

  mutate(name: string, args: Record<string, unknown>): Promise<unknown> {
    const clientMutationId = `${name}#${++FakeConvexClient.mutationCounter}`;
    const apply = this.makeServerEffect(name, args, clientMutationId);

    if (this.connection === "offline") {
      return new Promise((resolve, reject) => {
        this.replayQueue.push({ clientMutationId, name, args, applyToServer: apply, resolve, reject });
      });
    }

    // Online: delivered synchronously; the ack resolves on flushAcks().
    const result = safeApply(apply);
    const promise = new Promise<unknown>((res, rej) => {
      const record: AckRecord = {
        clientMutationId,
        name,
        result,
        resolve: res,
        reject: rej,
        applyToServer: apply,
      };
      if (this.ackLossArmed) {
        // Demo mode: the server processed this mutation, but the reply and
        // the client's knowledge of delivery are lost — the state that
        // cutConnection("after-server") would produce for exactly this send.
        this.ackLossArmed = false;
        this.lostInFlight.push(record);
        this.lateAcks.push(record);
        this.connection = "offline";
      } else {
        this.enqueueAck(record);
      }
    });
    return promise;
  }

  private autoAck = false;

  /** Browser mode: settle online mutation acks automatically, like the real transport. */
  enableAutoAck(): void {
    this.autoAck = true;
  }

  /**
   * Record an ack as pending. In browser mode (autoAck) the ack arrives on
   * its own microtask instead of waiting for an explicit flushAcks() — it
   * only settles if a cut hasn't already reclassified the record.
   */
  private enqueueAck(record: AckRecord): void {
    this.pendingAcks.push(record);
    if (this.autoAck) {
      void Promise.resolve().then(() => {
        const idx = this.pendingAcks.indexOf(record);
        if (idx !== -1) {
          this.pendingAcks.splice(idx, 1);
          settle(record);
        }
      });
    }
  }

  /** Queue depth visible to the user: unsent + unacked mutations. */
  get inFlightCount(): number {
    return this.replayQueue.length + this.lostInFlight.length;
  }

  connectionStatus(): "online" | "offline" {
    return this.connection;
  }

  private ackLossArmed = false;

  /** Arm one-shot ack loss: the NEXT online mutation is applied server-side but its ack is lost. */
  armAckLoss(): void {
    this.ackLossArmed = true;
  }

  async runAction(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Actions are one-shot and NOT replayed by Convex; offline they fail.
    if (this.connection === "offline") {
      throw new Error(`action ${name} failed: connection offline`);
    }
    return { name, args };
  }

  /** Visible client state for a notes query (post-ack cache only). */
  cachedNotes(meetingId: string): { content: string; version: number } | undefined {
    for (const [cacheKey, q] of this.queries) {
      if (!cacheKey.startsWith("notes.") || !q.fetched) continue;
      if (String(q.readArgs?.meetingId ?? "") !== meetingId) continue;
      const v = q.value as NoteDoc | undefined;
      return v ? { content: v.content, version: v.version } : undefined;
    }
    return undefined;
  }

  private makeServerEffect(
    name: string,
    args: Record<string, unknown>,
    clientMutationId: string,
  ): () => { ok: true; value: unknown } | { ok: false; error: Error } {
    const server = this.server;
    const meetingId = String(args?.meetingId ?? "");
    return () => {
      try {
        if (name.startsWith("notes.applyNoteOperation")) {
          const op = args["operation"] as NoteOperationInput | undefined;
          if (!op) return { ok: false, error: new Error("missing operation") };
          return { ok: true, value: server.applyNoteOperation(meetingId, clientMutationId, op) };
        }
        if (name.startsWith("notes.batchApplyNoteOperations")) {
          const ops = (args["operations"] as NoteOperationInput[] | undefined) ?? [];
          let last = { version: server.ensureNote(meetingId).version };
          for (const op of ops) {
            last = server.applyNoteOperation(meetingId, clientMutationId, op);
          }
          return { ok: true, value: last };
        }
        if (name.startsWith("meetings.lifecycle.createMeeting")) {
          const newId = String(args["__meetingId"] ?? meetingId);
          return { ok: true, value: server.createMeeting(newId, clientMutationId, args) };
        }
        if (name.startsWith("meetings.lifecycle.startMeeting")) {
          return { ok: true, value: server.startMeeting(meetingId, clientMutationId, args) };
        }
        if (name.startsWith("meetings.lifecycle.endMeeting")) {
          return { ok: true, value: server.endMeeting(meetingId, clientMutationId, args) };
        }
        return { ok: false, error: new Error(`unknown mutation ${name}`) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    };
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}

function safeApply(
  fn: () => { ok: true; value: unknown } | { ok: false; error: Error },
): { ok: true; value: unknown } | { ok: false; error: Error } {
  try {
    return fn();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

function settle(ack: AckRecord): void {
  if (ack.result.ok) ack.resolve(ack.result.value);
  else ack.reject(ack.result.error);
}
