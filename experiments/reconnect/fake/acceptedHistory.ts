/**
 * Accepted History — the experiment's independent record of what the fake
 * Convex server actually accepted, in order, keyed by client mutation id.
 *
 * This ledger is deliberately a SEPARATE object from the client-side cache:
 * the whole point of the reconnect study is that optimistic/visible client
 * state and accepted server state can (and do) diverge. Everything here is
 * written by the fake SERVER only — the client can never edit it.
 */

export interface AcceptedHistoryEntry {
  /** Monotonic sequence of accepted mutations, across all tables. */
  seq: number;
  /** Client-side identity of the mutation. Duplicates show up as repeats. */
  clientMutationId: string;
  /** Server function name (label). */
  name: string;
  /** Arguments the server saw. */
  args: unknown;
  /** State before the mutation was applied. */
  before: unknown;
  /** State after the mutation was applied. */
  after: unknown;
}

export class AcceptedHistory {
  private entries: AcceptedHistoryEntry[] = [];
  private nextSeq = 0;

  record(entry: Omit<AcceptedHistoryEntry, "seq">): AcceptedHistoryEntry {
    const full = { ...entry, seq: this.nextSeq++ };
    this.entries.push(full);
    return full;
  }

  list(): readonly AcceptedHistoryEntry[] {
    return this.entries;
  }

  /** Times each client mutation id was accepted (values > 1 = duplicated). */
  acceptCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const e of this.entries) {
      counts.set(e.clientMutationId, (counts.get(e.clientMutationId) ?? 0) + 1);
    }
    return counts;
  }

  /** Client mutation ids the server accepted more than once. */
  duplicatedMutationIds(): string[] {
    return [...this.acceptCounts().entries()]
      .filter(([, n]) => n > 1)
      .map(([id]) => id);
  }

  /** Number of EXTRA journal entries caused by duplicate acceptance. */
  duplicateEntryCount(): number {
    return [...this.acceptCounts().values()].reduce((acc, n) => acc + (n > 1 ? n - 1 : 0), 0);
  }

  /** Client mutation ids the server accepted at least once. */
  acceptedMutationIds(): Set<string> {
    return new Set(this.entries.map((e) => e.clientMutationId));
  }

  lastFor(name: string): AcceptedHistoryEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].name === name) return this.entries[i];
    }
    return undefined;
  }
}
