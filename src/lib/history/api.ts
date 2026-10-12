/**
 * Typed access to the history Convex module.
 *
 * convex/_generated at this head predates convex/history/ — that codegen
 * commit belongs to the data-layer task — so the generated `api` type
 * union has no `history` entry and `api.history.queries.*` fails
 * type-check. The runtime api object still resolves any module path, so
 * the four function references are captured ONCE here (module-level
 * constants: every importer sees the same object identity, which the
 * mounted tests' hook dispatch relies on) and exposed under explicit
 * structural types verified against convex/history/{queries,mutations}.ts.
 * When the generated api gains the history module, this file is the
 * single switch point back to the generated references; consumers never
 * change.
 */
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReference, PaginationOpts } from "convex/server";

/** Meeting lifecycle states, mirroring the meetings table validator. */
export type MeetingState = "scheduled" | "active" | "concluded" | "cancelled";

/** Participant roles on a meeting, mirroring the meetingParticipants table. */
export type MeetingRole = "host" | "participant" | "observer";

/** One participant-scoped list item served by listMyMeetings. */
export type MeetingListItem = {
  meeting: {
    _id: Id<"meetings">;
    title: string;
    state: MeetingState;
    scheduledAt: number | null;
    duration: number | null;
    createdAt: number;
  };
  role: MeetingRole;
  startedAt: number | null;
  endedAt: number | null;
};

/** The listMyMeetings envelope consumed by usePaginatedQuery. */
export type MeetingListPage = {
  page: MeetingListItem[];
  isDone: boolean;
  continueCursor: string | null;
};

/** The full after-call history payload served by getMeetingHistory. */
export type MeetingHistoryPayload = {
  meeting: {
    _id: Id<"meetings">;
    organizerId: Id<"users">;
    title: string;
    description: string | null;
    scheduledAt: number | null;
    duration: number | null;
    state: MeetingState;
    createdAt: number;
    updatedAt: number;
  };
  myRole: MeetingRole;
  participants: Array<{
    userId: Id<"users">;
    displayName: string | null;
    role: MeetingRole;
    presence: string;
    joinedAt: number | null;
    leftAt: number | null;
  }>;
  state: {
    startedAt: number | null;
    endedAt: number | null;
  } | null;
  lifecycleEvents: Array<{
    _id: string;
    event: string;
    timestamp: number;
  }>;
  notes: {
    content: string;
    version: number;
  } | null;
  prompts: Array<{
    _id: string;
    content: string;
    type: string;
    usedAt: number | null;
    createdAt: number;
  }>;
};

/** The stay-in-touch status shared by the status query and the mutation. */
export type StayInTouchStatus = { enabled: boolean; mutual: boolean };

type HistoryQueryName =
  | "listMyMeetings"
  | "getMeetingHistory"
  | "getStayInTouchStatus";

/**
 * Captures the real generated reference when the runtime api object
 * already has the history module; otherwise mirrors the reference shape
 * the api proxy produces for the same path. Either way the reference is
 * captured once so identity is stable for every consumer.
 */
function historyQueryRef(name: HistoryQueryName): FunctionReference<"query", "public"> {
  const generated = api as unknown as {
    history?: {
      queries?: { [K in HistoryQueryName]?: FunctionReference<"query", "public"> };
    };
  };
  const captured = generated.history?.queries?.[name];
  if (captured) return captured;
  return {
    type: "query",
    visibility: "public",
    name: `history/queries:${name}`,
  } as unknown as FunctionReference<"query", "public">;
}

/** Same capture for the module's single mutation. */
function historyMutationRef(
  name: "setStayInTouch",
): FunctionReference<"mutation", "public"> {
  const generated = api as unknown as {
    history?: {
      mutations?: { [K in "setStayInTouch"]?: FunctionReference<"mutation", "public"> };
    };
  };
  const captured = generated.history?.mutations?.[name];
  if (captured) return captured;
  return {
    type: "mutation",
    visibility: "public",
    name: `history/mutations:${name}`,
  } as unknown as FunctionReference<"mutation", "public">;
}

/** listMyMeetings, with the pagination args usePaginatedQuery supplies. */
export const listMyMeetingsRef = historyQueryRef("listMyMeetings") as unknown as FunctionReference<
  "query",
  "public",
  { paginationOpts: PaginationOpts },
  MeetingListPage
>;

/** getMeetingHistory, scoped to the caller and keyed by meeting id. */
export const getMeetingHistoryRef = historyQueryRef("getMeetingHistory") as unknown as FunctionReference<
  "query",
  "public",
  { meetingId: Id<"meetings"> },
  MeetingHistoryPayload
>;

/** getStayInTouchStatus for the caller on one meeting. */
export const getStayInTouchStatusRef = historyQueryRef("getStayInTouchStatus") as unknown as FunctionReference<
  "query",
  "public",
  { meetingId: Id<"meetings"> },
  StayInTouchStatus
>;

/** setStayInTouch — records the caller's own opt-in and returns the refreshed status. */
export const setStayInTouchRef = historyMutationRef("setStayInTouch") as unknown as FunctionReference<
  "mutation",
  "public",
  { meetingId: Id<"meetings">; enabled: boolean },
  StayInTouchStatus
>;

/** The history module's queries, mirroring api.history.queries. */
export const historyQueries = {
  listMyMeetings: listMyMeetingsRef,
  getMeetingHistory: getMeetingHistoryRef,
  getStayInTouchStatus: getStayInTouchStatusRef,
} as const;

/** The history module's mutations, mirroring api.history.mutations. */
export const historyMutations = {
  setStayInTouch: setStayInTouchRef,
} as const;
