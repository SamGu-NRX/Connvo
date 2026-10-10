/**
 * Fake meeting transport for the in-call client contract witnesses.
 *
 * This module implements the convex/react binding surface (useMutation /
 * useQuery-compatible) so the REAL `useCollaborativeNotes` hook can run
 * against a controlled fake. It exists to witness client-side defects, and
 * its behavior splits into two deliberately separate faces:
 *
 * 1. STRICT VALIDATOR MIRRORS — `validateBatchArgs` / `validateSingularArgs`
 *    walk arguments exactly like the REAL registered endpoint validators
 *    (same field order, same error strings). They are exported for the
 *    witness tests and cited against the real sources:
 *
 *    - `api.notes.mutations.batchApplyNoteOperations` — convex/notes/mutations.ts:392
 *      args: { meetingId, operations: [{ operation, clientSequence }], expectedVersion? }
 *      (entries wrap the op under `operation` with a per-meeting `clientSequence`)
 *    - `api.notes.mutations.applyNoteOperation` — convex/notes/mutations.ts (singular)
 *      args: { meetingId, operation, clientSequence, expectedVersion? }
 *    - note-operation shape — convex/schema/offline.ts (`NoteV.operation`):
 *      { type: "insert"|"delete"|"retain", position: number, content?: string, length?: number }
 *      — the field is `content`, never `text`
 *    - Convex object validators reject unknown fields with
 *      "Validator error: Unexpected field (text) in object" and missing
 *      required fields with "Validator error: Missing required field (operation) in object".
 *
 * 2. THE HOOK BRIDGE — the binding the hook actually runs through. It is
 *    deliberately permissive (it accepts the hook's current payload shape)
 *    so the witnesses can observe hook BEHAVIOR (re-send, rollback surface,
 *    state visibility) instead of stopping at the payload rejection. The
 *    payload mismatch itself is witnessed by assertion in
 *    useCollaborativeNotes.witness.test.ts against the strict mirrors.
 *
 * PROVENANCE RULE: this fake is a stand-in, NOT evidence of real server
 * behavior. Its bridge semantics (no dedupe, apply-on-receive) intentionally
 * mirror behaviors verified against the REAL registered endpoints in
 * test/convex/in-call-server-contract.test.ts (convex-test harness); any
 * bridge behavior not verified there documents only the fake, never the
 * server. See docs/in-call-client-20261010/witnesses.md.
 */

import { api } from "@convex/_generated/api";

/** The single synthetic identity the fake transport authenticates as. */
export const FAKE_CURRENT_USER = "fake-user-in-call";

/** Error carrying ConvexError-like `data` (code + message), mirroring what
 * the real endpoints throw (assertMeetingAccess / version-conflict paths). */
export class MeetingTransportError extends Error {
  readonly data: { code: string; message: string };

  constructor(code: string, message: string) {
    super(message);
    this.name = "MeetingTransportError";
    this.data = { code, message };
  }
}

/** Strict validator failure — mirrors Convex's `Validator error: …` strings. */
export class ValidatorMirrorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidatorMirrorError";
  }
}

type RawOp = {
  type: "insert" | "delete" | "retain";
  position: number;
  content?: string;
  length?: number;
};

/** One outgoing mutation the hook attempted, captured verbatim. */
export interface SentMutation {
  /** Real registered function name, e.g. `notes.mutations:batchApplyNoteOperations`. */
  name: string;
  args: unknown;
}

interface DeferredSend {
  run: () => void;
  resolve: () => void;
  reject: (error: unknown) => void;
  settled: boolean;
}

export class FakeMeetingTransport {
  /** Every mutation the hook sent, in order, captured verbatim for assertions. */
  readonly sentMutations: SentMutation[] = [];

  private content = "";
  private version = 0;
  private serverSequence = 0;
  private readonly participants = new Set<string>([FAKE_CURRENT_USER]);

  private beforeServer = false;
  private readonly queuedBeforeServer: DeferredSend[] = [];

  private withholdingAcks = false;
  private readonly withheldAcks: DeferredSend[] = [];

  useMutation(fnRef: unknown): (args: unknown) => Promise<unknown> {
    const name = describeRef(fnRef);
    return async (args: unknown) => this.send(name, args);
  }

  useQuery(fnRef: unknown, args?: unknown): unknown {
    const name = describeRef(fnRef);
    void args;
    if (name.endsWith("getMeetingConnectionInfo")) {
      return {
        meetingId: "fake-meeting",
        websocketUrl: "wss://fake.invalid",
        token: "fake-token",
        expiresAt: Date.now() + 60_000,
      };
    }
    if (name.toLowerCase().includes("note")) {
      return { content: this.content, version: this.version };
    }
    return {};
  }

  // ------------------------------------------------------------------
  // Test controls
  // ------------------------------------------------------------------

  /** Cut the connection: sends made while cut are queued locally and only
   * reach the (fake) server on restore(). */
  cutConnection(): void {
    this.beforeServer = true;
  }

  /** Restore the connection: replay every queued send through the bridge. */
  restore(): Promise<void> {
    this.beforeServer = false;
    const queued = this.queuedBeforeServer.splice(0);
    return Promise.all(
      queued.map(
        (send) =>
          new Promise<void>((resolve) => {
            send.run();
            void Promise.resolve().then(resolve);
          }),
      ),
    ).then(() => undefined);
  }

  /** Remove the current user's participant row (the effect of the real
   * lifecycle removal: assertMeetingAccess then finds no row). */
  removeParticipant(): void {
    this.participants.delete(FAKE_CURRENT_USER);
  }

  /** Apply accepted operations to the fake document but withhold the acks. */
  withholdAcks(): void {
    this.withholdingAcks = true;
  }

  /** Deliver every withheld ack. */
  flushAcks(): void {
    this.withholdingAcks = false;
    const withheld = this.withheldAcks.splice(0);
    for (const send of withheld) {
      send.resolve();
    }
  }

  docContent(): string {
    return this.content;
  }

  docVersion(): number {
    return this.version;
  }

  // ------------------------------------------------------------------
  // Send pipeline
  // ------------------------------------------------------------------

  private send(name: string, args: unknown): Promise<unknown> {
    this.sentMutations.push({ name, args });

    return new Promise<unknown>((resolve, reject) => {
      const run = () => {
        try {
          const result = this.dispatch(name, args);
          const deferred: DeferredSend = {
            run: () => undefined,
            resolve: () => {
              if (deferred.settled) return;
              deferred.settled = true;
              resolve(result);
            },
            reject: (error: unknown) => {
              if (deferred.settled) return;
              deferred.settled = true;
              reject(error);
            },
            settled: false,
          };
          if (this.withholdingAcks) {
            this.withheldAcks.push(deferred);
          } else {
            deferred.resolve();
          }
        } catch (error) {
          reject(error);
        }
      };

      if (this.beforeServer) {
        this.queuedBeforeServer.push({
          run,
          resolve: () => undefined,
          reject: () => undefined,
          settled: false,
        });
      } else {
        run();
      }
    });
  }

  /** Bridge dispatch — permissive about the hook's payload shape, strict
   * about the server-verified behaviors (participant guard, version
   * conflict, apply-on-receive with no dedupe). */
  private dispatch(name: string, args: unknown): unknown {
    if (name.endsWith("batchApplyNoteOperations")) {
      return this.bridgeBatch(name, args);
    }
    if (name.endsWith("applyNoteOperation")) {
      return this.bridgeSingular(name, args);
    }
    // Lifecycle and other refs: accept and record; the witnesses do not
    // depend on lifecycle return values.
    return { success: true };
  }

  private assertParticipant(meetingId: string): void {
    void meetingId;
    if (!this.participants.has(FAKE_CURRENT_USER)) {
      // Mirror of assertMeetingAccess (convex/meetings/guards.ts:143):
      // FORBIDDEN / "Access denied: Not a meeting participant".
      throw new MeetingTransportError(
        "FORBIDDEN",
        "Access denied: Not a meeting participant",
      );
    }
  }

  private applyOp(op: RawOp): { serverSequence: number } {
    if (op.type === "insert") {
      const text = op.content ?? "";
      const position = op.position;
      this.content =
        this.content.slice(0, position) + text + this.content.slice(position);
    } else if (op.type === "delete") {
      const start = op.position;
      const end = start + (op.length ?? 0);
      this.content = this.content.slice(0, start) + this.content.slice(end);
    }
    this.serverSequence += 1;
    return { serverSequence: this.serverSequence };
  }

  private bridgeBatch(name: string, args: unknown): unknown {
    const a = args as {
      meetingId?: string;
      operations?: unknown[];
      expectedVersion?: number;
    };
    if (!a || typeof a !== "object") {
      throw new ValidatorMirrorError(
        "Validator error: Argument of type `null` is not an object",
      );
    }
    this.assertParticipant(a.meetingId ?? "fake-meeting");
    if (
      a.expectedVersion !== undefined &&
      a.expectedVersion !== this.version
    ) {
      // Mirror of convex/notes/mutations.ts:446.
      throw new MeetingTransportError(
        "CONFLICT",
        `Version mismatch: expected ${a.expectedVersion}, got ${this.version}`,
      );
    }
    const entries = Array.isArray(a.operations) ? a.operations : [];
    const results = entries.map((entry) => {
      const op = normalizeEntry(entry);
      const { serverSequence } = this.applyOp(op);
      this.version += 1;
      return { serverSequence, transformedOperation: op, conflicts: [] };
    });
    void name;
    return {
      success: true,
      processed: entries.length,
      failed: 0,
      results,
      newVersion: this.version,
    };
  }

  private bridgeSingular(name: string, args: unknown): unknown {
    const a = args as {
      meetingId?: string;
      operation?: unknown;
      clientSequence?: number;
      clientTimestamp?: number;
      expectedVersion?: number;
    };
    if (!a || typeof a !== "object") {
      throw new ValidatorMirrorError(
        "Validator error: Argument of type `null` is not an object",
      );
    }
    this.assertParticipant(a.meetingId ?? "fake-meeting");
    if (
      a.expectedVersion !== undefined &&
      a.expectedVersion !== this.version
    ) {
      // Mirror of convex/realtime/batchedOperations.ts:147.
      throw new MeetingTransportError(
        "CONFLICT",
        `Version mismatch: expected ${a.expectedVersion}, got ${this.version}`,
      );
    }
    // Bridge discriminator: the hook's singular payload carries
    // `clientTimestamp` and no `clientSequence`; a real-shaped payload
    // carries `clientSequence`. Both are accepted here (permissive bridge),
    // never in the strict mirrors.
    const isHookShaped =
      a.clientSequence === undefined && a.clientTimestamp !== undefined;
    void isHookShaped;
    const op = normalizeEntry(a.operation);
    const { serverSequence } = this.applyOp(op);
    this.version += 1;
    void name;
    return { success: true, serverSequence, newVersion: this.version };
  }
}

/** Accept either a real-shaped entry `{ operation, clientSequence }` or the
 * hook's bare `{ type, position, text, length }` op (bridge only). */
function normalizeEntry(entry: unknown): RawOp {
  if (entry && typeof entry === "object" && "operation" in (entry as object)) {
    const wrapper = entry as { operation: RawOp };
    return wrapper.operation;
  }
  const bare = entry as {
    type: "insert" | "delete" | "retain";
    position: number;
    text?: string;
    content?: string;
    length?: number;
  };
  return {
    type: bare.type,
    position: bare.position,
    content: bare.content ?? bare.text,
    length: bare.length,
  };
}

function describeRef(fnRef: unknown): string {
  // Convex 1.28's generated api hands out Proxied function references that
  // throw on String()/property inspection and are not identity-stable, so
  // the witness test mocks "@convex/_generated/api" with refs tagged with
  // their own api path (__convexPath) — see the vi.mock in the witness test.
  const tagged = fnRef as { __convexPath?: string } | null | undefined;
  if (tagged && typeof tagged.__convexPath === "string") {
    return tagged.__convexPath;
  }
  return "unknown-function";
}

// ----------------------------------------------------------------------
// Strict validator mirrors (used by the witness tests, not the bridge)
// ----------------------------------------------------------------------

const OP_TYPES = new Set(["insert", "delete", "retain"]);

/** Mirrors the real batchApplyNoteOperations args validator
 * (convex/notes/mutations.ts:392-400): required fields are checked in the
 * validator's own order — including the wrapped `operation` object — and
 * unknown fields are rejected afterwards with the real error string. */
export function validateBatchArgs(args: unknown): void {
  const a = args as {
    meetingId?: unknown;
    operations?: unknown;
    expectedVersion?: unknown;
  } | null;

  if (!a || typeof a !== "object") {
    throw new ValidatorMirrorError(
      "Validator error: Argument of type `null` is not an object",
    );
  }
  if (typeof a.meetingId !== "string" || a.meetingId.length === 0) {
    throw new ValidatorMirrorError(
      "Validator error: Missing required field `meetingId` in object",
    );
  }
  if (!Array.isArray(a.operations)) {
    throw new ValidatorMirrorError(
      "Validator error: Missing required field `operations` in object",
    );
  }
  for (const entry of a.operations) {
    validateBatchEntry(entry);
  }
  if (
    a.expectedVersion !== undefined &&
    typeof a.expectedVersion !== "number"
  ) {
    throw new ValidatorMirrorError(
      "Validator error: Expected `number` for field `expectedVersion` in object",
    );
  }

  // Convex object validators reject unknown top-level fields after the
  // validator's own fields are satisfied (walk order: required → types →
  // unknown). The hook's payload adds `clientTimestamp`, which the real
  // endpoint rejects here.
  const known = new Set(["meetingId", "operations", "expectedVersion"]);
  for (const key of Object.keys(a as object)) {
    if (!known.has(key)) {
      throw new ValidatorMirrorError(
        `Validator error: Unexpected field \`${key}\` in object`,
      );
    }
  }
}

function validateBatchEntry(entry: unknown): void {
  if (!entry || typeof entry !== "object") {
    throw new ValidatorMirrorError(
      "Validator error: Expected `object` in array `operations`",
    );
  }
  const e = entry as {
    operation?: unknown;
    clientSequence?: unknown;
    clientTimestamp?: unknown;
  };
  // The real entry validator requires `operation` FIRST — a bare op
  // ({type, position, …}) fails with "Missing required field `operation`".
  if (typeof e.operation !== "object" || e.operation === null) {
    throw new ValidatorMirrorError(
      "Validator error: Missing required field `operation` in object",
    );
  }
  validateOpObject(e.operation);
  if (typeof e.clientSequence !== "number") {
    throw new ValidatorMirrorError(
      "Validator error: Missing required field `clientSequence` in object",
    );
  }
  const entryKnown = new Set(["operation", "clientSequence"]);
  for (const key of Object.keys(e as object)) {
    if (!entryKnown.has(key)) {
      throw new ValidatorMirrorError(
        `Validator error: Unexpected field \`${key}\` in object`,
      );
    }
  }
}

/** Mirrors the real applyNoteOperation args validator (singular): rejects
 * the hook's `text` field with the real "Unexpected field" error. */
export function validateSingularArgs(args: unknown): void {
  const a = args as {
    meetingId?: unknown;
    operation?: unknown;
    clientSequence?: unknown;
    clientTimestamp?: unknown;
    expectedVersion?: unknown;
  } | null;

  if (!a || typeof a !== "object") {
    throw new ValidatorMirrorError(
      "Validator error: Argument of type `null` is not an object",
    );
  }
  if (typeof a.meetingId !== "string" || a.meetingId.length === 0) {
    throw new ValidatorMirrorError(
      "Validator error: Missing required field `meetingId` in object",
    );
  }
  if (typeof a.operation !== "object" || a.operation === null) {
    throw new ValidatorMirrorError(
      "Validator error: Missing required field `operation` in object",
    );
  }
  validateOpObject(a.operation);
  if (typeof a.clientSequence !== "number") {
    throw new ValidatorMirrorError(
      "Validator error: Missing required field `clientSequence` in object",
    );
  }
  if (
    a.expectedVersion !== undefined &&
    typeof a.expectedVersion !== "number"
  ) {
    throw new ValidatorMirrorError(
      "Validator error: Expected `number` for field `expectedVersion` in object",
    );
  }

  // Walk order: unknown fields are rejected after the validator's own
  // fields — the hook's `clientTimestamp` lands here, and its op-level
  // `text` already failed in validateOpObject.
  const known = new Set([
    "meetingId",
    "operation",
    "clientSequence",
    "expectedVersion",
  ]);
  for (const key of Object.keys(a as object)) {
    if (!known.has(key)) {
      throw new ValidatorMirrorError(
        `Validator error: Unexpected field \`${key}\` in object`,
      );
    }
  }
}

function validateOpObject(op: unknown): void {
  if (!op || typeof op !== "object") {
    throw new ValidatorMirrorError(
      "Validator error: Expected `object` for field `operation`",
    );
  }
  const o = op as {
    type?: unknown;
    position?: unknown;
    content?: unknown;
    length?: unknown;
    text?: unknown;
  };
  if (typeof o.type !== "string" || !OP_TYPES.has(o.type)) {
    throw new ValidatorMirrorError(
      "Validator error: Missing required field `type` in object",
    );
  }
  if (typeof o.position !== "number") {
    throw new ValidatorMirrorError(
      "Validator error: Missing required field `position` in object",
    );
  }
  if (o.content !== undefined && typeof o.content !== "string") {
    throw new ValidatorMirrorError(
      "Validator error: Expected `string` for field `content` in object",
    );
  }
  if (o.length !== undefined && typeof o.length !== "number") {
    throw new ValidatorMirrorError(
      "Validator error: Expected `number` for field `length` in object",
    );
  }
  // NoteV.operation has `content`, never `text` (convex/schema/offline.ts).
  const known = new Set(["type", "position", "content", "length"]);
  for (const key of Object.keys(o as object)) {
    if (!known.has(key)) {
      throw new ValidatorMirrorError(
        `Validator error: Unexpected field \`${key}\` in object`,
      );
    }
  }
}

// ----------------------------------------------------------------------
// Module-level current transport — the vi.mock("convex/react") factory in
// the witness test delegates here (the factory cannot close over test
// locals, so the test installs the transport it wants per case).
// ----------------------------------------------------------------------

let currentTransport: FakeMeetingTransport | null = null;

export function setCurrentTransport(
  transport: FakeMeetingTransport | null,
): void {
  currentTransport = transport;
}

export function getCurrentTransport(): FakeMeetingTransport {
  if (!currentTransport) {
    throw new Error(
      "No fake meeting transport installed — call setCurrentTransport in the test",
    );
  }
  return currentTransport;
}

export function createFakeMeetingTransport(): FakeMeetingTransport {
  return new FakeMeetingTransport();
}
