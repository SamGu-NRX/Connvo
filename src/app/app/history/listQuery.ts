import type { HistoryMeetingListItem, MeetingStateFilter } from "./types";

export const PAGE_SIZE = 8;
export const HISTORY_STATE_FILTERS: MeetingStateFilter[] = ["concluded", "all", "scheduled", "active", "cancelled"];

export interface ListQuery {
  q: string;
  state: MeetingStateFilter;
  page: number;
}

export const DEFAULT_LIST_QUERY: ListQuery = { q: "", state: "concluded", page: 1 };

export function parseListQuery(params: URLSearchParams): ListQuery {
  const q = params.get("q") ?? "";
  const rawState = params.get("state");
  const state = HISTORY_STATE_FILTERS.includes(rawState as MeetingStateFilter)
    ? (rawState as MeetingStateFilter)
    : DEFAULT_LIST_QUERY.state;
  const page = Math.max(1, Math.floor(Number(params.get("page") ?? "1")) || 1);
  return { q, state, page };
}

export function buildListSearchParams(query: ListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.state !== DEFAULT_LIST_QUERY.state) params.set("state", query.state);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

export interface VisibleMeetings {
  items: HistoryMeetingListItem[];
  totalMatches: number;
  totalPages: number;
  page: number;
}

/** Client-side selection over the participant-scoped list result - never a server-side scan. */
export function selectVisibleMeetings(items: HistoryMeetingListItem[], query: ListQuery): VisibleMeetings {
  const needle = query.q.trim().toLowerCase();
  const filtered = items.filter((meeting) => {
    if (query.state !== "all" && meeting.state !== query.state) return false;
    if (!needle) return true;
    return (
      meeting.title.toLowerCase().includes(needle) ||
      (meeting.description ?? "").toLowerCase().includes(needle)
    );
  });
  const totalMatches = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalMatches / PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page), totalPages);
  const start = (page - 1) * PAGE_SIZE;
  return { items: filtered.slice(start, start + PAGE_SIZE), totalMatches, totalPages, page };
}
