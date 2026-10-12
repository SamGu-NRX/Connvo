/**
 * Property run against the REAL notes server: the real `NotesLedger` for
 * each client, and the real `batchApplyNoteOperations` mutation and
 * `getMeetingNotes` query running in convex-test. Nothing on the server
 * side is modelled. (test/in-call/property/notesLedger.property.test.ts
 * runs a faster light model of the server; the review found it bumps the
 * version on every batch while the mutation bumps only when an op applied,
 * so it cannot stand in for the server.)
 *
 * Each case: one or two clients in one meeting take random textarea edits
 * interleaved with transport faults (offline, a send dropped before the
 * server sees it, a response lost after the server applied it, a remount
 * over the same recovery storage). Faults sit in the transport only. After
 * every client recovers (reconnect, remount, the user's retry for refused
 * ops), the invariants are:
 *   - every client's view equals the server's stored text, status synced,
 *     nothing unsaved;
 *   - with one client, the server text equals that client's final buffer
 *     exactly (nothing typed is lost or duplicated);
 *   - send discipline: an op is resent only after a fresh read since its
 *     previous send, always with the same payload.
 *
 * Runs: NOTES_REAL_PROPERTY_RUNS (default 300, so the normal suite stays
 * fast). The recorded proof is the 10,000-case run at SEED; its result file
 * is docs/notes-ledger-f1/real-server-property-run.json.
 */

import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { NotesLedger } from "@/hooks/notes/notesLedger";
import type {
  BatchApplyNoteOperationsResponse,
  NotesBatchOp,
  NotesServerSnapshot,
  NotesTransport,
} from "@/hooks/notes/types";
import {
  addMeetingParticipant,
  createTestEnvironment,
  createTestMeeting,
  createTestUser,
} from "../convex/helpers";

/** The recorded seed. Change it deliberately and record the change. */
export const SEED = 20261012;
const RUNS = Number(process.env.NOTES_REAL_PROPERTY_RUNS ?? 300);
/** A fresh convex-test database every this many cases keeps reads fast. */
const CASES_PER_ENV = 100;

type Env = ReturnType<typeof createTestEnvironment>;
type Face = ReturnType<Env["withIdentity"]>;

// ---------------------------------------------------------------------------
// The real server
// ---------------------------------------------------------------------------

let env: Env | null = null;
/** Totals across the run, printed with the verdict as evidence of what ran. */
const totals = { batches: 0, reads: 0, faults: 0, remounts: 0 };
let casesOnEnv = 0;
let userSeq = 0;

class RealServer {
  private readonly subscribers = new Set<() => void>();
  /** Server calls still running; quiescence waits for all of them. */
  readonly inflight = new Set<Promise<unknown>>();

  private constructor(
    private readonly t: Env,
    readonly meetingId: Id<"meetings">,
    private readonly faces: Map<string, Face>,
  ) {}

  static async create(clientIds: string[]): Promise<RealServer> {
    if (env === null || casesOnEnv >= CASES_PER_ENV) {
      env = createTestEnvironment();
      casesOnEnv = 0;
    }
    casesOnEnv++;
    const t = env;
    const organizer = await createTestUser(t, {
      workosUserId: `prop-org-${++userSeq}`,
    });
    const meetingId = await createTestMeeting(t, organizer, {
      state: "active",
    });
    const faces = new Map<string, Face>();
    for (const clientId of clientIds) {
      const workosUserId = `prop-${clientId}-${++userSeq}`;
      const userId = await createTestUser(t, { workosUserId });
      await addMeetingParticipant(
        t,
        meetingId,
        userId,
        "participant",
        "joined",
      );
      faces.set(
        clientId,
        t.withIdentity({
          subject: workosUserId,
          tokenIdentifier: `tok-${workosUserId}`,
        }),
      );
    }
    return new RealServer(t, meetingId, faces);
  }

  track<T>(promise: Promise<T>): Promise<T> {
    this.inflight.add(promise);
    const done = () => this.inflight.delete(promise);
    promise.then(done, done);
    return promise;
  }

  subscribe(notify: () => void): () => void {
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }

  /** A query update to every live subscriber (what Convex pushes after a write). */
  pushAll(): void {
    for (const notify of this.subscribers) notify();
  }

  applyBatch(
    clientId: string,
    batch: { operations: NotesBatchOp[] },
  ): Promise<BatchApplyNoteOperationsResponse> {
    totals.batches++;
    return this.track(
      this.faces
        .get(clientId)!
        .mutation(api.notes.mutations.batchApplyNoteOperations, {
          meetingId: this.meetingId,
          clientId,
          operations: batch.operations,
        }) as Promise<BatchApplyNoteOperationsResponse>,
    );
  }

  /** getMeetingNotes, normalized exactly as notesConvexTransport.tsx does. */
  snapshotFor(clientId: string): Promise<NotesServerSnapshot> {
    totals.reads++;
    return this.track(
      (async () => {
        const raw = (await this.faces
          .get(clientId)!
          .query(api.notes.queries.getMeetingNotes, {
            meetingId: this.meetingId,
            clientId,
          })) as {
          content: string;
          version: number;
          headSequence?: number;
          clientAcks?: NotesServerSnapshot["clientAcks"];
        } | null;
        if (raw === null)
          return { content: "", version: 0, headSequence: 0, clientAcks: [] };
        return {
          content: raw.content,
          version: raw.version,
          headSequence: raw.headSequence ?? 0,
          clientAcks: raw.clientAcks ?? [],
        };
      })(),
    );
  }

  /** The stored note text: server truth. */
  async storedText(): Promise<string> {
    return this.t.run(async (ctx) => {
      const row = await ctx.db
        .query("meetingNotes")
        .withIndex("by_meeting", (q) => q.eq("meetingId", this.meetingId))
        .unique();
      return row?.content ?? "";
    });
  }
}

// ---------------------------------------------------------------------------
// Transport with faults (faults never touch server semantics)
// ---------------------------------------------------------------------------

interface Faults {
  offline?: boolean;
  dropBeforeApply?: boolean;
  dropAfterApply?: boolean;
}

class SendLog {
  readonly entries: Array<{
    clientOpId: string;
    payload: string;
    ingestCount: number;
  }> = [];
}

class FaultyTransport implements NotesTransport {
  faults: Faults = {};
  /** Fresh reads delivered to this client; resend discipline is judged on them. */
  ingestCount = 0;
  private onSnapshot:
    | ((snapshot: NotesServerSnapshot | undefined) => void)
    | null = null;
  private unsubscribeServer: (() => void) | null = null;

  constructor(
    private readonly server: RealServer,
    private readonly clientId: string,
    private readonly sendLog: SendLog,
  ) {}

  private deliverFreshRead(): void {
    void this.server.snapshotFor(this.clientId).then((snapshot) => {
      if (this.faults.offline || !this.onSnapshot) return;
      this.ingestCount++;
      this.onSnapshot(snapshot);
    });
  }

  subscribe(
    _meetingId: Id<"meetings">,
    _clientId: string,
    onSnapshot: (snapshot: NotesServerSnapshot | undefined) => void,
  ): () => void {
    this.onSnapshot = onSnapshot;
    if (!this.faults.offline) this.deliverFreshRead();
    this.unsubscribeServer = this.server.subscribe(() => {
      if (!this.faults.offline) this.deliverFreshRead();
    });
    return () => {
      this.onSnapshot = null;
      this.unsubscribeServer?.();
      this.unsubscribeServer = null;
    };
  }

  async applyBatch(
    _meetingId: Id<"meetings">,
    clientId: string,
    batch: { operations: NotesBatchOp[]; expectedVersion?: number },
  ): Promise<BatchApplyNoteOperationsResponse> {
    for (const entry of batch.operations) {
      this.sendLog.entries.push({
        clientOpId: entry.clientOpId,
        payload: JSON.stringify(entry.operation),
        ingestCount: this.ingestCount,
      });
    }
    if (this.faults.offline) {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND (offline)"), {
        code: "ENOTFOUND",
      });
    }
    if (this.faults.dropBeforeApply) {
      this.faults.dropBeforeApply = false;
      throw Object.assign(
        new Error("connection reset before the server saw the batch"),
        {
          code: "ECONNRESET",
        },
      );
    }
    if (this.faults.dropAfterApply) {
      this.faults.dropAfterApply = false;
      // The server applies and pushes; the response never arrives.
      void this.server.applyBatch(clientId, batch).then(
        () => this.server.pushAll(),
        () => this.server.pushAll(),
      );
      return new Promise<BatchApplyNoteOperationsResponse>(() => {});
    }
    try {
      return await this.server.applyBatch(clientId, batch);
    } finally {
      this.server.pushAll();
    }
  }

  reconnect(): void {
    this.faults.offline = false;
    this.deliverFreshRead();
  }

  close(): void {}
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

class MemStorage implements Storage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  key(): string | null {
    return null;
  }
  get length(): number {
    return this.map.size;
  }
}

interface Client {
  id: string;
  ledger: NotesLedger;
  transport: FaultyTransport;
  storage: MemStorage;
  buffer: string;
  /** A lost response leaves a batch in flight; the next step reloads first. */
  lostResponse: boolean;
}

function newLedger(
  server: RealServer,
  client: Pick<Client, "id" | "storage">,
  ids: { n: number },
): NotesLedger {
  return new NotesLedger({
    meetingId: server.meetingId,
    clientId: client.id,
    debounceMs: 0,
    storage: client.storage,
    now: () => 1,
    generateId: () => ++ids.n / 1e6,
  });
}

function makeClient(
  server: RealServer,
  id: string,
  sendLog: SendLog,
  ids: { n: number },
): Client {
  const storage = new MemStorage();
  const transport = new FaultyTransport(server, id, sendLog);
  const ledger = newLedger(server, { id, storage }, ids);
  ledger.start(transport);
  return { id, ledger, transport, storage, buffer: "", lostResponse: false };
}

/** The reload path: a new ledger over the same storage and a live transport. */
function remount(server: RealServer, client: Client, ids: { n: number }): void {
  totals.remounts++;
  client.ledger.destroy();
  client.transport.faults.offline = false;
  client.ledger = newLedger(server, client, ids);
  client.ledger.start(client.transport);
  client.lostResponse = false;
}

const stateOf = (clients: Client[]) =>
  JSON.stringify(
    clients.map((c) => {
      const s = c.ledger.getSnapshot();
      return [
        s.content,
        s.version,
        s.status,
        s.unsavedRecords.map((r) => [r.clientOpId, r.state, r.attempts]),
      ];
    }),
  );

/** Wait until no server call is running and every client's state held still for two turns. */
async function quiesce(server: RealServer, clients: Client[]): Promise<void> {
  let stable = 0;
  let last = stateOf(clients);
  for (let i = 0; i < 400 && stable < 2; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (server.inflight.size > 0) {
      await Promise.allSettled([...server.inflight]);
      stable = 0;
      continue;
    }
    const now = stateOf(clients);
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
}

async function recover(
  server: RealServer,
  client: Client,
  all: Client[],
  ids: { n: number },
): Promise<void> {
  client.transport.reconnect();
  await quiesce(server, all);
  remount(server, client, ids);
  await quiesce(server, all);
  for (
    let round = 0;
    round < 3 && client.ledger.getSnapshot().status !== "synced";
    round++
  ) {
    client.ledger.retryConflicts();
    await quiesce(server, all);
    remount(server, client, ids);
    await quiesce(server, all);
  }
}

function assertSendDiscipline(log: SendLog): void {
  const payloads = new Map<string, string>();
  const lastIngest = new Map<string, number>();
  for (const entry of log.entries) {
    const prior = payloads.get(entry.clientOpId);
    if (prior !== undefined && prior !== entry.payload) {
      throw new Error(`op ${entry.clientOpId} resent with a different payload`);
    }
    payloads.set(entry.clientOpId, entry.payload);
    const last = lastIngest.get(entry.clientOpId);
    if (last !== undefined && entry.ingestCount <= last) {
      throw new Error(
        `op ${entry.clientOpId} resent without a fresh read since its last send`,
      );
    }
    lastIngest.set(entry.clientOpId, entry.ingestCount);
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

type Fault =
  | "none"
  | "offline"
  | "reconnect"
  | "dropBefore"
  | "dropAfter"
  | "remount";

interface Step {
  client: 0 | 1;
  edit: {
    kind: "insert" | "delete" | "replace";
    position: number;
    length: number;
  } | null;
  fault: Fault;
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  client: fc.constantFrom<0 | 1>(0, 1),
  edit: fc.option(
    fc.record({
      kind: fc.constantFrom<"insert" | "delete" | "replace">(
        "insert",
        "delete",
        "replace",
      ),
      position: fc.nat(24),
      length: fc.nat(6),
    }),
    { nil: null, freq: 3 },
  ),
  fault: fc.constantFrom<Fault>(
    "none",
    "none",
    "none",
    "offline",
    "reconnect",
    "dropBefore",
    "dropAfter",
    "remount",
  ),
});

function applyEdit(
  text: string,
  edit: NonNullable<Step["edit"]>,
  token: string,
): string {
  const pos = Math.min(edit.position, text.length);
  const end = Math.min(pos + edit.length, text.length);
  if (edit.kind === "insert")
    return text.slice(0, pos) + token + text.slice(pos);
  if (edit.kind === "delete") return text.slice(0, pos) + text.slice(end);
  return text.slice(0, pos) + token + text.slice(end);
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe("notes ledger against the real notes server", () => {
  test(
    `random edits and faults converge on the real mutation and query (seed ${SEED})`,
    async () => {
      const started = Date.now();
      let cases = 0;
      const property = fc.asyncProperty(
        fc.constantFrom<1 | 2>(1, 2),
        fc.array(stepArb, { minLength: 2, maxLength: 12 }),
        async (clientCount, steps) => {
          cases++;
          const ids = { n: 0 };
          const sendLog = new SendLog();
          const clientIds = clientCount === 1 ? ["c1"] : ["c1", "c2"];
          const server = await RealServer.create(clientIds);
          const clients = clientIds.map((id) =>
            makeClient(server, id, sendLog, ids),
          );
          await quiesce(server, clients);
          let token = 0;

          for (const step of steps) {
            const client = clients[clientCount === 1 ? 0 : step.client];
            if (client.lostResponse) {
              remount(server, client, ids);
              await quiesce(server, clients);
            }
            const sendKiller =
              step.fault === "offline" ||
              step.fault === "dropBefore" ||
              step.fault === "dropAfter";
            if (
              sendKiller &&
              client.ledger.getSnapshot().transportOnline === false
            ) {
              // One fault episode at a time: come back online first.
              remount(server, client, ids);
              await quiesce(server, clients);
            }
            if (step.fault !== "none" && step.fault !== "reconnect")
              totals.faults++;
            switch (step.fault) {
              case "offline":
                client.transport.faults.offline = true;
                break;
              case "reconnect":
                client.transport.reconnect();
                break;
              case "dropBefore":
                client.transport.faults.dropBeforeApply = true;
                break;
              case "dropAfter":
                client.transport.faults.dropAfterApply = true;
                client.lostResponse = true;
                break;
              case "remount":
                remount(server, client, ids);
                break;
              case "none":
                break;
            }
            if (step.edit) {
              client.buffer = applyEdit(
                client.buffer,
                step.edit,
                `${client.id}w${++token} `,
              );
              client.ledger.onEdit(client.buffer);
            }
            await quiesce(server, clients);
          }

          for (const client of clients)
            await recover(server, client, clients, ids);
          for (const client of clients) client.transport.reconnect();
          await quiesce(server, clients);

          assertSendDiscipline(sendLog);
          const stored = await server.storedText();
          for (const client of clients) {
            const snap = client.ledger.getSnapshot();
            expect(snap.status).toBe("synced");
            expect(snap.unsavedRecords).toHaveLength(0);
            expect(snap.content).toBe(stored);
          }
          if (clientCount === 1) expect(stored).toBe(clients[0].buffer);
          for (const client of clients) client.ledger.destroy();
        },
      );
      await fc.assert(property, {
        seed: SEED,
        numRuns: RUNS,
        endOnFailure: true,
      });
      console.log(
        `[real-server property] seed=${SEED} runs=${RUNS} cases=${cases} passed in ${((Date.now() - started) / 1000).toFixed(1)} s; ` +
          `server batches=${totals.batches} reads=${totals.reads} faults=${totals.faults} remounts=${totals.remounts}`,
      );
    },
    4 * 60 * 60 * 1000,
  );
});
