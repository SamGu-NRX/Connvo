/**
 * Deterministic, extractive recap builder for the after-call history view.
 *
 * Pure TypeScript: no Convex imports, no AI, no generation. Every item is
 * traceable to a field of the RecapInput, and identical inputs always
 * produce byte-identical output (all ordering is by timestamp then id;
 * nothing reads the clock or random state).
 */

export interface RecapInput {
  meeting: {
    _id: string;
    title: string;
    state: string;
    scheduledAt?: number | null;
    duration?: number | null;
    createdAt: number;
  };
  participants: Array<{
    userId: string;
    displayName: string | null;
    role: string;
    presence: string;
    joinedAt: number | null;
    leftAt: number | null;
  }>;
  state: { startedAt?: number | null; endedAt?: number | null } | null;
  lifecycleEvents: Array<{ _id: string; event: string; timestamp: number }>;
  notes: { content: string; version: number } | null;
  prompts: Array<{
    _id: string;
    content: string;
    type: string;
    usedAt?: number | null;
    createdAt: number;
  }>;
}

export interface RecapSection {
  kind: string;
  title: string;
  items: string[];
}

/** Which input sources were present (true) or absent (false). */
export interface RecapSources {
  participants: boolean;
  duration: boolean;
  lifecycleEvents: boolean;
  notes: boolean;
  prompts: boolean;
}

export interface RecapResult {
  sections: RecapSection[];
  sources: RecapSources;
}

/** Stable id-string comparator: deterministic across identical inputs. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Builds the ordered recap sections from meeting records. Missing sources
 * emit the specified literal items — nothing is ever fabricated.
 */
export function buildRecap(input: RecapInput): RecapResult {
  const sections: RecapSection[] = [];

  // Participants: real names + roles from the records. Deterministic order
  // by display name (falling back to userId) then userId.
  const participantItems = [...input.participants]
    .sort((a, b) => {
      const aLabel = a.displayName ?? a.userId;
      const bLabel = b.displayName ?? b.userId;
      if (aLabel !== bLabel) return aLabel < bLabel ? -1 : 1;
      return compareIds(a.userId, b.userId);
    })
    .map((p) => {
      const label = p.displayName ?? p.userId;
      return `${label} (${p.role})`;
    });

  sections.push({
    kind: "participants",
    title: "Participants",
    items: participantItems,
  });

  // Duration: only from state.startedAt/state.endedAt when BOTH are
  // present, formatted as minutes. Never fabricate a duration.
  const durationRecorded =
    input.state !== null &&
    typeof input.state.startedAt === "number" &&
    typeof input.state.endedAt === "number";
  const durationItems = durationRecorded
    ? [
        `${Math.round(
          ((input.state?.endedAt ?? 0) - (input.state?.startedAt ?? 0)) / 60000,
        )} minutes`,
      ]
    : ["Not recorded"];

  sections.push({
    kind: "duration",
    title: "Duration",
    items: durationItems,
  });

  // Lifecycle events: verbatim event names with counts, chronological
  // (by timestamp then id), first occurrence order.
  const eventOrder: string[] = [];
  const eventCounts = new Map<string, number>();
  for (const event of [...input.lifecycleEvents].sort(
    (a, b) => a.timestamp - b.timestamp || compareIds(a._id, b._id),
  )) {
    if (!eventCounts.has(event.event)) eventOrder.push(event.event);
    eventCounts.set(event.event, (eventCounts.get(event.event) ?? 0) + 1);
  }

  sections.push({
    kind: "lifecycleEvents",
    title: "Lifecycle events",
    items: eventOrder.map((event) => `${event} \u00d7${eventCounts.get(event)}`),
  });

  // Shared notes: verbatim content with its version number; the literal
  // item when no note exists.
  sections.push({
    kind: "notes",
    title: "Shared notes",
    items:
      input.notes !== null
        ? [`${input.notes.content} (version ${input.notes.version})`]
        : ["No notes were shared during this meeting"],
  });

  // Prompts: verbatim content. Used prompts (usedAt recorded) come first;
  // the rest form the "served, no use recorded" subsection; the literal
  // item when none were recorded at all.
  if (input.prompts.length === 0) {
    sections.push({
      kind: "prompts-used",
      title: "Prompts used",
      items: ["No prompts were recorded"],
    });
  } else {
    const used = [...input.prompts]
      .filter((p) => typeof p.usedAt === "number")
      .sort(
        (a, b) =>
          (a.usedAt ?? 0) - (b.usedAt ?? 0) || compareIds(a._id, b._id),
      )
      .map((p) => p.content);
    if (used.length > 0) {
      sections.push({
        kind: "prompts-used",
        title: "Prompts used",
        items: used,
      });
    }

    const servedUnused = [...input.prompts]
      .filter((p) => typeof p.usedAt !== "number")
      .sort((a, b) => a.createdAt - b.createdAt || compareIds(a._id, b._id))
      .map((p) => p.content);
    if (servedUnused.length > 0) {
      sections.push({
        kind: "prompts-served",
        title: "Served, no use recorded",
        items: servedUnused,
      });
    }
  }

  return {
    sections,
    sources: {
      participants: input.participants.length > 0,
      duration: durationRecorded,
      lifecycleEvents: input.lifecycleEvents.length > 0,
      notes: input.notes !== null,
      prompts: input.prompts.length > 0,
    },
  };
}
